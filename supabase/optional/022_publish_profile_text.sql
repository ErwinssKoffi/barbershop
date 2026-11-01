CREATE TABLE salon_public_details (
 tenant_id UUID NOT NULL,profile_id UUID NOT NULL,details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),
 PRIMARY KEY(tenant_id,profile_id), FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id)
);
CREATE TABLE salon_publication_receipts (
 tenant_id UUID NOT NULL,activation_key UUID NOT NULL,actor_id TEXT NOT NULL,request_version INTEGER NOT NULL,
 slug TEXT NOT NULL,result_version INTEGER NOT NULL,revision INTEGER NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,activation_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER publication_receipt_immutable BEFORE UPDATE OR DELETE ON salon_publication_receipts FOR EACH ROW EXECUTE FUNCTION protect_public_profile_event();
ALTER TABLE salon_public_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_details FORCE ROW LEVEL SECURITY;
ALTER TABLE salon_publication_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_publication_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_details,salon_publication_receipts FROM PUBLIC;
DO $install$
BEGIN
 EXECUTE format($definition$
 CREATE FUNCTION publish_salon_profile_text(p_actor TEXT,p_key UUID,p_version INTEGER,p_slug TEXT,p_confirm BOOLEAN)
 RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE tenant UUID; p RECORD; prior RECORD; source RECORD; variant JSONB; price NUMERIC; duration NUMERIC;
 label TEXT; description TEXT; count_selected INTEGER; next_revision INTEGER; ends_grace TIMESTAMPTZ; zone TEXT;
 BEGIN
  tenant:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
  IF p_confirm IS DISTINCT FROM true OR p_key IS NULL OR p_version IS NULL OR p_version<1 OR p_version>=2147483647
   OR p_slug IS NULL OR length(p_slug) NOT BETWEEN 3 AND 100 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Explicit text publication intent required' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(%2$L || ':visibility:' || tenant::text));
  PERFORM 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id
   WHERE m.tenant_id=tenant AND m.user_id=p_actor AND m.role='manager' AND m.is_active AND u.is_active FOR SHARE OF m,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active manager required' USING ERRCODE='42501'; END IF;
  SELECT t.timezone INTO zone FROM %1$I.tenants t WHERE t.id=tenant AND t.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active tenant required' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM %1$I.salon_publication_receipts r WHERE r.tenant_id=tenant AND r.activation_key=p_key;
  IF FOUND THEN
   IF prior.actor_id<>p_actor OR prior.request_version<>p_version OR prior.slug<>p_slug THEN RAISE EXCEPTION 'Publication key conflict' USING ERRCODE='40001'; END IF;
   RETURN jsonb_build_object('outcome','replayed','version',prior.result_version,'revision',prior.revision,'slug',prior.slug);
  END IF;
  PERFORM 1 FROM %1$I.tenant_subscriptions s WHERE s.tenant_id=tenant FOR SHARE;
  SELECT s.grace_ends_at INTO ends_grace FROM %1$I.tenant_subscriptions s JOIN %1$I.saas_plans plan ON plan.id=s.plan_id
   WHERE s.tenant_id=tenant AND s.revoked_at IS NULL AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp()
   AND (plan.entitlements->>'publicProfile')::boolean ORDER BY s.ends_at DESC LIMIT 1;
  IF ends_grace IS NULL OR %1$I.subscription_public_cap(tenant,'profile',false)=0 THEN RAISE EXCEPTION 'Active subscription required' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM %1$I.salon_public_profiles x WHERE x.tenant_id=tenant FOR UPDATE;
  IF NOT FOUND OR p.version<>p_version THEN RAISE EXCEPTION 'Visibility version conflict' USING ERRCODE='40001'; END IF;
  IF length(btrim(p.display_name))=0 OR length(btrim(p.city))=0 THEN RAISE EXCEPTION 'Public name and city required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM %1$I.salon_public_media_projection m WHERE m.tenant_id=tenant) THEN RAISE EXCEPTION 'Existing public media require dedicated publication review' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM %1$I.salon_opening_hours h WHERE h.tenant_id=tenant AND h.profile_id=p.id)<>7 THEN RAISE EXCEPTION 'Seven saved schedule days required' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO count_selected FROM %1$I.salon_service_selections x WHERE x.tenant_id=tenant AND x.profile_id=p.id;
  IF count_selected<1 OR count_selected>%1$I.subscription_public_cap(tenant,'services',false) THEN RAISE EXCEPTION 'Selected service quota or empty selection' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(x.revision),0)+1 INTO next_revision FROM %1$I.salon_public_projection x WHERE x.tenant_id=tenant;
  INSERT INTO %1$I.salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until)
   VALUES(tenant,p.id,false,clock_timestamp(),ends_grace)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET published=false,allowed_from=clock_timestamp(),allowed_until=ends_grace;
  INSERT INTO %1$I.salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,public_phone,revision)
   VALUES(tenant,p.id,p_slug,p.display_name,p.description,p.city,p.commune,p.public_phone,next_revision)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET slug=EXCLUDED.slug,display_name=EXCLUDED.display_name,description=EXCLUDED.description,city=EXCLUDED.city,commune=EXCLUDED.commune,public_phone=EXCLUDED.public_phone,revision=EXCLUDED.revision,published_at=clock_timestamp();
  INSERT INTO %1$I.salon_public_details(tenant_id,profile_id,details)
   SELECT tenant,p.id,jsonb_build_object('slogan',d.slogan,'category',d.category,'publicAddress',d.public_address,'whatsapp',d.whatsapp,'publicEmail',d.public_email,'website',d.website,'facebook',d.facebook,'instagram',d.instagram,'tiktok',d.tiktok)
   FROM %1$I.salon_profile_details d WHERE d.tenant_id=tenant AND d.profile_id=p.id
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET details=EXCLUDED.details;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved profile details required' USING ERRCODE='23514'; END IF;
  DELETE FROM %1$I.salon_public_service_projection x WHERE x.tenant_id=tenant;
  FOR source IN SELECT s.id,s.source_variant_id,c.id AS source_id,c.name,c.reference_price,c.updated_at,c.is_active,c.payload_json AS body
   FROM %1$I.salon_service_selections x JOIN %1$I.salon_public_services s ON s.tenant_id=x.tenant_id AND s.profile_id=x.profile_id AND s.id=x.service_id
   JOIN %1$I.services_catalog c ON c.tenant_id=s.tenant_id AND c.id=s.source_service_id
   WHERE x.tenant_id=tenant AND x.profile_id=p.id ORDER BY c.id,s.id FOR SHARE OF s,c
  LOOP
   IF NOT source.is_active OR (source.body->>'isActive') IS DISTINCT FROM 'true' OR jsonb_typeof(COALESCE(source.body->'variants','[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='23514'; END IF;
   variant:=NULL;
   IF source.source_variant_id IS NOT NULL THEN
    IF (SELECT count(*) FROM jsonb_array_elements(source.body->'variants') v WHERE v->>'id'=source.source_variant_id)<>1 THEN RAISE EXCEPTION 'Source variant unavailable' USING ERRCODE='23514'; END IF;
    SELECT v INTO variant FROM jsonb_array_elements(source.body->'variants') v WHERE v->>'id'=source.source_variant_id;
    IF jsonb_typeof(variant->'price') IS DISTINCT FROM 'number' OR jsonb_typeof(variant->'label') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid variant' USING ERRCODE='23514'; END IF;
   END IF;
   price:=CASE WHEN variant IS NULL THEN source.reference_price ELSE (variant->>'price')::numeric END;
   duration:=COALESCE(NULLIF(variant->'durationMinutes','null'::jsonb),NULLIF(source.body->'durationMinutes','null'::jsonb))::text::numeric;
   IF price IS NULL OR price<0 OR price>9007199254740991 OR price<>trunc(price) OR (duration IS NOT NULL AND (duration<5 OR duration>480 OR duration<>trunc(duration))) THEN RAISE EXCEPTION 'Invalid price or duration' USING ERRCODE='23514'; END IF;
   label:=btrim(source.name) || CASE WHEN variant IS NULL THEN '' ELSE ' — ' || btrim(variant->>'label') END;
   IF jsonb_typeof(source.body->'description') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid service description' USING ERRCODE='23514'; END IF;
   description:=source.body->>'description';
   IF length(label)=0 OR length(label)>160 OR description IS NULL OR length(description)>4000 THEN RAISE EXCEPTION 'Invalid service text' USING ERRCODE='23514'; END IF;
   INSERT INTO %1$I.salon_public_service_projection(tenant_id,id,profile_id,source_service_id,source_variant_id,source_updated_at,source_available,display_name,description,price_xof,duration_minutes,booking_requested,revision)
    VALUES(tenant,source.id,p.id,source.source_id,source.source_variant_id,source.updated_at,true,label,description,price::bigint,duration::smallint,false,next_revision);
  END LOOP;
  IF (SELECT count(*) FROM %1$I.salon_public_service_projection x WHERE x.tenant_id=tenant)<>count_selected THEN RAISE EXCEPTION 'Selected source missing' USING ERRCODE='23514'; END IF;
  DELETE FROM %1$I.salon_public_opening_hours h WHERE h.tenant_id=tenant;
  DELETE FROM %1$I.salon_public_schedule_exceptions e WHERE e.tenant_id=tenant;
  INSERT INTO %1$I.salon_public_schedules(tenant_id,profile_id,timezone,revision) VALUES(tenant,p.id,zone,next_revision)
   ON CONFLICT(tenant_id,profile_id) DO UPDATE SET timezone=EXCLUDED.timezone,revision=EXCLUDED.revision,published_at=clock_timestamp();
  INSERT INTO %1$I.salon_public_opening_hours(tenant_id,profile_id,schedule_revision,iso_weekday,windows)
   SELECT tenant,p.id,next_revision,h.iso_weekday,h.windows FROM %1$I.salon_opening_hours h WHERE h.tenant_id=tenant AND h.profile_id=p.id;
  INSERT INTO %1$I.salon_public_schedule_exceptions(tenant_id,profile_id,schedule_revision,local_date,windows)
   SELECT tenant,p.id,next_revision,e.local_date,e.windows FROM %1$I.schedule_exceptions e WHERE e.tenant_id=tenant AND e.profile_id=p.id;
  -- Never carry legacy booking rules into an ESSENTIEL text-only publication.
  DELETE FROM %1$I.salon_public_booking_rules r WHERE r.tenant_id=tenant;
  UPDATE %1$I.salon_public_profiles x SET version=x.version+1,updated_at=clock_timestamp() WHERE x.tenant_id=tenant AND x.id=p.id;
  INSERT INTO %1$I.salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES(tenant,p.id,p_actor,'published',p.version+1);
  INSERT INTO %1$I.salon_publication_receipts(tenant_id,activation_key,actor_id,request_version,slug,result_version,revision) VALUES(tenant,p_key,p_actor,p_version,p_slug,p.version+1,next_revision);
  UPDATE %1$I.salon_public_visibility g SET published=true WHERE g.tenant_id=tenant AND g.profile_id=p.id;
  RETURN jsonb_build_object('outcome','published','version',p.version+1,'revision',next_revision,'slug',p_slug);
 END $body$;
 $definition$,current_schema(),current_schema());
END $install$;
REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); reader_role TEXT:='salon_pro_public_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 EXECUTE format('REVOKE ALL ON salon_public_details,salon_publication_receipts FROM %I,%I',runtime_role,reader_role);
 EXECUTE format('REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM %I',reader_role);
 EXECUTE format('GRANT SELECT ON salon_public_details TO %I,%I',runtime_role,reader_role);
 EXECUTE format('CREATE POLICY details_tenant_read ON salon_public_details FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 EXECUTE format('CREATE POLICY details_public_read ON salon_public_details FOR SELECT TO %I USING(EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_details.tenant_id AND p.profile_id=salon_public_details.profile_id))',reader_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) TO %I',runtime_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON salon_public_details,salon_publication_receipts FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN) FROM %I',browser_role);
  END IF;
 END LOOP;
END $roles$;
