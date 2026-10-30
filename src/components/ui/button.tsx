import { motion } from 'framer-motion'
import type { ButtonHTMLAttributes, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE, SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'destructive'

export type ButtonSize =
  | 'default'
  | 'xs'
  | 'sm'
  | 'lg'
  | 'icon'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-lg'

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  disabled,
  ref,
  ...props
}: ButtonProps) {
  const normalizedVariant = variant === 'primary' ? 'default' : variant
  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      data-slot="button"
      data-variant={normalizedVariant}
      data-size={size}
      whileHover={
        disabled
          ? undefined
          : {
              y: -2,
              scale: 1.022,
              transition: SPRING_SNAPPY,
            }
      }
      whileTap={
        disabled
          ? undefined
          : {
              y: 0.5,
              scale: 0.968,
              transition: {
                duration: MOTION_DURATION.instant,
                ease: MOTION_EASE,
              },
            }
      }
      className={cn(
        'reui-btn',
        `reui-btn--${normalizedVariant}`,
        `reui-btn--size-${size}`,
        className,
      )}
      {...props}
    />
  )
}
