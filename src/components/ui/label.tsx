import type { LabelHTMLAttributes, Ref } from 'react'
import { cn } from '@/lib/utils'

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  ref?: Ref<HTMLLabelElement>
}

export function Label({ className, ref, ...props }: LabelProps) {
  return (
    <label
      ref={ref}
      data-slot="label"
      className={cn('reui-label', className)}
      {...props}
    />
  )
}
