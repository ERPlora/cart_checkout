-- Marca un carrito 'active' como 'abandoned'. Runtime inyecta :hub_id, :current_user_id, :now.
-- Portado de CartCheckoutService.mark_abandoned. La transición de estado válida
-- (solo active→abandoned) y la concatenación del motivo en notes se validan en runtime
-- (invariant de máquina de estados) — ver WASM-TODO; aquí solo aplicamos si está active.
UPDATE cart_checkout_cart
SET status = 'abandoned',
    notes = CASE WHEN :reason = '' THEN notes
                 ELSE TRIM(notes || char(10) || '[ABANDONED] ' || :reason) END,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :cart_id AND hub_id = :hub_id AND is_deleted = 0 AND status = 'active';
