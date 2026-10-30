import { motion } from 'framer-motion'
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { MOTION_DURATION, MOTION_EASE, popover3DVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  contentId: string
  focusTrigger: () => void
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenuContext() {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) {
    throw new Error(
      'DropdownMenu subcomponents must be used within <DropdownMenu>',
    )
  }
  return ctx
}

export interface DropdownMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export function DropdownMenu({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const contentId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const setOpen = (next: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(next)
    }
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        if (!isControlled) {
          setUncontrolledOpen(false)
        }
        onOpenChange?.(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open, isControlled, onOpenChange])

  const focusTrigger = () => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')
      ?.focus()
  }

  return (
    <DropdownMenuContext.Provider
      value={{ open, setOpen, contentId, focusTrigger }}
    >
      <div
        ref={rootRef}
        data-slot="dropdown-menu"
        data-state={open ? 'open' : 'closed'}
        className="reui-dropdown"
      >
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

export interface DropdownMenuTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  render?: ReactElement<Record<string, unknown>>
}

export function DropdownMenuTrigger({
  render,
  children,
  className,
  onClick,
  onKeyDown,
  ...props
}: DropdownMenuTriggerProps) {
  const { open, setOpen, contentId } = useDropdownMenuContext()

  const handleToggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!e.defaultPrevented) {
      setOpen(!open)
    }
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown' && !open) {
      e.preventDefault()
      setOpen(true)
    }
  }

  if (render && isValidElement(render)) {
    const renderProps = render.props as {
      className?: string
      children?: ReactNode
      onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
      onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
    }

    const mergedProps: Record<string, unknown> = {
      ...props,
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      'aria-controls': contentId,
      'data-slot': 'dropdown-menu-trigger',
      'data-state': open ? 'open' : 'closed',
      className: cn(renderProps.className, className),
      onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
        renderProps.onClick?.(e)
        handleToggle(e)
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        renderProps.onKeyDown?.(e)
        handleKeyDown(e)
      },
    }

    return children !== undefined
      ? cloneElement(render, mergedProps, children)
      : cloneElement(render, mergedProps)
  }

  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      data-slot="dropdown-menu-trigger"
      data-state={open ? 'open' : 'closed'}
      className={cn('reui-dropdown-trigger', className)}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </button>
  )
}

type DivBaseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface DropdownMenuContentProps extends DivBaseProps {
  align?: 'start' | 'center' | 'end'
}

export function DropdownMenuContent({
  align = 'start',
  className,
  children,
  style,
  onKeyDown,
  ...props
}: DropdownMenuContentProps) {
  const ctx = useDropdownMenuContext()
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ctx.open || !menuRef.current) return
    const firstItem = menuRef.current.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    )
    firstItem?.focus()
  }, [ctx.open])

  if (!ctx.open) return null

  const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      ctx.setOpen(false)
      ctx.focusTrigger()
      return
    }

    if (!menuRef.current) return
    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    )
    if (items.length === 0) return
    const activeIdx = items.indexOf(document.activeElement as HTMLElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = activeIdx < items.length - 1 ? activeIdx + 1 : 0
      items[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1
      items[prev]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <motion.div
      ref={menuRef}
      id={ctx.contentId}
      role="menu"
      tabIndex={-1}
      data-slot="dropdown-menu-content"
      data-align={align}
      variants={popover3DVariants}
      initial="initial"
      animate="animate"
      style={{
        transformPerspective: 900,
        transformOrigin: align === 'end' ? 'top right' : 'top left',
        ...style,
      }}
      className={cn(
        'reui-dropdown-content',
        `reui-dropdown-content--${align}`,
        className,
      )}
      onKeyDown={handleMenuKeyDown}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export function DropdownMenuGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="dropdown-menu-group"
      className={cn('reui-dropdown-group', className)}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dropdown-menu-label"
      className={cn('reui-dropdown-label', className)}
      {...props}
    />
  )
}

type ItemButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface DropdownMenuItemProps extends ItemButtonProps {
  variant?: 'default' | 'destructive'
  onSelect?: () => void
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  disabled,
  onClick,
  onSelect,
  children,
  ...props
}: DropdownMenuItemProps) {
  const ctx = useDropdownMenuContext()

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    onClick?.(e)
    onSelect?.()
    if (!e.defaultPrevented) {
      ctx.setOpen(false)
    }
  }

  return (
    <motion.button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      whileHover={disabled ? undefined : { x: 3 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: MOTION_DURATION.instant, ease: MOTION_EASE }}
      className={cn(
        'reui-dropdown-item',
        variant === 'destructive' && 'reui-dropdown-item--destructive',
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </motion.button>
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      data-slot="dropdown-menu-separator"
      className={cn('reui-dropdown-separator', className)}
      {...props}
    />
  )
}
