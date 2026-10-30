import { AlertTriangle, ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/authContext'
import { useToast } from '../../hooks/toastContext'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const { authReady, currentUser, hasAnyManager, login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const redirectTarget =
    (location.state as { from?: string } | null)?.from ?? '/dashboard'

  if (authReady && currentUser) {
    return <Navigate to={redirectTarget} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const user = await login({ email, password, rememberMe })
      toast.success(`Bienvenue, ${user.fullName}.`)
      navigate(redirectTarget, { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de vous connecter. Vérifiez vos identifiants.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      variant="login"
      maxWidth={370}
      title="Connexion à votre espace"
      subtitle="Connectez-vous pour accéder à votre caisse et au pilotage"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {authReady && !hasAnyManager && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '11px 13px',
              borderRadius: 12,
              border: '1px solid rgba(16, 185, 129, 0.35)',
              background: 'var(--accent-emerald-soft)',
              fontSize: '0.8rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
                color: 'var(--accent-cta)',
              }}
            >
              <Sparkles size={14} />
              Première utilisation de SALON PRO
            </div>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Aucun compte n&apos;est encore configuré sur ce salon.
            </div>
            <div>
              <Link
                to="/register"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontWeight: 700,
                  color: 'var(--accent-cta)',
                }}
              >
                Créer le compte Gérant
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 11,
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              fontSize: '0.8rem',
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="auth-soft-field">
            <label htmlFor="login-email" className="auth-soft-label">
              Adresse e-mail
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              placeholder="nom@domaine.com"
              className="auth-soft-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="auth-soft-field" style={{ paddingRight: 40 }}>
            <label htmlFor="login-password" className="auth-soft-label">
              Mot de passe
            </label>
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="auth-soft-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={
                showPassword
                  ? 'Masquer le mot de passe'
                  : 'Afficher le mot de passe'
              }
              onClick={() => setShowPassword((v) => !v)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'inline-flex',
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '2px 2px 4px',
              fontSize: '0.79rem',
            }}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontWeight: 550,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Rester connecté</span>
            </label>

            <Link
              to="/register"
              style={{
                fontWeight: 650,
                color: 'var(--text-primary)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Nouveau salon ?
            </Link>
          </div>

          <button type="submit" className="auth-haven-submit" disabled={busy}>
            {busy ? 'Connexion en cours…' : 'Se connecter'}
          </button>
        </form>

        <div
          style={{
            marginTop: 6,
            textAlign: 'center',
            fontSize: '0.81rem',
            color: 'var(--text-secondary)',
          }}
        >
          Pas encore de compte ?{' '}
          <Link
            to="/register"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 700,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            S&apos;inscrire
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}
