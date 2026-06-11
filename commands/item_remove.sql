-- Borrado lógico (soft-delete) de una línea del carrito. Runtime inyecta :hub_id,
-- :current_user_id, :now. Portado de CartCheckoutService.remove_cart_item.
-- Guarda de estado: solo carritos 'active' admiten cambios (no-op si no — WASM-TODO §4).
-- El recálculo de totales lo encadena el command (segundo statement de la misma
-- transacción: commands/_recalc_totals_by_item.sql).
UPDATE cart_checkout_item
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :item_id AND hub_id = :hub_id AND is_deleted = 0
  AND EXISTS (SELECT 1 FROM cart_checkout_cart c
              WHERE c.id = cart_checkout_item.cart_id AND c.hub_id = :hub_id
                AND c.status = 'active' AND c.is_deleted = 0);
