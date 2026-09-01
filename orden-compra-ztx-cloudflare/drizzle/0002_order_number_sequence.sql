CREATE TABLE IF NOT EXISTS purchase_order_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);

INSERT OR IGNORE INTO purchase_order_sequence (id, next_number)
SELECT 1,
  COALESCE(MAX(
    CASE
      WHEN number LIKE 'OC-%' THEN CAST(SUBSTR(number, 4) AS INTEGER)
      ELSE CAST(number AS INTEGER)
    END
  ), 0) + 1
FROM purchase_orders;
