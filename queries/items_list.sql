-- Líneas de un carrito. Runtime inyecta :hub_id.
-- Portado de CartCheckoutService.get_cart (sección items).
SELECT id, cart_id, product_ref, product_name, sku, quantity,
       unit_price, line_total, variant_attributes
FROM cart_checkout_item
WHERE hub_id = :hub_id AND is_deleted = 0
  AND cart_id = :cart_id
ORDER BY created_at ASC;
