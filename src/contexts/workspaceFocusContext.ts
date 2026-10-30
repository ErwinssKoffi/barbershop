import { createContext, useContext } from 'react'

export type FocusActionKind = 'detail' | 'edit' | 'restock' | 'highlight'

export interface WorkspaceFocusTarget {
  route: string
  entityId?: string
  searchQuery?: string
  action?: FocusActionKind
  timestamp: number
}

export interface WorkspaceFocusContextValue {
  focusTarget: WorkspaceFocusTarget | null
  navigateToEntity: (params: {
    route: string
    entityId?: string
    searchQuery?: string
    action?: FocusActionKind
  }) => void
  clearFocusTarget: () => void
}

const fallbackFocusContext: WorkspaceFocusContextValue = {
  focusTarget: null,
  navigateToEntity: () => {},
  clearFocusTarget: () => {},
}

export const WorkspaceFocusContext =
  createContext<WorkspaceFocusContextValue>(fallbackFocusContext)

export function useWorkspaceFocus(): WorkspaceFocusContextValue {
  return useContext(WorkspaceFocusContext)
}
