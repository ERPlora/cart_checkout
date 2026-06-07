# cart_checkout — lógica NO-CRUD pendiente (Tier 2 Rust→WASM)

Las tablas, queries y los
commands de CRUD puro (alta de carrito, soft-delete, transiciones simples de estado
con guarda por `status` en el `WHERE`) viven ya en SQL declarativo. Todo lo que sigue
es **lógica de negocio** que NO se puede expresar en SQL puro y debe implementarse en el
handler WASM (Extism), que **no toca la BD**: recibe la entrada, lee vía host functions
(queries del propio módulo) y devuelve *intenciones* (commands declarativos) que el
runtime Rust valida y ejecuta. Mapeo de funciones en `module.json` → `commands[*].handler`.

## 1. Motor de totales del carrito (denormalización)

`Cart.total_items` y `Cart.total_amount` son un **snapshot denormalizado** que se
recalcula cada vez que cambian las líneas. En el legacy: `CartItem.calculate()`
(`line_total = quantity * unit_price`, redondeo a 2 decimales) y
`Cart.recalculate_totals()` (suma de cantidades + suma de `line_total`).

Afecta a estas funciones WASM:

- **`add_to_cart`** (`cart_checkout.items.add`) — porta `CartCheckoutService.add_to_cart`:
 - Valida `session_token`, `product_ref`, `product_name` no vacíos; `quantity` entero > 0;
 `unit_price` parseable a decimal.
 - Resuelve el carrito por `session_token`; **guarda**: el carrito debe estar `active`
 (rechazo `invalid_state` si no).
 - Calcula `line_total = quantity * unit_price` (quantize 0.01).
 - Inserta la línea (command interno `_insert_item`), recalcula los totales del carrito y
 actualiza `total_items`/`total_amount`/`last_activity_at` (command interno
 `_update_cart_totals`). Todo dentro de la misma transacción.
 - NOTA legacy: el docstring menciona "bump quantity si mismo ref + variant" pero el código
 real siempre inserta línea nueva — portar el **comportamiento real** (insertar).

- **`update_cart_item`** (`cart_checkout.items.update`) — porta `update_cart_item`:
 - `quantity` entero. Si `<= 0` ⇒ soft-delete de la línea; si `> 0` ⇒ actualiza
 `quantity` y recalcula `line_total`.
 - **Guarda**: carrito asociado debe estar `active`.
 - Recalcula totales del carrito + `last_activity_at`. Devuelve `removed: bool`.

- **`clear_cart`** (`cart_checkout.carts.clear`) — porta `clear_cart`:
 - **Guarda**: carrito `active`. Soft-delete de todas las líneas, totales a 0,
 `last_activity_at = now`. Mantiene la fila del carrito.

> El command declarativo `cart_checkout.items.remove` ya hace el soft-delete de UNA línea,
> pero **no recalcula** los totales del carrito. El recálculo posterior debe orquestarlo el
> motor; mientras `items.remove` se llame en aislado, los totales quedan obsoletos. Idealmente
> `remove` pasa también a WASM (recálculo) — se deja como command SQL por ahora para no
> bloquear el listado; documentado aquí como deuda.

## 2. Contador atómico de número de pedido

`CartCheckoutService._generate_order_number()` genera `OS-YYYYMMDD-NNNN`: cuenta los
checkouts del día (`order_number LIKE 'OS-YYYYMMDD-%'`) e incrementa. Es un **contador
secuencial por hub/día**, no expresable de forma segura en SQL declarativo puro (carrera).
Va en WASM dentro de la transacción de `initiate_checkout`; la colisión final la atrapa el
índice único `uq_checkout_hub_order_number`.

## 3. Pipeline de checkout (máquina de estados con efectos cruzados)

- **`initiate_checkout`** (`cart_checkout.checkout.initiate`) — porta `initiate_checkout`:
 - Valida `customer_email`. Resuelve carrito; **guarda**: `active`.
 - **Guarda**: el carrito no puede estar vacío (`empty_cart` si no hay líneas).
 - Genera `order_number` (§2). Inserta `CheckoutSession` con `status='initiated'`,
 `placed_at=now`, `total_amount = cart.total_amount` (snapshot), y
 `billing_address = billing_address or shipping_address` (fallback).

- **`complete_checkout`** (`cart_checkout.orders.complete`) — porta `complete_checkout`:
 - **Guarda**: checkout en `paid` (solo `paid → completed`).
 - Efecto cruzado: marca el `CheckoutSession` como `completed` (`completed_at=now`)
 **y** el `Cart` asociado como `converted`, en la misma transacción.

- **`cleanup_expired_carts`** (`cart_checkout.carts.cleanup_expired`) — porta
 `cleanup_expired_carts` (tarea programada): marca como `expired` todos los carritos
 `active` con `expires_at < now`. Devuelve el número de carritos expirados. Es un
 batch multi-fila con condición temporal; va en WASM (o, alternativamente, un command
 SQL `UPDATE ... WHERE status='active' AND expires_at < :now` si el runtime expone un
 bind `:now` — se deja en WASM por consistencia con el resto del pipeline).

> Las transiciones simples `initiated→paid` (`orders.mark_paid`) y `*→failed`
> (`orders.fail`) ya están como commands SQL con la guarda de estado en el `WHERE`.
> Las que tienen **efectos cruzados** (complete → marca el carrito) o **derivación de datos**
> (initiate → genera order_number + snapshot de total) requieren WASM.

## 4. Invariantes / guardas de máquina de estados

El legacy devuelve errores `invalid_state` cuando una transición no es válida (p.ej. añadir
ítems a un carrito no-`active`). En declarativo las hemos expresado como filtro `WHERE
status = ...` (el UPDATE simplemente no afecta filas). El runtime/WASM debería convertir
"0 filas afectadas" en un error tipado para que la UI muestre el motivo, replicando los
códigos del legacy: `invalid_state`, `not_found`, `empty_cart`, `duplicate_session_token`,
`invalid_quantity`, `invalid_price`, `missing_*`.

## 5. Eventos emitidos

`module.json` declara `emit` en los commands SQL. El motor WASM debe emitir los eventos
equivalentes para sus operaciones: `cart_checkout.item.added`, `cart_checkout.item.updated`,
`cart_checkout.cart.cleared`, `cart_checkout.checkout.initiated`,
`cart_checkout.order.completed`, `cart_checkout.carts.expired`.
