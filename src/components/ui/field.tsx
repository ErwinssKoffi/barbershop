import { motion } from 'framer-motion'
import type { HTMLAttributes, LabelHTMLAttributes, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE } from '@/lib/motion'
import { cn } from '@/lib/utils'

type DivBaseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface FieldGroupProps extends DivBaseProps {
  ref?: Ref<HTMLDivElement>
}

export function FieldGroup({ className, ref, ...props }: FieldGroupProps) {
  return (
    <motion.div
      ref={ref}
      data-slot="field-group"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_DURATION.base, ease: MOTION_EASE }}
      className={cn('reui-field-group', className)}
      {...props}
    />
  )
}

export interface FieldProps extends DivBaseProps {
  orientation?: 'vertical' | 'horizontal'
  ref?: Ref<HTMLDivElement>
}

export function Field({
  className,
  orientation = 'vertical',
  ref,
  ...props
}: FieldProps) {
  return (
    <motion.div
      ref={ref}
      role="group"
      data-slot="field"
      data-orientation={orientation}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      className={cn(
        'reui-field',
        orientation === 'horizontal' && 'reui-field--horizontal',
        className,
      )}
      {...props}
    />
  )
}

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  ref?: Ref<HTMLLabelElement>
}

export function FieldLabel({ className, ref, ...props }: FieldLabelProps) {
  return (
    <label
      ref={ref}
      data-slot="field-label"
      className={cn('reui-field-label', className)}
      {...props}
    />
  )
}

export interface FieldDescriptionProps
  extends HTMLAttributes<HTMLParagraphElement> {
  ref?: Ref<HTMLParagraphElement>
}

export function FieldDescription({
  className,
  ref,
  ...props
}: FieldDescriptionProps) {
  return (
    <p
      ref={ref}
      data-slot="field-description"
      className={cn('reui-field-description', className)}
      {...props}
    />
  )
}

export interface FieldErrorProps extends HTMLAttributes<HTMLParagraphElement> {
  ref?: Ref<HTMLParagraphElement>
}

export function FieldError({
  className,
  children,
  ref,
  ...props
}: FieldErrorProps) {
  if (!children) return null
  return (
    <p
      ref={ref}
      role="alert"
      data-slot="field-error"
      className={cn('reui-field-error', className)}
      {...props}
    >
      {children}
    </p>
  )
}
