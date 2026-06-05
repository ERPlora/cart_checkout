-- Borrado lógico (soft-delete) de un carrito. Runtime inyecta :hub_id, :current_user_id, :now.
-- Las líneas asociadas se mantienen; el cascade físico no aplica en soft-delete (el motor
-- puede arrastrar las líneas — ver WASM-TODO).
UPDATE cart_checkout_cart
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :cart_id AND hub_id = :hub_id AND is_deleted = 0;
