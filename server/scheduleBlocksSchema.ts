/** 015: private multi-day blocks, no availability endpoint or change to existing booking. */
export const SCHEDULE_BLOCKS_SQL = `
CREATE TABLE schedule_blocks (
 tenant_id UUID NOT NULL REFERENCES tenants(id), id UUID NOT NULL DEFAULT gen_random_uuid(),
 scope TEXT NOT NULL CHECK(scope IN ('salon','employee')),
 employee_id TEXT, employee_ref TEXT CHECK(length(employee_ref) BETWEEN 1 AND 200),
 start_at TIMESTAMPTZ NOT NULL CHECK(isfinite(start_at)),
 end_at TIMESTAMPTZ NOT NULL CHECK(isfinite(end_at)),
 private_note TEXT NOT NULL DEFAULT '' CHECK(length(private_note)<=1000),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','cancelled')),
 created_by TEXT NOT NULL, cancelled_by TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id) ON DELETE SET NULL(employee_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,cancelled_by) REFERENCES memberships(tenant_id,user_id),
 CHECK(end_at>start_at),
 CHECK((scope='salon' AND employee_id IS NULL AND employee_ref IS NULL) OR
       (scope='employee' AND employee_ref IS NOT NULL AND (employee_id IS NULL OR employee_id=employee_ref))),
 CHECK((state='active' AND cancelled_by IS NULL) OR (state='cancelled' AND cancelled_by IS NOT NULL))
);
CREATE INDEX schedule_blocks_interval ON schedule_blocks(tenant_id,scope,employee_ref,start_at,end_at) WHERE state='active';
CREATE TABLE schedule_block_events (
 tenant_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(), block_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('created','cancelled','employee_detached')),
 version INTEGER NOT NULL CHECK(version>0), actor_id TEXT,
 actor_db_role TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,block_id,version),
 FOREIGN KEY(tenant_id,block_id) REFERENCES schedule_blocks(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE FUNCTION validate_schedule_block() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $block$
DECLARE actor TEXT; permitted BOOLEAN; employee_active BOOLEAN;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'active' OR NEW.cancelled_by IS NOT NULL THEN RAISE EXCEPTION 'Block must start active' USING ERRCODE='23514'; END IF;
  actor:=NEW.created_by; NEW.version:=1; NEW.created_at:=now();
  IF NEW.scope='employee' THEN
   EXECUTE format('SELECT is_active FROM %I.employees WHERE tenant_id=$1 AND id=$2',TG_TABLE_SCHEMA)
    INTO employee_active USING NEW.tenant_id,NEW.employee_id;
   IF NOT COALESCE(employee_active,false) THEN RAISE EXCEPTION 'Active employee in same tenant required' USING ERRCODE='23514'; END IF;
   NEW.employee_ref:=NEW.employee_id;
  ELSE NEW.employee_ref:=NULL;
  END IF;
 ELSE
  IF ROW(NEW.tenant_id,NEW.id,NEW.scope,NEW.employee_ref,NEW.start_at,NEW.end_at,NEW.private_note,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.scope,OLD.employee_ref,OLD.start_at,OLD.end_at,OLD.private_note,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Block envelope immutable; cancel and recreate' USING ERRCODE='23514';
  END IF;
  IF OLD.employee_id IS NOT NULL AND NEW.employee_id IS NULL AND NEW.state=OLD.state AND NEW.cancelled_by IS NOT DISTINCT FROM OLD.cancelled_by THEN
   -- Only a genuine FK detachment after employee deletion, never a conversion to salon scope.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.employees WHERE tenant_id=$1 AND id=$2)',TG_TABLE_SCHEMA)
    INTO employee_active USING OLD.tenant_id,OLD.employee_id;
   IF employee_active THEN RAISE EXCEPTION 'Employee still exists' USING ERRCODE='23514'; END IF;
   NEW.version:=OLD.version+1; NEW.updated_at:=now(); RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR OLD.state<>'active' OR NEW.state<>'cancelled' OR NEW.cancelled_by IS NULL THEN
   RAISE EXCEPTION 'Invalid block transition' USING ERRCODE='23514';
  END IF;
  actor:=NEW.cancelled_by; NEW.version:=OLD.version+1;
 END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %1$I.memberships m JOIN %1$I.salon_users u ON u.id=m.user_id JOIN %1$I.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role=''manager'' AND m.is_active AND u.is_active AND t.status=''active'')',TG_TABLE_SCHEMA)
  INTO permitted USING NEW.tenant_id,actor;
 IF NOT permitted THEN RAISE EXCEPTION 'Active manager actor required' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $block$;
CREATE TRIGGER schedule_block_validate BEFORE INSERT OR UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION validate_schedule_block();
CREATE FUNCTION record_schedule_block_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $audit$
DECLARE kind TEXT; actor TEXT;
BEGIN
 IF TG_OP='INSERT' THEN kind:='created'; actor:=NEW.created_by;
 ELSIF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN kind:='employee_detached'; actor:=NULL;
 ELSE kind:='cancelled'; actor:=NEW.cancelled_by;
 END IF;
 EXECUTE format('INSERT INTO %I.schedule_block_events(tenant_id,block_id,event_type,version,actor_id,actor_db_role) VALUES($1,$2,$3,$4,$5,$6)',TG_TABLE_SCHEMA)
 USING NEW.tenant_id,NEW.id,kind,NEW.version,actor,COALESCE(NULLIF(current_setting('role',true),'none'),session_user::text);
 RETURN NEW;
END $audit$;
CREATE TRIGGER schedule_block_audit AFTER INSERT OR UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION record_schedule_block_event();
CREATE FUNCTION protect_schedule_block_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'Schedule block history immutable' USING ERRCODE='23514'; END $immutable$;
CREATE TRIGGER schedule_block_no_delete BEFORE DELETE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION protect_schedule_block_history();
CREATE TRIGGER schedule_block_event_immutable BEFORE UPDATE OR DELETE ON schedule_block_events FOR EACH ROW EXECUTE FUNCTION protect_schedule_block_history();
${['schedule_blocks','schedule_block_events'].map(table=>`
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${table} FROM PUBLIC;`).join('\n')}
REVOKE ALL ON FUNCTION validate_schedule_block(),record_schedule_block_event(),protect_schedule_block_history() FROM PUBLIC;
DO $roles$
DECLARE runtime_role TEXT:='salon_pro_runtime_' || substr(md5(current_schema()),1,12); table_name TEXT; browser_role TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['schedule_blocks','schedule_block_events'] LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I',table_name,runtime_role);
  EXECUTE format('CREATE POLICY block_tenant_read ON %I FOR SELECT TO %I USING(tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,runtime_role);
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,browser_role);
    EXECUTE format('REVOKE ALL ON FUNCTION validate_schedule_block(),record_schedule_block_event(),protect_schedule_block_history() FROM %I',browser_role);
   END IF;
  END LOOP;
 END LOOP;
END $roles$;
`
