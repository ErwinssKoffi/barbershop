-- Généré par npm run db:schema — ne pas modifier directement.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 001_baseline
CREATE TABLE IF NOT EXISTS salon_info (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  manager_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'XOF',
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light',
  date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
  receipt_format TEXT DEFAULT 'thermal_80mm',
  last_backup_exported_at TEXT,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_scope ON categories (scope);

CREATE TABLE IF NOT EXISTS services_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  reference_price BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  base_salary BIGINT NOT NULL DEFAULT 0,
  remuneration_type TEXT NOT NULL DEFAULT 'fixed',
  commission_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  commission_rate NUMERIC(6, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  theoretical_closing_balance BIGINT NOT NULL DEFAULT 0,
  counted_closing_balance BIGINT,
  discrepancy BIGINT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_opened_at ON cash_sessions (opened_at);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id);

CREATE TABLE IF NOT EXISTS revenues (
  id TEXT PRIMARY KEY,
  ticket_id TEXT,
  receipt_number TEXT,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  category_code TEXT NOT NULL,
  employee_id TEXT,
  amount BIGINT NOT NULL,
  payment_method TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revenues_date ON revenues (date);
CREATE INDEX IF NOT EXISTS idx_revenues_ticket ON revenues (ticket_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  category_code TEXT NOT NULL,
  amount BIGINT NOT NULL,
  payment_method TEXT NOT NULL,
  source_module TEXT NOT NULL,
  is_stock_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category_code TEXT NOT NULL,
  default_amount BIGINT NOT NULL,
  day_of_month INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  cost_price BIGINT NOT NULL DEFAULT 0,
  sale_price BIGINT,
  alert_threshold INTEGER NOT NULL DEFAULT 0,
  usage_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  unit_cost BIGINT NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id);

CREATE TABLE IF NOT EXISTS advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  amount BIGINT NOT NULL,
  paid_at TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advances_period ON advances (period_month);

CREATE TABLE IF NOT EXISTS bonuses (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  amount BIGINT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_payments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  net_paid_amount BIGINT NOT NULL,
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_period ON salary_payments (period_month);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  period_month TEXT NOT NULL,
  kind TEXT NOT NULL,
  category_code TEXT NOT NULL,
  planned_amount BIGINT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets (period_month);

CREATE TABLE IF NOT EXISTS correction_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS salon_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_salon_users_email ON salon_users (email);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

-- 002_auth_security
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits (expires_at);

-- 003_tenancy
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  timezone TEXT NOT NULL DEFAULT 'Africa/Abidjan',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tenant_bootstrap (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  tenant_id UUID NOT NULL REFERENCES tenants(id)
);
-- Uniquement des identifiants structurels pour rattacher les données existantes ; identité vierge préservée.
WITH organization AS (
  INSERT INTO organizations (name) SELECT COALESCE((SELECT name FROM salon_info ORDER BY updated_at DESC LIMIT 1), '') RETURNING id
), tenant AS (
  INSERT INTO tenants (org_id, name) SELECT id, COALESCE((SELECT name FROM salon_info ORDER BY updated_at DESC LIMIT 1), '') FROM organization RETURNING id
)
INSERT INTO tenant_bootstrap (tenant_id) SELECT id FROM tenant;


ALTER TABLE salon_info ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE salon_info SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE salon_info ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE salon_info ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_salon_info_tenant ON salon_info (tenant_id);


ALTER TABLE app_settings ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE app_settings SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE app_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app_settings ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_app_settings_tenant ON app_settings (tenant_id);


ALTER TABLE categories ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE categories SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_categories_tenant ON categories (tenant_id);


ALTER TABLE services_catalog ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE services_catalog SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE services_catalog ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE services_catalog ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_services_catalog_tenant ON services_catalog (tenant_id);


ALTER TABLE employees ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE employees SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE employees ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE employees ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_employees_tenant ON employees (tenant_id);


ALTER TABLE cash_sessions ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE cash_sessions SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE cash_sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE cash_sessions ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_cash_sessions_tenant ON cash_sessions (tenant_id);


ALTER TABLE cash_movements ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE cash_movements SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE cash_movements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE cash_movements ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_cash_movements_tenant ON cash_movements (tenant_id);


ALTER TABLE revenues ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE revenues SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE revenues ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE revenues ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_revenues_tenant ON revenues (tenant_id);


ALTER TABLE expenses ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE expenses SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE expenses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_expenses_tenant ON expenses (tenant_id);


ALTER TABLE recurring_expenses ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE recurring_expenses SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE recurring_expenses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE recurring_expenses ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_recurring_expenses_tenant ON recurring_expenses (tenant_id);


ALTER TABLE products ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE products SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_products_tenant ON products (tenant_id);


ALTER TABLE stock_movements ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE stock_movements SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE stock_movements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_stock_movements_tenant ON stock_movements (tenant_id);


ALTER TABLE advances ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE advances SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE advances ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE advances ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_advances_tenant ON advances (tenant_id);


ALTER TABLE bonuses ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE bonuses SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE bonuses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE bonuses ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_bonuses_tenant ON bonuses (tenant_id);


ALTER TABLE salary_payments ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE salary_payments SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE salary_payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE salary_payments ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_salary_payments_tenant ON salary_payments (tenant_id);


ALTER TABLE budgets ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE budgets SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE budgets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE budgets ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_budgets_tenant ON budgets (tenant_id);


ALTER TABLE correction_logs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE correction_logs SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE correction_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE correction_logs ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_correction_logs_tenant ON correction_logs (tenant_id);


ALTER TABLE sync_tombstones ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE sync_tombstones SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE sync_tombstones ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sync_tombstones ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_sync_tombstones_tenant ON sync_tombstones (tenant_id);


ALTER TABLE salon_users ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE salon_users SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE salon_users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE salon_users ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_salon_users_tenant ON salon_users (tenant_id);


ALTER TABLE salon_info DROP CONSTRAINT salon_info_pkey;
ALTER TABLE salon_info ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE salon_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_info FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON salon_info
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE app_settings ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE categories DROP CONSTRAINT categories_pkey;
ALTER TABLE categories ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE services_catalog DROP CONSTRAINT services_catalog_pkey;
ALTER TABLE services_catalog ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE services_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services_catalog
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE employees DROP CONSTRAINT employees_pkey;
ALTER TABLE employees ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_pkey;
ALTER TABLE cash_sessions ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_sessions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_pkey;
ALTER TABLE cash_movements ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_movements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE revenues DROP CONSTRAINT revenues_pkey;
ALTER TABLE revenues ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revenues
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE expenses DROP CONSTRAINT expenses_pkey;
ALTER TABLE expenses ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE recurring_expenses DROP CONSTRAINT recurring_expenses_pkey;
ALTER TABLE recurring_expenses ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_expenses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE products DROP CONSTRAINT products_pkey;
ALTER TABLE products ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_pkey;
ALTER TABLE stock_movements ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE advances DROP CONSTRAINT advances_pkey;
ALTER TABLE advances ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE advances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON advances
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE bonuses DROP CONSTRAINT bonuses_pkey;
ALTER TABLE bonuses ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonuses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bonuses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE salary_payments DROP CONSTRAINT salary_payments_pkey;
ALTER TABLE salary_payments ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON salary_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE budgets DROP CONSTRAINT budgets_pkey;
ALTER TABLE budgets ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budgets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE correction_logs DROP CONSTRAINT correction_logs_pkey;
ALTER TABLE correction_logs ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE correction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE correction_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON correction_logs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


ALTER TABLE sync_tombstones DROP CONSTRAINT sync_tombstones_pkey;
ALTER TABLE sync_tombstones ADD PRIMARY KEY (tenant_id, entity_type, entity_id);
ALTER TABLE sync_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_tombstones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_tombstones
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Identité globale : authentification avant résolution de tenant. Toutes les lectures d'administration sont filtrées.
ALTER TABLE salon_users DISABLE ROW LEVEL SECURITY;
CREATE TABLE memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES salon_users(id),
  role TEXT NOT NULL CHECK (role IN ('manager', 'cashier')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);
INSERT INTO memberships (tenant_id, user_id, role, is_active)
  SELECT tenant_id, id, role, is_active FROM salon_users;
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- Le propriétaire/Supabase postgres peut contourner la RLS : les transactions métier changent de rôle.
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS', runtime_role);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe runtime role';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', current_schema(), runtime_role);
  EXECUTE format('GRANT %I TO %I', runtime_role, current_user);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON salon_info, app_settings, categories, services_catalog, employees, cash_sessions, cash_movements, revenues, expenses, recurring_expenses, products, stock_movements, advances, bonuses, salary_payments, budgets, correction_logs, sync_tombstones TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON salon_users, memberships, organizations, tenants TO %I', runtime_role);
  EXECUTE format('GRANT SELECT ON tenant_bootstrap TO %I', runtime_role);
END
$runtime$;

-- 004_sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES salon_users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  family_id UUID NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  remember_me BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  replaced_by UUID REFERENCES sessions(id),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user_tenant ON sessions (user_id, tenant_id);
CREATE INDEX idx_sessions_family ON sessions (family_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);
-- Table globale d’authentification : accès serveur explicites par identité/session, jamais via sync ou navigateur.
REVOKE ALL ON sessions FROM PUBLIC;
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sessions TO %I', runtime_role);
END
$runtime$;

-- 005_sync_revisions
CREATE TABLE sync_state (tenant_id UUID PRIMARY KEY REFERENCES tenants(id), revision BIGINT NOT NULL DEFAULT 0, record_count BIGINT NOT NULL DEFAULT 0);
CREATE TABLE sync_changes (
  tenant_id UUID NOT NULL REFERENCES tenants(id), seq BIGINT NOT NULL, table_name TEXT NOT NULL,
  row_id TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('upsert','delete')), payload_json JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, seq)
);
CREATE INDEX idx_sync_changes_row ON sync_changes (tenant_id, table_name, row_id, seq DESC);
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_state
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE sync_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_changes
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE FUNCTION record_sync_change() RETURNS trigger LANGUAGE plpgsql AS $journal$
DECLARE revision BIGINT; tid UUID; rid TEXT; body JSONB; count_delta BIGINT := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.payload_json = NEW.payload_json THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN tid := OLD.tenant_id; rid := OLD.id; body := NULL;
  ELSE tid := NEW.tenant_id; rid := NEW.id; body := NEW.payload_json; END IF;
  IF TG_ARGV[0] NOT IN ('salon','settings','categories') THEN
    IF TG_OP = 'INSERT' THEN count_delta := 1; ELSIF TG_OP = 'DELETE' THEN count_delta := -1; END IF;
  END IF;
  INSERT INTO sync_state (tenant_id, revision, record_count) VALUES (tid, 1, count_delta)
    ON CONFLICT (tenant_id) DO UPDATE SET revision = sync_state.revision + 1, record_count = sync_state.record_count + count_delta RETURNING sync_state.revision INTO revision;
  INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json)
    VALUES (tid, revision, TG_ARGV[0], rid, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END, body);
  RETURN NULL;
END $journal$;
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON salon_info FOR EACH ROW EXECUTE FUNCTION record_sync_change('salon');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON app_settings FOR EACH ROW EXECUTE FUNCTION record_sync_change('settings');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION record_sync_change('categories');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON services_catalog FOR EACH ROW EXECUTE FUNCTION record_sync_change('services');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON employees FOR EACH ROW EXECUTE FUNCTION record_sync_change('employees');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON revenues FOR EACH ROW EXECUTE FUNCTION record_sync_change('revenues');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION record_sync_change('expenses');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON recurring_expenses FOR EACH ROW EXECUTE FUNCTION record_sync_change('recurringExpenses');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION record_sync_change('cashSessions');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION record_sync_change('cashMovements');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON advances FOR EACH ROW EXECUTE FUNCTION record_sync_change('advances');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON bonuses FOR EACH ROW EXECUTE FUNCTION record_sync_change('bonuses');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON salary_payments FOR EACH ROW EXECUTE FUNCTION record_sync_change('salaryPayments');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION record_sync_change('products');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION record_sync_change('stockMovements');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON budgets FOR EACH ROW EXECUTE FUNCTION record_sync_change('budgets');
CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON correction_logs FOR EACH ROW EXECUTE FUNCTION record_sync_change('correctionLogs');
-- Initialisation du journal pour toutes les données héritées, une seule fois, sans changer les écritures.
DO $baseline$
DECLARE t RECORD; r RECORD; revision BIGINT;
BEGIN
 FOR t IN SELECT id FROM tenants LOOP
  PERFORM set_config('app.tenant_id', t.id::text, true);
  INSERT INTO sync_state (tenant_id) VALUES (t.id) ON CONFLICT DO NOTHING;
  FOR r IN SELECT id, payload_json FROM salon_info WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 0 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'salon', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM app_settings WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 0 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'settings', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM categories WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 0 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'categories', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM services_catalog WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'services', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM employees WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'employees', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM revenues WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'revenues', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM expenses WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'expenses', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM recurring_expenses WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'recurringExpenses', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM cash_sessions WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'cashSessions', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM cash_movements WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'cashMovements', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM advances WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'advances', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM bonuses WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'bonuses', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM salary_payments WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'salaryPayments', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM products WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'products', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM stock_movements WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'stockMovements', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM budgets WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'budgets', r.id, 'upsert', r.payload_json);
  END LOOP;
FOR r IN SELECT id, payload_json FROM correction_logs WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + 1 WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, 'correctionLogs', r.id, 'upsert', r.payload_json);
  END LOOP;
 END LOOP;
 PERFORM set_config('app.tenant_id', '', true);
END $baseline$;
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
 EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sync_state TO %I', runtime_role);
 EXECUTE format('GRANT SELECT, INSERT ON sync_changes TO %I', runtime_role);
END $runtime$;
