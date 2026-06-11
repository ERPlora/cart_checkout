-- Batch: marca como 'expired' los carritos 'active' cuyo expires_at venció (WASM-TODO §3).
-- Comparación lexicográfica de datetimes ISO (mismo formato que escribe el runtime).
-- Intención emitida por el handler WASM (cleanup_expired_carts).
-- Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE cart_checkout_cart
SET status     = 'expired',
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND status = 'active' AND is_deleted = 0
  AND expires_at IS NOT NULL AND expires_at <> '' AND expires_at < :now;
