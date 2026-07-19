-- ADR-0147 — las cantidades pasan a punto fijo ENTERO de escala GLOBAL 10⁶ («2000000» = 2 uds):
-- el mismo lenguaje que sales/inventory/kitchen/invoice. EL DINERO NO SE TOCA (céntimos,
-- ADR-0123). Afecta a `cart_checkout_item.quantity` y a su agregado denormalizado
-- `cart_checkout_cart.total_items` (= SUM(quantity), así que hereda la escala).
--
-- Sin ventana mixta: nada externo escribe cantidades aquí (el módulo no escucha eventos);
-- todo lo existente es lógico → reescalado ciego ×10⁶. Ambas columnas tienen afinidad
-- INTEGER en SQLite, así que basta el UPDATE (no hay que reconstruir tablas como cuando la
-- afinidad era REAL). El DEFAULT 1 de `quantity` queda obsoleto pero es inerte: el handler
-- siempre manda la cantidad explícita (en Postgres sí se actualiza el default, que es barato).
UPDATE cart_checkout_item SET quantity    = quantity    * 1000000;
UPDATE cart_checkout_cart SET total_items = total_items * 1000000;
