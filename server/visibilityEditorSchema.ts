/** 017: selection membership only; never delete draft rows backing a published projection. */
export const VISIBILITY_EDITOR_SQL = `
ALTER TABLE salon_public_services ADD CONSTRAINT service_selection_profile_key UNIQUE(tenant_id,profile_id,id);
CREATE TABLE salon_service_selections (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL, service_id UUID NOT NULL,
 PRIMARY KEY(tenant_id,service_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,profile_id,service_id) REFERENCES salon_public_services(tenant_id,profile_id,id) ON DELETE CASCADE
);
ALTER TABLE salon_service_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_service_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_service_selections FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT,INSERT,DELETE ON salon_service_selections TO %I',runtime_role);
 EXECUTE format('CREATE POLICY selection_tenant ON salon_service_selections TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON salon_service_selections FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;
`
