BEGIN;

CREATE TABLE ordering.print_queue_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true
);
INSERT INTO ordering.print_queue_settings (id) VALUES (1);
ALTER TABLE ordering.print_queue_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON ordering.print_queue_settings TO service_role;

ALTER TABLE ordering.print_jobs DROP CONSTRAINT print_jobs_status_check;
ALTER TABLE ordering.print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'));

CREATE FUNCTION ordering.suppress_disabled_print_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  queue_enabled boolean;
BEGIN
  SELECT enabled INTO STRICT queue_enabled
  FROM ordering.print_queue_settings WHERE id = 1 FOR SHARE;
  IF NOT queue_enabled THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suppress_disabled_print_job
BEFORE INSERT ON ordering.print_jobs
FOR EACH ROW EXECUTE FUNCTION ordering.suppress_disabled_print_job();

COMMIT;
