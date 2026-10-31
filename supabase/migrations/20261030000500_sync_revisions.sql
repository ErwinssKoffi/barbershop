-- Journal et révisions du schéma privé SALON PRO uniquement.
SET LOCAL search_path = salon_pro;

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

REVOKE ALL ON sync_state, sync_changes FROM PUBLIC, anon, authenticated;
INSERT INTO schema_migrations (id) VALUES ('005_sync_revisions');
