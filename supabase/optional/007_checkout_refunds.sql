-- OPTIONNEL : 006 requise ; backup/restore vérifiés. Ne pas appliquer automatiquement.
BEGIN;
SET LOCAL search_path = salon_pro;

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

INSERT INTO schema_migrations(id) VALUES ('007_checkout_refunds');
COMMIT;
