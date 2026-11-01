/** 009: opt-in public-profile foundation only. No publication API or seeded data. */
export const MARKETPLACE_SQL = `
CREATE TABLE salon_public_profiles (
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 display_name TEXT NOT NULL DEFAULT '' CHECK(length(display_name)<=160),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 city TEXT NOT NULL DEFAULT '' CHECK(length(city)<=120),
 commune TEXT NOT NULL DEFAULT '' CHECK(length(commune)<=120),
 public_phone TEXT CHECK(length(public_phone)<=80),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id)
);
CREATE TABLE salon_public_visibility (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 published BOOLEAN NOT NULL DEFAULT false,
 tenant_active BOOLEAN NOT NULL DEFAULT false,
 allowed_from TIMESTAMPTZ, allowed_until TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 CHECK((allowed_from IS NULL AND allowed_until IS NULL) OR
       (allowed_from IS NOT NULL AND allowed_until IS NOT NULL AND allowed_until>allowed_from))
);
CREATE TABLE salon_public_projection (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 100 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL CHECK(length(description)<=4000),
 city TEXT NOT NULL CHECK(length(btrim(city)) BETWEEN 1 AND 120),
 commune TEXT NOT NULL CHECK(length(commune)<=120),
 public_phone TEXT CHECK(length(public_phone)<=80),
 revision INTEGER NOT NULL CHECK(revision>0),
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_visibility(tenant_id,profile_id)
);
CREATE TABLE salon_public_profile_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 actor_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('draft_saved','published','unpublished')),
 profile_version INTEGER NOT NULL CHECK(profile_version>0),
 at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX salon_public_profile_events_profile ON salon_public_profile_events(tenant_id,profile_id,at);

-- Gate activity is derived from the actual tenant, never trusted from a supplied value.
CREATE FUNCTION derive_public_tenant_activity() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $activity$
BEGIN
 EXECUTE format('SELECT status = ''active'' FROM %I.tenants WHERE id=$1',TG_TABLE_SCHEMA)
 INTO NEW.tenant_active USING NEW.tenant_id;
 NEW.tenant_active := COALESCE(NEW.tenant_active,false);
 RETURN NEW;
END $activity$;
CREATE TRIGGER public_visibility_activity BEFORE INSERT OR UPDATE ON salon_public_visibility
 FOR EACH ROW EXECUTE FUNCTION derive_public_tenant_activity();
CREATE FUNCTION close_public_visibility_on_suspension() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $suspension$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  -- Reactivation does not silently republish a previously suspended profile.
  EXECUTE format('UPDATE %I.salon_public_visibility SET tenant_active=$1, published=false WHERE tenant_id=$2',TG_TABLE_SCHEMA)
  USING NEW.status='active',NEW.id;
 END IF;
 RETURN NEW;
END $suspension$;
CREATE TRIGGER public_visibility_suspension AFTER UPDATE OF status ON tenants
 FOR EACH ROW EXECUTE FUNCTION close_public_visibility_on_suspension();
CREATE FUNCTION protect_public_profile_event() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $immutable$
BEGIN
 RAISE EXCEPTION 'Public profile events are immutable' USING ERRCODE='23514';
END $immutable$;
CREATE TRIGGER public_profile_event_immutable BEFORE UPDATE OR DELETE ON salon_public_profile_events
 FOR EACH ROW EXECUTE FUNCTION protect_public_profile_event();
REVOKE ALL ON FUNCTION derive_public_tenant_activity(), close_public_visibility_on_suspension(), protect_public_profile_event() FROM PUBLIC;

${['salon_public_profiles','salon_public_visibility','salon_public_projection','salon_public_profile_events'].map((table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${table} FROM PUBLIC;
`).join('\n')}

DO $roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=reader_role AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit)) THEN
  RAISE EXCEPTION 'Unsafe public reader role';
 END IF;
 -- Even a NOLOGIN role can already hold direct grants: never silently reuse one.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=reader_role) THEN
  RAISE EXCEPTION 'Public reader role already exists; review its privileges';
 END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',reader_role);
 EXECUTE format('GRANT %I TO %I',reader_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),reader_role);
 FOREACH table_name IN ARRAY ARRAY['salon_public_profiles','salon_public_visibility','salon_public_projection','salon_public_profile_events'] LOOP
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION derive_public_tenant_activity(), close_public_visibility_on_suspension(), protect_public_profile_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('CREATE POLICY tenant_insert ON salon_public_profiles FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY tenant_update ON salon_public_profiles FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY tenant_event ON salon_public_profile_events FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON salon_public_profiles TO %I',runtime_role);
 EXECUTE format('GRANT SELECT,INSERT ON salon_public_profile_events TO %I',runtime_role);
 -- No runtime publication grants in this foundation: a reviewed publish command is a later slice.
 EXECUTE format('GRANT SELECT ON salon_public_visibility,salon_public_projection TO %I',runtime_role);
 EXECUTE format('GRANT SELECT ON salon_public_visibility,salon_public_projection TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_gate ON salon_public_visibility FOR SELECT TO %I USING(published AND tenant_active AND allowed_from<=CURRENT_TIMESTAMP AND allowed_until>CURRENT_TIMESTAMP)',reader_role);
 EXECUTE format('CREATE POLICY visible_projection ON salon_public_projection FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_visibility g WHERE g.tenant_id=salon_public_projection.tenant_id AND g.profile_id=salon_public_projection.profile_id))',reader_role);
END $roles$;
`
