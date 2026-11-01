/** Optional 008; independent of checkout/refund migrations. No seeded business data. */
export const BOOKING_SQL=`
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
${['bookings','booking_events'].map((table) => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON ${table} FROM PUBLIC;`).join('\n')}
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
`
