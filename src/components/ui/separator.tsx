import type { HTMLAttributes, Ref } from 'react'
import { cn } from '@/lib/utils'

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
  ref?: Ref<HTMLDivElement>
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ref,
  ...props
}: SeparatorProps) {
  return (
    <div
      ref={ref}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cn(
        'reui-separator',
        orientation === 'vertical' && 'reui-separator--vertical',
        className,
      )}
      {...props}
    />
  )
}
