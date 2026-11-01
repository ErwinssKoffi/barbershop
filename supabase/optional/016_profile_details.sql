CREATE TABLE salon_profile_details (
 tenant_id UUID NOT NULL, profile_id UUID NOT NULL,
 slogan TEXT NOT NULL DEFAULT '' CHECK(length(slogan)<=160),
 category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=120),
 public_address TEXT NOT NULL DEFAULT '' CHECK(length(public_address)<=500),
 whatsapp TEXT NOT NULL DEFAULT '' CHECK(whatsapp='' OR whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
 public_email TEXT NOT NULL DEFAULT '' CHECK(length(public_email)<=254),
 website TEXT NOT NULL DEFAULT '' CHECK(length(website)<=2048 AND (website='' OR website ~ '^https://[^[:space:]]+$')),
 facebook TEXT NOT NULL DEFAULT '' CHECK(length(facebook)<=2048 AND (facebook='' OR facebook ~ '^https://[^[:space:]]+$')),
 instagram TEXT NOT NULL DEFAULT '' CHECK(length(instagram)<=2048 AND (instagram='' OR instagram ~ '^https://[^[:space:]]+$')),
 tiktok TEXT NOT NULL DEFAULT '' CHECK(length(tiktok)<=2048 AND (tiktok='' OR tiktok ~ '^https://[^[:space:]]+$')),
 PRIMARY KEY(tenant_id,profile_id), UNIQUE(tenant_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id)
);
ALTER TABLE salon_profile_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_profile_details FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_profile_details FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON salon_profile_details TO %I',runtime_role);
 EXECUTE format('CREATE POLICY details_read ON salon_profile_details FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_insert ON salon_profile_details FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_update ON salon_profile_details FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON salon_profile_details FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;
