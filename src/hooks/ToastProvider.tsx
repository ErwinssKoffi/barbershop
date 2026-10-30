import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MOTION_DURATION, MOTION_EASE, SPRING_ELEVATION } from '@/lib/motion'
import { ToastContext, type ToastItem, type ToastKind } from './toastContext'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setToasts((prev) => [...prev, { id, kind, message }])
      setTimeout(() => remove(id), 4200)
    },
    [remove],
  )

  const value = useMemo(
    () => ({
      notify,
      success: (msg: string) => notify('success', msg),
      error: (msg: string) => notify('error', msg),
      warning: (msg: string) => notify('warning', msg),
    }),
    [notify],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div
          className="no-print"
          role="region"
          aria-label="Notifications"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 22,
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 380,
          }}
        >
          <AnimatePresence>
            {toasts.map((t) => {
              const bg =
                t.kind === 'success'
                  ? 'var(--color-success-bg)'
                  : t.kind === 'error'
                    ? 'var(--color-danger-bg)'
                    : 'var(--color-warning-bg)'
              const fg =
                t.kind === 'success'
                  ? 'var(--color-success)'
                  : t.kind === 'error'
                    ? 'var(--color-danger)'
                    : 'var(--color-warning)'

              return (
                <motion.div
                  key={t.id}
                  role="alert"
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.94, rotateX: 12 }}
                  animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                  exit={{ opacity: 0, x: 28, scale: 0.94 }}
                  transition={{
                    duration: MOTION_DURATION.base,
                    ease: MOTION_EASE,
                  }}
                  whileHover={{
                    y: -3,
                    scale: 1.015,
                    transition: SPRING_ELEVATION,
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-strong)',
                    boxShadow: 'var(--shadow-elevated)',
                    fontSize: '0.84rem',
                    transformPerspective: 800,
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background: bg,
                      color: fg,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {t.kind === 'success' ? (
                      <CheckCircle2 size={15} />
                    ) : t.kind === 'error' ? (
                      <AlertCircle size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                  </span>
                  <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    aria-label="Fermer la notification"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </ToastContext.Provider>
  )
}
