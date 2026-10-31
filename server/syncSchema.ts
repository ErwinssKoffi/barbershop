export const SYNC_TABLES = {
  salon: 'salon_info', settings: 'app_settings', categories: 'categories', services: 'services_catalog',
  employees: 'employees', revenues: 'revenues', expenses: 'expenses', recurringExpenses: 'recurring_expenses',
  cashSessions: 'cash_sessions', cashMovements: 'cash_movements', advances: 'advances', bonuses: 'bonuses',
  salaryPayments: 'salary_payments', products: 'products', stockMovements: 'stock_movements', budgets: 'budgets', correctionLogs: 'correction_logs',
} as const
export type SyncKey = keyof typeof SYNC_TABLES
export const SYNC_REVISIONS_SQL = `
CREATE TABLE sync_state (tenant_id UUID PRIMARY KEY REFERENCES tenants(id), revision BIGINT NOT NULL DEFAULT 0, record_count BIGINT NOT NULL DEFAULT 0);
CREATE TABLE sync_changes (
  tenant_id UUID NOT NULL REFERENCES tenants(id), seq BIGINT NOT NULL, table_name TEXT NOT NULL,
  row_id TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('upsert','delete')), payload_json JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, seq)
);
CREATE INDEX idx_sync_changes_row ON sync_changes (tenant_id, table_name, row_id, seq DESC);
${['sync_state', 'sync_changes'].map((table) => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table}
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`).join('\n')}
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
${Object.entries(SYNC_TABLES).map(([key, table]) => `CREATE TRIGGER sync_journal AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION record_sync_change('${key}');`).join('\n')}
-- Initialisation du journal pour toutes les données héritées, une seule fois, sans changer les écritures.
DO $baseline$
DECLARE t RECORD; r RECORD; revision BIGINT;
BEGIN
 FOR t IN SELECT id FROM tenants LOOP
  PERFORM set_config('app.tenant_id', t.id::text, true);
  INSERT INTO sync_state (tenant_id) VALUES (t.id) ON CONFLICT DO NOTHING;
  ${Object.entries(SYNC_TABLES).map(([key, table]) => `FOR r IN SELECT id, payload_json FROM ${table} WHERE tenant_id = t.id LOOP
    UPDATE sync_state SET revision = sync_state.revision + 1, record_count = sync_state.record_count + ${['salon','settings','categories'].includes(key) ? 0 : 1} WHERE tenant_id = t.id RETURNING sync_state.revision INTO revision;
    INSERT INTO sync_changes (tenant_id, seq, table_name, row_id, op, payload_json) VALUES (t.id, revision, '${key}', r.id, 'upsert', r.payload_json);
  END LOOP;`).join('\n')}
 END LOOP;
 PERFORM set_config('app.tenant_id', '', true);
END $baseline$;
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
 EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sync_state TO %I', runtime_role);
 EXECUTE format('GRANT SELECT, INSERT ON sync_changes TO %I', runtime_role);
END $runtime$;
`
