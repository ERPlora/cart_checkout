-- Borrado lógico (soft-delete) de una línea del carrito. Runtime inyecta :hub_id,
-- :current_user_id, :now.
-- ATENCIÓN: portado parcial de CartCheckoutService.remove_cart_item — el recálculo de
-- los totales del carrito (total_items/total_amount) y la guarda de estado (solo carritos
-- 'active' admiten cambios) NO se hacen aquí: van al motor — ver WASM-TODO.
UPDATE cart_checkout_item
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :item_id AND hub_id = :hub_id AND is_deleted = 0;
