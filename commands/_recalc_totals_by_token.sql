-- Recalcula los totales denormalizados del carrito (motor de totales, WASM-TODO §1)
-- resolviendo el carrito por session_token. total_items = SUM(quantity) y
-- total_amount = SUM(line_total) de las líneas vivas; refresca last_activity_at.
-- Solo carritos 'active' (no-op si no). Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_cart
SET total_items      = COALESCE((SELECT SUM(i.quantity) FROM cart_checkout_item i
                                 WHERE i.cart_id = cart_checkout_cart.id
                                   AND i.hub_id = :hub_id AND i.is_deleted = 0), 0),
    total_amount     = COALESCE((SELECT ROUND(SUM(i.line_total), 2) FROM cart_checkout_item i
                                 WHERE i.cart_id = cart_checkout_cart.id
                                   AND i.hub_id = :hub_id AND i.is_deleted = 0), 0),
    last_activity_at = :now,
    updated_by       = :current_user_id,
    updated_at       = :now
WHERE hub_id = :hub_id AND session_token = :session_token
  AND status = 'active' AND is_deleted = 0;
