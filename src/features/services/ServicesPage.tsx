import {
  Clock,
  Download,
  Plus,
  Power,
  Printer,
  Receipt,
  Scissors,
  Search,
  SettingsIcon,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { KpiCard } from '@/components/ui/KpiCard'
import { Modal } from '@/components/ui/Modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useQuickAction } from '../../contexts/quickActionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import type { ServiceCatalogItem } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import { formatDateFR, formatFCFA, todayISO } from '../../utils/format'

export function ServicesPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const { openCheckoutTicket } = useQuickAction()
  const { focusTarget, clearFocusTarget } = useWorkspaceFocus()
  const toast = useToast()

  const [catFilter, setCatFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all')
  const [localSearch, setLocalSearch] = useState<string | null>(null)
  const [today] = useState<string>(() => todayISO())

  const isRouteFocused = focusTarget?.route === '/services'
  const search =
    localSearch !== null
      ? localSearch
      : isRouteFocused
        ? (focusTarget.searchQuery ?? '')
        : ''

  const serviceCategories = useMemo(
    () => state.categories.filter((c) => c.scope === 'service' && !c.isArchived),
    [state.categories],
  )

  const serviceUsageStats = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>()
    const usedEver = new Set<string>()
    for (const r of state.revenues) {
      if (r.serviceId) {
        usedEver.add(r.serviceId)
        if (!r.isArchived) {
          const cur = map.get(r.serviceId) ?? { count: 0, revenue: 0 }
          cur.count += 1
          cur.revenue += r.amount
          map.set(r.serviceId, cur)
        }
      }
    }
    return { map, usedEver }
  }, [state.revenues])

  const kpiStats = useMemo(() => {
    const active = state.services.filter((s) => s.isActive)
    const avgPrice =
      active.length > 0
        ? Math.round(
            active.reduce((sum, s) => sum + s.referencePrice, 0) / active.length,
          )
        : 0

    let topName = 'Aucune vente liée'
    let topRev = 0
    for (const s of state.services) {
      const st = serviceUsageStats.map.get(s.id)
      if (st && st.revenue > topRev) {
        topRev = st.revenue
        topName = `${s.name} (${st.count})`
      }
    }

    return {
      activeCount: active.length,
      totalCount: state.services.length,
      avgPrice,
      topName,
      topRev,
    }
  }, [state.services, serviceUsageStats.map])

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.services
      .filter((s) => catFilter === 'all' || s.categoryCode === catFilter)
      .filter((s) =>
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? s.isActive
            : !s.isActive,
      )
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.services, catFilter, statusFilter, search])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceCatalogItem | null>(null)
  const [name, setName] = useState('')
  const [categoryCode, setCategoryCode] = useState('tresses_nattes')
  const [referencePrice, setReferencePrice] = useState('')
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setName('')
    setCategoryCode(serviceCategories[0]?.code ?? 'autre_prestation')
    setReferencePrice('')
    setDuration('')
    setDescription('')
    setFormOpen(true)
  }

  const openEdit = (srv: ServiceCatalogItem) => {
    setEditing(srv)
    setName(srv.name)
    setCategoryCode(srv.categoryCode)
    setReferencePrice(String(srv.referencePrice))
    setDuration(srv.durationMinutes ? String(srv.durationMinutes) : '')
    setDescription(srv.description)
    setFormOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.saveService({
          id: editing?.id,
          name,
          categoryCode,
          referencePrice: Number(referencePrice),
          durationMinutes: duration.trim() ? Number(duration) : undefined,
          description,
        }),
      )
      toast.success(
        editing
          ? 'Prestation mise à jour.'
          : 'Prestation ajoutée au catalogue.',
      )
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur prestation.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleActive = async (srv: ServiceCatalogItem) => {
    try {
      await mutate((repo) => repo.toggleServiceStatus(srv.id))
      toast.success(
        srv.isActive
          ? `Prestation « ${srv.name} » désactivée (historique financier conservé).`
          : `Prestation « ${srv.name} » réactivée.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action refusée.')
    }
  }

  const handleDeleteUnused = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await mutate((repo) => repo.deleteServiceIfUnused(deleteTarget.id))
      setDeleteTarget(null)
      toast.success('Prestation non utilisée supprimée du catalogue.')
    } catch (err) {
      setDeleteTarget(null)
      toast.error(err instanceof Error ? err.message : 'Suppression refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `catalogue-prestations-${today}.csv`,
      [
        'Prestation',
        'Catégorie',
        'Durée (min)',
        'Tarif standard FCFA',
        'Statut',
        'Réalisations',
        'CA généré FCFA',
      ],
      filteredServices.map((s) => {
        const st = serviceUsageStats.map.get(s.id) ?? { count: 0, revenue: 0 }
        return [
          s.name,
          categoryLabel('service', s.categoryCode),
          s.durationMinutes ?? '',
          s.referencePrice,
          s.isActive ? 'Actif' : 'Inactif',
          st.count,
          st.revenue,
        ]
      }),
    )
    toast.success('Catalogue tarifaire exporté en CSV.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        className="print-only"
        style={{
          borderBottom: '2px solid #111827',
          paddingBottom: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
          {state.salon.name} — GRILLE TARIFAIRE DES PRESTATIONS
        </div>
        <div style={{ fontSize: '0.8rem', color: '#4b5563' }}>
          {state.salon.address} · Tél : {state.salon.phone} · Éditée le{' '}
          {formatDateFR(today, 'long-fr')}
        </div>
      </div>

      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Prestations et tarifs</h1>
          <p className="page-subtitle">
            Catalogue tarifaire du salon et encaissement direct en 1 clic
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button type="button" variant="outline" onClick={handleExportCSV}>
            <Download size={15} />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer size={15} />
            Grille A4
          </Button>
          <Button type="button" onClick={openCreate}>
            <Plus size={15} />
            Nouvelle prestation
          </Button>
        </div>
      </div>

      <section className="kpi-grid-3 no-print">
        <KpiCard
          label="Prestations actives"
          value={String(kpiStats.activeCount)}
          icon={<Scissors size={18} />}
          tone="emerald"
          subtitle={`Sur ${kpiStats.totalCount} au catalogue`}
        />
        <KpiCard
          label="Tarif moyen actif"
          value={formatFCFA(kpiStats.avgPrice)}
          icon={<Clock size={18} />}
          tone="blue"
          subtitle="Moyenne catalogue"
        />
        <KpiCard
          label="Prestation phare"
          value={kpiStats.topRev > 0 ? formatFCFA(kpiStats.topRev) : '—'}
          icon={<TrendingUp size={18} />}
          tone="amber"
          subtitle={kpiStats.topName}
        />
      </section>

      <div
        className="surface-card no-print"
        style={{
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 14,
          alignItems: 'end',
        }}
      >
        <Field>
          <FieldLabel htmlFor="srv-cat">Catégorie</FieldLabel>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger id="srv-cat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {serviceCategories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="srv-status">Statut</FieldLabel>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as 'all' | 'active' | 'inactive')
            }
          >
            <SelectTrigger id="srv-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="active">Actives uniquement</SelectItem>
              <SelectItem value="inactive">Inactives uniquement</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="srv-search">Rechercher une prestation</FieldLabel>
          <div style={{ position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <Input
              id="srv-search"
              type="search"
              style={{ paddingLeft: 34 }}
              placeholder="Tresses, Coupe, Brushing, Soin..."
              value={search}
              onChange={(e) => {
                if (isRouteFocused) clearFocusTarget()
                setLocalSearch(e.target.value)
              }}
            />
          </div>
        </Field>
      </div>

      <Card>
        <CardContent style={{ paddingTop: 6 }}>
          {filteredServices.length === 0 ? (
            <EmptyState
              icon={<Scissors size={24} />}
              title="Aucune prestation au catalogue"
              description="Ajoutez vos prestations habituelles (Tresses, Coupe, Brushing, Soins...) avec leur tarif de référence en FCFA."
              actionLabel="Créer une prestation"
              onAction={openCreate}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prestation</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Tarif standard</TableHead>
                  <TableHead className="no-print">Statut</TableHead>
                  <TableHead className="text-right no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredServices.map((srv) => {
                  const isUsed = serviceUsageStats.usedEver.has(srv.id)
                  const stats = serviceUsageStats.map.get(srv.id) ?? {
                    count: 0,
                    revenue: 0,
                  }

                  const metaParts: string[] = []
                  if (srv.durationMinutes) {
                    metaParts.push(`${srv.durationMinutes} min`)
                  }
                  if (stats.count > 0) {
                    metaParts.push(
                      `${stats.count} réal. · ${formatFCFA(stats.revenue)}`,
                    )
                  }
                  if (srv.description) {
                    metaParts.push(srv.description)
                  }

                  return (
                    <TableRow
                      key={srv.id}
                      style={{ opacity: srv.isActive ? 1 : 0.64 }}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {srv.name}
                          </span>
                          {metaParts.length > 0 && (
                            <span className="text-muted-foreground text-xs">
                              {metaParts.join(' · ')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" size="sm">
                          {categoryLabel('service', srv.categoryCode)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums">
                        {formatFCFA(srv.referencePrice)}
                      </TableCell>
                      <TableCell className="no-print">
                        <Badge
                          variant={
                            srv.isActive ? 'success-light' : 'destructive-light'
                          }
                          size="sm"
                        >
                          {srv.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right no-print">
                        <div className="inline-flex items-center justify-end gap-1">
                          {srv.isActive && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7"
                              title="Encaisser cette prestation sur un Ticket client"
                              onClick={() =>
                                openCheckoutTicket({ serviceId: srv.id })
                              }
                            >
                              <Receipt className="size-3.5" aria-hidden="true" />
                              Encaisser
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            title="Modifier"
                            onClick={() => openEdit(srv)}
                          >
                            <SettingsIcon
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            Gérer
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title={
                              srv.isActive
                                ? 'Désactiver cette prestation'
                                : 'Réactiver cette prestation'
                            }
                            onClick={() => void handleToggleActive(srv)}
                          >
                            <Power size={14} />
                          </Button>
                          {!isUsed && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              style={{ color: 'var(--color-danger)' }}
                              title="Supprimer (non utilisée dans l'historique)"
                              onClick={() => setDeleteTarget(srv)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={
          editing ? 'Modifier la prestation' : 'Nouvelle prestation au catalogue'
        }
        subtitle="Une prestation utilisée dans les recettes est toujours préservée via la désactivation."
        onClose={() => setFormOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="f-srv-name">Nom de la prestation</FieldLabel>
              <Input
                id="f-srv-name"
                type="text"
                required
                placeholder="Ex. Tresses sans nœuds, Coupe dégradé, Pose de perruque..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-srv-cat">Catégorie</FieldLabel>
                <Select value={categoryCode} onValueChange={setCategoryCode}>
                  <SelectTrigger id="f-srv-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceCategories.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="f-srv-price">
                  Tarif standard (FCFA)
                </FieldLabel>
                <Input
                  id="f-srv-price"
                  type="number"
                  min={1}
                  step={1}
                  required
                  placeholder="Ex. 10000"
                  value={referencePrice}
                  onChange={(e) => setReferencePrice(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-srv-dur">
                  Durée indicative (min)
                </FieldLabel>
                <Input
                  id="f-srv-dur"
                  type="number"
                  min={5}
                  step={5}
                  placeholder="Ex. 60"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-srv-desc">
                  Description courte (optionnel)
                </FieldLabel>
                <Input
                  id="f-srv-desc"
                  type="text"
                  placeholder="Ex. Shampoing et finition inclus"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {editing ? 'Enregistrer' : 'Ajouter au catalogue'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette prestation ?"
        message={
          deleteTarget
            ? `La prestation « ${deleteTarget.name} » n'est rattachée à aucune recette et sera retirée du catalogue.`
            : ''
        }
        confirmLabel="Supprimer"
        busy={busy}
        onConfirm={() => void handleDeleteUnused()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
