-- Migration transactionnelle du schéma privé SALON PRO uniquement.
SET LOCAL search_path = salon_pro;

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

INSERT INTO schema_migrations (id) VALUES ('003_tenancy');
