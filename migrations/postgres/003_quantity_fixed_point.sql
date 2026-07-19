-- ADR-0147 — cantidades a punto fijo ENTERO escala 10⁶. Ver migrations/sqlite/003 para el
-- razonamiento. BIGINT para que el agregado SUM(quantity) de carritos grandes no roce el
-- límite de INTEGER (2^31 ≈ 2147 unidades lógicas en µ).
ALTER TABLE cart_checkout_item ALTER COLUMN quantity    TYPE BIGINT USING (quantity::BIGINT * 1000000);
ALTER TABLE cart_checkout_item ALTER COLUMN quantity    SET DEFAULT 1000000;
ALTER TABLE cart_checkout_cart ALTER COLUMN total_items TYPE BIGINT USING (total_items::BIGINT * 1000000);
