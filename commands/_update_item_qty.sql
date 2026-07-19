-- Actualiza la cantidad de una línea. :quantity es punto fijo escala 10⁶ (ADR-0147) y
-- :line_total llega YA calculado por el handler (céntimos, SDK de dinero) a partir del
-- unit_price de la fila, pre-cargado vía read `cart_checkout.items.get` (ADR-0069 fase 2).
-- Aquí NO se redondea: SQLite y Postgres no redondean igual (ADR-0123 §2), y el antiguo
-- ROUND(unit_price * :quantity, 2) además habría multiplicado µ como si fueran unidades.
-- Intención emitida por update_cart_item (quantity > 0). Runtime inyecta :hub_id,
-- :current_user_id, :now. Guarda de estado: solo si el carrito está 'active' (no-op si no).
UPDATE cart_checkout_item
SET quantity   = :quantity,
    line_total = :line_total,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :item_id AND hub_id = :hub_id AND is_deleted = 0
  AND EXISTS (SELECT 1 FROM cart_checkout_cart c
              WHERE c.id = cart_checkout_item.cart_id AND c.hub_id = :hub_id
                AND c.status = 'active' AND c.is_deleted = 0);
