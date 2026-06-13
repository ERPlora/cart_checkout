-- Recalcula los totales denormalizados del carrito (motor de totales, WASM-TODO §1)
-- resolviendo el carrito a partir de una de sus líneas (:item_id) — la línea puede estar
-- ya soft-deleteada (el lookup no filtra is_deleted). Se encadena tras item_remove.sql en
-- cart_checkout.items.remove y lo reutiliza el handler WASM (update_cart_item).
-- Solo carritos 'active' (no-op si no). Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_cart
SET total_items      = COALESCE((SELECT SUM(i.quantity) FROM cart_checkout_item i
                                 WHERE i.cart_id = cart_checkout_cart.id
                                   AND i.hub_id = :hub_id AND i.is_deleted = 0), 0),
    total_amount     = COALESCE((SELECT SUM(i.line_total) FROM cart_checkout_item i
                                 WHERE i.cart_id = cart_checkout_cart.id
                                   AND i.hub_id = :hub_id AND i.is_deleted = 0), 0),
    last_activity_at = :now,
    updated_by       = :current_user_id,
    updated_at       = :now
WHERE hub_id = :hub_id AND status = 'active' AND is_deleted = 0
  AND id = (SELECT i.cart_id FROM cart_checkout_item i
            WHERE i.id = :item_id AND i.hub_id = :hub_id);
