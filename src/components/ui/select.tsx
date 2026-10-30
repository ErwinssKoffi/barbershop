import { motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { MOTION_DURATION, MOTION_EASE, popover3DVariants, SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface SelectOptionEntry {
  value: string
  label: ReactNode
  disabled?: boolean
}

interface SelectContextValue {
  open: boolean
  setOpen: (next: boolean) => void
  currentValue: string
  selectValue: (val: string) => void
  selectedLabel: ReactNode | undefined
  disabled: boolean
  listboxId: string
  options: SelectOptionEntry[]
  highlightedIndex: number
  setHighlightedIndex: (idx: number) => void
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelectContext(componentName: string): SelectContextValue {
  const ctx = useContext(SelectContext)
  if (!ctx) {
    throw new Error(`${componentName} must be used within <Select>.`)
  }
  return ctx
}

type DivBaseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface SelectItemProps extends DivBaseProps {
  value: string
  disabled?: boolean
  children: ReactNode
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
  ...props
}: SelectItemProps) {
  const {
    currentValue,
    selectValue,
    options,
    highlightedIndex,
    setHighlightedIndex,
  } = useSelectContext('SelectItem')

  const isSelected = currentValue === value
  const optionIdx = options.findIndex((o) => o.value === value)
  const isHighlighted = optionIdx >= 0 && highlightedIndex === optionIdx

  return (
    <motion.div
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      data-slot="select-item"
      data-selected={isSelected || undefined}
      data-highlighted={isHighlighted || undefined}
      data-disabled={disabled || undefined}
      whileHover={disabled ? undefined : { x: 3 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={{ duration: MOTION_DURATION.instant, ease: MOTION_EASE }}
      className={cn(
        'reui-select-item',
        isSelected && 'is-selected',
        isHighlighted && 'is-highlighted',
        disabled && 'is-disabled',
        className,
      )}
      onMouseEnter={() => {
        if (!disabled && optionIdx >= 0) {
          setHighlightedIndex(optionIdx)
        }
      }}
      onClick={() => {
        if (!disabled) {
          selectValue(value)
        }
      }}
      {...props}
    >
      <span className="reui-select-item-text">{children}</span>
      <span className="reui-select-item-indicator" aria-hidden="true">
        {isSelected ? <Check size={14} strokeWidth={2.4} /> : null}
      </span>
    </motion.div>
  )
}

function collectSelectOptions(
  node: ReactNode,
  out: SelectOptionEntry[],
): void {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    if (child.type === SelectItem) {
      const itemProps = child.props as SelectItemProps
      out.push({
        value: itemProps.value,
        label: itemProps.children,
        disabled: itemProps.disabled,
      })
      return
    }
    const maybeChildren = (child.props as { children?: ReactNode } | undefined)
      ?.children
    if (maybeChildren !== undefined) {
      collectSelectOptions(maybeChildren, out)
    }
  })
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  required?: boolean
  children: ReactNode
}

export function Select({
  value,
  defaultValue = '',
  onValueChange,
  disabled = false,
  name,
  required,
  children,
}: SelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
  const [open, setOpenState] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listboxId = useId()

  const isControlled = value !== undefined
  const currentValue = isControlled ? value : uncontrolledValue

  const options = useMemo(() => {
    const collected: SelectOptionEntry[] = []
    collectSelectOptions(children, collected)
    return collected
  }, [children])

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === currentValue)?.label,
    [options, currentValue],
  )

  const focusTrigger = useCallback(() => {
    rootRef.current
      ?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')
      ?.focus()
  }, [])

  const setOpen = useCallback(
    (next: boolean) => {
      if (disabled) return
      setOpenState(next)
      if (next) {
        const idx = options.findIndex((o) => o.value === currentValue)
        setHighlightedIndex(idx >= 0 ? idx : 0)
      }
    },
    [disabled, options, currentValue],
  )

  const selectValue = useCallback(
    (nextVal: string) => {
      if (!isControlled) {
        setUncontrolledValue(nextVal)
      }
      onValueChange?.(nextVal)
      setOpenState(false)
      focusTrigger()
    },
    [isControlled, onValueChange, focusTrigger],
  )

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenState(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpenState(false)
        focusTrigger()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, focusTrigger])

  const contextVal = useMemo<SelectContextValue>(
    () => ({
      open,
      setOpen,
      currentValue,
      selectValue,
      selectedLabel,
      disabled,
      listboxId,
      options,
      highlightedIndex,
      setHighlightedIndex,
    }),
    [
      open,
      setOpen,
      currentValue,
      selectValue,
      selectedLabel,
      disabled,
      listboxId,
      options,
      highlightedIndex,
    ],
  )

  return (
    <SelectContext.Provider value={contextVal}>
      <div
        ref={rootRef}
        data-slot="select"
        data-state={open ? 'open' : 'closed'}
        className="reui-select"
      >
        {name ? (
          <input
            type="hidden"
            name={name}
            value={currentValue}
            required={required}
          />
        ) : null}
        {children}
      </div>
    </SelectContext.Provider>
  )
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface SelectTriggerProps extends NativeButtonProps {
  children?: ReactNode
}

export function SelectTrigger({
  className,
  children,
  onKeyDown,
  onClick,
  ...props
}: SelectTriggerProps) {
  const {
    open,
    setOpen,
    disabled,
    listboxId,
    options,
    highlightedIndex,
    setHighlightedIndex,
    selectValue,
  } = useSelectContext('SelectTrigger')

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e)
    if (disabled) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (options.length > 0) {
        let next = highlightedIndex + 1
        while (next < options.length && options[next]?.disabled) next += 1
        if (next < options.length) setHighlightedIndex(next)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (options.length > 0) {
        let prev = highlightedIndex - 1
        while (prev >= 0 && options[prev]?.disabled) prev -= 1
        if (prev >= 0) setHighlightedIndex(prev)
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        const opt = options[highlightedIndex]
        if (opt && !opt.disabled) {
          selectValue(opt.value)
        }
      }
    }
  }

  return (
    <motion.button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      disabled={disabled}
      data-slot="select-trigger"
      data-state={open ? 'open' : 'closed'}
      whileHover={disabled ? undefined : { y: -1.5, transition: SPRING_SNAPPY }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      className={cn('reui-select-trigger', className)}
      onClick={(e) => {
        onClick?.(e)
        setOpen(!open)
      }}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <span className="reui-select-trigger-value">{children}</span>
      <ChevronDown
        size={15}
        className={cn('reui-select-chevron', open && 'is-open')}
        aria-hidden="true"
      />
    </motion.button>
  )
}

export interface SelectValueProps {
  placeholder?: ReactNode
}

export function SelectValue({ placeholder = 'Sélectionner…' }: SelectValueProps) {
  const { selectedLabel } = useSelectContext('SelectValue')
  if (
    selectedLabel !== undefined &&
    selectedLabel !== null &&
    selectedLabel !== ''
  ) {
    return <span data-slot="select-value">{selectedLabel}</span>
  }
  return (
    <span data-slot="select-value" className="reui-select-placeholder">
      {placeholder}
    </span>
  )
}

export interface SelectContentProps extends DivBaseProps {
  children: ReactNode
}

export function SelectContent({
  className,
  children,
  style,
  ...props
}: SelectContentProps) {
  const { open, listboxId } = useSelectContext('SelectContent')
  if (!open) return null

  return (
    <motion.div
      id={listboxId}
      role="listbox"
      data-slot="select-content"
      variants={popover3DVariants}
      initial="initial"
      animate="animate"
      style={{
        transformPerspective: 900,
        transformOrigin: 'top center',
        ...style,
      }}
      className={cn('reui-select-content', className)}
      {...props}
    >
      {children}
    </motion.div>
  )
}
