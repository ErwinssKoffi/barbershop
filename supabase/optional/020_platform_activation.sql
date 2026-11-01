CREATE TABLE platform_activation_receipts (
 activation_key UUID PRIMARY KEY, tenant_id UUID NOT NULL, subscription_id UUID NOT NULL,
 evidence_namespace TEXT NOT NULL, external_reference TEXT NOT NULL,
 command JSONB NOT NULL, verified_by TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(evidence_namespace,external_reference),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES tenant_subscriptions(tenant_id,id)
);
ALTER TABLE platform_activation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_activation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_activation_receipts FROM PUBLIC;
CREATE TRIGGER activation_receipt_immutable BEFORE UPDATE OR DELETE ON platform_activation_receipts FOR EACH ROW EXECUTE FUNCTION protect_subscription_history();
DO $install$
DECLARE operator_role TEXT:='salon_pro_platform_' || substr(md5(current_schema()),1,12); browser_role TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=operator_role) THEN RAISE EXCEPTION 'Platform role already exists; review privileges'; END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',operator_role);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',current_schema(),operator_role);
 -- Deliberately no membership assigned to any existing login or ERP role.
 EXECUTE format($definition$
 CREATE FUNCTION activate_essential_subscription(a JSONB,execute_activation BOOLEAN DEFAULT false) RETURNS JSONB
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE who RECORD; tenant UUID; key UUID; zone TEXT; anchor TIMESTAMPTZ; idx INTEGER;
  starts TIMESTAMPTZ; ends TIMESTAMPTZ; grace TIMESTAMPTZ; target TIMESTAMP; boundary TIMESTAMPTZ; candidates INTEGER; n INTEGER;
  plan UUID; existing_plan RECORD; receipt RECORD;
  caps JSONB:='{"establishments":1,"users":2,"managers":1,"cashiers":1,"employees":5,"galleryImages":3,"publicServices":10,"publicProfile":true,"serviceListing":true,"contactRequests":true,"appointmentRequests":true,"onlineBooking":false}'::jsonb;
 BEGIN
  IF execute_activation IS NULL THEN RAISE EXCEPTION 'Explicit activation mode required' USING ERRCODE='23514'; END IF;
  SELECT * INTO who FROM pg_roles WHERE rolname=session_user;
  IF NOT who.rolcanlogin OR who.rolsuper OR who.rolbypassrls OR who.rolcreaterole OR who.rolcreatedb OR who.rolreplication
   OR NOT pg_has_role(session_user,%2$L,'MEMBER')
   OR pg_has_role(session_user,%3$L,'MEMBER')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=%4$L AND nspowner=who.oid)
   OR EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=who.oid)
   OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname=%4$L AND c.relkind IN ('r','p','v','m','f') AND (has_any_column_privilege(session_user,c.oid,'SELECT') OR has_table_privilege(session_user,c.oid,'INSERT') OR has_table_privilege(session_user,c.oid,'UPDATE') OR has_table_privilege(session_user,c.oid,'DELETE'))) THEN
   RAISE EXCEPTION 'Dedicated restricted platform login required' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(a))<>10
   OR NOT (a ?& ARRAY['activationKey','tenantId','billingAnchorAt','periodIndex','evidenceNamespace','externalReference','evidenceReference','verificationReason','verifiedAmountXof','externalVerificationConfirmed']) THEN
   RAISE EXCEPTION 'Invalid activation fields' USING ERRCODE='23514';
  END IF;
  FOREACH zone IN ARRAY ARRAY['activationKey','tenantId','billingAnchorAt','evidenceNamespace','externalReference','evidenceReference','verificationReason'] LOOP
   IF jsonb_typeof(a->zone) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid activation text' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (a->>'activationKey') !~ '^[a-f0-9-]{36}$' OR (a->>'tenantId') !~ '^[a-f0-9-]{36}$'
   OR (a->>'evidenceNamespace') !~ '^[a-z0-9][a-z0-9_-]{1,39}$'
   OR length(btrim(a->>'externalReference')) NOT BETWEEN 1 AND 120
   OR length(btrim(a->>'evidenceReference')) NOT BETWEEN 1 AND 500
   OR length(btrim(a->>'verificationReason')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(a->'periodIndex') IS DISTINCT FROM 'number'
   OR (a->>'periodIndex')::numeric<>trunc((a->>'periodIndex')::numeric)
   OR (a->>'periodIndex')::numeric NOT BETWEEN 0 AND 1199
   OR a->'verifiedAmountXof' IS DISTINCT FROM '4900'::jsonb
   OR jsonb_typeof(a->'externalVerificationConfirmed') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Invalid verified activation' USING ERRCODE='23514';
  END IF;
  IF execute_activation AND a->'externalVerificationConfirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'External verification attestation required' USING ERRCODE='23514'; END IF;
  tenant:=(a->>'tenantId')::uuid; key:=(a->>'activationKey')::uuid; anchor:=(a->>'billingAnchorAt')::timestamptz; idx:=(a->>'periodIndex')::integer;
  IF NOT isfinite(anchor) THEN RAISE EXCEPTION 'Finite anchor required' USING ERRCODE='23514'; END IF;
  SELECT timezone INTO zone FROM %1$I.tenants WHERE id=tenant AND status='active' FOR UPDATE;
  IF zone IS NULL THEN RAISE EXCEPTION 'Active tenant required' USING ERRCODE='23514'; END IF;
  SELECT * INTO receipt FROM %1$I.platform_activation_receipts WHERE activation_key=key;
  IF FOUND THEN
   IF receipt.command IS DISTINCT FROM a OR receipt.verified_by<>session_user::text THEN RAISE EXCEPTION 'Activation key conflict' USING ERRCODE='23505'; END IF;
   SELECT starts_at,ends_at,grace_ends_at INTO starts,ends,grace FROM %1$I.tenant_subscriptions WHERE tenant_id=tenant AND id=receipt.subscription_id;
   RETURN jsonb_build_object('outcome','replayed','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
  END IF;
  -- Resolve both monthly boundaries uniquely; never silently choose an ambiguous DST time.
  FOR n IN idx..idx+1 LOOP
   target:=(anchor AT TIME ZONE zone)+make_interval(months=>n);
   WITH probes AS (
    SELECT (target AT TIME ZONE 'UTC')+h*interval '1 hour' AS p FROM generate_series(-36,36,6) h
   ), choices AS (
    SELECT DISTINCT (target AT TIME ZONE 'UTC')-((p AT TIME ZONE zone)-(p AT TIME ZONE 'UTC')) AS candidate FROM probes
   ) SELECT count(*),min(candidate) INTO candidates,boundary FROM choices WHERE candidate AT TIME ZONE zone=target;
   IF candidates<>1 THEN RAISE EXCEPTION 'Ambiguous local billing boundary; operator review required' USING ERRCODE='23514'; END IF;
   IF n=idx THEN starts:=boundary; ELSE ends:=boundary; END IF;
  END LOOP;
  grace:=ends+interval '72 hours';
  SELECT * INTO existing_plan FROM %1$I.saas_plans WHERE code='essentiel' AND version=1;
  IF FOUND THEN
   IF existing_plan.name<>'SALON PRO ESSENTIEL' OR existing_plan.price_xof<>4900 OR existing_plan.currency<>'XOF'
    OR existing_plan.period_kind<>'calendar_month' OR existing_plan.grace_seconds<>259200 OR existing_plan.entitlements IS DISTINCT FROM caps THEN
    RAISE EXCEPTION 'Approved ESSENTIEL v1 configuration mismatch' USING ERRCODE='23514';
   END IF;
   plan:=existing_plan.id;
  END IF;
  IF EXISTS(SELECT 1 FROM %1$I.tenant_subscriptions WHERE tenant_id=tenant AND revoked_at IS NULL AND starts_at<ends AND ends_at>starts)
   OR EXISTS(SELECT 1 FROM %1$I.platform_activation_receipts WHERE evidence_namespace=a->>'evidenceNamespace' AND external_reference=a->>'externalReference') THEN
   RAISE EXCEPTION 'Overlapping period or reused external reference' USING ERRCODE='23505';
  END IF;
  IF NOT execute_activation THEN
   RETURN jsonb_build_object('outcome','preview','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
  END IF;
  IF plan IS NULL THEN
   INSERT INTO %1$I.saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements)
    VALUES('essentiel',1,'SALON PRO ESSENTIEL',4900,'XOF','calendar_month',259200,caps) ON CONFLICT(code,version) DO NOTHING RETURNING id INTO plan;
   IF plan IS NULL THEN RAISE EXCEPTION 'Concurrent plan registration; retry unchanged command' USING ERRCODE='40001'; END IF;
  END IF;
  INSERT INTO %1$I.tenant_subscriptions(tenant_id,id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
   VALUES(tenant,key,plan,key,anchor,idx,zone,starts,ends,grace,4900,(a->>'evidenceNamespace') || ':' || (a->>'externalReference'),a->>'evidenceReference',session_user::text);
  INSERT INTO %1$I.platform_activation_receipts(activation_key,tenant_id,subscription_id,evidence_namespace,external_reference,command,verified_by)
   VALUES(key,tenant,key,a->>'evidenceNamespace',a->>'externalReference',a,session_user::text);
  RETURN jsonb_build_object('outcome','activated','tenantId',tenant,'activationKey',key,'startsAt',starts,'endsAt',ends,'graceEndsAt',grace);
 END $body$;
 $definition$,current_schema(),operator_role,'salon_pro_runtime_' || substr(md5(current_schema()),1,12),current_schema());
 REVOKE ALL ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) FROM PUBLIC;
 EXECUTE format('GRANT EXECUTE ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) TO %I',operator_role);
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON platform_activation_receipts FROM %I',browser_role);
   EXECUTE format('REVOKE ALL ON FUNCTION activate_essential_subscription(JSONB,BOOLEAN) FROM %I',browser_role);
  END IF;
 END LOOP;
END $install$;
