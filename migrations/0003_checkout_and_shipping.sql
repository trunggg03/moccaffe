ALTER TABLE products ADD COLUMN weight_g INTEGER NOT NULL DEFAULT 350 CHECK (weight_g > 0);

UPDATE products
SET weight_g = CASE
  WHEN category = 'bakery' THEN 180
  ELSE 350
END;

ALTER TABLE orders ADD COLUMN delivery_street TEXT;
ALTER TABLE orders ADD COLUMN delivery_ward_code TEXT;
ALTER TABLE orders ADD COLUMN delivery_district_id INTEGER;
ALTER TABLE orders ADD COLUMN delivery_ward_name TEXT;
ALTER TABLE orders ADD COLUMN delivery_district_name TEXT;
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'vnpay'));
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'refunded'));
ALTER TABLE orders ADD COLUMN payment_transaction_no TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN ghn_order_code TEXT;
ALTER TABLE orders ADD COLUMN ghn_status TEXT;
ALTER TABLE orders ADD COLUMN ghn_fee_vnd INTEGER;
ALTER TABLE orders ADD COLUMN shipping_label_url TEXT;
ALTER TABLE orders ADD COLUMN shipping_created_at TEXT;

ALTER TABLE order_items ADD COLUMN weight_g INTEGER NOT NULL DEFAULT 350 CHECK (weight_g > 0);

CREATE UNIQUE INDEX orders_ghn_order_code_idx
  ON orders (ghn_order_code)
  WHERE ghn_order_code IS NOT NULL;
