//! Handler WASM (Tier 2) del módulo `cart_checkout` — carrito y checkout.
//!
//! Lógica pura, sin BD: cada función recibe `{payload, context}`, valida y devuelve
//! **intenciones** (commands `_`-prefijados del propio módulo) que el host ejecuta en
//! UNA transacción, más los eventos `cart_checkout.*` a emitir.
//!
//! Restricciones del runtime actual (patrón `kitchen`/`sales`):
//! * la resolución del carrito por `session_token` y las guardas de estado (`active`,
//!   carrito no vacío, `paid → completed`) van EN EL SQL de la intención (no-op si no se
//!   cumplen); los errores tipados del legacy (`invalid_state`, `not_found`, `empty_cart`)
//!   solo se devuelven para lo validable desde el payload (`invalid_quantity`,
//!   `invalid_price`, `invalid_email`, `missing_*`);
//! * las CANTIDADES son punto fijo entero escala 10⁶ (ADR-0147): `500000` = 0,5;
//! * `line_total = quantity * unit_price` vía `money::mul_qty` con la cantidad LÓGICA
//!   (raw/10⁶); en `update_cart_item` el precio vive en la fila y llega por la read
//!   pre-cargada `cart_checkout.items.get` (ADR-0069 fase 2) — el SQL ya NO redondea;
//! * los totales del carrito (`total_items`/`total_amount`) se recalculan con las
//!   intenciones `_recalc_totals_by_token` / `_recalc_totals_by_item` (WASM-TODO §1);
//! * `order_number` atómico `OS-YYYYMMDD-NNNN`: `_bump_counter` (upsert) +
//!   `_insert_checkout` leyendo el contador con subquery en la MISMA transacción;
//! * ids: el host pasa `context.new_ids` (autoridad de ids); el guest solo los reparte.

use erplora_guest_sdk::money;
use erplora_guest_sdk::units::QUANTITY_SCALE;
use erplora_guest_sdk::{Event, Operation, Output};
use rust_decimal::Decimal;
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

// ── Exports WASM ───────────────────────────────────────────────────────────

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn add_to_cart(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(add_to_cart_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn update_cart_item(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(update_cart_item_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn clear_cart(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(clear_cart_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn cleanup_expired_carts(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(cleanup_expired_carts_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn initiate_checkout(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(initiate_checkout_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn complete_checkout(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    to_fn_result(complete_checkout_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
fn to_fn_result(r: Result<Output, String>) -> FnResult<Json<Output>> {
    match r {
        Ok(out) => Ok(Json(out)),
        Err(e) => Err(Error::msg(e).into()),
    }
}

// ── Helpers (mismo estilo que kitchen-handler / sales-handler) ─────────────

// El DINERO lo calcula `erplora_guest_sdk::money` (ADR-0123): una sola implementación.

fn as_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn str_field(p: &Value, k: &str) -> String {
    as_str(p.get(k).unwrap_or(&Value::Null)).trim().to_string()
}

fn str_or(p: &Value, k: &str, d: &str) -> String {
    let s = str_field(p, k);
    if s.is_empty() {
        d.to_string()
    } else {
        s
    }
}

/// Entero estricto (Number entero o String parseable a entero). `None` si no lo es.
fn parse_int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i)
            } else {
                // f64 sin parte fraccional también vale (JSON no distingue 2 de 2.0).
                n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)
            }
        }
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// Campo JSON libre (variant_attributes, direcciones): objeto/array → string JSON;
/// string → tal cual; ausente/null → `default`.
fn json_text(p: &Value, k: &str, default: &str) -> String {
    match p.get(k) {
        Some(Value::Object(_)) | Some(Value::Array(_)) => {
            serde_json::to_string(p.get(k).unwrap()).unwrap_or_else(|_| default.to_string())
        }
        Some(Value::String(s)) if !s.trim().is_empty() => s.clone(),
        _ => default.to_string(),
    }
}

/// `YYYYMMDD` a partir del `context.now` RFC3339 del host.
fn day_from_now(now: &str) -> String {
    let date = now.split('T').next().unwrap_or("");
    let digits: String = date.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        digits[..8].to_string()
    } else {
        "00000000".to_string()
    }
}

struct Ctx {
    now: String,
    user_id: String,
    new_ids: Vec<String>,
}

fn split_input(input: &Value) -> (Value, Ctx) {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let context = input.get("context").cloned().unwrap_or(Value::Null);
    let empty: Vec<Value> = Vec::new();
    let new_ids = context
        .get("new_ids")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .map(as_str)
        .collect();
    let ctx = Ctx {
        now: context.get("now").map(as_str).unwrap_or_default(),
        user_id: context
            .get("current_user_id")
            .map(as_str)
            .unwrap_or_default(),
        new_ids,
    };
    (payload, ctx)
}

/// Evento `cart_checkout.*` con remitente y autor.
fn cc_event(name: &str, user_id: &str, mut extra: Map<String, Value>) -> Event {
    extra.insert("sender".into(), json!("cart_checkout"));
    extra.insert(
        "performed_by_id".into(),
        if user_id.is_empty() {
            Value::Null
        } else {
            json!(user_id)
        },
    );
    Event::new(name, Value::Object(extra))
}

// ── add_to_cart (command cart_checkout.items.add) ──────────────────────────

pub fn add_to_cart_pure(input: Value) -> Result<Output, String> {
    let (payload, ctx) = split_input(&input);

    let session_token = str_field(&payload, "session_token");
    if session_token.is_empty() {
        return Err("missing_session_token".to_string());
    }
    let product_ref = str_field(&payload, "product_ref");
    if product_ref.is_empty() {
        return Err("missing_product_ref".to_string());
    }
    let product_name = str_field(&payload, "product_name");
    if product_name.is_empty() {
        return Err("missing_product_name".to_string());
    }
    let quantity = parse_int(payload.get("quantity").unwrap_or(&Value::Null))
        .filter(|q| *q > 0)
        .ok_or_else(|| "invalid_quantity: debe ser un entero > 0".to_string())?;
    // `-1` es el centinela de "ausente o ilegible": un precio válido nunca es negativo.
    let unit_price = payload
        .get("unit_price")
        .map(|v| money::from_json(v, -1))
        .filter(|p| *p >= 0)
        .ok_or_else(|| "invalid_price: debe ser céntimos >= 0".to_string())?;
    // La cantidad es punto fijo 10⁶ (ADR-0147); el dinero se multiplica por la LÓGICA exacta.
    let line_total = money::mul_qty(
        unit_price,
        Decimal::from(quantity) / Decimal::from(QUANTITY_SCALE),
    );

    let item_id = ctx.new_ids.first().cloned().unwrap_or_default();
    if item_id.is_empty() {
        return Err("missing_new_ids".to_string());
    }

    // Guarda `carrito active` (invalid_state) en el WHERE de `_insert_item` (no-op si no).
    let mut ins = Map::new();
    ins.insert("item_id".into(), json!(item_id));
    ins.insert("session_token".into(), json!(session_token));
    ins.insert("product_ref".into(), json!(product_ref));
    ins.insert("product_name".into(), json!(product_name));
    ins.insert("sku".into(), json!(str_or(&payload, "sku", "")));
    ins.insert("quantity".into(), json!(quantity));
    ins.insert("unit_price".into(), json!(unit_price)); // céntimos
    ins.insert("line_total".into(), json!(line_total)); // céntimos
    ins.insert(
        "variant_attributes".into(),
        json!(json_text(&payload, "variant_attributes", "{}")),
    );

    let mut recalc = Map::new();
    recalc.insert("session_token".into(), json!(session_token));

    let mut ev = Map::new();
    ev.insert("item_id".into(), json!(item_id));
    ev.insert("session_token".into(), json!(session_token));
    ev.insert("product_ref".into(), json!(product_ref));
    ev.insert("quantity".into(), json!(quantity));
    ev.insert("line_total".into(), json!(line_total)); // céntimos

    Ok(Output {
        operations: vec![
            Operation::sql("cart_checkout._insert_item", ins),
            Operation::sql("cart_checkout._recalc_totals_by_token", recalc),
        ],
        events: vec![cc_event("cart_checkout.item.added", &ctx.user_id, ev)],
        ..Default::default()
    })
}

// ── update_cart_item (command cart_checkout.items.update) ──────────────────

/// La fila de la línea pre-cargada por el runtime (read `cart_checkout.items.get`, filtrada por
/// `payload.item_id`). Acepta las dos formas del canal (`[…]` o `{rows:[…]}`), como sales.
fn preloaded_item(input: &Value) -> Option<Value> {
    let node = input
        .get("context")?
        .get("reads")?
        .get("cart_checkout.items.get")?;
    let arr = match node {
        Value::Array(a) => Some(a),
        Value::Object(_) => node.get("rows").and_then(|v| v.as_array()),
        _ => None,
    }?;
    arr.first().cloned()
}

pub fn update_cart_item_pure(input: Value) -> Result<Output, String> {
    let row = preloaded_item(&input);
    let (payload, ctx) = split_input(&input);

    let item_id = str_field(&payload, "item_id");
    if item_id.is_empty() {
        return Err("missing_item_id".to_string());
    }
    let quantity = parse_int(payload.get("quantity").unwrap_or(&Value::Null))
        .ok_or_else(|| "invalid_quantity: debe ser un entero".to_string())?;

    // quantity <= 0 ⇒ soft-delete de la línea; > 0 ⇒ update de qty. El line_total lo calcula
    // el HANDLER con el unit_price de la fila (read pre-cargada, ADR-0069 fase 2): el SQL no
    // redondea (SQLite y Postgres no redondean igual) ni conoce la escala 10⁶ (ADR-0147).
    // Guarda `carrito active` en el WHERE.
    let removed = quantity <= 0;
    let mut op_params = Map::new();
    op_params.insert("item_id".into(), json!(item_id));
    let first = if removed {
        Operation::sql("cart_checkout._soft_delete_item", op_params)
    } else {
        let row = row.ok_or_else(|| {
            "item_not_found: la línea no existe (o la read `cart_checkout.items.get` no está declarada)".to_string()
        })?;
        let unit_price = row
            .get("unit_price")
            .map(|v| money::from_json(v, -1))
            .filter(|p| *p >= 0)
            .ok_or_else(|| "invalid_price: la fila no trae unit_price".to_string())?;
        let line_total = money::mul_qty(
            unit_price,
            Decimal::from(quantity) / Decimal::from(QUANTITY_SCALE),
        );
        op_params.insert("quantity".into(), json!(quantity));
        op_params.insert("line_total".into(), json!(line_total)); // céntimos
        Operation::sql("cart_checkout._update_item_qty", op_params)
    };

    let mut recalc = Map::new();
    recalc.insert("item_id".into(), json!(item_id));

    let mut ev = Map::new();
    ev.insert("item_id".into(), json!(item_id));
    ev.insert("quantity".into(), json!(quantity.max(0)));
    ev.insert("removed".into(), json!(removed));

    Ok(Output {
        operations: vec![
            first,
            Operation::sql("cart_checkout._recalc_totals_by_item", recalc),
        ],
        events: vec![cc_event("cart_checkout.item.updated", &ctx.user_id, ev)],
        ..Default::default()
    })
}

// ── clear_cart (command cart_checkout.carts.clear) ─────────────────────────

pub fn clear_cart_pure(input: Value) -> Result<Output, String> {
    let (payload, ctx) = split_input(&input);

    let session_token = str_field(&payload, "session_token");
    if session_token.is_empty() {
        return Err("missing_session_token".to_string());
    }

    // Soft-delete de todas las líneas + totales a 0 y last_activity_at = now (el recálculo
    // sobre 0 líneas activas deja los totales a 0). Guarda `active` en ambos WHERE.
    let mut del = Map::new();
    del.insert("session_token".into(), json!(session_token));
    let mut recalc = Map::new();
    recalc.insert("session_token".into(), json!(session_token));

    let mut ev = Map::new();
    ev.insert("session_token".into(), json!(session_token));

    Ok(Output {
        operations: vec![
            Operation::sql("cart_checkout._soft_delete_cart_items", del),
            Operation::sql("cart_checkout._recalc_totals_by_token", recalc),
        ],
        events: vec![cc_event("cart_checkout.cart.cleared", &ctx.user_id, ev)],
        ..Default::default()
    })
}

// ── cleanup_expired_carts (command cart_checkout.carts.cleanup_expired) ────

pub fn cleanup_expired_carts_pure(input: Value) -> Result<Output, String> {
    let (_payload, ctx) = split_input(&input);

    // Batch set-based: la condición (active + expires_at < now) va en el SQL. Sin lecturas
    // pre-cargadas no se puede devolver el nº de carritos expirados (mejora futura).
    let mut ev = Map::new();
    ev.insert("expired_before".into(), json!(ctx.now));

    Ok(Output {
        operations: vec![Operation::sql("cart_checkout._expire_carts", Map::new())],
        events: vec![cc_event("cart_checkout.carts.expired", &ctx.user_id, ev)],
        ..Default::default()
    })
}

// ── initiate_checkout (command cart_checkout.checkout.initiate) ────────────

pub fn initiate_checkout_pure(input: Value) -> Result<Output, String> {
    let (payload, ctx) = split_input(&input);

    let session_token = str_field(&payload, "session_token");
    if session_token.is_empty() {
        return Err("missing_session_token".to_string());
    }
    let customer_email = str_field(&payload, "customer_email");
    if customer_email.is_empty() {
        return Err("missing_customer_email".to_string());
    }
    let at = customer_email.find('@');
    if !matches!(at, Some(i) if i > 0 && i < customer_email.len() - 1) {
        return Err("invalid_email".to_string());
    }

    let checkout_id = ctx.new_ids.first().cloned().unwrap_or_default();
    if checkout_id.is_empty() {
        return Err("missing_new_ids".to_string());
    }
    let day = day_from_now(&ctx.now);

    // Fallback legacy: billing_address ← shipping_address si no viene.
    let shipping_address = json_text(&payload, "shipping_address", "{}");
    let billing_address = match payload.get("billing_address") {
        Some(Value::Object(_)) | Some(Value::Array(_)) => {
            json_text(&payload, "billing_address", "{}")
        }
        Some(Value::String(s)) if !s.trim().is_empty() => s.clone(),
        _ => shipping_address.clone(),
    };

    // Contador atómico por hub/día (WASM-TODO §2): upsert + subquery en la misma tx; la
    // colisión final la atrapa el índice único `uq_checkout_hub_order_number`. Guardas
    // `active` + carrito no vacío (`empty_cart`) en el WHERE de `_insert_checkout`.
    let mut bump = Map::new();
    bump.insert("day".into(), json!(day));

    let mut ins = Map::new();
    ins.insert("checkout_id".into(), json!(checkout_id));
    ins.insert("day".into(), json!(day));
    ins.insert("session_token".into(), json!(session_token));
    ins.insert("customer_email".into(), json!(customer_email));
    ins.insert("shipping_address".into(), json!(shipping_address));
    ins.insert("billing_address".into(), json!(billing_address));
    ins.insert(
        "shipping_method".into(),
        json!(str_or(&payload, "shipping_method", "")),
    );
    ins.insert(
        "payment_method".into(),
        json!(str_or(&payload, "payment_method", "")),
    );
    ins.insert("notes".into(), json!(str_or(&payload, "notes", "")));

    let mut ev = Map::new();
    ev.insert("checkout_id".into(), json!(checkout_id));
    ev.insert("session_token".into(), json!(session_token));
    ev.insert("customer_email".into(), json!(customer_email));

    Ok(Output {
        operations: vec![
            Operation::sql("cart_checkout._bump_counter", bump),
            Operation::sql("cart_checkout._insert_checkout", ins),
        ],
        events: vec![cc_event(
            "cart_checkout.checkout.initiated",
            &ctx.user_id,
            ev,
        )],
        ..Default::default()
    })
}

// ── complete_checkout (command cart_checkout.orders.complete) ──────────────

pub fn complete_checkout_pure(input: Value) -> Result<Output, String> {
    let (payload, ctx) = split_input(&input);

    let checkout_id = str_field(&payload, "checkout_id");
    if checkout_id.is_empty() {
        return Err("missing_checkout_id".to_string());
    }

    // Solo `paid → completed` (guarda en el WHERE de `_complete_checkout`); el efecto
    // cruzado `_convert_cart` solo aplica si la sesión quedó `completed` (subquery),
    // ambos en la MISMA transacción.
    let mut complete = Map::new();
    complete.insert("checkout_id".into(), json!(checkout_id));
    let mut convert = Map::new();
    convert.insert("checkout_id".into(), json!(checkout_id));

    let mut ev = Map::new();
    ev.insert("checkout_id".into(), json!(checkout_id));

    Ok(Output {
        operations: vec![
            Operation::sql("cart_checkout._complete_checkout", complete),
            Operation::sql("cart_checkout._convert_cart", convert),
        ],
        events: vec![cc_event("cart_checkout.order.completed", &ctx.user_id, ev)],
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp(payload: Value) -> Value {
        json!({ "payload": payload, "context": {
            "new_ids": ["id-0"], "now": "2026-07-19T10:00:00+00:00", "current_user_id": "u1"
        } })
    }

    #[test]
    fn add_to_cart_quantity_is_fixed_point_10e6() {
        // ADR-0147: la cantidad viaja como punto fijo entero escala 10⁶. 0,5 (500000 µ)
        // × 12,00 € = 6,00 € → 600 céntimos (HALF_UP del SDK), no 600 millones.
        let out = add_to_cart_pure(inp(json!({
            "session_token": "t1", "product_ref": "p1", "product_name": "Vino a granel",
            "quantity": 500_000, "unit_price": 1200
        })))
        .expect("add válido");
        let ins = &out.operations[0].params;
        assert_eq!(ins["quantity"], json!(500_000));
        assert_eq!(ins["line_total"], json!(600));
    }

    #[test]
    fn update_item_line_total_from_preloaded_read() {
        // El unit_price vive en la FILA: llega por la read pre-cargada (ADR-0069 fase 2) y el
        // line_total lo calcula el HANDLER con el SDK — fuera el ROUND(unit_price*qty, 2) del
        // SQL, que además de redondear en SQL (prohibido: SQLite y Postgres no redondean igual)
        // multiplicaría µ como si fueran unidades.
        let input = json!({
            "payload": { "item_id": "i1", "quantity": 2_000_000 },
            "context": {
                "new_ids": [], "now": "2026-07-19T10:00:00+00:00", "current_user_id": "u1",
                "reads": { "cart_checkout.items.get": [ { "id": "i1", "unit_price": 350 } ] }
            }
        });
        let out = update_cart_item_pure(input).expect("update válido");
        assert_eq!(out.operations[0].command, "cart_checkout._update_item_qty");
        let p = &out.operations[0].params;
        assert_eq!(p["quantity"], json!(2_000_000));
        assert_eq!(
            p["line_total"],
            json!(700),
            "2 × 3,50 € — lo calcula el handler, no el SQL"
        );
    }

    #[test]
    fn update_item_without_row_errors() {
        // Fila ausente en la read → error tipado: nunca escribir un line_total a ciegas.
        let input = json!({
            "payload": { "item_id": "ghost", "quantity": 1_000_000 },
            "context": { "new_ids": [], "now": "2026-07-19T10:00:00+00:00", "current_user_id": "u1",
                         "reads": { "cart_checkout.items.get": [] } }
        });
        assert!(update_cart_item_pure(input).is_err());
    }

    #[test]
    fn update_item_zero_still_removes_without_read() {
        // qty <= 0 sigue siendo soft-delete y no necesita la read (no calcula dinero).
        let out = update_cart_item_pure(inp(json!({ "item_id": "i1", "quantity": 0 })))
            .expect("remove válido");
        assert_eq!(out.operations[0].command, "cart_checkout._soft_delete_item");
    }
}
