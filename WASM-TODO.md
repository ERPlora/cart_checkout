# cart_checkout — estado Tier 2 (WASM)

El handler WASM (`handler/src/lib.rs` → `dist/handler.wasm`) está **implementado** para los
6 commands Tier 2: `add_to_cart`, `update_cart_item`, `clear_cart`, `cleanup_expired_carts`,
`initiate_checkout`, `complete_checkout` (cierra cart_checkout#1).

> Regla hub: el WASM **nunca toca la BD**. Recibe `{payload, context}` y devuelve
> *intenciones* (commands `_`-prefijados del propio módulo) que el runtime valida y
> persiste en UNA transacción, más los eventos a emitir. Importes `quantize(0.01)`
> (redondeo half-even, igual que sales/kitchen).

## Adaptaciones al runtime actual (sin lecturas pre-cargadas)

El diseño original preveía que el handler leyera el carrito/las líneas vía host functions
antes de decidir. El runtime de hoy solo pasa
`{payload, context{hub_id, current_user_id, now, new_ids}}`, así que (patrón `kitchen`):

1. **Resolución del carrito en SQL**: las intenciones resuelven el carrito por
   `session_token` (o desde la línea por `item_id`) dentro del propio SQL.
2. **Motor de totales (§1 original)**: `_recalc_totals_by_token` / `_recalc_totals_by_item`
   recalculan `total_items` (SUM quantity) y `total_amount` (SUM line_total) de las líneas
   vivas + `last_activity_at = now`, en la misma transacción que el cambio de líneas.
   `cart_checkout.items.remove` (SQL declarativo) **ya no deja totales obsoletos**: encadena
   `_recalc_totals_by_item.sql` como segundo statement de su transacción y aplica la guarda
   `active` (cierra cart_checkout#2).
3. **`line_total` en update**: el `unit_price` vive en la fila, así que
   `_update_item_qty` recalcula `line_total = ROUND(unit_price * :quantity, 2)` en SQL
   (en `add_to_cart` lo calcula el handler con quantize 0.01, el precio viene en payload).
4. **Guardas de estado en el WHERE** de la intención (no-op si no se cumplen, sin mensaje):
   carrito `active` para añadir/editar/vaciar líneas e iniciar checkout; carrito no vacío
   (`empty_cart`) para iniciar; solo `paid → completed` para completar. Los errores tipados
   del legacy se devuelven solo para lo validable desde el payload: `invalid_quantity`,
   `invalid_price`, `invalid_email`, `missing_*`. Mejora futura: con lecturas pre-cargadas,
   devolver también `invalid_state`/`not_found`/`empty_cart` tipados.
5. **`order_number` atómico** `OS-YYYYMMDD-NNNN` (§2 original): `_bump_counter` (upsert
   sobre `cart_checkout_order_counter`, migración `002_order_counter.sql`) + subquery en
   `_insert_checkout` (patrón `sales`/`kitchen`; `printf()` es SQLite — en Postgres sería
   `lpad()`, portabilidad §14). La colisión final la atrapa `uq_checkout_hub_order_number`.
6. **Efecto cruzado de `complete_checkout`** (§3 original): `_complete_checkout`
   (paid → completed) + `_convert_cart` (carrito → converted, solo si la sesión quedó
   `completed`) en la MISMA transacción.
7. **`cleanup_expired_carts`** es un batch set-based (`_expire_carts`); sin lecturas
   pre-cargadas no puede devolver el nº de carritos expirados (mejora futura).
8. **Eventos (§5 original)**: los commands WASM NO declaran `emit` (los eventos los
   devuelve el handler en `Output.events` y el runtime los persiste en el outbox en la
   misma transacción): `cart_checkout.item.added`, `cart_checkout.item.updated`,
   `cart_checkout.cart.cleared`, `cart_checkout.carts.expired`,
   `cart_checkout.checkout.initiated`, `cart_checkout.order.completed`
   (cierra cart_checkout#3).
