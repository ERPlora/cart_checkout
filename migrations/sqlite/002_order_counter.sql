-- Contador atómico de números de pedido por hub/día (WASM-TODO §2). Lo incrementa
-- cart_checkout._bump_counter (upsert) y lo lee cart_checkout._insert_checkout en la
-- misma transacción para generar order_number OS-YYYYMMDD-NNNN. Mismo patrón que
-- sales_counter / kitchen_order_counter.
CREATE TABLE IF NOT EXISTS cart_checkout_order_counter (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    day         TEXT NOT NULL,              -- YYYYMMDD
    last_number INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_checkout_counter_hub_day
    ON cart_checkout_order_counter (hub_id, day);
