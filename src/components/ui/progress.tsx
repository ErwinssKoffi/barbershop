import { motion } from 'framer-motion'
import type { HTMLAttributes, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type ProgressVariant = 'default' | 'warning' | 'destructive'

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number | null
  max?: number
  variant?: ProgressVariant
  ref?: Ref<HTMLDivElement>
}

export function Progress({
  className,
  value = 0,
  max = 100,
  variant = 'default',
  ref,
  ...props
}: ProgressProps) {
  const safeMax = max > 0 ? max : 100
  const clamped =
    value === null || value === undefined
      ? 0
      : Math.min(safeMax, Math.max(0, value))
  const percent = Math.round((clamped / safeMax) * 1000) / 10

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(clamped)}
      data-slot="progress"
      data-variant={variant}
      className={cn('reui-progress', className)}
      {...props}
    >
      <motion.div
        data-slot="progress-indicator"
        initial={{ width: '0%' }}
        animate={{ width: `${percent}%` }}
        transition={{ duration: MOTION_DURATION.slow, ease: MOTION_EASE }}
        className={cn(
          'reui-progress-indicator',
          variant !== 'default' && `reui-progress-indicator--${variant}`,
        )}
      />
    </div>
  )
}
