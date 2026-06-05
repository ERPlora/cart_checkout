-- Carrito por session_token. Runtime inyecta :hub_id.
-- Portado de CartCheckoutService.get_cart (las líneas se obtienen con items_list).
SELECT id, session_token, customer_email, customer_name, status,
       total_items, total_amount, currency, expires_at, last_activity_at,
       notes, created_at
FROM cart_checkout_cart
WHERE hub_id = :hub_id AND is_deleted = 0
  AND session_token = :session_token;
