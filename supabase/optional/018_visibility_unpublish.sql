DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION unpublish_salon_profile(p_actor TEXT,p_expected_version INTEGER)
 RETURNS TABLE(version INTEGER,changed BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; profile UUID; current_version INTEGER; was_published BOOLEAN;
 BEGIN
  tenant:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
  IF tenant IS NULL OR NOT EXISTS(
   SELECT 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id JOIN %1$I.tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=tenant AND m.user_id=p_actor AND m.role='manager' AND m.is_active AND u.is_active AND t.status='active'
  ) THEN RAISE EXCEPTION 'Active manager required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(%2$L || ':visibility:' || tenant::text));
  SELECT p.id,p.version INTO profile,current_version FROM %1$I.salon_public_profiles p WHERE p.tenant_id=tenant FOR UPDATE;
  IF profile IS NULL THEN RAISE EXCEPTION 'Profile required' USING ERRCODE='23514'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<1 OR current_version<>p_expected_version THEN
   RAISE EXCEPTION 'Visibility version conflict' USING ERRCODE='40001';
  END IF;
  SELECT g.published INTO was_published FROM %1$I.salon_public_visibility g WHERE g.tenant_id=tenant AND g.profile_id=profile FOR UPDATE;
  IF NOT COALESCE(was_published,false) THEN RETURN QUERY SELECT current_version,false; RETURN; END IF;
  UPDATE %1$I.salon_public_visibility g SET published=false WHERE g.tenant_id=tenant AND g.profile_id=profile;
  UPDATE %1$I.salon_public_profiles p SET version=p.version+1,updated_at=now() WHERE p.tenant_id=tenant AND p.id=profile;
  INSERT INTO %1$I.salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version)
   VALUES(tenant,profile,p_actor,'unpublished',current_version+1);
  RETURN QUERY SELECT current_version+1,true;
 END $body$;
 $definition$,current_schema(),current_schema());
END $install$;
REVOKE ALL ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('GRANT EXECUTE ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION unpublish_salon_profile(TEXT,INTEGER) FROM %I',browser_role); END IF;
 END LOOP;
END $roles$;
