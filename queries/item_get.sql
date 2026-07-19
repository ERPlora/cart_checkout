-- Una línea de carrito por id. La usa la read pre-cargada de `cart_checkout.items.update`
-- (ADR-0069 fase 2): el handler necesita el unit_price DE LA FILA para calcular line_total
-- con el SDK de dinero — pedírselo al cliente rompería que el servidor sea la autoridad.
-- Runtime inyecta :hub_id.
SELECT id, cart_id, product_ref, product_name, sku, quantity,
       unit_price, line_total, variant_attributes
FROM cart_checkout_item
WHERE hub_id = :hub_id AND is_deleted = 0
  AND id = :item_id
