ALTER TABLE ordering.print_jobs DROP CONSTRAINT print_jobs_kind_check;
ALTER TABLE ordering.print_jobs ADD CONSTRAINT print_jobs_kind_check CHECK (kind IN ('kitchen','kitchen_cashier','receipt'));
