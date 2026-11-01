-- Minutes in the local calendar day, half-open ranges. Empty multirange = closed.
-- Native multiranges keep stored intervals disjoint without an extension or exclusion index.
CREATE TABLE salon_opening_hours (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 iso_weekday SMALLINT NOT NULL CHECK(iso_weekday BETWEEN 1 AND 7),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,iso_weekday),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
CREATE TABLE schedule_exceptions (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 local_date DATE NOT NULL CHECK(isfinite(local_date)),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 private_note TEXT NOT NULL DEFAULT '' CHECK(length(private_note)<=1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,local_date),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
CREATE TABLE salon_public_schedules (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 timezone TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id), UNIQUE(tenant_id,profile_id,revision),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id)
);
CREATE TABLE salon_public_opening_hours (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, schedule_revision INTEGER NOT NULL,
 iso_weekday SMALLINT NOT NULL CHECK(iso_weekday BETWEEN 1 AND 7),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 PRIMARY KEY(tenant_id,iso_weekday),
 FOREIGN KEY(tenant_id,profile_id,schedule_revision) REFERENCES salon_public_schedules(tenant_id,profile_id,revision)
);
CREATE TABLE salon_public_schedule_exceptions (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, schedule_revision INTEGER NOT NULL,
 local_date DATE NOT NULL CHECK(isfinite(local_date)),
 windows INT4MULTIRANGE NOT NULL CHECK(windows <@ '{[0,1440)}'::int4multirange),
 PRIMARY KEY(tenant_id,local_date),
 FOREIGN KEY(tenant_id,profile_id,schedule_revision) REFERENCES salon_public_schedules(tenant_id,profile_id,revision)
);

-- Snapshot the salon timezone on publication; no arbitrary default replaces tenants.timezone.
CREATE FUNCTION validate_public_schedule_timezone() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $timezone$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone) THEN
  RAISE EXCEPTION 'Invalid schedule timezone' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $timezone$;
CREATE TRIGGER public_schedule_timezone BEFORE INSERT OR UPDATE OF timezone ON salon_public_schedules
 FOR EACH ROW EXECUTE FUNCTION validate_public_schedule_timezone();
REVOKE ALL ON FUNCTION validate_public_schedule_timezone() FROM PUBLIC;


ALTER TABLE salon_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_opening_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_opening_hours FROM PUBLIC;


ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_exceptions FROM PUBLIC;


ALTER TABLE salon_public_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_schedules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_schedules FROM PUBLIC;


ALTER TABLE salon_public_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_opening_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_opening_hours FROM PUBLIC;


ALTER TABLE salon_public_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_schedule_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_schedule_exceptions FROM PUBLIC;

DO $schedule_roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['salon_opening_hours','schedule_exceptions','salon_public_schedules','salon_public_opening_hours','salon_public_schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY schedule_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_public_schedule_timezone() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['salon_opening_hours','schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY schedule_tenant_insert ON %I FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY schedule_tenant_update ON %I FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('CREATE POLICY schedule_tenant_delete ON %I FOR DELETE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  EXECUTE format('GRANT INSERT,UPDATE,DELETE ON %I TO %I',table_name,runtime_role);
 END LOOP;
 -- Runtime cannot publish. Reader never sees drafts/private notes.
 EXECUTE format('GRANT SELECT ON salon_public_schedules,salon_public_opening_hours,salon_public_schedule_exceptions TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_schedule ON salon_public_schedules FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_schedules.tenant_id AND p.profile_id=salon_public_schedules.profile_id))',reader_role);
 FOREACH table_name IN ARRAY ARRAY['salon_public_opening_hours','salon_public_schedule_exceptions'] LOOP
  EXECUTE format('CREATE POLICY visible_schedule_rows ON %I FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_schedules s WHERE s.tenant_id=%I.tenant_id AND s.profile_id=%I.profile_id AND s.revision=%I.schedule_revision))',table_name,reader_role,table_name,table_name,table_name);
 END LOOP;
END $schedule_roles$;
