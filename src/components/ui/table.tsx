import { motion } from 'framer-motion'
import type {
  HTMLAttributes,
  Ref,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import { MOTION_DURATION, MOTION_EASE } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  ref?: Ref<HTMLTableElement>
}

export function Table({ className, ref, ...props }: TableProps) {
  return (
    <div data-slot="table-container" className="reui-table-container">
      <table
        ref={ref}
        data-slot="table"
        className={cn('reui-table', className)}
        {...props}
      />
    </div>
  )
}

export interface TableHeaderProps
  extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>
}

export function TableHeader({ className, ref, ...props }: TableHeaderProps) {
  return (
    <thead
      ref={ref}
      data-slot="table-header"
      className={cn('reui-table-header', className)}
      {...props}
    />
  )
}

export interface TableBodyProps
  extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>
}

export function TableBody({ className, ref, ...props }: TableBodyProps) {
  return (
    <tbody
      ref={ref}
      data-slot="table-body"
      className={cn('reui-table-body', className)}
      {...props}
    />
  )
}

export interface TableFooterProps
  extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>
}

export function TableFooter({ className, ref, ...props }: TableFooterProps) {
  return (
    <tfoot
      ref={ref}
      data-slot="table-footer"
      className={cn('reui-table-footer', className)}
      {...props}
    />
  )
}

type NativeRowProps = Omit<
  HTMLAttributes<HTMLTableRowElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>

export interface TableRowProps extends NativeRowProps {
  ref?: Ref<HTMLTableRowElement>
}

export function TableRow({ className, ref, ...props }: TableRowProps) {
  return (
    <motion.tr
      ref={ref}
      data-slot="table-row"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      className={cn('reui-table-row', className)}
      {...props}
    />
  )
}

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  ref?: Ref<HTMLTableCellElement>
}

export function TableHead({ className, ref, ...props }: TableHeadProps) {
  return (
    <th
      ref={ref}
      data-slot="table-head"
      className={cn('reui-table-head', className)}
      {...props}
    />
  )
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  ref?: Ref<HTMLTableCellElement>
}

export function TableCell({ className, ref, ...props }: TableCellProps) {
  return (
    <td
      ref={ref}
      data-slot="table-cell"
      className={cn('reui-table-cell', className)}
      {...props}
    />
  )
}

export interface TableCaptionProps
  extends HTMLAttributes<HTMLTableCaptionElement> {
  ref?: Ref<HTMLTableCaptionElement>
}

export function TableCaption({ className, ref, ...props }: TableCaptionProps) {
  return (
    <caption
      ref={ref}
      data-slot="table-caption"
      className={cn('reui-table-caption', className)}
      {...props}
    />
  )
}
