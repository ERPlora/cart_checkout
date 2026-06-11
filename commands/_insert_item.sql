-- Inserta una línea del carrito. Intención emitida por el handler WASM (add_to_cart).
-- Runtime inyecta :hub_id, :current_user_id, :now. :item_id (de context.new_ids),
-- :quantity/:unit_price/:line_total (quantize 0.01) los aporta el handler.
-- El carrito se resuelve AQUÍ por session_token con la guarda de estado en el WHERE
-- (solo carritos 'active' admiten líneas; si no se cumple, no-op — WASM-TODO §4).
INSERT INTO cart_checkout_item
  (id, hub_id, cart_id, product_ref, product_name, sku, quantity, unit_price,
   line_total, variant_attributes, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :item_id, :hub_id, c.id, :product_ref, :product_name, :sku, :quantity, :unit_price,
       :line_total, :variant_attributes, 0, :current_user_id, :current_user_id, :now, :now
FROM cart_checkout_cart c
WHERE c.hub_id = :hub_id AND c.session_token = :session_token
  AND c.status = 'active' AND c.is_deleted = 0;
