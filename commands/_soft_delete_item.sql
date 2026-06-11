-- Soft-delete de una línea del carrito con guarda de estado (solo carritos 'active').
-- Intención emitida por el handler WASM (update_cart_item con quantity <= 0).
-- Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_item
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :item_id AND hub_id = :hub_id AND is_deleted = 0
  AND EXISTS (SELECT 1 FROM cart_checkout_cart c
              WHERE c.id = cart_checkout_item.cart_id AND c.hub_id = :hub_id
                AND c.status = 'active' AND c.is_deleted = 0);
