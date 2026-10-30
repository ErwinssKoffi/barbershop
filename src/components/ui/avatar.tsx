import { motion } from 'framer-motion'
import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type Ref,
} from 'react'
import { SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'

type AvatarStatus = 'idle' | 'loaded' | 'error'

interface AvatarContextValue {
  status: AvatarStatus
  setStatus: (status: AvatarStatus) => void
  hasSrc: boolean
  setHasSrc: (has: boolean) => void
}

const AvatarContext = createContext<AvatarContextValue | null>(null)

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface AvatarProps extends NativeSpanProps {
  ref?: Ref<HTMLSpanElement>
}

export function Avatar({ className, children, ref, ...props }: AvatarProps) {
  const [status, setStatus] = useState<AvatarStatus>('idle')
  const [hasSrc, setHasSrc] = useState(false)

  return (
    <AvatarContext.Provider value={{ status, setStatus, hasSrc, setHasSrc }}>
      <motion.span
        ref={ref}
        data-slot="avatar"
        whileHover={{
          y: -2,
          scale: 1.08,
          rotateZ: 2,
          transition: SPRING_SNAPPY,
        }}
        whileTap={{ scale: 0.95 }}
        className={cn('reui-avatar', className)}
        {...props}
      >
        {children}
      </motion.span>
    </AvatarContext.Provider>
  )
}

export interface AvatarImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  ref?: Ref<HTMLImageElement>
}

export function AvatarImage({
  className,
  src,
  alt = '',
  onLoad,
  onError,
  ref,
  ...props
}: AvatarImageProps) {
  const ctx = useContext(AvatarContext)
  const [imgError, setImgError] = useState(false)
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined)

  if (!src || imgError) {
    return null
  }

  const isLoaded = loadedSrc === src

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      data-slot="avatar-image"
      className={cn(
        'reui-avatar-image',
        !isLoaded && 'reui-avatar-image--loading',
        className,
      )}
      onLoad={(e) => {
        setLoadedSrc(src)
        ctx?.setHasSrc(true)
        ctx?.setStatus('loaded')
        onLoad?.(e)
      }}
      onError={(e) => {
        setImgError(true)
        ctx?.setStatus('error')
        onError?.(e)
      }}
      {...props}
    />
  )
}

export interface AvatarFallbackProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>
}

export function AvatarFallback({
  className,
  ref,
  ...props
}: AvatarFallbackProps) {
  const ctx = useContext(AvatarContext)
  if (ctx?.hasSrc && ctx.status === 'loaded') {
    return null
  }
  return (
    <span
      ref={ref}
      data-slot="avatar-fallback"
      className={cn('reui-avatar-fallback', className)}
      {...props}
    />
  )
}
