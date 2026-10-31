-- Sessions d'authentification du schéma privé uniquement.
SET LOCAL search_path = salon_pro;

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES salon_users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  family_id UUID NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  remember_me BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  replaced_by UUID REFERENCES sessions(id),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user_tenant ON sessions (user_id, tenant_id);
CREATE INDEX idx_sessions_family ON sessions (family_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);
-- Table globale d’authentification : accès serveur explicites par identité/session, jamais via sync ou navigateur.
REVOKE ALL ON sessions FROM PUBLIC;
DO $runtime$
DECLARE runtime_role TEXT := 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12);
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sessions TO %I', runtime_role);
END
$runtime$;

REVOKE ALL ON sessions FROM anon, authenticated;
INSERT INTO schema_migrations (id) VALUES ('004_sessions');
