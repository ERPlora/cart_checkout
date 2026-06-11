-- Actualiza la cantidad de una línea recalculando line_total con el unit_price de la
-- propia fila (el handler WASM no tiene lecturas pre-cargadas). Intención emitida por
-- update_cart_item (quantity > 0). Runtime inyecta :hub_id, :current_user_id, :now.
-- Guarda de estado: solo si el carrito asociado está 'active' (no-op si no).
UPDATE cart_checkout_item
SET quantity   = :quantity,
    line_total = ROUND(unit_price * :quantity, 2),
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :item_id AND hub_id = :hub_id AND is_deleted = 0
  AND EXISTS (SELECT 1 FROM cart_checkout_cart c
              WHERE c.id = cart_checkout_item.cart_id AND c.hub_id = :hub_id
                AND c.status = 'active' AND c.is_deleted = 0);
