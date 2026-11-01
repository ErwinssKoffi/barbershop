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
