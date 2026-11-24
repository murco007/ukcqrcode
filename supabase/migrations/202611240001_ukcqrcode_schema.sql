CREATE SCHEMA IF NOT EXISTS ordering;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SEQUENCE IF NOT EXISTS ordering.ticket_serial START WITH 1;

CREATE TABLE IF NOT EXISTS ordering.dining_tables (
  table_no integer PRIMARY KEY CHECK (table_no BETWEEN 1 AND 10),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0)
);

CREATE TABLE IF NOT EXISTS ordering.bills (
  id text PRIMARY KEY,
  table_no integer NOT NULL CHECK (table_no BETWEEN 1 AND 10),
  generation integer NOT NULL CHECK (generation > 0),
  serial bigint NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
  opened_at text NOT NULL,
  paid_at text,
  payment text,
  received integer,
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (table_no,generation)
);

CREATE TABLE IF NOT EXISTS ordering.lines (
  id text PRIMARY KEY,
  bill_id text NOT NULL REFERENCES ordering.bills(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 20),
  note text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  served integer NOT NULL DEFAULT 0 CHECK (served IN (0,1))
);

CREATE TABLE IF NOT EXISTS ordering.menu_overrides (
  id text PRIMARY KEY,
  price integer NOT NULL CHECK (price >= 0),
  available integer NOT NULL DEFAULT 1 CHECK (available IN (0,1))
);
CREATE TABLE IF NOT EXISTS ordering.menu_custom (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  image text NOT NULL DEFAULT '',
  price integer NOT NULL CHECK (price >= 0),
  available integer NOT NULL DEFAULT 1 CHECK (available IN (0,1))
);
CREATE TABLE IF NOT EXISTS ordering.menu_deleted (
  id text PRIMARY KEY,
  deleted_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.expenses (
  id text PRIMARY KEY,
  day text NOT NULL,
  category text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  note text NOT NULL DEFAULT '',
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  window_bucket integer NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.staff_accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  username text UNIQUE,
  role text NOT NULL CHECK (role IN ('admin','kitchen','cashier')),
  password_hash text NOT NULL,
  password_scheme text NOT NULL CHECK (password_scheme IN ('legacy','bcrypt')),
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.staff_sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES ordering.staff_accounts(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.print_jobs (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('kitchen','receipt')),
  bill_id text NOT NULL REFERENCES ordering.bills(id) ON DELETE CASCADE,
  created_at text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  owner text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ordering.kitchen_hidden (
  bill_id text PRIMARY KEY REFERENCES ordering.bills(id) ON DELETE CASCADE,
  line_count integer NOT NULL CHECK (line_count > 0),
  hidden_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS ordering.preorders (
  bill_id text PRIMARY KEY REFERENCES ordering.bills(id) ON DELETE CASCADE,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 10),
  pickup_code text NOT NULL CHECK (pickup_code ~ '^[0-9]{3}$'),
  pickup_date text NOT NULL CHECK (pickup_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  channel text NOT NULL CHECK (channel IN ('phone','web')),
  request_id text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  completed_at text
);
CREATE TABLE IF NOT EXISTS ordering.runtime_config (
  id integer PRIMARY KEY CHECK (id=1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO ordering.runtime_config(id,settings)
VALUES (1,'{"SITE_URL":"https://murco007.github.io/ukcqrcode/"}'::jsonb)
ON CONFLICT (id) DO UPDATE
SET settings = ordering.runtime_config.settings || EXCLUDED.settings;

CREATE INDEX IF NOT EXISTS bills_recent_active_idx
  ON ordering.bills(serial DESC) WHERE archived=false;
CREATE INDEX IF NOT EXISTS lines_bill_id_idx ON ordering.lines(bill_id);
CREATE INDEX IF NOT EXISTS print_jobs_pending_idx ON ordering.print_jobs(status,created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dining_tables','bills','lines','menu_overrides','menu_custom','menu_deleted',
    'expenses','login_attempts','staff_accounts','staff_sessions','print_jobs',
    'kitchen_hidden','preorders','runtime_config'
  ] LOOP
    EXECUTE format('ALTER TABLE ordering.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE ordering.%I FROM PUBLIC, anon, authenticated',t);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA ordering FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ordering TO postgres, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ordering TO postgres, service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ordering TO postgres, service_role;
