import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { MOTION_DURATION, MOTION_EASE, SPRING_ELEVATION } from '@/lib/motion'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: MOTION_DURATION.base, ease: MOTION_EASE }}
      style={{
        padding: '38px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <motion.div
        whileHover={{
          y: -4,
          scale: 1.08,
          rotateY: 10,
          transition: SPRING_ELEVATION,
        }}
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'var(--bg-surface-muted)',
          color: 'var(--text-muted)',
          display: 'grid',
          placeItems: 'center',
          boxShadow: 'var(--shadow-sm)',
          transformPerspective: 600,
        }}
      >
        {icon}
      </motion.div>
      <div style={{ fontWeight: 700, fontSize: '0.98rem' }}>{title}</div>
      <p
        style={{
          margin: 0,
          maxWidth: 420,
          fontSize: '0.84rem',
          color: 'var(--text-muted)',
        }}
      >
        {description}
      </p>
      {(actionLabel || secondaryLabel) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 10,
            marginTop: 8,
          }}
        >
          {actionLabel && onAction && (
            <Button type="button" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button type="button" variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  )
}
