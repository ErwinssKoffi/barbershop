import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import {
  salonRepo,
  type FullSalonState,
  type SalonRepositoryHub,
} from '../db/repositories/salonRepositories'
import {
  buildDefaultSalonInfo,
  buildDefaultSettings,
  buildSystemCategories,
} from '../db/seed'
import { openAccountWorkspace, workspaceKey } from '../db/accountWorkspace'
import type { CategoryScope, PublicSalonUser } from '../domain/models'
import { SalonStoreContext } from './salonStoreContext'

function createInitialPlaceholderState(): FullSalonState {
  return {
    salon: buildDefaultSalonInfo(),
    settings: buildDefaultSettings(),
    categories: buildSystemCategories(),
    services: [],
    employees: [],
    revenues: [],
    expenses: [],
    cashSessions: [],
    cashMovements: [],
    advances: [],
    bonuses: [],
    salaryPayments: [],
    products: [],
    stockMovements: [],
    budgets: [],
    recurringExpenses: [],
    correctionLogs: [],
  }
}

export function SalonStoreProvider({
  children,
  repository = salonRepo,
}: {
  children: ReactNode
  repository?: SalonRepositoryHub
}) {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [state, setState] = useState<FullSalonState>(
    createInitialPlaceholderState,
  )
  const [ready, setReady] = useState(false)
  const [mutationCount, setMutationCount] = useState(0)

  const [activeRepository, setActiveRepository] = useState<SalonRepositoryHub | null>(repository === salonRepo ? null : repository)
  const activeRef = useRef(activeRepository)
  const generation = useRef(0)
  const opened = useRef(new Map<string, Promise<SalonRepositoryHub>>())
  const identityWithRepo = useCallback(async <R,>(fn: (repo: SalonRepositoryHub) => Promise<R>): Promise<R> => fn(repository), [repository])
  const activateWorkspace = useCallback(async (user: PublicSalonUser | null) => {
    const request = ++generation.current
    activeRef.current = null
    setReady(false)
    setState(createInitialPlaceholderState())
    setMutationCount(0)
    setActiveRepository(null)
    if (!user) return
    const key = workspaceKey(user)
    let pending = opened.current.get(key)
    if (!pending) {
      pending = openAccountWorkspace(repository.database, user)
      opened.current.set(key, pending)
      void pending.catch(() => { opened.current.delete(key) })
    }
    const nextRepo = await pending
    const next = await nextRepo.readFullState()
    if (mounted.current && generation.current === request) {
      activeRef.current = nextRepo
      setActiveRepository(nextRepo)
      setState(next)
      setReady(true)
    }
  }, [repository])
  const refresh = useCallback(async () => {
    if (!activeRepository || activeRepository !== activeRef.current) throw new Error('Espace local déconnecté.')
    const next = await activeRepository.readFullState()
    if (mounted.current && activeRef.current === activeRepository) { setState(next); setReady(true) }
  }, [activeRepository])

  useEffect(() => {
    if (activeRepository && activeRepository === activeRef.current) void refresh().catch(() => { /* A superseded workspace must not populate the new view. */ })
  }, [activeRepository, refresh])

  // Appliquer le thème d'interface non sensible sur documentElement + localStorage
  useEffect(() => {
    const theme = state.settings.theme
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('salon_pro_ui_theme', theme)
    } catch {
      // ignore
    }
  }, [state.settings.theme])

  const mutate = useCallback(
    async <R,>(fn: (repo: SalonRepositoryHub) => Promise<R>): Promise<R> => {
      if (!activeRepository || activeRepository !== activeRef.current) throw new Error('Espace local déconnecté.')
      const result = await fn(activeRepository)
      const next = await activeRepository.readFullState()
      if (mounted.current && activeRef.current === activeRepository) {
        setState(next)
        setMutationCount((c) => c + 1)
      }
      return result
    },
    [activeRepository],
  )

  const syncWithRepo = useCallback(
    async <R,>(fn: (repo: SalonRepositoryHub) => Promise<R>): Promise<R> => {
      if (!activeRepository || activeRepository !== activeRef.current) throw new Error('Espace local déconnecté.')
      const result = await fn(activeRepository)
      const next = await activeRepository.readFullState()
      if (mounted.current && activeRef.current === activeRepository) setState(next)
      return result
    },
    [activeRepository],
  )

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of state.categories) {
      map.set(`${c.scope}:${c.code}`, c.label)
    }
    return map
  }, [state.categories])

  const categoryLabel = useCallback(
    (scope: CategoryScope, code: string) =>
      categoryMap.get(`${scope}:${code}`) ?? code,
    [categoryMap],
  )

  const value = useMemo(
    () => ({
      identityWithRepo,
      activateWorkspace,
      state,
      ready,
      mutationCount,
      categoryLabel,
      refresh,
      mutate,
      syncWithRepo,
    }),
    [identityWithRepo, activateWorkspace, state, ready, mutationCount, categoryLabel, refresh, mutate, syncWithRepo],
  )

  return (
    <SalonStoreContext.Provider value={value}>
      {children}
    </SalonStoreContext.Provider>
  )
}
