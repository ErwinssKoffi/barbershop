import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'warning'

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
}

export interface ToastContextValue {
  notify: (kind: ToastKind, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast doit être utilisé dans ToastProvider')
  }
  return ctx
}
