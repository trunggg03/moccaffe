CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
  image_key TEXT,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX products_available_category_idx
  ON products (is_available, category, name);

CREATE TABLE orders (
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX orders_created_at_idx ON orders (created_at DESC);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_vnd INTEGER NOT NULL CHECK (unit_price_vnd >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_vnd INTEGER NOT NULL CHECK (line_total_vnd >= 0)
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
