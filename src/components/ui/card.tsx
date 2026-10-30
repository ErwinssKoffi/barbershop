import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, Ref } from 'react'
import { MOTION_DURATION, MOTION_EASE, SPRING_ELEVATION, SPRING_TILT_3D } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type CardSize = 'default' | 'sm'

type DivBaseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface CardProps extends DivBaseProps {
  size?: CardSize
  tilt3d?: boolean
  ref?: Ref<HTMLDivElement>
}

export function Card({
  className,
  size = 'default',
  tilt3d = true,
  style,
  children,
  onMouseMove,
  onMouseLeave,
  ref,
  ...props
}: CardProps) {
  const pointerX = useMotionValue(0.5)
  const pointerY = useMotionValue(0.5)

  const smoothX = useSpring(pointerX, SPRING_TILT_3D)
  const smoothY = useSpring(pointerY, SPRING_TILT_3D)

  const rotateX = useTransform(smoothY, [0, 1], tilt3d ? [3.6, -3.6] : [0, 0])
  const rotateY = useTransform(smoothX, [0, 1], tilt3d ? [-3.6, 3.6] : [0, 0])
  const sheenX = useTransform(smoothX, [0, 1], ['0%', '100%'])
  const sheenY = useTransform(smoothY, [0, 1], ['0%', '100%'])
  const sheenBg = useMotionTemplate`radial-gradient(380px circle at ${sheenX} ${sheenY}, var(--card-3d-sheen), transparent 72%)`

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    onMouseMove?.(e)
    if (!tilt3d) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      pointerX.set(nx)
      pointerY.set(ny)
    }
  }

  const handleMouseLeave = (e: ReactMouseEvent<HTMLDivElement>) => {
    onMouseLeave?.(e)
    pointerX.set(0.5)
    pointerY.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      data-slot="card"
      data-size={size}
      data-3d={tilt3d ? 'true' : 'false'}
      initial={{ opacity: 0, y: 12, scale: 0.986 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: MOTION_DURATION.base, ease: MOTION_EASE }}
      whileHover={
        tilt3d ? { y: -4, scale: 1.01, transition: SPRING_ELEVATION } : undefined
      }
      style={{
        transformPerspective: 1050,
        rotateX,
        rotateY,
        ...style,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'reui-card',
        size === 'sm' && 'reui-card--sm',
        className,
      )}
      {...props}
    >
      {tilt3d && (
        <motion.div
          aria-hidden="true"
          data-slot="card-sheen"
          className="reui-card-sheen"
          style={{ background: sheenBg }}
        />
      )}
      {children}
    </motion.div>
  )
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardHeader({ className, ref, ...props }: CardHeaderProps) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn('reui-card-header', className)}
      {...props}
    />
  )
}

export interface CardTitleProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardTitle({ className, ref, ...props }: CardTitleProps) {
  return (
    <div
      ref={ref}
      data-slot="card-title"
      className={cn('reui-card-title', className)}
      {...props}
    />
  )
}

export interface CardDescriptionProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardDescription({
  className,
  ref,
  ...props
}: CardDescriptionProps) {
  return (
    <div
      ref={ref}
      data-slot="card-description"
      className={cn('reui-card-description', className)}
      {...props}
    />
  )
}

export interface CardActionProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardAction({ className, ref, ...props }: CardActionProps) {
  return (
    <div
      ref={ref}
      data-slot="card-action"
      className={cn('reui-card-action', className)}
      {...props}
    />
  )
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardContent({ className, ref, ...props }: CardContentProps) {
  return (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn('reui-card-content', className)}
      {...props}
    />
  )
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
}

export function CardFooter({ className, ref, ...props }: CardFooterProps) {
  return (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn('reui-card-footer', className)}
      {...props}
    />
  )
}
