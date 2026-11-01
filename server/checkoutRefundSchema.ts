import { CHECKOUT_SQL } from './checkoutSchema.ts'

// Replace the protection function only in opt-in 007; never change already published 006.
const originalFunction=CHECKOUT_SQL.slice(CHECKOUT_SQL.indexOf('CREATE FUNCTION protect_checkout_record()'),CHECKOUT_SQL.indexOf('END $protect$;')+'END $protect$;'.length)
const owners='(SELECT tenant_id,table_name,row_id FROM checkout_records UNION ALL SELECT tenant_id,table_name,row_id FROM checkout_refund_records)'
export const REFUND_SQL=`
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
${['checkout_refunds','checkout_refund_records'].map((table) => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table} USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);`).join('\n')}
${originalFunction.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('FROM checkout_records c',`FROM ${owners} c`).replace('FROM checkout_records WHERE',`FROM ${owners} owned WHERE`)}
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
`
