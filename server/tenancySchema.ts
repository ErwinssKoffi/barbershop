export const TENANT_BUSINESS_TABLES = [
  'salon_info', 'app_settings', 'categories', 'services_catalog', 'employees',
  'cash_sessions', 'cash_movements', 'revenues', 'expenses', 'recurring_expenses',
  'products', 'stock_movements', 'advances', 'bonuses', 'salary_payments',
  'budgets', 'correction_logs', 'sync_tombstones',
] as const

export const TENANCY_SQL = `
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

${[...TENANT_BUSINESS_TABLES, 'salon_users'].map((table) => `
ALTER TABLE ${table} ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE ${table} SET tenant_id = (SELECT tenant_id FROM tenant_bootstrap);
ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
CREATE INDEX idx_${table}_tenant ON ${table} (tenant_id);
`).join('\n')}
${TENANT_BUSINESS_TABLES.map((table) => `
ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey;
ALTER TABLE ${table} ADD PRIMARY KEY (tenant_id, ${table === 'sync_tombstones' ? 'entity_type, entity_id' : 'id'});
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table}
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
`).join('\n')}
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ${TENANT_BUSINESS_TABLES.join(', ')} TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON salon_users, memberships, organizations, tenants TO %I', runtime_role);
  EXECUTE format('GRANT SELECT ON tenant_bootstrap TO %I', runtime_role);
END
$runtime$;
`
