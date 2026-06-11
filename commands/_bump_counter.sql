-- Incrementa atómicamente el contador de pedidos del día (upsert). Primera intención de
-- initiate_checkout (WASM-TODO §2). Runtime inyecta :new_id, :hub_id. :day (YYYYMMDD) lo
-- aporta el handler WASM. Mismo patrón que sales/kitchen._bump_counter.
INSERT INTO cart_checkout_order_counter (id, hub_id, day, last_number)
VALUES (:new_id, :hub_id, :day, 1)
ON CONFLICT (hub_id, day) DO UPDATE SET last_number = last_number + 1;
