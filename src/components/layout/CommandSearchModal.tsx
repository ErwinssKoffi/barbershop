import { motion } from 'framer-motion'
import {
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  LayoutDashboard,
  Package,
  Receipt,
  Scissors,
  Search,
  Unlock,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  modalDialog3DVariants,
  MOTION_DURATION,
  MOTION_EASE,
} from '@/lib/motion'
import { useCashSession } from '../../contexts/cashSessionContext'
import { useQuickAction } from '../../contexts/quickActionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { formatDateFR, formatFCFA } from '../../utils/format'

interface SearchResultItem {
  id: string
  group: string
  title: string
  subtitle: string
  route: string
  kind:
    | 'action'
    | 'nav'
    | 'service'
    | 'employee'
    | 'product'
    | 'revenue'
    | 'expense'
  entityId?: string
  searchQuery?: string
  quickAction?: 'ticket' | 'expense' | 'open_cash'
}

const STATIC_NAV_RESULTS: SearchResultItem[] = [
  {
    id: 'nav-dashboard',
    group: 'Rubriques',
    title: 'Tableau de bord',
    subtitle: 'KPI, graphiques et alertes financières',
    route: '/dashboard',
    kind: 'nav',
  },
  {
    id: 'nav-cash',
    group: 'Rubriques',
    title: 'Caisse espèces',
    subtitle: 'Ouverture, billetage FCFA, mouvements espèces et clôture',
    route: '/cash',
    kind: 'nav',
  },
  {
    id: 'nav-revenue',
    group: 'Rubriques',
    title: 'Recettes',
    subtitle: 'Tickets clients, prestations encaissées et ventes produits',
    route: '/revenue',
    kind: 'nav',
  },
  {
    id: 'nav-expenses',
    group: 'Rubriques',
    title: 'Dépenses',
    subtitle: 'Charges fixes récurrentes, fournisseurs et justificatifs',
    route: '/expenses',
    kind: 'nav',
  },
  {
    id: 'nav-services',
    group: 'Rubriques',
    title: 'Prestations et tarifs',
    subtitle: 'Catalogue tarifaire coiffure, tresses et soins',
    route: '/services',
    kind: 'nav',
  },
  {
    id: 'nav-employees',
    group: 'Rubriques',
    title: 'Personnel',
    subtitle: 'Fiches salariés, performances et contrats de rémunération',
    route: '/employees',
    kind: 'nav',
  },
  {
    id: 'nav-payroll',
    group: 'Rubriques',
    title: 'Salaires et commissions',
    subtitle: 'Avances, primes, paie mensuelle et bulletins signés',
    route: '/payroll',
    kind: 'nav',
  },
  {
    id: 'nav-inventory',
    group: 'Rubriques',
    title: 'Inventaire',
    subtitle: 'Produits consommables, revente, CUMP et alertes stock',
    route: '/inventory',
    kind: 'nav',
  },
  {
    id: 'nav-reports',
    group: 'Rubriques',
    title: 'Rapports et états financiers',
    subtitle: '8 états comptables A4, rapprochement Wave/OM, audit et CSV',
    route: '/reports',
    kind: 'nav',
  },
  {
    id: 'nav-budget',
    group: 'Rubriques',
    title: 'Budget et objectifs',
    subtitle: 'Objectif de CA, plafonds et projection fin de mois',
    route: '/budget',
    kind: 'nav',
  },
  {
    id: 'nav-settings',
    group: 'Rubriques',
    title: 'Paramètres & Sauvegarde',
    subtitle: 'Infos du salon, reçu client 80mm/A5, catégories et JSON',
    route: '/settings',
    kind: 'nav',
  },
]

export function CommandSearchModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { state, categoryLabel } = useSalonStore()
  const { openSession, openQuickCashModal } = useCashSession()
  const { openCheckoutTicket, openQuickExpense } = useQuickAction()
  const { navigateToEntity } = useWorkspaceFocus()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 30)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const quickActions = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [
      {
        id: 'act-ticket',
        group: 'Action rapide',
        title: 'Nouveau Ticket client (encaisser)',
        subtitle: 'Prestations + produits, paiement simple ou mixte & reçu',
        route: '/revenue',
        kind: 'action',
        quickAction: 'ticket',
      },
      {
        id: 'act-expense',
        group: 'Action rapide',
        title: 'Enregistrer une dépense rapide',
        subtitle: 'Saisir une facture ou sortie sans quitter votre écran',
        route: '/expenses',
        kind: 'action',
        quickAction: 'expense',
      },
    ]
    if (!openSession) {
      items.push({
        id: 'act-open-cash',
        group: 'Action rapide',
        title: 'Ouvrir la session de caisse espèces',
        subtitle: 'Définir le fond de roulement du jour en 1 clic',
        route: '/cash',
        kind: 'action',
        quickAction: 'open_cash',
      })
    }
    return items
  }, [openSession])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return [...quickActions, ...STATIC_NAV_RESULTS.slice(0, 7)]
    }

    const matched: SearchResultItem[] = []

    for (const act of quickActions) {
      if (
        act.title.toLowerCase().includes(q) ||
        act.subtitle.toLowerCase().includes(q)
      ) {
        matched.push(act)
      }
    }

    for (const nav of STATIC_NAV_RESULTS) {
      if (
        nav.title.toLowerCase().includes(q) ||
        nav.subtitle.toLowerCase().includes(q)
      ) {
        matched.push(nav)
      }
    }

    for (const srv of state.services) {
      if (
        srv.name.toLowerCase().includes(q) ||
        srv.description.toLowerCase().includes(q)
      ) {
        matched.push({
          id: `srv-${srv.id}`,
          group: 'Prestations',
          title: srv.name,
          subtitle: `${formatFCFA(srv.referencePrice)} · ${srv.isActive ? 'Actif' : 'Inactif'}`,
          route: '/services',
          kind: 'service',
          entityId: srv.id,
          searchQuery: srv.name,
        })
      }
    }

    for (const emp of state.employees) {
      if (
        emp.fullName.toLowerCase().includes(q) ||
        emp.roleTitle.toLowerCase().includes(q)
      ) {
        matched.push({
          id: `emp-${emp.id}`,
          group: 'Personnel',
          title: emp.fullName,
          subtitle: `${emp.roleTitle} · Base ${formatFCFA(emp.baseSalary)}`,
          route: '/employees',
          kind: 'employee',
          entityId: emp.id,
          searchQuery: emp.fullName,
        })
      }
    }

    for (const prod of state.products) {
      if (
        prod.name.toLowerCase().includes(q) ||
        prod.sku.toLowerCase().includes(q)
      ) {
        matched.push({
          id: `prd-${prod.id}`,
          group: 'Inventaire',
          title: `${prod.name} (${prod.sku})`,
          subtitle: `Stock : ${prod.quantity} ${prod.unit} · CUMP ${formatFCFA(prod.costPrice)}`,
          route: '/inventory',
          kind: 'product',
          entityId: prod.id,
          searchQuery: prod.name,
        })
      }
    }

    for (const rev of state.revenues) {
      if (
        !rev.isArchived &&
        (rev.label.toLowerCase().includes(q) ||
          (rev.receiptNumber ?? '').toLowerCase().includes(q) ||
          (rev.clientName ?? '').toLowerCase().includes(q))
      ) {
        matched.push({
          id: `rev-${rev.id}`,
          group: 'Recettes',
          title: rev.receiptNumber
            ? `${rev.label} (${rev.receiptNumber})`
            : rev.label,
          subtitle: `${formatDateFR(rev.date)} · +${formatFCFA(rev.amount)} (${categoryLabel('payment_method', rev.paymentMethod)})`,
          route: '/revenue',
          kind: 'revenue',
          entityId: rev.id,
          searchQuery: rev.receiptNumber ?? rev.label,
        })
      }
    }

    for (const exp of state.expenses) {
      if (
        !exp.isArchived &&
        (exp.label.toLowerCase().includes(q) ||
          (exp.beneficiary ?? '').toLowerCase().includes(q) ||
          (exp.receiptRef ?? '').toLowerCase().includes(q))
      ) {
        matched.push({
          id: `exp-${exp.id}`,
          group: 'Dépenses',
          title: exp.label,
          subtitle: `${formatDateFR(exp.date)} · -${formatFCFA(exp.amount)}${exp.beneficiary ? ` · ${exp.beneficiary}` : ''}`,
          route: '/expenses',
          kind: 'expense',
          entityId: exp.id,
          searchQuery: exp.label,
        })
      }
    }

    return matched.slice(0, 14)
  }, [
    query,
    quickActions,
    state.services,
    state.employees,
    state.products,
    state.revenues,
    state.expenses,
    categoryLabel,
  ])

  if (!open) return null

  const handleSelect = (item: SearchResultItem) => {
    setQuery('')
    onClose()
    if (item.quickAction === 'ticket') {
      openCheckoutTicket()
      return
    }
    if (item.quickAction === 'expense') {
      openQuickExpense()
      return
    }
    if (item.quickAction === 'open_cash') {
      openQuickCashModal()
      return
    }
    if (item.entityId || item.searchQuery) {
      navigateToEntity({
        route: item.route,
        entityId: item.entityId,
        searchQuery: item.searchQuery,
      })
      return
    }
    navigate(item.route)
  }

  const renderIcon = (item: SearchResultItem) => {
    if (item.quickAction === 'ticket') {
      return <Receipt size={15} color="var(--color-success)" />
    }
    if (item.quickAction === 'expense') {
      return <ArrowDownCircle size={15} color="var(--color-danger)" />
    }
    if (item.quickAction === 'open_cash') {
      return <Unlock size={15} color="var(--accent-emerald)" />
    }
    switch (item.kind) {
      case 'service':
        return <Scissors size={15} />
      case 'employee':
        return <Users size={15} />
      case 'product':
        return <Package size={15} />
      case 'revenue':
        return <ArrowUpCircle size={15} color="var(--color-success)" />
      case 'expense':
        return <ArrowDownCircle size={15} color="var(--color-danger)" />
      default:
        return <LayoutDashboard size={15} />
    }
  }

  return (
    <motion.div
      className="modal-backdrop no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Recherche globale SALON PRO"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE }}
      onClick={onClose}
    >
      <motion.div
        className="modal-dialog"
        variants={modalDialog3DVariants}
        initial="initial"
        animate="animate"
        style={{
          maxWidth: 580,
          padding: 0,
          overflow: 'hidden',
          transformPerspective: 1100,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Search size={17} color="var(--text-muted)" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une rubrique, N° reçu, recette, dépense, prestation, salarié, produit..."
            aria-label="Champ de recherche rapide"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
            }}
          />
          <button
            type="button"
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={onClose}
            aria-label="Fermer la recherche"
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            maxHeight: 390,
            overflowY: 'auto',
            padding: '10px 10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: '26px 14px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
              }}
            >
              Aucun résultat trouvé pour « {query} ».
            </div>
          ) : (
            results.map((item) => (
              <motion.button
                key={item.id}
                type="button"
                whileHover={{ x: 4, scale: 1.006 }}
                whileTap={{ scale: 0.99 }}
                transition={{
                  duration: MOTION_DURATION.instant,
                  ease: MOTION_EASE,
                }}
                onClick={() => handleSelect(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 11px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-surface-muted)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background:
                      item.kind === 'action'
                        ? 'var(--accent-emerald-soft)'
                        : 'var(--bg-surface-muted)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {renderIcon(item)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontWeight: 600,
                      fontSize: '0.85rem',
                    }}
                  >
                    <span>{item.title}</span>
                    <span
                      style={{
                        fontSize: '0.66rem',
                        padding: '1px 6px',
                        borderRadius: 999,
                        background:
                          item.kind === 'action'
                            ? 'var(--accent-emerald-soft)'
                            : 'var(--bg-surface-muted)',
                        color:
                          item.kind === 'action'
                            ? 'var(--accent-cta)'
                            : 'var(--text-muted)',
                        fontWeight: 600,
                      }}
                    >
                      {item.group}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.subtitle}
                  </div>
                </div>
                <ArrowRight size={14} color="var(--text-muted)" />
              </motion.button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
