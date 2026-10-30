import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} maxWidth={440} onClose={onCancel}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '0.88rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          Annuler
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
