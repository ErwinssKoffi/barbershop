CREATE TABLE salon_media (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('logo','cover','gallery')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','ready','rejected','deleted')),
 original_key TEXT NOT NULL CHECK(original_key=tenant_id::text || '/' || id::text || '/original'),
 declared_mime TEXT NOT NULL CHECK(declared_mime IN ('image/jpeg','image/png','image/webp')),
 declared_bytes BIGINT NOT NULL CHECK(declared_bytes BETWEEN 1 AND 9007199254740991),
 upload_expires_at TIMESTAMPTZ NOT NULL,
 actual_mime TEXT CHECK(actual_mime IN ('image/jpeg','image/png','image/webp')),
 actual_bytes BIGINT CHECK(actual_bytes BETWEEN 1 AND 9007199254740991),
 width INTEGER CHECK(width>0), height INTEGER CHECK(height>0),
 sha256 TEXT CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text)<=300),
 credit_text TEXT NOT NULL DEFAULT '' CHECK(length(credit_text)<=300),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_profiles(tenant_id,id),
 CHECK(upload_expires_at>created_at),
 CHECK(state<>'ready' OR (actual_mime IS NOT NULL AND actual_bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL AND actual_mime=declared_mime AND actual_bytes=declared_bytes))
);
CREATE INDEX salon_media_state_expiry ON salon_media(tenant_id,state,upload_expires_at);
CREATE TABLE salon_media_variants (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL, media_id UUID NOT NULL,
 object_key TEXT NOT NULL CHECK(object_key=tenant_id::text || '/' || media_id::text || '/variants/' || id::text),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 byte_size BIGINT NOT NULL CHECK(byte_size BETWEEN 1 AND 9007199254740991),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 purged_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,media_id,id),
 FOREIGN KEY(tenant_id,profile_id,media_id) REFERENCES salon_media(tenant_id,profile_id,id)
);
CREATE TABLE salon_public_media_projection (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), profile_id UUID NOT NULL,
 media_id UUID NOT NULL, variant_id UUID NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('logo','cover','gallery')),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 alt_text TEXT NOT NULL CHECK(length(btrim(alt_text)) BETWEEN 1 AND 300),
 credit_text TEXT NOT NULL DEFAULT '' CHECK(length(credit_text)<=300),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 renderable BOOLEAN NOT NULL DEFAULT false,
 revision INTEGER NOT NULL CHECK(revision>0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,profile_id,sort_order),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES salon_public_projection(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,profile_id,media_id,variant_id) REFERENCES salon_media_variants(tenant_id,profile_id,media_id,id)
);
CREATE UNIQUE INDEX salon_public_media_single_role ON salon_public_media_projection(tenant_id,profile_id,purpose) WHERE purpose IN ('logo','cover');

CREATE TABLE salon_media_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), media_id UUID NOT NULL,
 from_state TEXT CHECK(from_state IN ('pending','processing','ready','rejected','deleted')),
 to_state TEXT NOT NULL CHECK(to_state IN ('pending','processing','ready','rejected','deleted')),
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,media_id) REFERENCES salon_media(tenant_id,id)
);
CREATE INDEX salon_media_events_media ON salon_media_events(tenant_id,media_id,at);
CREATE FUNCTION record_media_lifecycle_event() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE previous_state TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  previous_state:=OLD.state;
 END IF;
 EXECUTE format('INSERT INTO %I.salon_media_events(tenant_id,media_id,from_state,to_state,actor_db_role) VALUES($1,$2,$3,$4,$5)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,previous_state,NEW.state,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER media_state_audit AFTER INSERT OR UPDATE OF state ON salon_media FOR EACH ROW EXECUTE FUNCTION record_media_lifecycle_event();
CREATE FUNCTION protect_media_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN
 RAISE EXCEPTION 'Media lifecycle events are immutable' USING ERRCODE='23514';
END $immutable$;
CREATE TRIGGER media_event_immutable BEFORE UPDATE OR DELETE ON salon_media_events FOR EACH ROW EXECUTE FUNCTION protect_media_event();

CREATE FUNCTION validate_media_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $lifecycle$
DECLARE has_variant BOOLEAN;
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.profile_id<>OLD.profile_id OR NEW.original_key<>OLD.original_key
  OR NEW.declared_mime<>OLD.declared_mime OR NEW.declared_bytes<>OLD.declared_bytes OR NEW.upload_expires_at<>OLD.upload_expires_at THEN
  RAISE EXCEPTION 'Media identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state<>OLD.state AND NOT (
  (OLD.state='pending' AND NEW.state IN ('processing','rejected','deleted')) OR
  (OLD.state='processing' AND NEW.state IN ('ready','rejected','deleted')) OR
  (OLD.state IN ('ready','rejected') AND NEW.state='deleted')) THEN
  RAISE EXCEPTION 'Invalid media state transition' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('ready','rejected','deleted') AND
  ROW(NEW.actual_mime,NEW.actual_bytes,NEW.width,NEW.height,NEW.sha256) IS DISTINCT FROM
  ROW(OLD.actual_mime,OLD.actual_bytes,OLD.width,OLD.height,OLD.sha256) THEN
  RAISE EXCEPTION 'Verified media metadata is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state='ready' AND OLD.state<>'ready' THEN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.salon_media_variants WHERE tenant_id=$1 AND media_id=$2 AND purged_at IS NULL)',TG_TABLE_SCHEMA) INTO has_variant USING NEW.tenant_id,NEW.id;
  IF NOT has_variant THEN
   RAISE EXCEPTION 'Ready media requires an optimized variant' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $lifecycle$;
CREATE TRIGGER media_lifecycle BEFORE UPDATE ON salon_media FOR EACH ROW EXECUTE FUNCTION validate_media_lifecycle();
CREATE FUNCTION validate_media_variant_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $variant$
DECLARE state TEXT;
BEGIN
 EXECUTE format('SELECT state FROM %I.salon_media WHERE tenant_id=$1 AND id=$2 AND profile_id=$3',TG_TABLE_SCHEMA)
 INTO state USING NEW.tenant_id,NEW.media_id,NEW.profile_id;
 IF state IS DISTINCT FROM 'processing' OR NEW.purged_at IS NOT NULL THEN
  RAISE EXCEPTION 'Variants require processing media' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $variant$;
CREATE TRIGGER media_variant_insert BEFORE INSERT ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION validate_media_variant_insert();
CREATE FUNCTION protect_media_variant() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $protect$
DECLARE state TEXT;
BEGIN
 IF ROW(NEW.tenant_id,NEW.id,NEW.profile_id,NEW.media_id,NEW.object_key,NEW.mime,NEW.byte_size,NEW.width,NEW.height,NEW.sha256)
  IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.profile_id,OLD.media_id,OLD.object_key,OLD.mime,OLD.byte_size,OLD.width,OLD.height,OLD.sha256) THEN
  RAISE EXCEPTION 'Variant metadata is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
  RAISE EXCEPTION 'Purged variant cannot be restored' USING ERRCODE='23514';
 END IF;
 IF NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL THEN
  EXECUTE format('SELECT state FROM %I.salon_media WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA) INTO state USING NEW.tenant_id,NEW.media_id;
  IF state IS NULL OR state NOT IN ('rejected','deleted') THEN RAISE EXCEPTION 'Close media before purging variant' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $protect$;
CREATE TRIGGER media_variant_protected BEFORE UPDATE ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION protect_media_variant();
CREATE FUNCTION derive_public_media_renderable() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $renderable$
DECLARE ready BOOLEAN; w INTEGER; h INTEGER; content_type TEXT;
BEGIN
 EXECUTE format('SELECT m.state=''ready'' AND v.purged_at IS NULL,v.width,v.height,v.mime FROM %I.salon_media m JOIN %I.salon_media_variants v ON v.tenant_id=m.tenant_id AND v.media_id=m.id AND v.profile_id=m.profile_id WHERE m.tenant_id=$1 AND m.profile_id=$2 AND m.id=$3 AND v.id=$4',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA)
 INTO ready,w,h,content_type USING NEW.tenant_id,NEW.profile_id,NEW.media_id,NEW.variant_id;
 IF TG_OP='INSERT' AND NOT COALESCE(ready,false) THEN RAISE EXCEPTION 'Only ready optimized media can be published' USING ERRCODE='23514'; END IF;
 IF ready THEN NEW.width:=w; NEW.height:=h; NEW.mime:=content_type; END IF;
 NEW.renderable := NEW.renderable AND COALESCE(ready,false);
 RETURN NEW;
END $renderable$;
CREATE TRIGGER public_media_renderable BEFORE INSERT OR UPDATE ON salon_public_media_projection FOR EACH ROW EXECUTE FUNCTION derive_public_media_renderable();
CREATE FUNCTION close_public_media() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog AS $close$
BEGIN
 IF TG_TABLE_NAME='salon_media' THEN
  IF NEW.state<>'ready' THEN
   EXECUTE format('UPDATE %I.salon_public_media_projection SET renderable=false WHERE tenant_id=$1 AND media_id=$2',TG_TABLE_SCHEMA) USING NEW.tenant_id,NEW.id;
  END IF;
 ELSE
  IF NEW.purged_at IS NOT NULL THEN
   EXECUTE format('UPDATE %I.salon_public_media_projection SET renderable=false WHERE tenant_id=$1 AND variant_id=$2',TG_TABLE_SCHEMA) USING NEW.tenant_id,NEW.id;
  END IF;
 END IF;
 RETURN NEW;
END $close$;
CREATE TRIGGER media_closed AFTER UPDATE OF state ON salon_media FOR EACH ROW EXECUTE FUNCTION close_public_media();
CREATE TRIGGER variant_purged AFTER UPDATE OF purged_at ON salon_media_variants FOR EACH ROW EXECUTE FUNCTION close_public_media();
REVOKE ALL ON FUNCTION validate_media_lifecycle(),validate_media_variant_insert(),protect_media_variant(),derive_public_media_renderable(),close_public_media(),record_media_lifecycle_event(),protect_media_event() FROM PUBLIC;

ALTER TABLE salon_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media FROM PUBLIC;

ALTER TABLE salon_media_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media_variants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media_variants FROM PUBLIC;

ALTER TABLE salon_public_media_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_public_media_projection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_public_media_projection FROM PUBLIC;

ALTER TABLE salon_media_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_media_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON salon_media_events FROM PUBLIC;
DO $media_roles$
DECLARE
 runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 reader_role TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12);
 worker_role TEXT := 'salon_pro_media_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=worker_role) THEN RAISE EXCEPTION 'Media worker role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',worker_role);
 EXECUTE format('GRANT %I TO %I',worker_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),worker_role);
 FOREACH table_name IN ARRAY ARRAY['salon_media','salon_media_variants','salon_public_media_projection','salon_media_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY media_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_media_lifecycle(),validate_media_variant_insert(),protect_media_variant(),derive_public_media_renderable(),close_public_media(),record_media_lifecycle_event(),protect_media_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('GRANT INSERT ON salon_media TO %I',runtime_role);
 EXECUTE format('CREATE POLICY media_pending_insert ON salon_media FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid AND state=''pending'' AND actual_mime IS NULL AND actual_bytes IS NULL AND width IS NULL AND height IS NULL AND sha256 IS NULL)',runtime_role);
 EXECUTE format('GRANT UPDATE(alt_text,credit_text,version,updated_at) ON salon_media TO %I',runtime_role);
 EXECUTE format('CREATE POLICY media_draft_edit ON salon_media FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH table_name IN ARRAY ARRAY['salon_media','salon_media_variants'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,worker_role);
  EXECUTE format('CREATE POLICY worker_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,worker_role);
  EXECUTE format('CREATE POLICY worker_tenant_update ON %I FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,worker_role);
 END LOOP;
 EXECUTE format('GRANT UPDATE(state,actual_mime,actual_bytes,width,height,sha256,version,updated_at) ON salon_media TO %I',worker_role);
 EXECUTE format('GRANT INSERT ON salon_media_variants TO %I',worker_role);
 EXECUTE format('CREATE POLICY worker_variant_insert ON salon_media_variants FOR INSERT TO %I WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
 EXECUTE format('GRANT UPDATE(purged_at) ON salon_media_variants TO %I',worker_role);
 EXECUTE format('GRANT SELECT ON salon_media_events TO %I',worker_role);
 EXECUTE format('CREATE POLICY worker_event_read ON salon_media_events FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
 EXECUTE format('GRANT SELECT ON salon_public_media_projection TO %I',reader_role);
 EXECUTE format('CREATE POLICY visible_media ON salon_public_media_projection FOR SELECT TO %I USING(renderable AND EXISTS(SELECT 1 FROM salon_public_projection p WHERE p.tenant_id=salon_public_media_projection.tenant_id AND p.profile_id=salon_public_media_projection.profile_id))',reader_role);
END $media_roles$;
