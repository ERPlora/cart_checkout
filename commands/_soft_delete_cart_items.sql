-- Soft-delete de TODAS las líneas de un carrito 'active' (clear_cart). El carrito se
-- resuelve por session_token con la guarda de estado en el subquery (no-op si no está
-- 'active'). Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_item
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND is_deleted = 0
  AND cart_id = (SELECT c.id FROM cart_checkout_cart c
                 WHERE c.hub_id = :hub_id AND c.session_token = :session_token
                   AND c.status = 'active' AND c.is_deleted = 0);
