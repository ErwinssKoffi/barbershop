import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import {
  modalDialog3DVariants,
  MOTION_DURATION,
  MOTION_EASE,
} from '@/lib/motion'

interface ModalProps {
  open: boolean
  title: string
  subtitle?: string
  maxWidth?: number
  onClose: () => void
  children: ReactNode
}

export function Modal({
  open,
  title,
  subtitle,
  maxWidth = 540,
  onClose,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <motion.div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      onClick={onClose}
    >
      <motion.div
        className="modal-dialog"
        variants={modalDialog3DVariants}
        initial="initial"
        animate="animate"
        style={{
          maxWidth,
          maxHeight: '90vh',
          overflowY: 'auto',
          transformPerspective: 1100,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700 }}>
              {title}
            </h2>
            {subtitle && (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
          <motion.button
            type="button"
            onClick={onClose}
            whileHover={{ y: -1.5, scale: 1.06, rotateZ: 90 }}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
            className="icon-btn"
            aria-label="Fermer la fenêtre"
          >
            <X size={18} />
          </motion.button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
