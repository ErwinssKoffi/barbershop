-- OPTIONNEL : sauvegarde et restauration vérifiées obligatoires. Ne pas appliquer automatiquement.
-- Généré depuis server/checkoutSchema.ts ; uniquement le schéma privé salon_pro.
BEGIN;
SET LOCAL search_path = salon_pro;

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

INSERT INTO schema_migrations(id) VALUES ('006_checkout');
COMMIT;
