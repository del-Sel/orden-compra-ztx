CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('plain_order_numbers_v1', '1');

UPDATE purchase_order_sequence
SET next_number = 1
WHERE id = 1;
