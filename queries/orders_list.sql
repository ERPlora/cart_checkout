-- Sesiones de checkout (pedidos) del hub con filtros opcionales. Runtime inyecta :hub_id.
-- Portado de routes.list_orders.
-- (:status y :customer_email deben pasarse: '' = sin filtro.)
SELECT id, cart_id, order_number, customer_email, shipping_method, payment_method,
       status, placed_at, paid_at, completed_at, total_amount, notes, created_at
FROM cart_checkout_session
WHERE hub_id = :hub_id AND is_deleted = 0
