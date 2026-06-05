-- Sesión de checkout por id. Runtime inyecta :hub_id.
SELECT id, cart_id, order_number, customer_email, shipping_address, billing_address,
       shipping_method, payment_method, status, placed_at, paid_at, completed_at,
       total_amount, notes, created_at
FROM cart_checkout_session
WHERE hub_id = :hub_id AND is_deleted = 0
  AND id = :order_id;
