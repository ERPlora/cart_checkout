-- Efecto cruzado de complete_checkout (WASM-TODO §3): marca el carrito asociado como
-- 'converted' en la MISMA transacción. Solo aplica si la sesión quedó 'completed'
-- (la transición paid → completed acaba de ejecutarse en _complete_checkout; si aquella
-- fue no-op, esta también). Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_cart
SET status     = 'converted',
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND is_deleted = 0
  AND id = (SELECT s.cart_id FROM cart_checkout_session s
            WHERE s.id = :checkout_id AND s.hub_id = :hub_id
              AND s.status = 'completed' AND s.is_deleted = 0);
