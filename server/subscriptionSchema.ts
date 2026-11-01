/** 019: explicit verified grants, no seeds, no payment or operator endpoint. */
export const SUBSCRIPTION_SQL = `
CREATE FUNCTION valid_plan_entitlements(value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $validate$
DECLARE k TEXT; n NUMERIC;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>12 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['establishments','users','managers','cashiers','employees','galleryImages','publicServices'] LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(value->>k)::numeric; IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['publicProfile','serviceListing','contactRequests','appointmentRequests','onlineBooking'] LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $validate$;
CREATE TABLE saas_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL CHECK(code ~ '^[a-z][a-z0-9-]{1,59}$'),
 version INTEGER NOT NULL CHECK(version>0), name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 price_xof BIGINT NOT NULL CHECK(price_xof BETWEEN 0 AND 9007199254740991),
 currency TEXT NOT NULL CHECK(currency='XOF'), period_kind TEXT NOT NULL CHECK(period_kind='calendar_month'),
 grace_seconds INTEGER NOT NULL CHECK(grace_seconds BETWEEN 0 AND 2678400),
 entitlements JSONB NOT NULL CHECK(valid_plan_entitlements(entitlements)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(code,version)
);
CREATE TABLE tenant_subscriptions (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES saas_plans(id),
 activation_key UUID NOT NULL, billing_anchor_at TIMESTAMPTZ NOT NULL CHECK(isfinite(billing_anchor_at)),
 period_index INTEGER NOT NULL CHECK(period_index BETWEEN 0 AND 1199), billing_timezone TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL CHECK(isfinite(starts_at)), ends_at TIMESTAMPTZ NOT NULL CHECK(isfinite(ends_at)),
 grace_ends_at TIMESTAMPTZ NOT NULL CHECK(isfinite(grace_ends_at)),
 amount_xof BIGINT NOT NULL CHECK(amount_xof BETWEEN 0 AND 9007199254740991),
 external_reference TEXT NOT NULL CHECK(length(btrim(external_reference)) BETWEEN 1 AND 200),
 evidence_reference TEXT NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 500),
 operator_reference TEXT NOT NULL CHECK(length(btrim(operator_reference)) BETWEEN 1 AND 200),
 revoked_at TIMESTAMPTZ, revoked_by TEXT, revocation_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,activation_key), UNIQUE(tenant_id,external_reference),
 CHECK(ends_at>starts_at AND grace_ends_at>=ends_at),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
       (revoked_at IS NOT NULL AND isfinite(revoked_at) AND length(btrim(revoked_by)) BETWEEN 1 AND 200 AND revoked_by IS NOT NULL AND length(btrim(revocation_reason)) BETWEEN 1 AND 500 AND revocation_reason IS NOT NULL))
);
CREATE INDEX tenant_subscriptions_period ON tenant_subscriptions(tenant_id,starts_at,ends_at,grace_ends_at);
CREATE TABLE subscription_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), subscription_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('activated','revoked')), operator_reference TEXT NOT NULL,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,subscription_id) REFERENCES tenant_subscriptions(tenant_id,id)
);
CREATE FUNCTION validate_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $subscription$
DECLARE price BIGINT; grace INTEGER; has_overlap BOOLEAN; zone TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.id,NEW.plan_id,NEW.activation_key,NEW.billing_anchor_at,NEW.period_index,NEW.billing_timezone,NEW.starts_at,NEW.ends_at,NEW.grace_ends_at,NEW.amount_xof,NEW.external_reference,NEW.evidence_reference,NEW.operator_reference,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.plan_id,OLD.activation_key,OLD.billing_anchor_at,OLD.period_index,OLD.billing_timezone,OLD.starts_at,OLD.ends_at,OLD.grace_ends_at,OLD.amount_xof,OLD.external_reference,OLD.evidence_reference,OLD.operator_reference,OLD.created_at)
   OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'Subscription immutable except one-way revocation' USING ERRCODE='23514'; END IF;
  NEW.revoked_at:=now(); RETURN NEW;
 END IF;
 IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revocation_reason IS NOT NULL THEN RAISE EXCEPTION 'New grant cannot start revoked' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT price_xof,grace_seconds FROM %I.saas_plans WHERE id=$1',TG_TABLE_SCHEMA) INTO price,grace USING NEW.plan_id;
 IF price IS NULL OR NEW.amount_xof<>price OR NEW.grace_ends_at<>NEW.ends_at+grace*interval '1 second' THEN
  RAISE EXCEPTION 'Grant must match immutable plan price and grace' USING ERRCODE='23514';
 END IF;
 -- Serialize grants by the actual tenant, not a process-local lock.
 EXECUTE format('SELECT timezone FROM %I.tenants WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO zone USING NEW.tenant_id;
 IF zone IS NULL OR NEW.billing_timezone<>zone OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'Valid tenant billing timezone required' USING ERRCODE='23514'; END IF;
 IF NEW.starts_at<>((NEW.billing_anchor_at AT TIME ZONE zone)+make_interval(months=>NEW.period_index)) AT TIME ZONE zone OR NEW.ends_at<>((NEW.billing_anchor_at AT TIME ZONE zone)+make_interval(months=>NEW.period_index+1)) AT TIME ZONE zone THEN RAISE EXCEPTION 'Calendar anchor period mismatch' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.tenant_subscriptions WHERE tenant_id=$1 AND revoked_at IS NULL AND starts_at<$3 AND ends_at>$2)',TG_TABLE_SCHEMA)
  INTO has_overlap USING NEW.tenant_id,NEW.starts_at,NEW.ends_at;
 IF has_overlap THEN RAISE EXCEPTION 'Overlapping paid subscription periods' USING ERRCODE='23514'; END IF;
 NEW.created_at:=now(); RETURN NEW;
END $subscription$;
CREATE TRIGGER subscription_validate BEFORE INSERT OR UPDATE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION validate_subscription();
CREATE FUNCTION record_subscription_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
BEGIN
 EXECUTE format('INSERT INTO %I.subscription_events(tenant_id,subscription_id,event_type,operator_reference,actor_db_role) VALUES($1,$2,$3,$4,$5)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'activated' ELSE 'revoked' END,CASE WHEN TG_OP='INSERT' THEN NEW.operator_reference ELSE NEW.revoked_by END,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER subscription_audit AFTER INSERT OR UPDATE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION record_subscription_event();
CREATE FUNCTION protect_subscription_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Subscription history immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER plan_immutable BEFORE UPDATE OR DELETE ON saas_plans FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
CREATE TRIGGER subscription_no_delete BEFORE DELETE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
CREATE TRIGGER subscription_event_immutable BEFORE UPDATE OR DELETE ON subscription_events FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
${['saas_plans','tenant_subscriptions','subscription_events'].map(table=>`
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${table} FROM PUBLIC;`).join('\n')}
REVOKE ALL ON FUNCTION valid_plan_entitlements(JSONB),validate_subscription(),record_subscription_event(),protect_subscription_history() FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); table_name TEXT; browser_role TEXT;
BEGIN
 EXECUTE format('GRANT SELECT ON saas_plans TO %I',runtime_role);
 EXECUTE format('CREATE POLICY plan_catalog_read ON saas_plans FOR SELECT TO %I USING(true)',runtime_role);
 EXECUTE format('GRANT SELECT(tenant_id,id,plan_id,starts_at,ends_at,grace_ends_at,revoked_at) ON tenant_subscriptions TO %I',runtime_role);
 EXECUTE format('CREATE POLICY subscription_tenant_read ON tenant_subscriptions FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',runtime_role);
 FOREACH table_name IN ARRAY ARRAY['saas_plans','tenant_subscriptions','subscription_events'] LOOP
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION valid_plan_entitlements(JSONB),validate_subscription(),record_subscription_event(),protect_subscription_history() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
END $roles$;
`
