-- Inserta la sesión de checkout desde un carrito 'active' y NO vacío (guardas
-- invalid_state/empty_cart en el WHERE → no-op si no se cumplen, WASM-TODO §3/§4).
-- :checkout_id (de context.new_ids), :day y las direcciones (billing con fallback a
-- shipping) los aporta el handler WASM (initiate_checkout). total_amount = snapshot del
-- carrito. order_number OS-YYYYMMDD-NNNN se calcula leyendo el contador (recién
-- incrementado por cart_checkout._bump_counter) en la MISMA transacción; la colisión la
-- atrapa uq_checkout_hub_order_number. Padding portable: erp_pad(valor, ancho)
-- (ADR-0007) → printf/lpad por dialecto en el shim del runtime.
-- Runtime inyecta :hub_id, :current_user_id, :now.
INSERT INTO cart_checkout_session
  (id, hub_id, cart_id, order_number, customer_email, shipping_address, billing_address,
   shipping_method, payment_method, status, placed_at, total_amount, notes,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :checkout_id, :hub_id, c.id,
       'OS-' || :day || '-' || erp_pad((
           SELECT last_number FROM cart_checkout_order_counter
           WHERE hub_id = :hub_id AND day = :day
       ), 4),
       :customer_email, :shipping_address, :billing_address,
       :shipping_method, :payment_method, 'initiated', :now, c.total_amount, :notes,
       0, :current_user_id, :current_user_id, :now, :now
FROM cart_checkout_cart c
WHERE c.hub_id = :hub_id AND c.session_token = :session_token
  AND c.status = 'active' AND c.is_deleted = 0
  AND EXISTS (SELECT 1 FROM cart_checkout_item i
              WHERE i.cart_id = c.id AND i.hub_id = :hub_id AND i.is_deleted = 0);
