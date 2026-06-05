-- Alta de carrito. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de CartCheckoutService.create_cart.
-- (hub_id, session_token) único lo garantiza el índice uq_cart_hub_session_token
-- (rechazo de duplicados). El carrito nace 'active' y sin líneas (totales a 0).
INSERT INTO cart_checkout_cart
  (id, hub_id, session_token, customer_email, customer_name, status,
   total_items, total_amount, currency, expires_at, last_activity_at, notes,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :session_token, :customer_email, :customer_name, 'active',
   0, 0, :currency, :expires_at, :now, '',
   0, :current_user_id, :current_user_id, :now, :now);
