import { motion } from 'framer-motion'
import type { InputHTMLAttributes, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE } from '@/lib/motion'
import { cn } from '@/lib/utils'

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface InputProps extends NativeInputProps {
  ref?: Ref<HTMLInputElement>
}

export function Input({
  className,
  type = 'text',
  disabled,
  ref,
  ...props
}: InputProps) {
  return (
    <motion.input
      ref={ref}
      type={type}
      disabled={disabled}
      data-slot="input"
      whileHover={disabled ? undefined : { y: -1 }}
      whileFocus={disabled ? undefined : { y: -1.5, scale: 1.005 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      className={cn('reui-input', className)}
      {...props}
    />
  )
}
