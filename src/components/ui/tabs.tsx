import { motion } from 'framer-motion'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react'
import { MOTION_DURATION, MOTION_EASE, SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type TabsOrientation = 'horizontal' | 'vertical'
export type TabsListVariant = 'default' | 'line'

interface TabsContextValue {
  activeValue: string
  setValue: (next: string) => void
  orientation: TabsOrientation
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)
const TabsListContext = createContext<TabsListVariant>('default')

function useTabsContext(componentName: string): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) {
    throw new Error(`${componentName} must be used within <Tabs>.`)
  }
  return ctx
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: TabsOrientation
  ref?: Ref<HTMLDivElement>
}

export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
  ref,
  ...props
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
  const baseId = useId()

  const isControlled = value !== undefined
  const activeValue = isControlled ? value : uncontrolledValue

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) {
        setUncontrolledValue(next)
      }
      onValueChange?.(next)
    },
    [isControlled, onValueChange],
  )

  const ctx = useMemo<TabsContextValue>(
    () => ({
      activeValue,
      setValue,
      orientation,
      baseId,
    }),
    [activeValue, setValue, orientation, baseId],
  )

  return (
    <TabsContext.Provider value={ctx}>
      <div
        ref={ref}
        data-slot="tabs"
        data-orientation={orientation}
        className={cn(
          'reui-tabs',
          orientation === 'vertical'
            ? 'reui-tabs--vertical'
            : 'reui-tabs--horizontal',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  variant?: TabsListVariant
  ref?: Ref<HTMLDivElement>
}

export function TabsList({
  variant = 'default',
  className,
  onKeyDown,
  children,
  ref,
  ...props
}: TabsListProps) {
  const { orientation } = useTabsContext('TabsList')
  const listRef = useRef<HTMLDivElement | null>(null)

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || !listRef.current) return

    const triggers = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)',
      ),
    )
    if (triggers.length === 0) return

    const currentIdx = triggers.indexOf(
      document.activeElement as HTMLButtonElement,
    )
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

    let targetIdx = -1
    if (e.key === nextKey) {
      e.preventDefault()
      targetIdx = currentIdx < triggers.length - 1 ? currentIdx + 1 : 0
    } else if (e.key === prevKey) {
      e.preventDefault()
      targetIdx = currentIdx > 0 ? currentIdx - 1 : triggers.length - 1
    } else if (e.key === 'Home') {
      e.preventDefault()
      targetIdx = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      targetIdx = triggers.length - 1
    }

    if (targetIdx >= 0) {
      const target = triggers[targetIdx]
      target?.focus()
      target?.click()
    }
  }

  return (
    <TabsListContext.Provider value={variant}>
      <div
        ref={(node) => {
          listRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        role="tablist"
        aria-orientation={orientation}
        data-slot="tabs-list"
        data-variant={variant}
        data-orientation={orientation}
        onKeyDown={handleKeyDown}
        className={cn(
          'reui-tabs-list',
          `reui-tabs-list--${variant}`,
          orientation === 'vertical'
            ? 'reui-tabs-list--vertical'
            : 'reui-tabs-list--horizontal',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TabsListContext.Provider>
  )
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface TabsTriggerProps extends NativeButtonProps {
  value: string
  ref?: Ref<HTMLButtonElement>
}

export function TabsTrigger({
  value,
  disabled,
  className,
  children,
  onClick,
  ref,
  ...props
}: TabsTriggerProps) {
  const { activeValue, setValue, orientation, baseId } =
    useTabsContext('TabsTrigger')
  const variant = useContext(TabsListContext)

  const isActive = activeValue === value
  const triggerId = `${baseId}-trigger-${value}`
  const panelId = `${baseId}-content-${value}`

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!disabled && !e.defaultPrevented) {
      setValue(value)
    }
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      role="tab"
      id={triggerId}
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      data-slot="tabs-trigger"
      data-state={isActive ? 'active' : 'inactive'}
      data-orientation={orientation}
      data-variant={variant}
      whileHover={
        disabled
          ? undefined
          : orientation === 'vertical'
            ? { x: 2 }
            : { y: -1 }
      }
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      onClick={handleClick}
      className={cn(
        'reui-tabs-trigger',
        `reui-tabs-trigger--${variant}`,
        orientation === 'vertical'
          ? 'reui-tabs-trigger--vertical'
          : 'reui-tabs-trigger--horizontal',
        isActive && 'is-active',
        className,
      )}
      {...props}
    >
      <span className="reui-tabs-trigger-label">{children}</span>
      {isActive && variant === 'line' && (
        <motion.span
          layoutId={`${baseId}-line-indicator`}
          data-slot="tabs-line-indicator"
          className="reui-tabs-line-indicator"
          transition={SPRING_SNAPPY}
          aria-hidden="true"
        />
      )}
    </motion.button>
  )
}

type DivBaseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface TabsContentProps extends DivBaseProps {
  value: string
  ref?: Ref<HTMLDivElement>
}

export function TabsContent({
  value,
  className,
  children,
  ref,
  ...props
}: TabsContentProps) {
  const { activeValue, orientation, baseId } = useTabsContext('TabsContent')
  if (activeValue !== value) {
    return null
  }

  const triggerId = `${baseId}-trigger-${value}`
  const panelId = `${baseId}-content-${value}`

  return (
    <motion.div
      ref={ref}
      role="tabpanel"
      id={panelId}
      aria-labelledby={triggerId}
      tabIndex={0}
      data-slot="tabs-content"
      data-state="active"
      data-orientation={orientation}
      initial={{ opacity: 0, y: 8, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: MOTION_DURATION.base, ease: MOTION_EASE }}
      className={cn('reui-tabs-content', className)}
      {...props}
    >
      {children}
    </motion.div>
  )
}
