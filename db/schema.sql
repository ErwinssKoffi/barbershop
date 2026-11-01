-- Généré par npm run db:schema — ne pas modifier directement.
-- Inclut 006/007/008/009/010/011/012/013/014/015/016/017/018/019/020/021/022 optionnelles : ne pas appliquer ce snapshot sans sauvegarde/restauration vérifiées.
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

-- 006_checkout
CREATE TABLE checkout_counters (
 tenant_id UUID PRIMARY KEY REFERENCES tenants(id), last_receipt BIGINT NOT NULL DEFAULT 0 CHECK(last_receipt >= 0)
);
CREATE TABLE checkout_commands (
 tenant_id UUID NOT NULL REFERENCES tenants(id), idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES salon_users(id),
 ticket_id TEXT NOT NULL, receipt_number TEXT NOT NULL, result_json JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id, idempotency_key), UNIQUE(tenant_id, ticket_id), UNIQUE(tenant_id, receipt_number)
);
CREATE TABLE checkout_records (
 tenant_id UUID NOT NULL REFERENCES tenants(id), table_name TEXT NOT NULL CHECK(table_name IN ('revenues','stock_movements','cash_movements')),
 row_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id, table_name, row_id),
 FOREIGN KEY(tenant_id, ticket_id) REFERENCES checkout_commands(tenant_id, ticket_id)
);
ALTER TABLE checkout_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_counters
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE checkout_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_commands
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE checkout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_records
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE FUNCTION protect_checkout_record() RETURNS trigger LANGUAGE plpgsql AS $protect$
BEGIN
 IF TG_TABLE_NAME = 'cash_sessions' THEN
  IF EXISTS (SELECT 1 FROM checkout_records c JOIN cash_movements m ON m.tenant_id = c.tenant_id AND m.id = c.row_id WHERE c.tenant_id = OLD.tenant_id AND c.table_name = 'cash_movements' AND m.session_id = OLD.id) THEN
   IF TG_OP = 'DELETE' OR OLD.opening_balance IS DISTINCT FROM NEW.opening_balance OR OLD.opened_at IS DISTINCT FROM NEW.opened_at OR (OLD.payload_json->'openingBalance') IS DISTINCT FROM (NEW.payload_json->'openingBalance') OR (OLD.payload_json->'openedAt') IS DISTINCT FROM (NEW.payload_json->'openedAt') THEN
    RAISE EXCEPTION 'Finalized checkout session requires a correction command' USING ERRCODE = '23514';
   END IF;
  END IF;
 ELSIF EXISTS (SELECT 1 FROM checkout_records WHERE tenant_id = OLD.tenant_id AND table_name = TG_TABLE_NAME AND row_id = OLD.id) THEN
  IF TG_OP = 'DELETE' OR OLD IS DISTINCT FROM NEW THEN
   RAISE EXCEPTION 'Finalized checkout record requires a reversal command' USING ERRCODE = '23514';
  END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $protect$;
CREATE TRIGGER protect_checkout BEFORE UPDATE OR DELETE ON revenues FOR EACH ROW EXECUTE FUNCTION protect_checkout_record();
CREATE TRIGGER protect_checkout BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION protect_checkout_record();
CREATE TRIGGER protect_checkout BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION protect_checkout_record();
CREATE TRIGGER protect_checkout BEFORE UPDATE OR DELETE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION protect_checkout_record();
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
 EXECUTE format('GRANT SELECT, INSERT, UPDATE ON checkout_counters TO %I', runtime_role);
 EXECUTE format('GRANT SELECT, INSERT ON checkout_commands, checkout_records TO %I', runtime_role);
END $runtime$;
REVOKE ALL ON checkout_counters, checkout_commands, checkout_records FROM PUBLIC;
DO $browser$
DECLARE browser_role TEXT;
BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
   EXECUTE format('REVOKE ALL ON checkout_counters, checkout_commands, checkout_records FROM %I', browser_role);
  END IF;
 END LOOP;
END $browser$;

-- 007_checkout_refunds
CREATE TABLE checkout_refunds (
 tenant_id UUID NOT NULL REFERENCES tenants(id), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES salon_users(id), original_ticket_id TEXT NOT NULL,
 refund_ticket_id TEXT NOT NULL, receipt_number TEXT NOT NULL, result_json JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,idempotency_key),
 UNIQUE(tenant_id,original_ticket_id), UNIQUE(tenant_id,refund_ticket_id), UNIQUE(tenant_id,receipt_number),
 FOREIGN KEY(tenant_id,original_ticket_id) REFERENCES checkout_commands(tenant_id,ticket_id)
);
CREATE TABLE checkout_refund_records (
 tenant_id UUID NOT NULL REFERENCES tenants(id), table_name TEXT NOT NULL CHECK(table_name IN ('revenues','stock_movements','cash_movements')),
 row_id TEXT NOT NULL, ticket_id TEXT NOT NULL, PRIMARY KEY(tenant_id,table_name,row_id),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES checkout_refunds(tenant_id,refund_ticket_id)
);
ALTER TABLE checkout_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_refunds USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE checkout_refund_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_refund_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_refund_records USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION protect_checkout_record() RETURNS trigger LANGUAGE plpgsql AS $protect$
BEGIN
 IF TG_TABLE_NAME = 'cash_sessions' THEN
  IF EXISTS (SELECT 1 FROM (SELECT tenant_id,table_name,row_id FROM checkout_records UNION ALL SELECT tenant_id,table_name,row_id FROM checkout_refund_records) c JOIN cash_movements m ON m.tenant_id = c.tenant_id AND m.id = c.row_id WHERE c.tenant_id = OLD.tenant_id AND c.table_name = 'cash_movements' AND m.session_id = OLD.id) THEN
   IF TG_OP = 'DELETE' OR OLD.opening_balance IS DISTINCT FROM NEW.opening_balance OR OLD.opened_at IS DISTINCT FROM NEW.opened_at OR (OLD.payload_json->'openingBalance') IS DISTINCT FROM (NEW.payload_json->'openingBalance') OR (OLD.payload_json->'openedAt') IS DISTINCT FROM (NEW.payload_json->'openedAt') THEN
    RAISE EXCEPTION 'Finalized checkout session requires a correction command' USING ERRCODE = '23514';
   END IF;
  END IF;
 ELSIF EXISTS (SELECT 1 FROM (SELECT tenant_id,table_name,row_id FROM checkout_records UNION ALL SELECT tenant_id,table_name,row_id FROM checkout_refund_records) owned WHERE tenant_id = OLD.tenant_id AND table_name = TG_TABLE_NAME AND row_id = OLD.id) THEN
  IF TG_OP = 'DELETE' OR OLD IS DISTINCT FROM NEW THEN
   RAISE EXCEPTION 'Finalized checkout record requires a reversal command' USING ERRCODE = '23514';
  END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $protect$;
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT, INSERT ON checkout_refunds, checkout_refund_records TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON checkout_refunds, checkout_refund_records FROM %I',browser_role);
  END IF;
 END LOOP;
END $runtime$;
REVOKE ALL ON checkout_refunds, checkout_refund_records FROM PUBLIC;

-- 008_booking
CREATE TABLE bookings (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id TEXT NOT NULL,
 employee_id TEXT NOT NULL, start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('planned','confirmed','arrived','completed','cancelled','no_show')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES salon_users(id), payload_json JSONB NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_key), CHECK(end_at>start_at),
 CHECK(end_at<=start_at+interval '8 hours')
);
CREATE INDEX bookings_employee_interval ON bookings(tenant_id,employee_id,start_at,end_at);
CREATE TABLE booking_events (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id TEXT NOT NULL, booking_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES salon_users(id), at TIMESTAMPTZ NOT NULL DEFAULT now(),
 payload_json JSONB NOT NULL, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bookings USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON bookings FROM PUBLIC;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON booking_events USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON booking_events FROM PUBLIC;
DO $booking$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON bookings TO %I',runtime_role);
 EXECUTE format('GRANT SELECT,INSERT ON booking_events TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON bookings,booking_events FROM %I',browser_role);
  END IF;
 END LOOP;
END $booking$;

-- 009_marketplace_profiles
CREATE TABLE salon_public_profiles (
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 display_name TEXT NOT NULL DEFAULT '' CHECK(length(display_name)<=160),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 city TEXT NOT NULL DEFAULT '' CHECK(length(city)<=120),
 commune TEXT NOT NULL DEFAULT '' CHECK(length(commune)<=120),
 public_phone TEXT CHECK(length(public_phone)<=80),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id)
);
CREATE TABLE salon_public_visibility (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 published BOOLEAN NOT NULL DEFAULT false,
 tenant_active BOOLEAN NOT NULL DEFAULT false,
 allowed_from TIMESTAMPTZ, allowed_until TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 CHECK((allowed_from IS NULL AND allowed_until IS NULL) OR
       (allowed_from IS NOT NULL AND allowed_until IS NOT NULL AND allowed_until>allowed_from))
);
CREATE TABLE salon_public_projection (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 100 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL CHECK(length(description)<=4000),
 city TEXT NOT NULL CHECK(length(btrim(city)) BETWEEN 1 AND 120),
 commune TEXT NOT NULL CHECK(length(commune)<=120),
 public_phone TEXT CHECK(length(public_phone)<=80),
 revision INTEGER NOT NULL CHECK(revision>0),
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_visibility(tenant_id,profile_id)
);
CREATE TABLE salon_public_profile_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 actor_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('draft_saved','published','unpublished')),
 profile_version INTEGER NOT NULL CHECK(profile_version>0),
 at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX salon_public_profile_events_profile ON salon_public_profile_events(tenant_id,profile_id,at);

-- Gate activity is derived from the actual tenant, never trusted from a supplied value.
CREATE FUNCTION derive_public_tenant_activity() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $activity$
BEGIN
 EXECUTE format('SELECT status = ''active'' FROM %I.tenants WHERE id=$1',TG_TABLE_SCHEMA)
 INTO NEW.tenant_active USING NEW.tenant_id;
 NEW.tenant_active := COALESCE(NEW.tenant_active,false);
 RETURN NEW;
END $activity$;
CREATE TRIGGER public_visibility_activity BEFORE INSERT OR UPDATE ON salon_public_visibility
 FOR EACH ROW EXECUTE FUNCTION derive_public_tenant_activity();
CREATE FUNCTION close_public_visibility_on_suspension() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $suspension$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  -- Reactivation does not silently republish a previously suspended profile.
  EXECUTE format('UPDATE %I.salon_public_visibility SET tenant_active=$1, published=false WHERE tenant_id=$2',TG_TABLE_SCHEMA)
  USING NEW.status='active',NEW.id;
 END IF;
 RETURN NEW;
END $suspension$;
CREATE TRIGGER public_visibility_suspension AFTER UPDATE OF status ON tenants
 FOR EACH ROW EXECUTE FUNCTION close_public_visibility_on_suspension();
CREATE FUNCTION protect_public_profile_event() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $immutable$
BEGIN
 RAISE EXCEPTION 'Public profile events are immutable' USING ERRCODE='23514';
END $immutable$;
CREATE TRIGGER public_profile_event_immutable BEFORE UPDATE OR DELETE ON salon_public_profile_events
 FOR EACH ROW EXECUTE FUNCTION protect_public_profile_event();
REVOKE ALL ON FUNCTION derive_public_tenant_activity(), close_public_visibility_on_suspension(), protect_public_profile_event() FROM PUBLIC;


ALTER TABLE salon_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_profiles FROM PUBLIC;


ALTER TABLE salon_public_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_visibility FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_visibility FROM PUBLIC;


ALTER TABLE salon_public_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_projection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_projection FROM PUBLIC;


ALTER TABLE salon_public_profile_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_profile_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_profile_events FROM PUBLIC;


DO $roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=reader_role AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit)) THEN
  RAISE EXCEPTION 'Unsafe public reader role';
 END IF;
 -- Even a NOLOGIN role can already hold direct grants: never silently reuse one.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=reader_role) THEN
  RAISE EXCEPTION 'Public reader role already exists; review its privileges';
 END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',reader_role);
 EXECUTE format('GRANT %I TO %I',reader_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),reader_role);
 FOREACH table_name IN ARRAY ARRAY['salon_public_profiles','salon_public_visibility','salon_public_projection','salon_public_profile_events'] LOOP
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION derive_public_tenant_activity(), close_public_visibility_on_suspension(), protect_public_profile_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('CREATE POLICY tenant_insert ON salon_public_profiles FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY tenant_update ON salon_public_profiles FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY tenant_event ON salon_public_profile_events FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON salon_public_profiles TO %I',runtime_role);
 EXECUTE format('GRANT SELECT,INSERT ON salon_public_profile_events TO %I',runtime_role);
 -- No runtime publication grants in this foundation: a reviewed publish command is a later slice.
 EXECUTE format('GRANT SELECT ON salon_public_visibility,salon_public_projection TO %I',runtime_role);
 EXECUTE format('GRANT SELECT ON salon_public_visibility,salon_public_projection TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_gate ON salon_public_visibility FOR SELECT TO %I USING(published AND tenant_active AND allowed_from<=CURRENT_TIMESTAMP AND allowed_until>CURRENT_TIMESTAMP)',reader_role);
 EXECUTE format('CREATE POLICY visible_projection ON salon_public_projection FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_visibility g WHERE g.tenant_id=salon_public_projection.tenant_id AND g.profile_id=salon_public_projection.profile_id))',reader_role);
END $roles$;

-- 010_marketplace_scheduling
-- Minutes in the local calendar day, half-open ranges. Empty multirange = closed.
-- Native multiranges keep stored intervals disjoint without an extension or exclusion index.
CREATE TABLE salon_opening_hours (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 iso_weekday SMALLINT NOT NULL CHECK(iso_weekday BETWEEN 1 AND 7),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,iso_weekday),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
CREATE TABLE schedule_exceptions (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 local_date DATE NOT NULL CHECK(isfinite(local_date)),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 private_note TEXT NOT NULL DEFAULT '' CHECK(length(private_note)<=1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,local_date),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
CREATE TABLE salon_public_schedules (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 timezone TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id), UNIQUE(tenant_id,profile_id,revision),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id)
);
CREATE TABLE salon_public_opening_hours (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, schedule_revision INTEGER NOT NULL,
 iso_weekday SMALLINT NOT NULL CHECK(iso_weekday BETWEEN 1 AND 7),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 PRIMARY KEY(tenant_id,iso_weekday),
 FOREIGN KEY(tenant_id,profile_id,schedule_revision) REFERENCES salon_public_schedules(tenant_id,profile_id,revision)
);
CREATE TABLE salon_public_schedule_exceptions (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, schedule_revision INTEGER NOT NULL,
 local_date DATE NOT NULL CHECK(isfinite(local_date)),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 PRIMARY KEY(tenant_id,local_date),
 FOREIGN KEY(tenant_id,profile_id,schedule_revision) REFERENCES salon_public_schedules(tenant_id,profile_id,revision)
);

-- Snapshot the salon timezone on publication; no arbitrary default replaces tenants.timezone.
CREATE FUNCTION validate_public_schedule_timezone() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $timezone$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone) THEN
  RAISE EXCEPTION 'Invalid schedule timezone' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $timezone$;
CREATE TRIGGER public_schedule_timezone BEFORE INSERT OR UPDATE OF timezone ON salon_public_schedules
 FOR EACH ROW EXECUTE FUNCTION validate_public_schedule_timezone();
REVOKE ALL ON FUNCTION validate_public_schedule_timezone() FROM PUBLIC;


ALTER TABLE salon_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_opening_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_opening_hours FROM PUBLIC;


ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_exceptions FROM PUBLIC;


ALTER TABLE salon_public_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_schedules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_schedules FROM PUBLIC;


ALTER TABLE salon_public_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_opening_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_opening_hours FROM PUBLIC;


ALTER TABLE salon_public_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_schedule_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_schedule_exceptions FROM PUBLIC;

DO $schedule_roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['salon_opening_hours','schedule_exceptions','salon_public_schedules','salon_public_opening_hours','salon_public_schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY schedule_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_public_schedule_timezone() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['salon_opening_hours','schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY schedule_tenant_insert ON %I FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY schedule_tenant_update ON %I FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY schedule_tenant_delete ON %I FOR DELETE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('GRANT INSERT,UPDATE,DELETE ON %I TO %I',table_name,runtime_role);
 END LOOP;
 -- Runtime cannot publish. Reader never sees drafts/private notes.
 EXECUTE format('GRANT SELECT ON salon_public_schedules,salon_public_opening_hours,salon_public_schedule_exceptions TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_schedule ON salon_public_schedules FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_schedules.tenant_id AND p.profile_id=salon_public_schedules.profile_id))',reader_role);
 FOREACH table_name IN ARRAY ARRAY['salon_public_opening_hours','salon_public_schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY visible_schedule_rows ON %I FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_schedules s WHERE s.tenant_id=%I.tenant_id AND s.profile_id=%I.profile_id AND s.revision=%I.schedule_revision))',table_name,reader_role,table_name,table_name,table_name);
 END LOOP;
END $schedule_roles$;

-- 011_public_catalog
CREATE TABLE salon_public_services (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 source_service_id TEXT NOT NULL, source_variant_id TEXT CHECK(length(source_variant_id) BETWEEN 1 AND 200),
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 booking_requested BOOLEAN NOT NULL DEFAULT false,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,id,source_service_id),
 UNIQUE NULLS NOT DISTINCT(tenant_id,source_service_id,source_variant_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,source_service_id) REFERENCES services_catalog(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE salon_public_service_projection (
 tenant_id UUID NOT NULL, id UUID NOT NULL, profile_id UUID NOT NULL,
 source_service_id TEXT NOT NULL, source_variant_id TEXT CHECK(length(source_variant_id) BETWEEN 1 AND 200),
 source_updated_at TEXT NOT NULL, source_available BOOLEAN NOT NULL DEFAULT false,
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL CHECK(length(description)<=4000),
 price_xof BIGINT NOT NULL CHECK(price_xof BETWEEN 0 AND 9007199254740991),
 duration_minutes SMALLINT CHECK(duration_minutes BETWEEN 5 AND 480),
 booking_requested BOOLEAN NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_id,id,source_service_id) REFERENCES salon_public_services(tenant_id,profile_id,id,source_service_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,source_service_id) REFERENCES services_catalog(tenant_id,id) ON DELETE CASCADE,
 CHECK(NOT booking_requested OR duration_minutes IS NOT NULL)
);

CREATE TABLE salon_booking_rules (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 online_booking_enabled BOOLEAN NOT NULL,
 slot_step_minutes SMALLINT NOT NULL CHECK(slot_step_minutes BETWEEN 1 AND 1440),
 minimum_notice_minutes INTEGER NOT NULL CHECK(minimum_notice_minutes>=0),
 horizon_days INTEGER NOT NULL CHECK(horizon_days>0),
 buffer_before_minutes SMALLINT NOT NULL CHECK(buffer_before_minutes BETWEEN 0 AND 1440),
 buffer_after_minutes SMALLINT NOT NULL CHECK(buffer_after_minutes BETWEEN 0 AND 1440),
 cancellation_allowed BOOLEAN NOT NULL,
 cancellation_notice_minutes INTEGER NOT NULL CHECK(cancellation_notice_minutes>=0),
 employee_choice_allowed BOOLEAN NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);

CREATE TABLE salon_public_booking_rules (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 online_booking_enabled BOOLEAN NOT NULL,
 slot_step_minutes SMALLINT NOT NULL CHECK(slot_step_minutes BETWEEN 1 AND 1440),
 minimum_notice_minutes INTEGER NOT NULL CHECK(minimum_notice_minutes>=0),
 horizon_days INTEGER NOT NULL CHECK(horizon_days>0),
 buffer_before_minutes SMALLINT NOT NULL CHECK(buffer_before_minutes BETWEEN 0 AND 1440),
 buffer_after_minutes SMALLINT NOT NULL CHECK(buffer_after_minutes BETWEEN 0 AND 1440),
 cancellation_allowed BOOLEAN NOT NULL,
 cancellation_notice_minutes INTEGER NOT NULL CHECK(cancellation_notice_minutes>=0),
 employee_choice_allowed BOOLEAN NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id)
);

-- Private source validation for draft variants, executed under the caller's tenant context.
CREATE FUNCTION validate_public_service_variant() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $variant$
DECLARE body JSONB;
BEGIN
 IF NEW.source_variant_id IS NOT NULL THEN
  EXECUTE format('SELECT payload_json FROM %I.services_catalog WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA)
   INTO body USING NEW.tenant_id,NEW.source_service_id;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(body->'variants','[]'::jsonb)) v WHERE v->>'id'=NEW.source_variant_id) THEN
   RAISE EXCEPTION 'Source variant does not belong to service' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $variant$;
CREATE TRIGGER public_service_variant BEFORE INSERT OR UPDATE ON salon_public_services
 FOR EACH ROW EXECUTE FUNCTION validate_public_service_variant();

-- Never trust an injected source_available value. No private lookup on anonymous SELECT.
CREATE FUNCTION derive_public_service_availability() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $available$
DECLARE body JSONB; active BOOLEAN; stamp TEXT;
BEGIN
 EXECUTE format('SELECT payload_json,is_active,updated_at FROM %I.services_catalog WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA)
  INTO body,active,stamp USING NEW.tenant_id,NEW.source_service_id;
 NEW.source_available := NEW.source_available AND COALESCE(active AND body->>'isActive'='true' AND stamp=NEW.source_updated_at AND
  (NEW.source_variant_id IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(body->'variants','[]'::jsonb)) v WHERE v->>'id'=NEW.source_variant_id)),false);
 RETURN NEW;
END $available$;
CREATE TRIGGER public_service_availability BEFORE INSERT OR UPDATE OF source_service_id,source_variant_id,source_updated_at,source_available ON salon_public_service_projection
 FOR EACH ROW EXECUTE FUNCTION derive_public_service_availability();
CREATE FUNCTION invalidate_public_service_source() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $invalidate$
BEGIN
 -- Any actual source change requires explicit republication; a reactivation is not publication.
 IF NEW IS DISTINCT FROM OLD THEN
  EXECUTE format('UPDATE %I.salon_public_service_projection SET source_available=false WHERE tenant_id=$1 AND source_service_id=$2',TG_TABLE_SCHEMA)
   USING NEW.tenant_id,NEW.id;
 END IF;
 RETURN NEW;
END $invalidate$;
CREATE TRIGGER public_catalog_source_changed AFTER UPDATE ON services_catalog
 FOR EACH ROW EXECUTE FUNCTION invalidate_public_service_source();
REVOKE ALL ON FUNCTION validate_public_service_variant(),derive_public_service_availability(),invalidate_public_service_source() FROM PUBLIC;


ALTER TABLE salon_public_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_services FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_services FROM PUBLIC;

ALTER TABLE salon_public_service_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_service_projection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_service_projection FROM PUBLIC;

ALTER TABLE salon_booking_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_booking_rules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_booking_rules FROM PUBLIC;

ALTER TABLE salon_public_booking_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_booking_rules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_booking_rules FROM PUBLIC;
DO $catalog_roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['salon_public_services','salon_public_service_projection','salon_booking_rules','salon_public_booking_rules'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY catalog_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_public_service_variant(),derive_public_service_availability(),invalidate_public_service_source() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['salon_public_services','salon_booking_rules'] LOOP
  EXECUTE format('GRANT INSERT,UPDATE,DELETE ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY catalog_tenant_insert ON %I FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY catalog_tenant_update ON %I FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY catalog_tenant_delete ON %I FOR DELETE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
 END LOOP;
 EXECUTE format('GRANT SELECT ON salon_public_service_projection,salon_public_booking_rules TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_catalog_service ON salon_public_service_projection FOR SELECT TO %I USING(source_available AND EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_service_projection.tenant_id AND p.profile_id=salon_public_service_projection.profile_id))',reader_role);
 EXECUTE format('CREATE POLICY visible_booking_rules ON salon_public_booking_rules FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_booking_rules.tenant_id AND p.profile_id=salon_public_booking_rules.profile_id))',reader_role);
END $catalog_roles$;

-- 012_marketplace_media
CREATE TABLE salon_media (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('logo','cover','gallery')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','ready','rejected','deleted')),
 original_key TEXT NOT NULL CHECK(original_key=tenant_id::text || '/' || id::text || '/original'),
 declared_mime TEXT NOT NULL CHECK(declared_mime IN ('image/jpeg','image/png','image/webp')),
 declared_bytes BIGINT NOT NULL CHECK(declared_bytes BETWEEN 1 AND 9007199254740991),
 upload_expires_at TIMESTAMPTZ NOT NULL,
 actual_mime TEXT CHECK(actual_mime IN ('image/jpeg','image/png','image/webp')),
 actual_bytes BIGINT CHECK(actual_bytes BETWEEN 1 AND 9007199254740991),
 width INTEGER CHECK(width>0), height INTEGER CHECK(height>0),
 sha256 TEXT CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text)<=300),
 credit_text TEXT NOT NULL DEFAULT '' CHECK(length(credit_text)<=300),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 CHECK(upload_expires_at>created_at),
 CHECK(state<>'ready' OR (actual_mime IS NOT NULL AND actual_bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL AND actual_mime=declared_mime AND actual_bytes=declared_bytes))
);
CREATE INDEX salon_media_state_expiry ON salon_media(tenant_id,state,upload_expires_at);
CREATE TABLE salon_media_variants (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL, media_id UUID NOT NULL,
 object_key TEXT NOT NULL CHECK(object_key=tenant_id::text || '/' || media_id::text || '/variants/' || id::text),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 byte_size BIGINT NOT NULL CHECK(byte_size BETWEEN 1 AND 9007199254740991),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 purged_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,media_id,id),
 FOREIGN KEY(tenant_id,profile_id,media_id) REFERENCES salon_media(tenant_id,profile_id,id)
);
CREATE TABLE salon_public_media_projection (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 media_id UUID NOT NULL, variant_id UUID NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('logo','cover','gallery')),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 alt_text TEXT NOT NULL CHECK(length(btrim(alt_text)) BETWEEN 1 AND 300),
 credit_text TEXT NOT NULL DEFAULT '' CHECK(length(credit_text)<=300),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 renderable BOOLEAN NOT NULL DEFAULT false,
 revision INTEGER NOT NULL CHECK(revision>0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,sort_order),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id,media_id,variant_id) REFERENCES salon_media_variants(tenant_id,profile_id,media_id,id)
);
CREATE UNIQUE INDEX salon_public_media_single_role ON salon_public_media_projection(tenant_id,profile_id,purpose) WHERE purpose IN ('logo','cover');

CREATE TABLE salon_media_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), media_id UUID NOT NULL,
 from_state TEXT CHECK(from_state IN ('pending','processing','ready','rejected','deleted')),
 to_state TEXT NOT NULL CHECK(to_state IN ('pending','processing','ready','rejected','deleted')),
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,media_id) REFERENCES salon_media(tenant_id,id)
);
CREATE INDEX salon_media_events_media ON salon_media_events(tenant_id,media_id,at);
CREATE FUNCTION record_media_lifecycle_event() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE previous_state TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  previous_state:=OLD.state;
 END IF;
 EXECUTE format('INSERT INTO %I.salon_media_events(tenant_id,media_id,from_state,to_state,actor_db_role) VALUES($1,$2,$3,$4,$5)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,previous_state,NEW.state,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER media_state_audit AFTER INSERT OR UPDATE OF state ON salon_media FOR EACH ROW EXECUTE FUNCTION record_media_lifecycle_event();
CREATE FUNCTION protect_media_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN
 RAISE EXCEPTION 'Media lifecycle events are immutable' USING ERRCODE='23514';
END $immutable$;
CREATE TRIGGER media_event_immutable BEFORE UPDATE OR DELETE ON salon_media_events FOR EACH ROW EXECUTE FUNCTION protect_media_event();

CREATE FUNCTION validate_media_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $lifecycle$
DECLARE has_variant BOOLEAN;
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.profile_id<>OLD.profile_id OR NEW.original_key<>OLD.original_key
  OR NEW.declared_mime<>OLD.declared_mime OR NEW.declared_bytes<>OLD.declared_bytes OR NEW.upload_expires_at<>OLD.upload_expires_at THEN
  RAISE EXCEPTION 'Media identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state<>OLD.state AND NOT (
  (OLD.state='pending' AND NEW.state IN ('processing','rejected','deleted')) OR
  (OLD.state='processing' AND NEW.state IN ('ready','rejected','deleted')) OR
  (OLD.state IN ('ready','rejected') AND NEW.state='deleted')) THEN
  RAISE EXCEPTION 'Invalid media state transition' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('ready','rejected','deleted') AND
  ROW(NEW.actual_mime,NEW.actual_bytes,NEW.width,NEW.height,NEW.sha256) IS DISTINCT FROM
  ROW(OLD.actual_mime,OLD.actual_bytes,OLD.width,OLD.height,OLD.sha256) THEN
  RAISE EXCEPTION 'Verified media metadata is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state='ready' AND OLD.state<>'ready' THEN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.salon_media_variants WHERE tenant_id=$1 AND media_id=$2 AND purged_at IS NULL)',TG_TABLE_SCHEMA) INTO has_variant USING NEW.tenant_id,NEW.id;
  IF NOT has_variant THEN
   RAISE EXCEPTION 'Ready media requires an optimized variant' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $lifecycle$;
CREATE TRIGGER media_lifecycle BEFORE UPDATE ON salon_media FOR EACH ROW EXECUTE FUNCTION validate_media_lifecycle();
CREATE FUNCTION validate_media_variant_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $variant$
DECLARE state TEXT;
BEGIN
 EXECUTE format('SELECT state FROM %I.salon_media WHERE tenant_id=$1 AND id=$2 AND profile_id=$3',TG_TABLE_SCHEMA)
 INTO state USING NEW.tenant_id,NEW.media_id,NEW.profile_id;
 IF state IS DISTINCT FROM 'processing' OR NEW.purged_at IS NOT NULL THEN
  RAISE EXCEPTION 'Variants require processing media' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $variant$;
CREATE TRIGGER media_variant_insert BEFORE INSERT ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION validate_media_variant_insert();
CREATE FUNCTION protect_media_variant() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $protect$
DECLARE state TEXT;
BEGIN
 IF ROW(NEW.tenant_id,NEW.id,NEW.profile_id,NEW.media_id,NEW.object_key,NEW.mime,NEW.byte_size,NEW.width,NEW.height,NEW.sha256)
  IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.profile_id,OLD.media_id,OLD.object_key,OLD.mime,OLD.byte_size,OLD.width,OLD.height,OLD.sha256) THEN
  RAISE EXCEPTION 'Variant metadata is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
  RAISE EXCEPTION 'Purged variant cannot be restored' USING ERRCODE='23514';
 END IF;
 IF NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL THEN
  EXECUTE format('SELECT state FROM %I.salon_media WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA) INTO state USING NEW.tenant_id,NEW.media_id;
  IF state IS NULL OR state NOT IN ('rejected','deleted') THEN RAISE EXCEPTION 'Close media before purging variant' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $protect$;
CREATE TRIGGER media_variant_protected BEFORE UPDATE ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION protect_media_variant();
CREATE FUNCTION derive_public_media_renderable() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $renderable$
DECLARE ready BOOLEAN; w INTEGER; h INTEGER; content_type TEXT;
BEGIN
 EXECUTE format('SELECT m.state=''ready'' AND v.purged_at IS NULL,v.width,v.height,v.mime FROM %I.salon_media m JOIN %I.salon_media_variants v ON v.tenant_id=m.tenant_id AND v.media_id=m.id AND v.profile_id=m.profile_id WHERE m.tenant_id=$1 AND m.profile_id=$2 AND m.id=$3 AND v.id=$4',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA)
 INTO ready,w,h,content_type USING NEW.tenant_id,NEW.profile_id,NEW.media_id,NEW.variant_id;
 IF TG_OP='INSERT' AND NOT COALESCE(ready,false) THEN RAISE EXCEPTION 'Only ready optimized media can be published' USING ERRCODE='23514'; END IF;
 IF ready THEN NEW.width:=w; NEW.height:=h; NEW.mime:=content_type; END IF;
 NEW.renderable := NEW.renderable AND COALESCE(ready,false);
 RETURN NEW;
END $renderable$;
CREATE TRIGGER public_media_renderable BEFORE INSERT OR UPDATE ON salon_public_media_projection FOR EACH ROW EXECUTE FUNCTION derive_public_media_renderable();
CREATE FUNCTION close_public_media() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $close$
BEGIN
 IF TG_TABLE_NAME='salon_media' THEN
  IF NEW.state<>'ready' THEN
   EXECUTE format('UPDATE %I.salon_public_media_projection SET renderable=false WHERE tenant_id=$1 AND media_id=$2',TG_TABLE_SCHEMA) USING NEW.tenant_id,NEW.id;
  END IF;
 ELSE
  IF NEW.purged_at IS NOT NULL THEN
   EXECUTE format('UPDATE %I.salon_public_media_projection SET renderable=false WHERE tenant_id=$1 AND variant_id=$2',TG_TABLE_SCHEMA) USING NEW.tenant_id,NEW.id;
  END IF;
 END IF;
 RETURN NEW;
END $close$;
CREATE TRIGGER media_closed AFTER UPDATE OF state ON salon_media FOR EACH ROW EXECUTE FUNCTION close_public_media();
CREATE TRIGGER variant_purged AFTER UPDATE OF purged_at ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION close_public_media();
REVOKE ALL ON FUNCTION validate_media_lifecycle(),validate_media_variant_insert(),protect_media_variant(),derive_public_media_renderable(),close_public_media(),record_media_lifecycle_event(),protect_media_event() FROM PUBLIC;

ALTER TABLE salon_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media FROM PUBLIC;

ALTER TABLE salon_media_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media_variants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media_variants FROM PUBLIC;

ALTER TABLE salon_public_media_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_media_projection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_media_projection FROM PUBLIC;

ALTER TABLE salon_media_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media_events FROM PUBLIC;
DO $media_roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 worker_role TEXT := 'salon_pro_media_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=worker_role) THEN RAISE EXCEPTION 'Media worker role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',worker_role);
 EXECUTE format('GRANT %I TO %I',worker_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),worker_role);
 FOREACH table_name IN ARRAY ARRAY['salon_media','salon_media_variants','salon_public_media_projection','salon_media_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY media_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_media_lifecycle(),validate_media_variant_insert(),protect_media_variant(),derive_public_media_renderable(),close_public_media(),record_media_lifecycle_event(),protect_media_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('GRANT INSERT ON salon_media TO %I',runtime_role);
 EXECUTE format('CREATE POLICY media_pending_insert ON salon_media FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid AND state=''pending'' AND actual_mime IS NULL AND actual_bytes IS NULL AND width IS NULL AND height IS NULL AND sha256 IS NULL)',runtime_role);
 EXECUTE format('GRANT UPDATE(alt_text,credit_text,version,updated_at) ON salon_media TO %I',runtime_role);
 EXECUTE format('CREATE POLICY media_draft_edit ON salon_media FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH table_name IN ARRAY ARRAY['salon_media','salon_media_variants'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,worker_role);
  EXECUTE format('CREATE POLICY worker_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,worker_role);
  EXECUTE format('CREATE POLICY worker_tenant_update ON %I FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,worker_role);
 END LOOP;
 EXECUTE format('GRANT UPDATE(state,actual_mime,actual_bytes,width,height,sha256,version,updated_at) ON salon_media TO %I',worker_role);
 EXECUTE format('GRANT INSERT ON salon_media_variants TO %I',worker_role);
 EXECUTE format('CREATE POLICY worker_variant_insert ON salon_media_variants FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
 EXECUTE format('GRANT UPDATE(purged_at) ON salon_media_variants TO %I',worker_role);
 EXECUTE format('GRANT SELECT ON salon_media_events TO %I',worker_role);
 EXECUTE format('CREATE POLICY worker_event_read ON salon_media_events FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
 EXECUTE format('GRANT SELECT ON salon_public_media_projection TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_media ON salon_public_media_projection FOR SELECT TO %I USING(renderable AND EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_media_projection.tenant_id AND p.profile_id=salon_public_media_projection.profile_id))',reader_role);
END $media_roles$;

-- 013_notification_outbox
CREATE TABLE notification_outbox (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(),
 deduplication_key UUID NOT NULL, resource_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('booking_confirmation','booking_reminder','booking_cancellation')),
 channel TEXT NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','dead','cancelled')),
 available_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 100),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND max_attempts),
 lease_token UUID, leased_at TIMESTAMPTZ, lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,deduplication_key),
 CHECK(expires_at>available_at),
 CHECK((state='processing' AND lease_token IS NOT NULL AND leased_at IS NOT NULL AND lease_until IS NOT NULL AND lease_until>leased_at AND lease_until<=expires_at)
    OR (state<>'processing' AND lease_token IS NULL AND leased_at IS NULL AND lease_until IS NULL)),
 CHECK(state<>'processing' OR attempts>0)
);
CREATE INDEX notification_outbox_due ON notification_outbox(tenant_id,available_at,id) WHERE state='pending';
CREATE INDEX notification_outbox_leases ON notification_outbox(tenant_id,lease_until,id) WHERE state='processing';
CREATE TABLE notification_outbox_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), notification_id UUID NOT NULL,
 from_state TEXT, to_state TEXT NOT NULL, attempt INTEGER NOT NULL,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,notification_id) REFERENCES notification_outbox(tenant_id,id)
);
CREATE INDEX notification_events_parent ON notification_outbox_events(tenant_id,notification_id,at);
CREATE FUNCTION protect_notification_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $transition$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.attempts<>0 THEN RAISE EXCEPTION 'Outbox must start pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.tenant_id,NEW.id,NEW.deduplication_key,NEW.resource_id,NEW.event_type,NEW.channel,NEW.expires_at,NEW.max_attempts,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.deduplication_key,OLD.resource_id,OLD.event_type,OLD.channel,OLD.expires_at,OLD.max_attempts,OLD.created_at) THEN
  RAISE EXCEPTION 'Outbox envelope immutable' USING ERRCODE='23514';
 END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('processing','dead','cancelled')) OR
         (OLD.state='processing' AND NEW.state IN ('pending','sent','dead','cancelled'))) THEN
  RAISE EXCEPTION 'Invalid outbox transition' USING ERRCODE='23514';
 END IF;
 IF NEW.state='processing' THEN
  IF NEW.attempts<>OLD.attempts+1 OR NEW.available_at>now() OR NEW.expires_at<=now() OR NEW.leased_at<>now() OR NEW.lease_until<=now() THEN
   RAISE EXCEPTION 'Invalid outbox claim' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.attempts<>OLD.attempts THEN
  RAISE EXCEPTION 'Attempt count immutable outside claim' USING ERRCODE='23514';
 END IF;
 IF NEW.state='pending' AND (NEW.attempts>=NEW.max_attempts OR NEW.available_at>=NEW.expires_at OR NEW.available_at<now()) THEN
  RAISE EXCEPTION 'Invalid retry schedule' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $transition$;
CREATE TRIGGER notification_transition BEFORE INSERT OR UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION protect_notification_transition();
CREATE FUNCTION record_notification_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE previous_state TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN previous_state:=OLD.state; END IF;
 EXECUTE format('INSERT INTO %I.notification_outbox_events(tenant_id,notification_id,from_state,to_state,attempt,actor_db_role) VALUES($1,$2,$3,$4,$5,$6)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,previous_state,NEW.state,NEW.attempts,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER notification_audit AFTER INSERT OR UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION record_notification_event();
CREATE FUNCTION protect_notification_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Outbox events immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER notification_event_immutable BEFORE UPDATE OR DELETE ON notification_outbox_events FOR EACH ROW EXECUTE FUNCTION protect_notification_event();
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON notification_outbox,notification_outbox_events FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_notification_transition(),record_notification_event(),protect_notification_event() FROM PUBLIC;
DO $roles$
DECLARE
 runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 worker_role TEXT:='salon_pro_notify_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=worker_role) THEN RAISE EXCEPTION 'Notification role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',worker_role);
 EXECUTE format('GRANT %I TO %I',worker_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),worker_role);
 FOREACH table_name IN ARRAY ARRAY['notification_outbox','notification_outbox_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I,%I',table_name,runtime_role,worker_role);
  EXECUTE format('CREATE POLICY notification_tenant_read ON %I FOR SELECT TO %I,%I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role,worker_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION protect_notification_transition(),record_notification_event(),protect_notification_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('GRANT UPDATE(state,available_at,attempts,lease_token,leased_at,lease_until,updated_at) ON notification_outbox TO %I',worker_role);
 EXECUTE format('CREATE POLICY notification_worker_update ON notification_outbox FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
END $roles$;

-- 014_appointment_services
CREATE TABLE appointment_services (
 tenant_id UUID NOT NULL, booking_id TEXT NOT NULL,
 position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 100),
 source_service_id TEXT NOT NULL CHECK(length(source_service_id) BETWEEN 1 AND 200),
 source_variant_id TEXT CHECK(length(source_variant_id) BETWEEN 1 AND 200),
 source_updated_at TEXT NOT NULL CHECK(length(source_updated_at)>0),
 service_name TEXT NOT NULL CHECK(length(btrim(service_name)) BETWEEN 1 AND 160),
 variant_label TEXT CHECK(length(btrim(variant_label)) BETWEEN 1 AND 160),
 price_xof BIGINT NOT NULL CHECK(price_xof BETWEEN 0 AND 9007199254740991),
 duration_minutes SMALLINT NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480),
 actor_id TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,booking_id,position),
 FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id),
 CHECK((source_variant_id IS NULL)=(variant_label IS NULL))
);
CREATE INDEX appointment_services_source ON appointment_services(tenant_id,source_service_id);
CREATE FUNCTION derive_appointment_service_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $snapshot$
DECLARE
 body JSONB; selected JSONB; active BOOLEAN; parent_state TEXT; parent_kind TEXT;
 valid_actor BOOLEAN; price NUMERIC; minutes NUMERIC; matches INTEGER;
BEGIN
 -- Lock the parent before reading the source. Future booking commands must share this order.
 EXECUTE format('SELECT status,payload_json->>''kind'' FROM %I.bookings WHERE tenant_id=$1 AND id=$2 FOR UPDATE',TG_TABLE_SCHEMA)
 INTO parent_state,parent_kind USING NEW.tenant_id,NEW.booking_id;
 IF parent_state IS DISTINCT FROM 'planned' OR parent_kind IS DISTINCT FROM 'appointment' THEN
  RAISE EXCEPTION 'Snapshot requires a planned appointment in the same tenant' USING ERRCODE='23514';
 END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id JOIN %1$I.tenants t ON t.id=m.tenant_id WHERE t.status=''active'' AND m.tenant_id=$1 AND m.user_id=$2 AND m.role=''manager'' AND m.is_active AND u.is_active)',TG_TABLE_SCHEMA)
 INTO valid_actor USING NEW.tenant_id,NEW.actor_id;
 IF NOT valid_actor THEN RAISE EXCEPTION 'Active manager actor required' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT payload_json,is_active,name,reference_price,updated_at FROM %I.services_catalog WHERE tenant_id=$1 AND id=$2 FOR SHARE',TG_TABLE_SCHEMA)
 INTO body,active,NEW.service_name,price,NEW.source_updated_at USING NEW.tenant_id,NEW.source_service_id;
 IF NOT COALESCE(active AND body->>'isActive'='true',false) THEN
  RAISE EXCEPTION 'Active source service required in the same tenant' USING ERRCODE='23514';
 END IF;
 selected:=body;
 IF NEW.source_variant_id IS NOT NULL THEN
  IF jsonb_typeof(body->'variants') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid source variants' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(body->'variants') v WHERE v->>'id'=NEW.source_variant_id;
  IF matches<>1 THEN RAISE EXCEPTION 'Source variant missing or ambiguous' USING ERRCODE='23514'; END IF;
  SELECT v INTO selected FROM jsonb_array_elements(body->'variants') v WHERE v->>'id'=NEW.source_variant_id;
  IF jsonb_typeof(selected->'price') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid variant price' USING ERRCODE='23514'; END IF;
  price:=(selected->>'price')::numeric;
  IF jsonb_typeof(selected->'label') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid variant label' USING ERRCODE='23514'; END IF;
  NEW.variant_label:=selected->>'label';
 ELSE
  NEW.variant_label:=NULL;
 END IF;
 IF selected->'durationMinutes' IS NULL OR selected->'durationMinutes'='null'::jsonb THEN selected:=body; END IF;
 IF jsonb_typeof(selected->'durationMinutes') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Explicit source duration required' USING ERRCODE='23514';
 END IF;
 minutes:=(selected->>'durationMinutes')::numeric;
 IF price IS NULL OR price<0 OR price>9007199254740991 OR price<>trunc(price) OR minutes<5 OR minutes>480 OR minutes<>trunc(minutes) THEN
  RAISE EXCEPTION 'Invalid snapshot price or duration' USING ERRCODE='23514';
 END IF;
 NEW.price_xof:=price::bigint; NEW.duration_minutes:=minutes::smallint; NEW.captured_at:=now();
 RETURN NEW;
END $snapshot$;
CREATE TRIGGER appointment_service_snapshot BEFORE INSERT ON appointment_services FOR EACH ROW EXECUTE FUNCTION derive_appointment_service_snapshot();
CREATE FUNCTION protect_appointment_service_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Appointment service snapshot immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER appointment_service_immutable BEFORE UPDATE OR DELETE ON appointment_services FOR EACH ROW EXECUTE FUNCTION protect_appointment_service_snapshot();
ALTER TABLE appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_services FORCE ROW LEVEL SECURITY;
REVOKE ALL ON appointment_services FROM PUBLIC;
REVOKE ALL ON FUNCTION derive_appointment_service_snapshot(),protect_appointment_service_snapshot() FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT ON appointment_services TO %I',runtime_role);
 EXECUTE format('CREATE POLICY appointment_service_read ON appointment_services FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON appointment_services FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION derive_appointment_service_snapshot(),protect_appointment_service_snapshot() FROM %I',browser_role);
  END IF;
 END LOOP;
END $roles$;

-- 015_schedule_blocks
CREATE TABLE schedule_blocks (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(),
 scope TEXT NOT NULL CHECK(scope IN ('salon','employee')),
 employee_id TEXT, employee_ref TEXT CHECK(length(employee_ref) BETWEEN 1 AND 200),
 start_at TIMESTAMPTZ NOT NULL CHECK(isfinite(start_at)),
 end_at TIMESTAMPTZ NOT NULL CHECK(isfinite(end_at)),
 private_note TEXT NOT NULL DEFAULT '' CHECK(length(private_note)<=1000),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','cancelled')),
 created_by TEXT NOT NULL, cancelled_by TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id) ON DELETE SET NULL(employee_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,cancelled_by) REFERENCES memberships(tenant_id,user_id),
 CHECK(end_at>start_at),
 CHECK((scope='salon' AND employee_id IS NULL AND employee_ref IS NULL) OR
       (scope='employee' AND employee_ref IS NOT NULL AND (employee_id IS NULL OR employee_id=employee_ref))),
 CHECK((state='active' AND cancelled_by IS NULL) OR (state='cancelled' AND cancelled_by IS NOT NULL))
);
CREATE INDEX schedule_blocks_interval ON schedule_blocks(tenant_id,scope,employee_ref,start_at,end_at) WHERE state='active';
CREATE TABLE schedule_block_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), block_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('created','cancelled','employee_detached')),
 version INTEGER NOT NULL CHECK(version>0), actor_id TEXT,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,block_id,version),
 FOREIGN KEY(tenant_id,block_id) REFERENCES schedule_blocks(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE FUNCTION validate_schedule_block() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $block$
DECLARE actor TEXT; permitted BOOLEAN; employee_active BOOLEAN;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'active' OR NEW.cancelled_by IS NOT NULL THEN RAISE EXCEPTION 'Block must start active' USING ERRCODE='23514'; END IF;
  actor:=NEW.created_by; NEW.version:=1; NEW.created_at:=now();
  IF NEW.scope='employee' THEN
   EXECUTE format('SELECT is_active FROM %I.employees WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA)
    INTO employee_active USING NEW.tenant_id,NEW.employee_id;
   IF NOT COALESCE(employee_active,false) THEN RAISE EXCEPTION 'Active employee in same tenant required' USING ERRCODE='23514'; END IF;
   NEW.employee_ref:=NEW.employee_id;
  ELSE NEW.employee_ref:=NULL;
  END IF;
 ELSE
  IF ROW(NEW.tenant_id,NEW.id,NEW.scope,NEW.employee_ref,NEW.start_at,NEW.end_at,NEW.private_note,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.scope,OLD.employee_ref,OLD.start_at,OLD.end_at,OLD.private_note,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Block envelope immutable; cancel and recreate' USING ERRCODE='23514';
  END IF;
  IF OLD.employee_id IS NOT NULL AND NEW.employee_id IS NULL AND NEW.state=OLD.state AND NEW.cancelled_by IS NOT DISTINCT FROM OLD.cancelled_by THEN
   -- Only a genuine FK detachment after employee deletion, never a conversion to salon scope.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.employees WHERE tenant_id=$1 AND id=$2)',TG_TABLE_SCHEMA)
    INTO employee_active USING OLD.tenant_id,OLD.employee_id;
   IF employee_active THEN RAISE EXCEPTION 'Employee still exists' USING ERRCODE='23514'; END IF;
   NEW.version:=OLD.version+1; NEW.updated_at:=now(); RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR OLD.state<>'active' OR NEW.state<>'cancelled' OR NEW.cancelled_by IS NULL THEN
   RAISE EXCEPTION 'Invalid block transition' USING ERRCODE='23514';
  END IF;
  actor:=NEW.cancelled_by; NEW.version:=OLD.version+1;
 END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id JOIN %1$I.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role=''manager'' AND m.is_active AND u.is_active AND t.status=''active'')',TG_TABLE_SCHEMA)
  INTO permitted USING NEW.tenant_id,actor;
 IF NOT permitted THEN RAISE EXCEPTION 'Active manager actor required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $block$;
CREATE TRIGGER schedule_block_validate BEFORE INSERT OR UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION validate_schedule_block();
CREATE FUNCTION record_schedule_block_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE kind TEXT; actor TEXT;
BEGIN
 IF TG_OP='INSERT' THEN kind:='created'; actor:=NEW.created_by;
 ELSIF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN kind:='employee_detached'; actor:=NULL;
 ELSE kind:='cancelled'; actor:=NEW.cancelled_by;
 END IF;
 EXECUTE format('INSERT INTO %I.schedule_block_events(tenant_id,block_id,event_type,version,actor_id,actor_db_role) VALUES($1,$2,$3,$4,$5,$6)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,kind,NEW.version,actor,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER schedule_block_audit AFTER INSERT OR UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION record_schedule_block_event();
CREATE FUNCTION protect_schedule_block_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Schedule block history immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER schedule_block_no_delete BEFORE DELETE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION protect_schedule_block_history();
CREATE TRIGGER schedule_block_event_immutable BEFORE UPDATE OR DELETE ON schedule_block_events FOR EACH ROW EXECUTE FUNCTION protect_schedule_block_history();

ALTER TABLE schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_blocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_blocks FROM PUBLIC;

ALTER TABLE schedule_block_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_block_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_block_events FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_schedule_block(),record_schedule_block_event(),protect_schedule_block_history() FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); table_name TEXT; browser_role TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['schedule_blocks','schedule_block_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY block_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_schedule_block(),record_schedule_block_event(),protect_schedule_block_history() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
END $roles$;

-- 016_profile_details
CREATE TABLE salon_profile_details (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 slogan TEXT NOT NULL DEFAULT '' CHECK(length(slogan)<=160),
 category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=120),
 public_address TEXT NOT NULL DEFAULT '' CHECK(length(public_address)<=500),
 whatsapp TEXT NOT NULL DEFAULT '' CHECK(whatsapp='' OR whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
 public_email TEXT NOT NULL DEFAULT '' CHECK(length(public_email)<=254),
 website TEXT NOT NULL DEFAULT '' CHECK(length(website)<=2048 AND (website='' OR website ~ '^https://[^[:space:]]+$')),
 facebook TEXT NOT NULL DEFAULT '' CHECK(length(facebook)<=2048 AND (facebook='' OR facebook ~ '^https://[^[:space:]]+$')),
 instagram TEXT NOT NULL DEFAULT '' CHECK(length(instagram)<=2048 AND (instagram='' OR instagram ~ '^https://[^[:space:]]+$')),
 tiktok TEXT NOT NULL DEFAULT '' CHECK(length(tiktok)<=2048 AND (tiktok='' OR tiktok ~ '^https://[^[:space:]]+$')),
 PRIMARY KEY(tenant_id,profile_id), UNIQUE(tenant_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
ALTER TABLE salon_profile_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_profile_details FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_profile_details FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON salon_profile_details TO %I',runtime_role);
 EXECUTE format('CREATE POLICY details_read ON salon_profile_details FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_insert ON salon_profile_details FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_update ON salon_profile_details FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON salon_profile_details FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;

-- 017_visibility_editor
ALTER TABLE salon_public_services ADD CONSTRAINT service_selection_profile_key UNIQUE(tenant_id,profile_id,id);
CREATE TABLE salon_service_selections (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, service_id UUID NOT NULL,
 PRIMARY KEY(tenant_id,service_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_id,service_id) REFERENCES salon_public_services(tenant_id,profile_id,id) ON DELETE CASCADE
);
ALTER TABLE salon_service_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_service_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_service_selections FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT,INSERT,DELETE ON salon_service_selections TO %I',runtime_role);
 EXECUTE format('CREATE POLICY selection_tenant ON salon_service_selections TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON salon_service_selections FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;

-- 018_visibility_unpublish
DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION unpublish_salon_profile(p_actor TEXT,p_expected_version INTEGER)
 RETURNS TABLE(version INTEGER,changed BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; profile UUID; current_version INTEGER; was_published BOOLEAN;
 BEGIN
  tenant:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
  IF tenant IS NULL OR NOT EXISTS(
   SELECT 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id JOIN %1$I.tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=tenant AND m.user_id=p_actor AND m.role='manager' AND m.is_active AND u.is_active AND t.status='active'
  ) THEN RAISE EXCEPTION 'Active manager required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(%2$L || ':visibility:' || tenant::text));
  SELECT p.id,p.version INTO profile,current_version FROM %1$I.salon_public_profiles p WHERE p.tenant_id=tenant FOR UPDATE;
  IF profile IS NULL THEN RAISE EXCEPTION 'Profile required' USING ERRCODE='23514'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<1 OR current_version<>p_expected_version THEN
   RAISE EXCEPTION 'Visibility version conflict' USING ERRCODE='40001';
  END IF;
  SELECT g.published INTO was_published FROM %1$I.salon_public_visibility g WHERE g.tenant_id=tenant AND g.profile_id=profile FOR UPDATE;
  IF NOT COALESCE(was_published,false) THEN RETURN QUERY SELECT current_version,false; RETURN; END IF;
  UPDATE %1$I.salon_public_visibility g SET published=false WHERE g.tenant_id=tenant AND g.profile_id=profile;
  UPDATE %1$I.salon_public_profiles p SET version=p.version+1,updated_at=now() WHERE p.tenant_id=tenant AND p.id=profile;
  INSERT INTO %1$I.salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version)
   VALUES(tenant,profile,p_actor,'unpublished',current_version+1);
  RETURN QUERY SELECT current_version+1,true;
 END $body$;
 $definition$,current_schema(),current_schema());
END $install$;
REVOKE ALL ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT EXECUTE ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;

-- 019_saas_subscriptions
CREATE FUNCTION valid_plan_entitlements(value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $validate$
DECLARE k TEXT; n NUMERIC;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>12 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['establishments','users','managers','cashiers','employees','galleryImages','publicServices'] LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(value->>k)::numeric; IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['publicProfile','serviceListing','contactRequests','appointmentRequests','onlineBooking'] LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $validate$;
CREATE TABLE saas_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL CHECK(code ~ '^[a-z][a-z0-9-]{1,59}$'),
 version INTEGER NOT NULL CHECK(version>0), name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 price_xof BIGINT NOT NULL CHECK(price_xof BETWEEN 0 AND 9007199254740991),
 currency TEXT NOT NULL CHECK(currency='XOF'), period_kind TEXT NOT NULL CHECK(period_kind='calendar_month'),
 grace_seconds INTEGER NOT NULL CHECK(grace_seconds BETWEEN 0 AND 2678400),
 entitlements JSONB NOT NULL CHECK(valid_plan_entitlements(entitlements)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(code,version)
);
CREATE TABLE tenant_subscriptions (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES saas_plans(id),
 activation_key UUID NOT NULL, billing_anchor_at TIMESTAMPTZ NOT NULL CHECK(isfinite(billing_anchor_at)),
 period_index INTEGER NOT NULL CHECK(period_index BETWEEN 0 AND 1199), billing_timezone TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL CHECK(isfinite(starts_at)), ends_at TIMESTAMPTZ NOT NULL CHECK(isfinite(ends_at)),
 grace_ends_at TIMESTAMPTZ NOT NULL CHECK(isfinite(grace_ends_at)),
 amount_xof BIGINT NOT NULL CHECK(amount_xof BETWEEN 0 AND 9007199254740991),
 external_reference TEXT NOT NULL CHECK(length(btrim(external_reference)) BETWEEN 1 AND 200),
 evidence_reference TEXT NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 500),
 operator_reference TEXT NOT NULL CHECK(length(btrim(operator_reference)) BETWEEN 1 AND 200),
 revoked_at TIMESTAMPTZ, revoked_by TEXT, revocation_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,activation_key), UNIQUE(tenant_id,external_reference),
 CHECK(ends_at>starts_at AND grace_ends_at>=ends_at),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
       (revoked_at IS NOT NULL AND isfinite(revoked_at) AND length(btrim(revoked_by)) BETWEEN 1 AND 200 AND revoked_by IS NOT NULL AND length(btrim(revocation_reason)) BETWEEN 1 AND 500 AND revocation_reason IS NOT NULL))
);
CREATE INDEX tenant_subscriptions_period ON tenant_subscriptions(tenant_id,starts_at,ends_at,grace_ends_at);
CREATE TABLE subscription_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), subscription_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('activated','revoked')), operator_reference TEXT NOT NULL,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,subscription_id) REFERENCES tenant_subscriptions(tenant_id,id)
);
CREATE FUNCTION validate_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $subscription$
DECLARE price BIGINT; grace INTEGER; has_overlap BOOLEAN; zone TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.id,NEW.plan_id,NEW.activation_key,NEW.billing_anchor_at,NEW.period_index,NEW.billing_timezone,NEW.starts_at,NEW.ends_at,NEW.grace_ends_at,NEW.amount_xof,NEW.external_reference,NEW.evidence_reference,NEW.operator_reference,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.plan_id,OLD.activation_key,OLD.billing_anchor_at,OLD.period_index,OLD.billing_timezone,OLD.starts_at,OLD.ends_at,OLD.grace_ends_at,OLD.amount_xof,OLD.external_reference,OLD.evidence_reference,OLD.operator_reference,OLD.created_at)
   OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'Subscription immutable except one-way revocation' USING ERRCODE='23514'; END IF;
  NEW.revoked_at:=now(); RETURN NEW;
 END IF;
 IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revocation_reason IS NOT NULL THEN RAISE EXCEPTION 'New grant cannot start revoked' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT price_xof,grace_seconds FROM %I.saas_plans WHERE id=$1',TG_TABLE_SCHEMA) INTO price,grace USING NEW.plan_id;
 IF price IS NULL OR NEW.amount_xof<>price OR NEW.grace_ends_at<>NEW.ends_at+grace*interval '1 second' THEN
  RAISE EXCEPTION 'Grant must match immutable plan price and grace' USING ERRCODE='23514';
 END IF;
 -- Serialize grants by the actual tenant, not a process-local lock.
 EXECUTE format('SELECT timezone FROM %I.tenants WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO zone USING NEW.tenant_id;
 IF zone IS NULL OR NEW.billing_timezone<>zone OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'Valid tenant billing timezone required' USING ERRCODE='23514'; END IF;
 IF NEW.starts_at<>((NEW.billing_anchor_at AT TIME ZONE zone)+make_interval(months=>NEW.period_index)) AT TIME ZONE zone OR NEW.ends_at<>((NEW.billing_anchor_at AT TIME ZONE zone)+make_interval(months=>NEW.period_index+1)) AT TIME ZONE zone THEN RAISE EXCEPTION 'Calendar anchor period mismatch' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.tenant_subscriptions WHERE tenant_id=$1 AND revoked_at IS NULL AND starts_at<$3 AND ends_at>$2)',TG_TABLE_SCHEMA)
  INTO has_overlap USING NEW.tenant_id,NEW.starts_at,NEW.ends_at;
 IF has_overlap THEN RAISE EXCEPTION 'Overlapping paid subscription periods' USING ERRCODE='23514'; END IF;
 NEW.created_at:=now(); RETURN NEW;
END $subscription$;
CREATE TRIGGER subscription_validate BEFORE INSERT OR UPDATE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION validate_subscription();
CREATE FUNCTION record_subscription_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
BEGIN
 EXECUTE format('INSERT INTO %I.subscription_events(tenant_id,subscription_id,event_type,operator_reference,actor_db_role) VALUES($1,$2,$3,$4,$5)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'activated' ELSE 'revoked' END,CASE WHEN TG_OP='INSERT' THEN NEW.operator_reference ELSE NEW.revoked_by END,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER subscription_audit AFTER INSERT OR UPDATE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION record_subscription_event();
CREATE FUNCTION protect_subscription_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Subscription history immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER plan_immutable BEFORE UPDATE OR DELETE ON saas_plans FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
CREATE TRIGGER subscription_no_delete BEFORE DELETE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
CREATE TRIGGER subscription_event_immutable BEFORE UPDATE OR DELETE ON subscription_events FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();

ALTER TABLE saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON saas_plans FROM PUBLIC;

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_subscriptions FROM PUBLIC;

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON subscription_events FROM PUBLIC;
REVOKE ALL ON FUNCTION valid_plan_entitlements(JSONB),validate_subscription(),record_subscription_event(),protect_subscription_history() FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); table_name TEXT; browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT ON saas_plans TO %I',runtime_role);
 EXECUTE format('CREATE POLICY plan_catalog_read ON saas_plans FOR SELECT TO %I USING(true)',runtime_role);
 EXECUTE format('GRANT SELECT(tenant_id,id,plan_id,starts_at,ends_at,grace_ends_at,revoked_at) ON tenant_subscriptions TO %I',runtime_role);
 EXECUTE format('CREATE POLICY subscription_tenant_read ON tenant_subscriptions FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH table_name IN ARRAY ARRAY['saas_plans','tenant_subscriptions','subscription_events'] LOOP
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION valid_plan_entitlements(JSONB),validate_subscription(),record_subscription_event(),protect_subscription_history() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
END $roles$;

-- 020_platform_activation
CREATE TABLE platform_activation_receipts (
 activation_key UUID PRIMARY KEY, tenant_id UUID NOT NULL, subscription_id UUID NOT NULL,
 evidence_namespace TEXT NOT NULL, external_reference TEXT NOT NULL,
 command JSONB NOT NULL, verified_by TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(evidence_namespace,external_reference),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES tenant_subscriptions(tenant_id,id)
);
ALTER TABLE platform_activation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_activation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_activation_receipts FROM PUBLIC;
CREATE TRIGGER activation_receipt_immutable BEFORE UPDATE OR DELETE ON platform_activation_receipts FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
DO $install$
DECLARE operator_role TEXT:='salon_pro_platform_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=operator_role) THEN RAISE EXCEPTION 'Platform role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',operator_role);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),operator_role);
 -- Deliberately no membership assigned to any existing login or ERP role.
 EXECUTE format($definition$
 CREATE FUNCTION activate_essential_subscription(a JSONB,execute_activation BOOLEAN DEFAULT false) RETURNS JSONB
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE who RECORD; tenant UUID; key UUID; zone TEXT; anchor TIMESTAMPTZ; idx INTEGER;
  starts TIMESTAMPTZ; ends TIMESTAMPTZ; grace TIMESTAMPTZ; target TIMESTAMP; boundary TIMESTAMPTZ; candidates INTEGER; n INTEGER;
  plan UUID; existing_plan RECORD; receipt RECORD;
  caps JSONB:='{"establishments":1,"users":2,"managers":1,"cashiers":1,"employees":5,"galleryImages":3,"publicServices":10,"publicProfile":true,"serviceListing":true,"contactRequests":true,"appointmentRequests":true,"onlineBooking":false}'::jsonb;
 BEGIN
  IF execute_activation IS NULL THEN RAISE EXCEPTION 'Explicit activation mode required' USING ERRCODE='23514'; END IF;
  SELECT * INTO who FROM pg_roles WHERE rolname=session_user;
  IF NOT who.rolcanlogin OR who.rolsuper OR who.rolbypassrls OR who.rolcreaterole OR who.rolcreatedb OR who.rolreplication
   OR NOT pg_has_role(session_user,%2$L,'MEMBER')
   OR pg_has_role(session_user,%3$L,'MEMBER')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=%4$L AND nspowner=who.oid)
   OR EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=who.oid)
   OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname=%4$L AND c.relkind IN ('r','p','v','m','f') AND (has_any_column_privilege(session_user,c.oid,'SELECT') OR has_table_privilege(session_user,c.oid,'INSERT') OR has_table_privilege(session_user,c.oid,'UPDATE') OR has_table_privilege(session_user,c.oid,'DELETE'))) THEN
   RAISE EXCEPTION 'Dedicated restricted platform login required' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(a))<>10
   OR NOT (a ?& ARRAY['activationKey','tenantId','billingAnchorAt','periodIndex','evidenceNamespace','externalReference','evidenceReference','verificationReason','verifiedAmountXof','externalVerificationConfirmed']) THEN
   RAISE EXCEPTION 'Invalid activation fields' USING ERRCODE='23514';
  END IF;
  FOREACH zone IN ARRAY ARRAY['activationKey','tenantId','billingAnchorAt','evidenceNamespace','externalReference','evidenceReference','verificationReason'] LOOP
   IF jsonb_typeof(a->zone) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid activation text' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (a->>'activationKey') !~ '^[a-f0-9-]{36}$' OR (a->>'tenantId') !~ '^[a-f0-9-]{36}$'
   OR (a->>'evidenceNamespace') !~ '^[a-z0-9][a-z0-9_-]{1,39}$'
   OR length(btrim(a->>'externalReference')) NOT BETWEEN 1 AND 120
   OR length(btrim(a->>'evidenceReference')) NOT BETWEEN 1 AND 500
   OR length(btrim(a->>'verificationReason')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(a->'periodIndex') IS DISTINCT FROM 'number'
   OR (a->>'periodIndex')::numeric<>trunc((a->>'periodIndex')::numeric)
   OR (a->>'periodIndex')::numeric NOT BETWEEN 0 AND 1199
   OR a->'verifiedAmountXof' IS DISTINCT FROM '4900'::jsonb
   OR jsonb_typeof(a->'externalVerificationConfirmed') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Invalid verified activation' USING ERRCODE='23514';
  END IF;
  IF execute_activation AND a->'externalVerificationConfirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'External verification attestation required' USING ERRCODE='23514'; END IF;
  tenant:=(a->>'tenantId')::uuid; key:=(a->>'activationKey')::uuid; anchor:=(a->>'billingAnchorAt')::timestamptz; idx:=(a->>'periodIndex')::integer;
  IF NOT isfinite(anchor) THEN RAISE EXCEPTION 'Finite anchor required' USING ERRCODE='23514'; END IF;
  SELECT timezone INTO zone FROM %1$I.tenants WHERE id=tenant AND status='active' FOR UPDATE;
  IF zone IS NULL THEN RAISE EXCEPTION 'Active tenant required' USING ERRCODE='23514'; END IF;
  SELECT * INTO receipt FROM %1$I.platform_activation_receipts WHERE activation_key=key;
  IF FOUND THEN
   IF receipt.command IS DISTINCT FROM a OR receipt.verified_by<>session_user::text THEN RAISE EXCEPTION 'Activation key conflict' USING ERRCODE='23505'; END IF;
   SELECT starts_at,ends_at,grace_ends_at INTO starts,ends,grace FROM %1$I.tenant_subscriptions WHERE tenant_id=tenant AND id=receipt.subscription_id;
   RETURN jsonb_build_object('outcome','replayed','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
  END IF;
  -- Resolve both monthly boundaries uniquely; never silently choose an ambiguous DST time.
  FOR n IN idx..idx+1 LOOP
   target:=(anchor AT TIME ZONE zone)+make_interval(months=>n);
   WITH probes AS (
    SELECT (target AT TIME ZONE 'UTC')+h*interval '1 hour' AS p FROM generate_series(-36,36,6) h
   ), choices AS (
    SELECT DISTINCT (target AT TIME ZONE 'UTC')-((p AT TIME ZONE zone)-(p AT TIME ZONE 'UTC')) AS candidate FROM probes
   ) SELECT count(*),min(candidate) INTO candidates,boundary FROM choices WHERE candidate AT TIME ZONE zone=target;
   IF candidates<>1 THEN RAISE EXCEPTION 'Ambiguous local billing boundary; operator review required' USING ERRCODE='23514'; END IF;
   IF n=idx THEN starts:=boundary; ELSE ends:=boundary; END IF;
  END LOOP;
  grace:=ends+interval '72 hours';
  SELECT * INTO existing_plan FROM %1$I.saas_plans WHERE code='essentiel' AND version=1;
  IF FOUND THEN
   IF existing_plan.name<>'SALON PRO ESSENTIEL' OR existing_plan.price_xof<>4900 OR existing_plan.currency<>'XOF'
    OR existing_plan.period_kind<>'calendar_month' OR existing_plan.grace_seconds<>259200 OR existing_plan.entitlements IS DISTINCT FROM caps THEN
    RAISE EXCEPTION 'Approved ESSENTIEL v1 configuration mismatch' USING ERRCODE='23514';
   END IF;
   plan:=existing_plan.id;
  END IF;
  IF EXISTS(SELECT 1 FROM %1$I.tenant_subscriptions WHERE tenant_id=tenant AND revoked_at IS NULL AND starts_at<ends AND ends_at>starts)
   OR EXISTS(SELECT 1 FROM %1$I.platform_activation_receipts WHERE evidence_namespace=a->>'evidenceNamespace' AND external_reference=a->>'externalReference') THEN
   RAISE EXCEPTION 'Overlapping period or reused external reference' USING ERRCODE='23505';
  END IF;
  IF NOT execute_activation THEN
   RETURN jsonb_build_object('outcome','preview','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
  END IF;
  IF plan IS NULL THEN
   INSERT INTO %1$I.saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements)
    VALUES('essentiel',1,'SALON PRO ESSENTIEL',4900,'XOF','calendar_month',259200,caps) ON CONFLICT(code,version) DO NOTHING RETURNING id INTO plan;
   IF plan IS NULL THEN RAISE EXCEPTION 'Concurrent plan registration; retry unchanged command' USING ERRCODE='40001'; END IF;
  END IF;
  INSERT INTO %1$I.tenant_subscriptions(tenant_id,id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
   VALUES(tenant,key,plan,key,anchor,idx,zone,starts,ends,grace,4900,(a->>'evidenceNamespace') || ':' || (a->>'externalReference'),a->>'evidenceReference',session_user::text);
  INSERT INTO %1$I.platform_activation_receipts(activation_key,tenant_id,subscription_id,evidence_namespace,external_reference,command,verified_by)
   VALUES(key,tenant,key,a->>'evidenceNamespace',a->>'externalReference',a,session_user::text);
  RETURN jsonb_build_object('outcome','activated','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
 END $body$;
 $definition$,current_schema(),operator_role,'salon_pro_runtime_' || substr(md5(current_schema()),1,12),current_schema());
 REVOKE ALL ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) FROM PUBLIC;
 EXECUTE format('GRANT EXECUTE ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) TO %I',operator_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON platform_activation_receipts FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) FROM %I',browser_role);
  END IF;
 END LOOP;
END $install$;

-- 021_public_access_enforcement
LOCK TABLE salon_public_service_projection,salon_public_media_projection,salon_media,salon_public_visibility,salon_public_projection IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE salon_public_quota_usage (
 tenant_id UUID NOT NULL REFERENCES tenants(id), resource TEXT NOT NULL CHECK(resource IN ('services','photos','uploads')),
 used BIGINT NOT NULL CHECK(used>=0), PRIMARY KEY(tenant_id,resource)
);
INSERT INTO salon_public_quota_usage SELECT tenant_id,'services',count(*) FROM salon_public_service_projection GROUP BY tenant_id;
INSERT INTO salon_public_quota_usage SELECT tenant_id,'photos',count(*) FROM salon_public_media_projection GROUP BY tenant_id;
INSERT INTO salon_public_quota_usage SELECT tenant_id,'uploads',count(*) FROM salon_media WHERE state NOT IN ('rejected','deleted') GROUP BY tenant_id;
ALTER TABLE salon_public_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_quota_usage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_quota_usage FROM PUBLIC;
DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION subscription_public_cap(p_tenant UUID,p_resource TEXT,p_keep BOOLEAN DEFAULT false)
 RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE caps JSONB; at_time TIMESTAMPTZ:=clock_timestamp();
 BEGIN
  SELECT p.entitlements INTO caps FROM %1$I.tenant_subscriptions s JOIN %1$I.saas_plans p ON p.id=s.plan_id
   JOIN %1$I.tenants t ON t.id=s.tenant_id
   WHERE s.tenant_id=p_tenant AND t.status='active' AND s.revoked_at IS NULL AND s.starts_at<=at_time
    AND CASE WHEN p_keep THEN s.grace_ends_at>at_time ELSE s.ends_at>at_time END
   ORDER BY s.ends_at DESC LIMIT 1;
  IF caps IS NULL OR (caps->>'publicProfile')::boolean IS NOT TRUE THEN RETURN 0; END IF;
  IF p_resource='profile' THEN RETURN 1;
  ELSIF p_resource='services' AND (caps->>'serviceListing')::boolean IS TRUE THEN RETURN (caps->>'publicServices')::integer;
  ELSIF p_resource IN ('photos','uploads') THEN RETURN (caps->>'galleryImages')::integer;
  END IF;
  RETURN 0;
 END $body$;
 CREATE FUNCTION subscription_public_visible(p_tenant UUID)
 RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 BEGIN
  RETURN %1$I.subscription_public_cap(p_tenant,'profile',true)>0
   AND NOT EXISTS(SELECT 1 FROM %1$I.salon_public_quota_usage q WHERE q.tenant_id=p_tenant AND q.resource IN ('services','photos') AND q.used>%1$I.subscription_public_cap(p_tenant,q.resource,true));
 END $body$;
 CREATE FUNCTION enforce_public_subscription_write()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; resource_name TEXT; delta INTEGER:=0; old_counted BOOLEAN:=false; new_counted BOOLEAN:=false; cap INTEGER; usage BIGINT; safety_close BOOLEAN:=false;
 BEGIN
  IF TG_OP='DELETE' THEN tenant:=OLD.tenant_id; ELSE tenant:=NEW.tenant_id; END IF;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Quota tenant immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP<>'DELETE' THEN
   PERFORM 1 FROM %1$I.tenants t WHERE t.id=tenant FOR UPDATE;
   PERFORM 1 FROM %1$I.tenant_subscriptions s WHERE s.tenant_id=tenant FOR SHARE;
  END IF;
  IF TG_TABLE_NAME='salon_public_visibility' THEN
   IF NEW.published THEN
    IF %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM %1$I.salon_public_quota_usage q WHERE q.tenant_id=tenant AND q.resource IN ('services','photos') AND q.used>%1$I.subscription_public_cap(tenant,q.resource,false)) THEN RAISE EXCEPTION 'Public quota exceeded' USING ERRCODE='23514'; END IF;
   END IF;
   RETURN NEW;
  ELSIF TG_TABLE_NAME='salon_public_projection' THEN
   IF TG_OP<>'DELETE' AND %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='salon_public_service_projection' THEN resource_name:='services';
  ELSIF TG_TABLE_NAME='salon_public_media_projection' THEN resource_name:='photos';
  ELSE resource_name:='uploads'; END IF;
  IF TG_OP<>'INSERT' THEN
   IF resource_name='uploads' THEN old_counted:=OLD.state NOT IN ('rejected','deleted'); ELSE old_counted:=true; END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
   IF resource_name='uploads' THEN new_counted:=NEW.state NOT IN ('rejected','deleted'); ELSE new_counted:=true; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
   IF resource_name='services' THEN safety_close:=NOT NEW.source_available AND (to_jsonb(OLD)-'source_available')=(to_jsonb(NEW)-'source_available');
   ELSIF resource_name='photos' THEN safety_close:=NOT NEW.renderable AND (to_jsonb(OLD)-'renderable')=(to_jsonb(NEW)-'renderable');
   END IF;
  END IF;
  delta:=new_counted::integer-old_counted::integer;
  IF new_counted AND NOT safety_close THEN
   cap:=%1$I.subscription_public_cap(tenant,resource_name,false);
   IF cap=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
  END IF;
  -- Atomic row update, not count-then-insert. Concurrent RR/serializable writers
  -- conflict on this row; READ COMMITTED writers recheck the latest used value.
  INSERT INTO %1$I.salon_public_quota_usage(tenant_id,resource,used) VALUES(tenant,resource_name,0) ON CONFLICT DO NOTHING;
  UPDATE %1$I.salon_public_quota_usage q SET used=q.used+delta
   WHERE q.tenant_id=tenant AND q.resource=resource_name
    AND q.used+delta>=0 AND (delta<=0 OR q.used+delta<=cap)
   RETURNING q.used INTO usage;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public quota exceeded' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END $body$;
 $definition$,current_schema());
END $install$;
CREATE TRIGGER subscription_gate_write BEFORE INSERT OR UPDATE ON salon_public_visibility FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_profile_write BEFORE INSERT OR UPDATE ON salon_public_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_services_write AFTER INSERT OR UPDATE OR DELETE ON salon_public_service_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_photos_write AFTER INSERT OR UPDATE OR DELETE ON salon_public_media_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_uploads_write AFTER INSERT OR UPDATE OR DELETE ON salon_media FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
REVOKE ALL ON FUNCTION subscription_public_cap(UUID,TEXT,BOOLEAN),subscription_public_visible(UUID),enforce_public_subscription_write() FROM PUBLIC;
DO $roles$
DECLARE reader_role TEXT:='salon_pro_public_' || substr(md5(current_schema()),1,12); runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('REVOKE ALL ON salon_public_quota_usage FROM %I,%I',reader_role,runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION subscription_public_visible(UUID) TO %I,%I',reader_role,runtime_role);
 EXECUTE format('CREATE POLICY subscription_visibility ON salon_public_visibility AS RESTRICTIVE FOR SELECT TO %I USING(%I.subscription_public_visible(tenant_id))',reader_role,current_schema());
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON salon_public_quota_usage FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION subscription_public_cap(UUID,TEXT,BOOLEAN),subscription_public_visible(UUID),enforce_public_subscription_write() FROM %I',browser_role);
  END IF;
 END LOOP;
END $roles$;

-- 022_publish_profile_text
CREATE TABLE salon_public_details (
 tenant_id UUID NOT NULL,profile_id UUID NOT NULL,details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),
 PRIMARY KEY(tenant_id,profile_id), FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id)
);
CREATE TABLE salon_publication_receipts (
 tenant_id UUID NOT NULL,activation_key UUID NOT NULL,actor_id TEXT NOT NULL,request_version INTEGER NOT NULL,
 slug TEXT NOT NULL,result_version INTEGER NOT NULL,revision INTEGER NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,activation_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER publication_receipt_immutable BEFORE UPDATE OR DELETE ON salon_publication_receipts FOR EACH ROW EXECUTE FUNCTION protect_public_profile_event();
ALTER TABLE salon_public_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_details FORCE ROW LEVEL SECURITY;
ALTER TABLE salon_publication_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_publication_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_details,salon_publication_receipts FROM PUBLIC;
DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION publish_salon_profile_text(p_actor TEXT,p_key UUID,p_version INTEGER,p_slug TEXT,p_confirm BOOLEAN)
 RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; p RECORD; prior RECORD; source RECORD; variant JSONB; price NUMERIC; duration NUMERIC;
 label TEXT; description TEXT; count_selected INTEGER; next_revision INTEGER; ends_grace TIMESTAMPTZ; zone TEXT;
 BEGIN
  tenant:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
  IF p_confirm IS DISTINCT FROM true OR p_key IS NULL OR p_version IS NULL OR p_version<1 OR p_version>=2147483647
   OR p_slug IS NULL OR length(p_slug) NOT BETWEEN 3 AND 100 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Explicit text publication intent required' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(%2$L || ':visibility:' || tenant::text));
  PERFORM 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id
   WHERE m.tenant_id=tenant AND m.user_id=p_actor AND m.role='manager' AND m.is_active AND u.is_active FOR SHARE OF m,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active manager required' USING ERRCODE='42501'; END IF;
  SELECT t.timezone INTO zone FROM %1$I.tenants t WHERE t.id=tenant AND t.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active tenant required' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM %1$I.salon_publication_receipts r WHERE r.tenant_id=tenant AND r.activation_key=p_key;
  IF FOUND THEN
   IF prior.actor_id<>p_actor OR prior.request_version<>p_version OR prior.slug<>p_slug THEN RAISE EXCEPTION 'Publication key conflict' USING ERRCODE='40001'; END IF;
   RETURN jsonb_build_object('outcome','replayed','version',prior.result_version,'revision',prior.revision,'slug',prior.slug);
  END IF;
  PERFORM 1 FROM %1$I.tenant_subscriptions s WHERE s.tenant_id=tenant FOR SHARE;
  SELECT s.grace_ends_at INTO ends_grace FROM %1$I.tenant_subscriptions s JOIN %1$I.saas_plans plan ON plan.id=s.plan_id
   WHERE s.tenant_id=tenant AND s.revoked_at IS NULL AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp()
   AND (plan.entitlements->>'publicProfile')::boolean ORDER BY s.ends_at DESC LIMIT 1;
  IF ends_grace IS NULL OR %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM %1$I.salon_public_profiles x WHERE x.tenant_id=tenant FOR UPDATE;
  IF NOT FOUND OR p.version<>p_version THEN RAISE EXCEPTION 'Visibility version conflict' USING ERRCODE='40001'; END IF;
  IF length(btrim(p.display_name))=0 OR length(btrim(p.city))=0 THEN RAISE EXCEPTION 'Public name and city required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM %1$I.salon_public_media_projection m WHERE m.tenant_id=tenant) THEN RAISE EXCEPTION 'Existing public media require dedicated publication review' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM %1$I.salon_opening_hours h WHERE h.tenant_id=tenant AND h.profile_id=p.id)<>7 THEN RAISE EXCEPTION 'Seven saved schedule days required' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO count_selected FROM %1$I.salon_service_selections x WHERE x.tenant_id=tenant AND x.profile_id=p.id;
  IF count_selected<1 OR count_selected>%1$I.subscription_public_cap(tenant,'services',false) THEN RAISE EXCEPTION 'Selected service quota or empty selection' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(x.revision),0)+1 INTO next_revision FROM %1$I.salon_public_projection x WHERE x.tenant_id=tenant;
  INSERT INTO %1$I.salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until)
   VALUES(tenant,p.id,false,clock_timestamp(),ends_grace)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET published=false,allowed_from=clock_timestamp(),allowed_until=ends_grace;
  INSERT INTO %1$I.salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,public_phone,revision)
   VALUES(tenant,p.id,p_slug,p.display_name,p.description,p.city,p.commune,p.public_phone,next_revision)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET slug=EXCLUDED.slug,display_name=EXCLUDED.display_name,description=EXCLUDED.description,city=EXCLUDED.city,commune=EXCLUDED.commune,public_phone=EXCLUDED.public_phone,revision=EXCLUDED.revision,published_at=clock_timestamp();
  INSERT INTO %1$I.salon_public_details(tenant_id,profile_id,details)
   SELECT tenant,p.id,jsonb_build_object('slogan',d.slogan,'category',d.category,'publicAddress',d.public_address,'whatsapp',d.whatsapp,'publicEmail',d.public_email,'website',d.website,'facebook',d.facebook,'instagram',d.instagram,'tiktok',d.tiktok)
   FROM %1$I.salon_profile_details d WHERE d.tenant_id=tenant AND d.profile_id=p.id
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET details=EXCLUDED.details;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved profile details required' USING ERRCODE='23514'; END IF;
  DELETE FROM %1$I.salon_public_service_projection x WHERE x.tenant_id=tenant;
  FOR source IN SELECT s.id,s.source_variant_id,c.id AS source_id,c.name,c.reference_price,c.updated_at,c.is_active,c.payload_json AS body
   FROM %1$I.salon_service_selections x JOIN %1$I.salon_public_services s ON s.tenant_id=x.tenant_id AND s.profile_id=x.profile_id AND s.id=x.service_id
   JOIN %1$I.services_catalog c ON c.tenant_id=s.tenant_id AND c.id=s.source_service_id
   WHERE x.tenant_id=tenant AND x.profile_id=p.id ORDER BY c.id,s.id FOR SHARE OF s,c
  LOOP
   IF NOT source.is_active OR (source.body->>'isActive') IS DISTINCT FROM 'true' OR jsonb_typeof(COALESCE(source.body->'variants','[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='23514'; END IF;
   variant:=NULL;
   IF source.source_variant_id IS NOT NULL THEN
    IF (SELECT count(*) FROM jsonb_array_elements(source.body->'variants') v WHERE v->>'id'=source.source_variant_id)<>1 THEN RAISE EXCEPTION 'Source variant unavailable' USING ERRCODE='23514'; END IF;
    SELECT v INTO variant FROM jsonb_array_elements(source.body->'variants') v WHERE v->>'id'=source.source_variant_id;
    IF jsonb_typeof(variant->'price') IS DISTINCT FROM 'number' OR jsonb_typeof(variant->'label') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid variant' USING ERRCODE='23514'; END IF;
   END IF;
   price:=CASE WHEN variant IS NULL THEN source.reference_price ELSE (variant->>'price')::numeric END;
   duration:=COALESCE(NULLIF(variant->'durationMinutes','null'::jsonb),NULLIF(source.body->'durationMinutes','null'::jsonb))::text::numeric;
   IF price IS NULL OR price<0 OR price>9007199254740991 OR price<>trunc(price) OR (duration IS NOT NULL AND (duration<5 OR duration>480 OR duration<>trunc(duration))) THEN RAISE EXCEPTION 'Invalid price or duration' USING ERRCODE='23514'; END IF;
   label:=btrim(source.name) || CASE WHEN variant IS NULL THEN '' ELSE ' — ' || btrim(variant->>'label') END;
   IF jsonb_typeof(source.body->'description') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid service description' USING ERRCODE='23514'; END IF;
   description:=source.body->>'description';
   IF length(label)=0 OR length(label)>160 OR description IS NULL OR length(description)>4000 THEN RAISE EXCEPTION 'Invalid service text' USING ERRCODE='23514'; END IF;
   INSERT INTO %1$I.salon_public_service_projection(tenant_id,id,profile_id,source_service_id,source_variant_id,source_updated_at,source_available,display_name,description,price_xof,duration_minutes,booking_requested,revision)
    VALUES(tenant,source.id,p.id,source.source_id,source.source_variant_id,source.updated_at,true,label,description,price::bigint,duration::smallint,false,next_revision);
  END LOOP;
  IF (SELECT count(*) FROM %1$I.salon_public_service_projection x WHERE x.tenant_id=tenant)<>count_selected THEN RAISE EXCEPTION 'Selected source missing' USING ERRCODE='23514'; END IF;
  DELETE FROM %1$I.salon_public_opening_hours h WHERE h.tenant_id=tenant;
  DELETE FROM %1$I.salon_public_schedule_exceptions e WHERE e.tenant_id=tenant;
  INSERT INTO %1$I.salon_public_schedules(tenant_id,profile_id,timezone,revision) VALUES(tenant,p.id,zone,next_revision)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET timezone=EXCLUDED.timezone,revision=EXCLUDED.revision,published_at=clock_timestamp();
  INSERT INTO %1$I.salon_public_opening_hours(tenant_id,profile_id,schedule_revision,iso_weekday,windows)
   SELECT tenant,p.id,next_revision,h.iso_weekday,h.windows FROM %1$I.salon_opening_hours h WHERE h.tenant_id=tenant AND h.profile_id=p.id;
  INSERT INTO %1$I.salon_public_schedule_exceptions(tenant_id,profile_id,schedule_revision,local_date,windows)
   SELECT tenant,p.id,next_revision,e.local_date,e.windows FROM %1$I.schedule_exceptions e WHERE e.tenant_id=tenant AND e.profile_id=p.id;
  -- Never carry legacy booking rules into an ESSENTIEL text-only publication.
  DELETE FROM %1$I.salon_public_booking_rules r WHERE r.tenant_id=tenant;
  UPDATE %1$I.salon_public_profiles x SET version=x.version+1,updated_at=clock_timestamp() WHERE x.tenant_id=tenant AND x.id=p.id;
  INSERT INTO %1$I.salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES(tenant,p.id,p_actor,'published',p.version+1);
  INSERT INTO %1$I.salon_publication_receipts(tenant_id,activation_key,actor_id,request_version,slug,result_version,revision) VALUES(tenant,p_key,p_actor,p_version,p_slug,p.version+1,next_revision);
  UPDATE %1$I.salon_public_visibility g SET published=true WHERE g.tenant_id=tenant AND g.profile_id=p.id;
  RETURN jsonb_build_object('outcome','published','version',p.version+1,'revision',next_revision,'slug',p_slug);
 END $body$;
 $definition$,current_schema(),current_schema());
END $install$;
REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); reader_role TEXT:='salon_pro_public_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('REVOKE ALL ON salon_public_details,salon_publication_receipts FROM %I,%I',runtime_role,reader_role);
 EXECUTE format('REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM %I',reader_role);
 EXECUTE format('GRANT SELECT ON salon_public_details TO %I,%I',runtime_role,reader_role);
 EXECUTE format('CREATE POLICY details_tenant_read ON salon_public_details FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_public_read ON salon_public_details FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_details.tenant_id AND p.profile_id=salon_public_details.profile_id))',reader_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON salon_public_details,salon_publication_receipts FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM %I',browser_role);
  END IF;
 END LOOP;
END $roles$;
