import { motion } from 'framer-motion'
import type { HTMLAttributes, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE, SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'success-light'
  | 'destructive-light'
  | 'warning-light'
  | 'info-light'

export type BadgeSize = 'default' | 'sm' | 'lg'

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface BadgeProps extends NativeSpanProps {
  variant?: BadgeVariant
  size?: BadgeSize
  ref?: Ref<HTMLSpanElement>
}

export function Badge({
  className,
  variant = 'default',
  size = 'default',
  ref,
  ...props
}: BadgeProps) {
  return (
    <motion.span
      ref={ref}
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      whileHover={{ y: -1.5, scale: 1.045, transition: SPRING_SNAPPY }}
      className={cn(
        'reui-badge',
        `reui-badge--${variant}`,
        `reui-badge--size-${size}`,
        className,
      )}
      {...props}
    />
  )
}
