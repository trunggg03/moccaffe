PRAGMA defer_foreign_keys = ON;

CREATE TABLE order_items_backup AS
SELECT id, order_id, product_id, product_name, unit_price_vnd, quantity,
       line_total_vnd, weight_g
FROM order_items;

DROP TABLE order_items;

CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup', 'delivery')),
  delivery_address TEXT,
  customer_note TEXT NOT NULL DEFAULT '',
  subtotal_vnd INTEGER NOT NULL CHECK (subtotal_vnd >= 0),
  delivery_fee_vnd INTEGER NOT NULL CHECK (delivery_fee_vnd >= 0),
  total_vnd INTEGER NOT NULL CHECK (total_vnd >= 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivery_street TEXT,
  delivery_ward_code TEXT,
  delivery_district_id INTEGER,
  delivery_ward_name TEXT,
  delivery_district_name TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'vnpay')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'refunded')),
  payment_transaction_no TEXT,
  paid_at TEXT,
  ghn_order_code TEXT,
  ghn_status TEXT,
  ghn_fee_vnd INTEGER,
  shipping_label_url TEXT,
  shipping_created_at TEXT
);

INSERT INTO orders_new (
  id, customer_name, customer_phone, fulfillment_type, delivery_address,
  customer_note, subtotal_vnd, delivery_fee_vnd, total_vnd, status, created_at,
  delivery_street, delivery_ward_code, delivery_district_id, delivery_ward_name,
  delivery_district_name, payment_method, payment_status, payment_transaction_no,
  paid_at, ghn_order_code, ghn_status, ghn_fee_vnd, shipping_label_url,
  shipping_created_at
)
SELECT
  id, customer_name, customer_phone, fulfillment_type, delivery_address,
  customer_note, subtotal_vnd, delivery_fee_vnd, total_vnd, status, created_at,
  delivery_street, delivery_ward_code, delivery_district_id, delivery_ward_name,
  delivery_district_name, payment_method, payment_status, payment_transaction_no,
  paid_at, ghn_order_code, ghn_status, ghn_fee_vnd, shipping_label_url,
  shipping_created_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE UNIQUE INDEX orders_ghn_order_code_idx
  ON orders (ghn_order_code)
  WHERE ghn_order_code IS NOT NULL;

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_vnd INTEGER NOT NULL CHECK (unit_price_vnd >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_vnd INTEGER NOT NULL CHECK (line_total_vnd >= 0),
  weight_g INTEGER NOT NULL CHECK (weight_g > 0)
);

INSERT INTO order_items (
  id, order_id, product_id, product_name, unit_price_vnd, quantity, line_total_vnd, weight_g
)
SELECT id, order_id, product_id, product_name, unit_price_vnd, quantity,
       line_total_vnd, weight_g
FROM order_items_backup
ORDER BY id;

DROP TABLE order_items_backup;

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
