import { Cloud, HardDrive, Moon, Scissors, Sun } from 'lucide-react'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { pageTransitionVariants } from '@/lib/motion'
import { useAuth } from '../../contexts/authContext'
import { useSalonStore } from '../../hooks/salonStoreContext'

export function AuthLayout({
  variant,
  title,
  subtitle,
  maxWidth = 370,
  children,
}: {
  variant: 'login' | 'register'
  title: string
  subtitle: string
  maxWidth?: number
  children: ReactNode
}) {
  const { authMode } = useAuth()
  const { state, mutate } = useSalonStore()

  const handleToggleTheme = async () => {
    const next = state.settings.theme === 'dark' ? 'light' : 'dark'
    await mutate((repo) => repo.updateSettings({ theme: next }))
  }

  return (
    <div className="auth-haven-viewport">
      <div className="auth-haven-card">
        {/* PARTIE 1 (Gauche) : Marque centrée + Titre + Formulaire épuré */}
        <section className="auth-haven-left">
          <motion.div
            variants={pageTransitionVariants}
            initial="initial"
            animate="animate"
            className="auth-haven-form-box"
            style={{ maxWidth }}
          >
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div className="auth-brand-row">
                <div className="auth-brand-icon" aria-hidden="true">
                  <Scissors size={18} strokeWidth={2.2} />
                </div>
                <span className="auth-brand-wordmark">SalonPro.</span>
              </div>

              <h1
                style={{
                  fontSize: '1.82rem',
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.18,
                  margin: 0,
                  color: 'var(--text-primary)',
                }}
              >
                {title}
              </h1>
              <p
                style={{
                  fontSize: '0.84rem',
                  color: 'var(--text-muted)',
                  margin: '6px 0 0',
                  lineHeight: 1.45,
                }}
              >
                {subtitle}
              </p>
            </div>

            {children}
          </motion.div>
        </section>

        {/* PARTIE 2 (Droite) : Photographie architecturale à découpe sculptée (Top-Left & Bottom-Right) */}
        <aside className="auth-haven-visual" aria-label="Présentation visuelle SALON PRO">
          <img
            src="/images/auth-salon-hero.jpg"
            alt="Intérieur contemporain du salon de coiffure et barbershop"
            className="auth-haven-photo"
          />
          <div className="auth-haven-photo-scrim" />

          {/* Accroche éditoriale blanche en haut à droite de l'image */}
          <div className="auth-haven-visual-headline">
            {variant === 'login' ? (
              <>
                Pilotez votre caisse, vos prestations et votre équipe
                <br />
                au franc près, en toute sérénité.
              </>
            ) : (
              <>
                Configurez les accès Gérant et Caissier de votre salon
                <br />
                avec continuité locale et Cloud Neon.
              </>
            )}
          </div>

          {/* Découpe crantée Haut-Gauche + bouton discret thème */}
          <div className="auth-notch-tl">
            <button
              type="button"
              className="icon-btn"
              onClick={() => void handleToggleTheme()}
              aria-label="Basculer le thème clair ou sombre"
              title="Thème clair / sombre"
              style={{ width: 34, height: 34 }}
            >
              {state.settings.theme === 'dark' ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
              )}
            </button>
          </div>
          <div className="auth-notch-tl-r" />
          <div className="auth-notch-tl-b" />

          {/* Découpe crantée Bas-Droite + indicateur discret mode Cloud/Local */}
          <div className="auth-notch-br">
            <span
              title={
                authMode === 'cloud_neon'
                  ? 'Connecté à Neon PostgreSQL'
                  : 'Mode local hors-ligne actif (IndexedDB)'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.68rem',
                fontWeight: 650,
                color:
                  authMode === 'cloud_neon'
                    ? 'var(--color-success)'
                    : 'var(--text-muted)',
                padding: '4px 7px',
              }}
            >
              {authMode === 'cloud_neon' ? (
                <>
                  <Cloud size={12} />
                  Neon
                </>
              ) : (
                <>
                  <HardDrive size={12} />
                  Local
                </>
              )}
            </span>
          </div>
          <div className="auth-notch-br-l" />
          <div className="auth-notch-br-t" />
        </aside>
      </div>
    </div>
  )
}
