/** 014: historical service snapshots only; depends on 008, not on public booking. */
export const APPOINTMENT_SERVICES_SQL = `
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
`
