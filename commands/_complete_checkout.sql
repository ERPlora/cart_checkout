-- Transición de checkout paid → completed (única transición válida, WASM-TODO §3).
-- Guarda de estado en el WHERE (no-op si la sesión no está 'paid'). Intención emitida
-- por el handler WASM (complete_checkout). Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_session
SET status       = 'completed',
    completed_at = :now,
    updated_by   = :current_user_id,
    updated_at   = :now
WHERE id = :checkout_id AND hub_id = :hub_id AND is_deleted = 0 AND status = 'paid';
