ALTER TABLE ordering.bills
  ADD COLUMN dining_mode text,
  ADD COLUMN dining_table integer,
  ADD CONSTRAINT bills_dining_details CHECK (
    (dining_mode IS NULL AND dining_table IS NULL)
    OR (dining_mode IS NOT NULL AND (
      (dining_mode = 'takeaway' AND dining_table IS NULL)
      OR (dining_mode = 'dine_in' AND dining_table IS NOT NULL AND dining_table > 0)
    ))
  );