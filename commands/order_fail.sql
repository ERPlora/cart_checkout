-- Marca un checkout como 'failed' (p.ej. pago rechazado). Runtime inyecta :hub_id,
-- :current_user_id, :now.
-- Portado de CartCheckoutService.fail_checkout. La guarda (no se puede fallar un checkout
-- ya 'completed') se valida en runtime — ver WASM-TODO; aquí excluimos status='completed'.
UPDATE cart_checkout_session
SET status = 'failed',
    notes = TRIM(notes || '
' || '[FAILED] ' || :reason),
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :checkout_id AND hub_id = :hub_id AND is_deleted = 0 AND status <> 'completed';
