-- Complément au socle privé existant ; aucune donnée métier modifiée.
SET LOCAL search_path = salon_pro;
SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':salon-pro-migrations'));
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits (expires_at);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Le socle a déjà été appliqué par la migration Supabase précédente.
INSERT INTO schema_migrations (id) VALUES ('001_baseline'), ('002_auth_security') ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON auth_rate_limits, schema_migrations FROM PUBLIC, anon, authenticated;
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
