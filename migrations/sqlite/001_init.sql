-- Cart & Checkout · esquema inicial (SQLite). Portado fielmente de
-- old_modules/m_cart_checkout/models.py.
-- Modelos: Cart (carrito guest/identificado con ciclo de vida), CartItem (línea con
-- variantes) y CheckoutSession (pipeline de checkout iniciado→pagado→completado).
-- Contrato de fila estándar de hub (§2.5): hub_id + soft-delete + auditoría.

-- Carrito de la compra. session_token es único por hub (un guest puede reusar el mismo
-- token en hubs distintos). total_items/total_amount son snapshot denormalizado que
-- recalcula el motor (ver WASM-TODO). status: active|abandoned|converted|expired.
CREATE TABLE IF NOT EXISTS cart_checkout_cart (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    session_token    TEXT NOT NULL,
    customer_email   TEXT NOT NULL DEFAULT '',
    customer_name    TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'active',   -- active|abandoned|converted|expired
    total_items      INTEGER NOT NULL DEFAULT 0,
    total_amount     INTEGER NOT NULL DEFAULT 0,  -- céntimos (ADR-0007)
    currency         TEXT NOT NULL DEFAULT 'EUR',
    expires_at       TEXT,                             -- ISO datetime o NULL
    last_activity_at TEXT,                             -- ISO datetime o NULL
    notes            TEXT NOT NULL DEFAULT '',
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TEXT,
    created_by       TEXT,
    updated_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_hub_session_token  ON cart_checkout_cart (hub_id, session_token);
CREATE INDEX        IF NOT EXISTS ix_cart_hub_status         ON cart_checkout_cart (hub_id, status);
CREATE INDEX        IF NOT EXISTS ix_cart_hub_customer_email ON cart_checkout_cart (hub_id, customer_email);
CREATE INDEX        IF NOT EXISTS ix_cart_hub_last_activity  ON cart_checkout_cart (hub_id, last_activity_at);
CREATE INDEX        IF NOT EXISTS idx_cart_checkout_cart_hub ON cart_checkout_cart (hub_id, is_deleted);

-- Línea del carrito. product_ref/product_name son snapshot libre (sin FK a producto).
-- line_total = quantity * unit_price lo computa el motor (ver WASM-TODO).
-- variant_attributes es JSON libre (talla, color…).
CREATE TABLE IF NOT EXISTS cart_checkout_item (
    id                 TEXT PRIMARY KEY,
    hub_id             TEXT NOT NULL,
    cart_id            TEXT NOT NULL,
    product_ref        TEXT NOT NULL,
    product_name       TEXT NOT NULL,
    sku                TEXT NOT NULL DEFAULT '',
    quantity           INTEGER NOT NULL DEFAULT 1,
    unit_price         INTEGER NOT NULL DEFAULT 0,  -- céntimos
    line_total         INTEGER NOT NULL DEFAULT 0,  -- céntimos
    variant_attributes TEXT NOT NULL DEFAULT '{}',     -- JSON libre
    is_deleted         INTEGER NOT NULL DEFAULT 0,
    deleted_at         TEXT,
    created_by         TEXT,
    updated_by         TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT,
    FOREIGN KEY (cart_id) REFERENCES cart_checkout_cart (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_cart_item_cart           ON cart_checkout_item (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_checkout_item_hub  ON cart_checkout_item (hub_id, is_deleted);

-- Sesión de checkout creada desde un carrito activo. order_number es único por hub
-- (formato OS-YYYYMMDD-NNNN, generado por el motor — ver WASM-TODO).
-- shipping_address/billing_address son JSON libre.
-- status: initiated|paid|failed|completed.
CREATE TABLE IF NOT EXISTS cart_checkout_session (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    cart_id          TEXT NOT NULL,
    order_number     TEXT NOT NULL,
    customer_email   TEXT NOT NULL,
    shipping_address TEXT NOT NULL DEFAULT '{}',       -- JSON libre
    billing_address  TEXT NOT NULL DEFAULT '{}',       -- JSON libre
    shipping_method  TEXT NOT NULL DEFAULT '',
    payment_method   TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'initiated',-- initiated|paid|failed|completed
    placed_at        TEXT,
    paid_at          TEXT,
    completed_at     TEXT,
    total_amount     INTEGER NOT NULL DEFAULT 0,  -- céntimos (ADR-0007)
    notes            TEXT NOT NULL DEFAULT '',
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TEXT,
    created_by       TEXT,
    updated_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT,
    FOREIGN KEY (cart_id) REFERENCES cart_checkout_cart (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_hub_order_number  ON cart_checkout_session (hub_id, order_number);
CREATE INDEX        IF NOT EXISTS ix_checkout_hub_status        ON cart_checkout_session (hub_id, status);
CREATE INDEX        IF NOT EXISTS ix_checkout_hub_email         ON cart_checkout_session (hub_id, customer_email);
CREATE INDEX        IF NOT EXISTS ix_checkout_cart              ON cart_checkout_session (cart_id);
CREATE INDEX        IF NOT EXISTS idx_cart_checkout_session_hub ON cart_checkout_session (hub_id, is_deleted);
