CREATE TABLE notification_outbox (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(),
 deduplication_key UUID NOT NULL, resource_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('booking_confirmation','booking_reminder','booking_cancellation')),
 channel TEXT NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','dead','cancelled')),
 available_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 100),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND max_attempts),
 lease_token UUID, leased_at TIMESTAMPTZ, lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,deduplication_key),
 CHECK(expires_at>available_at),
 CHECK((state='processing' AND lease_token IS NOT NULL AND leased_at IS NOT NULL AND lease_until IS NOT NULL AND lease_until>leased_at AND lease_until<=expires_at)
    OR (state<>'processing' AND lease_token IS NULL AND leased_at IS NULL AND lease_until IS NULL)),
 CHECK(state<>'processing' OR attempts>0)
);
CREATE INDEX notification_outbox_due ON notification_outbox(tenant_id,available_at,id) WHERE state='pending';
CREATE INDEX notification_outbox_leases ON notification_outbox(tenant_id,lease_until,id) WHERE state='processing';
CREATE TABLE notification_outbox_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), notification_id UUID NOT NULL,
 from_state TEXT, to_state TEXT NOT NULL, attempt INTEGER NOT NULL,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,notification_id) REFERENCES notification_outbox(tenant_id,id)
);
CREATE INDEX notification_events_parent ON notification_outbox_events(tenant_id,notification_id,at);
CREATE FUNCTION protect_notification_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $transition$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.attempts<>0 THEN RAISE EXCEPTION 'Outbox must start pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.tenant_id,NEW.id,NEW.deduplication_key,NEW.resource_id,NEW.event_type,NEW.channel,NEW.expires_at,NEW.max_attempts,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.deduplication_key,OLD.resource_id,OLD.event_type,OLD.channel,OLD.expires_at,OLD.max_attempts,OLD.created_at) THEN
  RAISE EXCEPTION 'Outbox envelope immutable' USING ERRCODE='23514';
 END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('processing','dead','cancelled')) OR
         (OLD.state='processing' AND NEW.state IN ('pending','sent','dead','cancelled'))) THEN
  RAISE EXCEPTION 'Invalid outbox transition' USING ERRCODE='23514';
 END IF;
 IF NEW.state='processing' THEN
  IF NEW.attempts<>OLD.attempts+1 OR NEW.available_at>now() OR NEW.expires_at<=now() OR NEW.leased_at<>now() OR NEW.lease_until<=now() THEN
   RAISE EXCEPTION 'Invalid outbox claim' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.attempts<>OLD.attempts THEN
  RAISE EXCEPTION 'Attempt count immutable outside claim' USING ERRCODE='23514';
 END IF;
 IF NEW.state='pending' AND (NEW.attempts>=NEW.max_attempts OR NEW.available_at>=NEW.expires_at OR NEW.available_at<now()) THEN
  RAISE EXCEPTION 'Invalid retry schedule' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $transition$;
CREATE TRIGGER notification_transition BEFORE INSERT OR UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION protect_notification_transition();
CREATE FUNCTION record_notification_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE previous_state TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN previous_state:=OLD.state; END IF;
 EXECUTE format('INSERT INTO %I.notification_outbox_events(tenant_id,notification_id,from_state,to_state,attempt,actor_db_role) VALUES($1,$2,$3,$4,$5,$6)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,previous_state,NEW.state,NEW.attempts,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER notification_audit AFTER INSERT OR UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION record_notification_event();
CREATE FUNCTION protect_notification_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Outbox events immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER notification_event_immutable BEFORE UPDATE OR DELETE ON notification_outbox_events FOR EACH ROW EXECUTE FUNCTION protect_notification_event();
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON notification_outbox,notification_outbox_events FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_notification_transition(),record_notification_event(),protect_notification_event() FROM PUBLIC;
DO $roles$
DECLARE
 runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12);
 worker_role TEXT:='salon_pro_notify_' || substr(md5(current_schema()),1,12);
 table_name TEXT; browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=worker_role) THEN RAISE EXCEPTION 'Notification role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',worker_role);
 EXECUTE format('GRANT %I TO %I',worker_role,current_user);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),worker_role);
 FOREACH table_name IN ARRAY ARRAY['notification_outbox','notification_outbox_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I,%I',table_name,runtime_role,worker_role);
  EXECUTE format('CREATE POLICY notification_tenant_read ON %I FOR SELECT TO %I,%I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role,worker_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION protect_notification_transition(),record_notification_event(),protect_notification_event() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
 EXECUTE format('GRANT UPDATE(state,available_at,attempts,lease_token,leased_at,lease_until,updated_at) ON notification_outbox TO %I',worker_role);
 EXECUTE format('CREATE POLICY notification_worker_update ON notification_outbox FOR UPDATE TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',worker_role);
END $roles$;
