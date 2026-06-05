-- Transición de checkout initiated → paid. Runtime inyecta :hub_id, :current_user_id, :now.
-- Portado de CartCheckoutService.mark_checkout_paid. La guarda de estado (solo 'initiated'
-- puede pasar a 'paid') se valida en runtime (invariant) — ver WASM-TODO; aquí filtramos
-- por status='initiated'.
UPDATE cart_checkout_session
SET status = 'paid',
    paid_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :checkout_id AND hub_id = :hub_id AND is_deleted = 0 AND status = 'initiated';
