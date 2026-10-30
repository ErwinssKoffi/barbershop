import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  WorkspaceFocusContext,
  type FocusActionKind,
  type WorkspaceFocusTarget,
} from './workspaceFocusContext'

export function WorkspaceFocusProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [focusTarget, setFocusTarget] = useState<WorkspaceFocusTarget | null>(
    null,
  )

  const navigateToEntity = useCallback(
    (params: {
      route: string
      entityId?: string
      searchQuery?: string
      action?: FocusActionKind
    }) => {
      setFocusTarget({
        route: params.route,
        entityId: params.entityId,
        searchQuery: params.searchQuery,
        action: params.action ?? 'detail',
        timestamp: Date.now(),
      })
      navigate(params.route)
    },
    [navigate],
  )

  const clearFocusTarget = useCallback(() => {
    setFocusTarget(null)
  }, [])

  const value = useMemo(
    () => ({
      focusTarget,
      navigateToEntity,
      clearFocusTarget,
    }),
    [focusTarget, navigateToEntity, clearFocusTarget],
  )

  return (
    <WorkspaceFocusContext.Provider value={value}>
      {children}
    </WorkspaceFocusContext.Provider>
  )
}
