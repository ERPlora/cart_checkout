-- Carritos del hub (con filtros opcionales). Runtime inyecta :hub_id.
-- Portado de CartCheckoutService.list_carts / routes.list_carts.
-- (:status y :customer_email deben pasarse: '' = sin filtro.)
SELECT id, session_token, customer_email, customer_name, status,
       total_items, total_amount, currency, expires_at, last_activity_at,
       notes, created_at
FROM cart_checkout_cart
WHERE hub_id = :hub_id AND is_deleted = 0
