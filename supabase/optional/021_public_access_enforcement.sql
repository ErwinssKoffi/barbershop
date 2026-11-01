LOCK TABLE salon_public_service_projection,salon_public_media_projection,salon_media,salon_public_visibility,salon_public_projection IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE salon_public_quota_usage (
 tenant_id UUID NOT NULL REFERENCES tenants(id), resource TEXT NOT NULL CHECK(resource IN ('services','photos','uploads')),
 used BIGINT NOT NULL CHECK(used>=0), PRIMARY KEY(tenant_id,resource)
);
INSERT INTO salon_public_quota_usage SELECT tenant_id,'services',count(*) FROM salon_public_service_projection GROUP BY tenant_id;
INSERT INTO salon_public_quota_usage SELECT tenant_id,'photos',count(*) FROM salon_public_media_projection GROUP BY tenant_id;
INSERT INTO salon_public_quota_usage SELECT tenant_id,'uploads',count(*) FROM salon_media WHERE state NOT IN ('rejected','deleted') GROUP BY tenant_id;
ALTER TABLE salon_public_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_quota_usage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_quota_usage FROM PUBLIC;
DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION subscription_public_cap(p_tenant UUID,p_resource TEXT,p_keep BOOLEAN DEFAULT false)
 RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE caps JSONB; at_time TIMESTAMPTZ:=clock_timestamp();
 BEGIN
  SELECT p.entitlements INTO caps FROM %1$I.tenant_subscriptions s JOIN %1$I.saas_plans p ON p.id=s.plan_id
   JOIN %1$I.tenants t ON t.id=s.tenant_id
   WHERE s.tenant_id=p_tenant AND t.status='active' AND s.revoked_at IS NULL AND s.starts_at<=at_time
    AND CASE WHEN p_keep THEN s.grace_ends_at>at_time ELSE s.ends_at>at_time END
   ORDER BY s.ends_at DESC LIMIT 1;
  IF caps IS NULL OR (caps->>'publicProfile')::boolean IS NOT TRUE THEN RETURN 0; END IF;
  IF p_resource='profile' THEN RETURN 1;
  ELSIF p_resource='services' AND (caps->>'serviceListing')::boolean IS TRUE THEN RETURN (caps->>'publicServices')::integer;
  ELSIF p_resource IN ('photos','uploads') THEN RETURN (caps->>'galleryImages')::integer;
  END IF;
  RETURN 0;
 END $body$;
 CREATE FUNCTION subscription_public_visible(p_tenant UUID)
 RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 BEGIN
  RETURN %1$I.subscription_public_cap(p_tenant,'profile',true)>0
   AND NOT EXISTS(SELECT 1 FROM %1$I.salon_public_quota_usage q WHERE q.tenant_id=p_tenant AND q.resource IN ('services','photos') AND q.used>%1$I.subscription_public_cap(p_tenant,q.resource,true));
 END $body$;
 CREATE FUNCTION enforce_public_subscription_write()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; resource_name TEXT; delta INTEGER:=0; old_counted BOOLEAN:=false; new_counted BOOLEAN:=false; cap INTEGER; usage BIGINT; safety_close BOOLEAN:=false;
 BEGIN
  IF TG_OP='DELETE' THEN tenant:=OLD.tenant_id; ELSE tenant:=NEW.tenant_id; END IF;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Quota tenant immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP<>'DELETE' THEN
   PERFORM 1 FROM %1$I.tenants t WHERE t.id=tenant FOR UPDATE;
   PERFORM 1 FROM %1$I.tenant_subscriptions s WHERE s.tenant_id=tenant FOR SHARE;
  END IF;
  IF TG_TABLE_NAME='salon_public_visibility' THEN
   IF NEW.published THEN
    IF %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM %1$I.salon_public_quota_usage q WHERE q.tenant_id=tenant AND q.resource IN ('services','photos') AND q.used>%1$I.subscription_public_cap(tenant,q.resource,false)) THEN RAISE EXCEPTION 'Public quota exceeded' USING ERRCODE='23514'; END IF;
   END IF;
   RETURN NEW;
  ELSIF TG_TABLE_NAME='salon_public_projection' THEN
   IF TG_OP<>'DELETE' AND %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='salon_public_service_projection' THEN resource_name:='services';
  ELSIF TG_TABLE_NAME='salon_public_media_projection' THEN resource_name:='photos';
  ELSE resource_name:='uploads'; END IF;
  IF TG_OP<>'INSERT' THEN
   IF resource_name='uploads' THEN old_counted:=OLD.state NOT IN ('rejected','deleted'); ELSE old_counted:=true; END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
   IF resource_name='uploads' THEN new_counted:=NEW.state NOT IN ('rejected','deleted'); ELSE new_counted:=true; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
   IF resource_name='services' THEN safety_close:=NOT NEW.source_available AND (to_jsonb(OLD)-'source_available')=(to_jsonb(NEW)-'source_available');
   ELSIF resource_name='photos' THEN safety_close:=NOT NEW.renderable AND (to_jsonb(OLD)-'renderable')=(to_jsonb(NEW)-'renderable');
   END IF;
  END IF;
  delta:=new_counted::integer-old_counted::integer;
  IF new_counted AND NOT safety_close THEN
   cap:=%1$I.subscription_public_cap(tenant,resource_name,false);
   IF cap=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
  END IF;
  -- Atomic row update, not count-then-insert. Concurrent RR/serializable writers
  -- conflict on this row; READ COMMITTED writers recheck the latest used value.
  INSERT INTO %1$I.salon_public_quota_usage(tenant_id,resource,used) VALUES(tenant,resource_name,0) ON CONFLICT DO NOTHING;
  UPDATE %1$I.salon_public_quota_usage q SET used=q.used+delta
   WHERE q.tenant_id=tenant AND q.resource=resource_name
    AND q.used+delta>=0 AND (delta<=0 OR q.used+delta<=cap)
   RETURNING q.used INTO usage;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public quota exceeded' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END $body$;
 $definition$,current_schema());
END $install$;
CREATE TRIGGER subscription_gate_write BEFORE INSERT OR UPDATE ON salon_public_visibility FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_profile_write BEFORE INSERT OR UPDATE ON salon_public_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_services_write AFTER INSERT OR UPDATE OR DELETE ON salon_public_service_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_photos_write AFTER INSERT OR UPDATE OR DELETE ON salon_public_media_projection FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
CREATE TRIGGER subscription_uploads_write AFTER INSERT OR UPDATE OR DELETE ON salon_media FOR EACH ROW EXECUTE FUNCTION enforce_public_subscription_write();
REVOKE ALL ON FUNCTION subscription_public_cap(UUID,TEXT,BOOLEAN),subscription_public_visible(UUID),enforce_public_subscription_write() FROM PUBLIC;
DO $roles$
DECLARE reader_role TEXT:='salon_pro_public_' || substr(md5(current_schema()),1,12); runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('REVOKE ALL ON salon_public_quota_usage FROM %I,%I',reader_role,runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION subscription_public_visible(UUID) TO %I,%I',reader_role,runtime_role);
 EXECUTE format('CREATE POLICY subscription_visibility ON salon_public_visibility AS RESTRICTIVE FOR SELECT TO %I USING(%I.subscription_public_visible(tenant_id))',reader_role,current_schema());
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON salon_public_quota_usage FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION subscription_public_cap(UUID,TEXT,BOOLEAN),subscription_public_visible(UUID),enforce_public_subscription_write() FROM %I',browser_role);
  END IF;
 END LOOP;
END $roles$;
