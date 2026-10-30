import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Download,
  Edit3,
  History,
  Package,
  Plus,
  Receipt,
  Search,
  Unlock,
  X,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
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
import { useCashSession } from '../../contexts/cashSessionContext'
import { useQuickAction } from '../../contexts/quickActionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import {
  calculateCUMP,
  calculateInventoryValuation,
} from '../../domain/calculations/finance'
import type {
  ProductItem,
  ProductUsageType,
  StockMovementType,
} from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import { formatDateFR, formatFCFA, todayISO } from '../../utils/format'

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  purchase: 'Entrée / Achat fournisseur',
  use: 'Sortie pour prestation (consommation)',
  sale: 'Vente produit client',
  loss: 'Perte ou casse',
  adjustment: "Ajustement d'inventaire (+/-)",
}

export function InventoryPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const { openSession, openQuickCashModal } = useCashSession()
  const { openCheckoutTicket } = useQuickAction()
  const { focusTarget, clearFocusTarget } = useWorkspaceFocus()
  const toast = useToast()

  const [alertOnly, setAlertOnly] = useState(false)
  const [catFilter, setCatFilter] = useState('all')
  const [usageFilter, setUsageFilter] = useState<'all' | ProductUsageType>('all')
  const [localSearch, setLocalSearch] = useState<string | null>(null)
  const [historyProduct, setHistoryProduct] = useState<ProductItem | null>(null)

  const isRouteFocused = focusTarget?.route === '/inventory'
  const search =
    localSearch !== null
      ? localSearch
      : isRouteFocused
        ? (focusTarget.searchQuery ?? '')
        : ''

  const productCategories = useMemo(
    () => state.categories.filter((c) => c.scope === 'product' && !c.isArchived),
    [state.categories],
  )
  const paymentMethods = useMemo(
    () =>
      state.categories.filter(
        (c) => c.scope === 'payment_method' && !c.isArchived,
      ),
    [state.categories],
  )

  const valuation = useMemo(
    () => calculateInventoryValuation(state.products),
    [state.products],
  )
  const outOfStockCount = useMemo(
    () => state.products.filter((p) => p.isActive && p.quantity === 0).length,
    [state.products],
  )

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.products
      .filter((p) => (alertOnly ? p.quantity <= p.alertThreshold : true))
      .filter((p) => catFilter === 'all' || p.categoryCode === catFilter)
      .filter((p) => usageFilter === 'all' || p.usageType === usageFilter)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.products, alertOnly, catFilter, usageFilter, search])

  const recentMovements = useMemo(
    () =>
      [...state.stockMovements]
        .sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) ||
            b.createdAt.localeCompare(a.createdAt),
        )
        .slice(0, 8),
    [state.stockMovements],
  )

  // Modale Produit
  const [prodOpen, setProdOpen] = useState(false)
  const [editing, setEditing] = useState<ProductItem | null>(null)
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [categoryCode, setCategoryCode] = useState('shampoo_cond')
  const [usageType, setUsageType] = useState<ProductUsageType>('consumable')
  const [initialQuantity, setInitialQuantity] = useState('0')
  const [unit, setUnit] = useState('bouteille')
  const [costPrice, setCostPrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [alertThreshold, setAlertThreshold] = useState('3')

  // Modale Mouvement de stock
  const [movOpen, setMovOpen] = useState(false)
  const [movProdId, setMovProdId] = useState('')
  const [movType, setMovType] = useState<StockMovementType>('purchase')
  const [movDate, setMovDate] = useState<string>(() => todayISO())
  const [movQty, setMovQty] = useState('1')
  const [movUnitCost, setMovUnitCost] = useState('')
  const [movSalePrice, setMovSalePrice] = useState('')
  const [movReason, setMovReason] = useState('')
  const [movPayMethod, setMovPayMethod] = useState('cash')
  const [movSupplier, setMovSupplier] = useState('')
  const [movRecordFin, setMovRecordFin] = useState(true)
  const [busy, setBusy] = useState(false)

  const openCreateProduct = () => {
    setEditing(null)
    setSku(`PRD-${String(state.products.length + 1).padStart(3, '0')}`)
    setName('')
    setCategoryCode(productCategories[0]?.code ?? 'shampoo_cond')
    setUsageType('consumable')
    setInitialQuantity('0')
    setUnit('pièce')
    setCostPrice('')
    setSalePrice('')
    setAlertThreshold('3')
    setProdOpen(true)
  }

  const openEditProduct = (p: ProductItem) => {
    setEditing(p)
    setSku(p.sku)
    setName(p.name)
    setCategoryCode(p.categoryCode)
    setUsageType(p.usageType)
    setInitialQuantity(String(p.quantity))
    setUnit(p.unit)
    setCostPrice(String(p.costPrice))
    setSalePrice(p.salePrice !== undefined ? String(p.salePrice) : '')
    setAlertThreshold(String(p.alertThreshold))
    setProdOpen(true)
  }

  const openMovementDialog = (p?: ProductItem) => {
    const target = p ?? state.products[0]
    if (!target) return
    setMovProdId(target.id)
    setMovType('purchase')
    setMovDate(todayISO())
    setMovQty('1')
    setMovUnitCost(String(target.costPrice))
    setMovSalePrice(
      target.salePrice !== undefined ? String(target.salePrice) : '',
    )
    setMovReason('')
    setMovPayMethod('cash')
    setMovSupplier('')
    setMovRecordFin(true)
    setMovOpen(true)
  }

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.saveProduct({
          id: editing?.id,
          sku,
          name,
          categoryCode,
          usageType,
          initialQuantity: Number(initialQuantity),
          unit,
          costPrice: Number(costPrice),
          salePrice: salePrice.trim() ? Number(salePrice) : undefined,
          alertThreshold: Number(alertThreshold),
        }),
      )
      toast.success(
        editing ? 'Fiche produit mise à jour.' : 'Produit ajouté à l’inventaire.',
      )
      setProdOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur produit.')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveMovement = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.recordStockMovement({
          productId: movProdId,
          occurredAt: `${movDate}T12:00:00.000Z`,
          type: movType,
          quantity: Number(movQty),
          unitCost: Number(movUnitCost || 0),
          unitSalePrice: movSalePrice.trim() ? Number(movSalePrice) : undefined,
          reason: movReason.trim() || MOVEMENT_LABELS[movType],
          paymentMethod: movPayMethod,
          supplierName: movSupplier,
          recordFinancialEntry: movRecordFin,
        }),
      )
      setMovOpen(false)
      toast.success('Mouvement de stock enregistré.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mouvement refusé.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `inventaire-${todayISO()}.csv`,
      [
        'Référence',
        'Produit',
        'Catégorie',
        'Usage',
        'Quantité disponible',
        'Unité',
        'Prix achat unitaire FCFA',
        'Prix vente FCFA',
        'Seuil alerte',
        'Valeur stock FCFA',
      ],
      filteredProducts.map((p) => [
        p.sku,
        p.name,
        categoryLabel('product', p.categoryCode),
        p.usageType,
        p.quantity,
        p.unit,
        p.costPrice,
        p.salePrice ?? '',
        p.alertThreshold,
        Math.round(p.quantity * p.costPrice),
      ]),
    )
    toast.success('Inventaire exporté en CSV.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventaire &amp; Stock</h1>
          <p className="page-subtitle">
            Consommables salon, produits de revente et valorisation CUMP
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredProducts.length === 0}
          >
            <Download size={15} />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => openMovementDialog()}
            disabled={state.products.length === 0}
          >
            <ArrowDownUp size={15} />
            Mouvement de stock
          </Button>
          <Button type="button" onClick={openCreateProduct}>
            <Plus size={15} />
            Nouveau produit
          </Button>
        </div>
      </div>

      {isRouteFocused && (
        <div
          style={{
            padding: '11px 16px',
            borderRadius: 10,
            background: 'var(--accent-emerald-soft)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: '0.82rem',
          }}
        >
          <span>
            {focusTarget?.action === 'restock'
              ? 'Approvisionnement fournisseur : sélectionnez un produit existant ou créez une référence pour mettre à jour le stock et le CUMP sans double comptage.'
              : `Focus inventaire : ${focusTarget?.searchQuery ?? 'Produit ciblé'}`}
          </span>
          <div className="flex items-center gap-2">
            {focusTarget?.action === 'restock' && state.products.length > 0 && (
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  clearFocusTarget()
                  openMovementDialog()
                }}
              >
                <ArrowDownUp size={13} />
                Saisir l&apos;achat de stock
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                clearFocusTarget()
                setLocalSearch('')
              }}
            >
              <X size={13} />
              Fermer
            </Button>
          </div>
        </div>
      )}

      <section className="kpi-grid">
        <KpiCard
          label="Valorisation totale du stock"
          value={formatFCFA(valuation.totalStockCostValue)}
          icon={<Package size={18} />}
          tone="emerald"
          subtitle="Quantité disponible × prix d'achat"
        />
        <KpiCard
          label="Références actives"
          value={String(valuation.totalItemsCount)}
          icon={<CheckCircle2 size={18} />}
          tone="blue"
          subtitle={`${valuation.totalUnitsCount} unités cumulées`}
        />
        <KpiCard
          label="Produits en alerte (≤ seuil)"
          value={String(valuation.lowStockProducts.length)}
          icon={<AlertTriangle size={18} />}
          tone={valuation.lowStockProducts.length > 0 ? 'amber' : 'emerald'}
          subtitle="À réapprovisionner bientôt"
        />
        <KpiCard
          label="Produits en rupture (0)"
          value={String(outOfStockCount)}
          icon={<AlertTriangle size={18} />}
          tone={outOfStockCount > 0 ? 'danger' : 'emerald'}
          subtitle="Stock épuisé"
        />
      </section>

      <div
        className="surface-card"
        style={{
          padding: '14px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <Field>
          <FieldLabel htmlFor="inv-cat">Catégorie produit</FieldLabel>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger id="inv-cat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {productCategories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="inv-usage">Usage</FieldLabel>
          <Select
            value={usageFilter}
            onValueChange={(v) =>
              setUsageFilter(v as 'all' | ProductUsageType)
            }
          >
            <SelectTrigger id="inv-usage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les usages</SelectItem>
              <SelectItem value="consumable">Consommables salon</SelectItem>
              <SelectItem value="resale">Revente client</SelectItem>
              <SelectItem value="both">Mixte (salon &amp; vente)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="inv-alert">Filtre d&apos;alerte</FieldLabel>
          <Select
            value={alertOnly ? 'alert' : 'all'}
            onValueChange={(v) => setAlertOnly(v === 'alert')}
          >
            <SelectTrigger id="inv-alert">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les produits</SelectItem>
              <SelectItem value="alert">
                En alerte ou rupture uniquement
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="inv-search">
            Rechercher un produit ou code
          </FieldLabel>
          <div style={{ position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <Input
              id="inv-search"
              type="search"
              style={{ paddingLeft: 32 }}
              placeholder="Shampoing, mèches, lames, SKU..."
              value={search}
              onChange={(e) => {
                if (isRouteFocused) clearFocusTarget()
                setLocalSearch(e.target.value)
              }}
            />
          </div>
        </Field>
      </div>

      <article className="surface-card">
        <div className="surface-card-body" style={{ paddingTop: 10 }}>
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon={<Package size={24} />}
              title="Aucun produit en inventaire"
              description="Ajoutez vos consommables (mèches, shampoings, lames, gants, désinfectants) et produits de revente avec leur seuil d'alerte."
              actionLabel="Ajouter un produit"
              onAction={openCreateProduct}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th style={{ textAlign: 'right' }}>Stock dispo</th>
                    <th style={{ textAlign: 'right' }}>CUMP achat</th>
                    <th style={{ textAlign: 'right' }}>Prix vente</th>
                    <th style={{ textAlign: 'right' }}>Valeur stock</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const isOut = p.quantity === 0
                    const isLow = p.quantity > 0 && p.quantity <= p.alertThreshold
                    const stockVal = Math.round(p.quantity * p.costPrice)
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {p.sku} · {categoryLabel('product', p.categoryCode)}
                          </div>
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              justifyContent: 'flex-end',
                              fontWeight: 700,
                            }}
                          >
                            <span>
                              {p.quantity} {p.unit}
                            </span>
                            {isOut && (
                              <span className="badge badge-red">Rupture</span>
                            )}
                            {isLow && (
                              <span className="badge badge-amber">
                                Bas (≤{p.alertThreshold})
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {formatFCFA(p.costPrice)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {p.salePrice !== undefined
                            ? formatFCFA(p.salePrice)
                            : '—'}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right', fontWeight: 700 }}
                        >
                          {formatFCFA(stockVal)}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              gap: 6,
                              justifyContent: 'flex-end',
                            }}
                          >
                            {p.usageType !== 'consumable' && p.quantity > 0 && (
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{ height: 28, padding: '0 8px' }}
                                title="Vendre ce produit sur un Ticket client"
                                onClick={() =>
                                  openCheckoutTicket({ productId: p.id })
                                }
                              >
                                <Receipt size={13} />
                                Vendre
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ height: 28, padding: '0 8px' }}
                              onClick={() => openMovementDialog(p)}
                            >
                              <ArrowDownUp size={13} />
                              Mouvement
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 28, height: 28 }}
                              title="Historique des mouvements de ce produit"
                              aria-label={`Historique ${p.name}`}
                              onClick={() => setHistoryProduct(p)}
                            >
                              <History size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 28, height: 28 }}
                              title="Modifier la fiche produit"
                              onClick={() => openEditProduct(p)}
                            >
                              <Edit3 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>

      {recentMovements.length > 0 && (
        <article className="surface-card">
          <div className="surface-card-header">
            <div>
              <h2 className="surface-card-title">
                Derniers mouvements de stock
              </h2>
              <div className="surface-card-subtitle">
                Traçabilité des achats, consommations salon, ventes, pertes et
                ajustements
              </div>
            </div>
          </div>
          <div className="surface-card-body" style={{ paddingTop: 6 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Produit</th>
                    <th>Nature</th>
                    <th style={{ textAlign: 'right' }}>Variation</th>
                    <th style={{ textAlign: 'right' }}>Stock après</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((mv) => {
                    const prod = state.products.find(
                      (p) => p.id === mv.productId,
                    )
                    return (
                      <tr key={mv.id}>
                        <td className="tabular-nums">
                          {formatDateFR(mv.occurredAt)}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {prod?.name ?? 'Produit'}
                        </td>
                        <td>{MOVEMENT_LABELS[mv.type]}</td>
                        <td
                          className="tabular-nums"
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color:
                              mv.quantityDelta >= 0
                                ? 'var(--color-success)'
                                : 'var(--color-danger)',
                          }}
                        >
                          {mv.quantityDelta >= 0 ? '+' : ''}
                          {mv.quantityDelta}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {mv.quantityAfter}
                        </td>
                        <td>{mv.reason}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      )}

      <Modal
        open={prodOpen}
        title={
          editing ? 'Modifier un produit' : 'Ajouter un produit à l’inventaire'
        }
        maxWidth={580}
        onClose={() => setProdOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSaveProduct(e)}>
          <FieldGroup>
            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-prd-sku">
                  Code ou référence (SKU)
                </FieldLabel>
                <Input
                  id="f-prd-sku"
                  type="text"
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-prd-cat">Catégorie</FieldLabel>
                <Select value={categoryCode} onValueChange={setCategoryCode}>
                  <SelectTrigger id="f-prd-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {productCategories.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="f-prd-name">Nom du produit</FieldLabel>
              <Input
                id="f-prd-name"
                type="text"
                required
                placeholder="Ex. Mèches X-Pression, Shampoing kératine, Lames rasoir..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-prd-kind">Type d&apos;usage</FieldLabel>
                <Select
                  value={usageType}
                  onValueChange={(v) => setUsageType(v as ProductUsageType)}
                >
                  <SelectTrigger id="f-prd-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumable">
                      Consommable interne salon
                    </SelectItem>
                    <SelectItem value="resale">
                      Produit destiné à la revente
                    </SelectItem>
                    <SelectItem value="both">
                      Mixte (salon &amp; revente)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="f-prd-unit">Unité de comptage</FieldLabel>
                <Input
                  id="f-prd-unit"
                  type="text"
                  required
                  placeholder="bouteille, paquet, boîte, pot..."
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
            </div>

            <div className="form-grid-2">
              {!editing && (
                <Field>
                  <FieldLabel htmlFor="f-prd-qty">
                    Quantité initiale en stock
                  </FieldLabel>
                  <Input
                    id="f-prd-qty"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={initialQuantity}
                    onChange={(e) => setInitialQuantity(e.target.value)}
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="f-prd-alert">
                  Seuil d&apos;alerte stock bas
                </FieldLabel>
                <Input
                  id="f-prd-alert"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                />
              </Field>
            </div>

            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-prd-cost">
                  Prix d&apos;achat unitaire (FCFA)
                </FieldLabel>
                <Input
                  id="f-prd-cost"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-prd-sale">
                  Prix de vente unitaire optionnel (FCFA)
                </FieldLabel>
                <Input
                  id="f-prd-sale"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Si revendu aux clients"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setProdOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {editing ? 'Enregistrer' : 'Créer le produit'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <Modal
        open={movOpen}
        title="Enregistrer un mouvement de stock"
        subtitle="Le stock ne peut jamais devenir négatif. Les ajustements exigent un motif explicite."
        maxWidth={560}
        onClose={() => setMovOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSaveMovement(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="f-mv-prod">Produit concerné</FieldLabel>
              <Select
                value={movProdId}
                onValueChange={(pid) => {
                  setMovProdId(pid)
                  const found = state.products.find((x) => x.id === pid)
                  if (found) {
                    setMovUnitCost(String(found.costPrice))
                    setMovSalePrice(
                      found.salePrice !== undefined
                        ? String(found.salePrice)
                        : '',
                    )
                  }
                }}
              >
                <SelectTrigger id="f-mv-prod">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} (Stock actuel : {p.quantity} {p.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-mv-type">Type de mouvement</FieldLabel>
                <Select
                  value={movType}
                  onValueChange={(v) => setMovType(v as StockMovementType)}
                >
                  <SelectTrigger id="f-mv-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Entrée / Achat</SelectItem>
                    <SelectItem value="use">Sortie pour prestation</SelectItem>
                    <SelectItem value="sale">Vente produit</SelectItem>
                    <SelectItem value="loss">Perte ou casse</SelectItem>
                    <SelectItem value="adjustment">
                      Ajustement d&apos;inventaire (+ / −)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="f-mv-date">Date</FieldLabel>
                <Input
                  id="f-mv-date"
                  type="date"
                  required
                  value={movDate}
                  onChange={(e) => setMovDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-mv-qty">
                  {movType === 'adjustment'
                    ? 'Variation de stock (+ ou −)'
                    : 'Quantité du mouvement'}
                </FieldLabel>
                <Input
                  id="f-mv-qty"
                  type="number"
                  min={movType === 'adjustment' ? -9999 : 1}
                  step={1}
                  required
                  value={movQty}
                  onChange={(e) => setMovQty(e.target.value)}
                />
              </Field>

              {movType === 'purchase' && (
                <Field>
                  <FieldLabel htmlFor="f-mv-cost">
                    Coût d&apos;achat unitaire (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-mv-cost"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={movUnitCost}
                    onChange={(e) => setMovUnitCost(e.target.value)}
                  />
                </Field>
              )}

              {movType === 'sale' && (
                <Field>
                  <FieldLabel htmlFor="f-mv-sprice">
                    Prix de vente unitaire (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-mv-sprice"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={movSalePrice}
                    onChange={(e) => setMovSalePrice(e.target.value)}
                  />
                </Field>
              )}
            </div>

            {movType === 'purchase' &&
              (() => {
                const targetProd = state.products.find(
                  (p) => p.id === movProdId,
                )
                const nextQty = Math.max(0, Math.round(Number(movQty || 0)))
                const nextCost = Math.max(
                  0,
                  Math.round(Number(movUnitCost || 0)),
                )
                if (!targetProd || nextQty <= 0) return null
                const previewCump = calculateCUMP(
                  targetProd.quantity,
                  targetProd.costPrice,
                  nextQty,
                  nextCost,
                )
                return (
                  <div
                    style={{
                      padding: '9px 12px',
                      borderRadius: 8,
                      background: 'var(--bg-surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.79rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span>
                      CUMP actuel :{' '}
                      <strong>{formatFCFA(targetProd.costPrice)}</strong>
                    </span>
                    <span>
                      Nouveau CUMP pondéré :{' '}
                      <strong style={{ color: 'var(--accent-cta)' }}>
                        {formatFCFA(previewCump)}
                      </strong>
                    </span>
                  </div>
                )
              })()}

            {(movType === 'purchase' || movType === 'sale') &&
              movRecordFin &&
              movPayMethod === 'cash' &&
              !openSession && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--color-warning-bg)',
                    border: '1px solid rgba(217, 119, 6, 0.35)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: '0.78rem',
                  }}
                >
                  <span>
                    Caisse espèces fermée : ouvrez-la pour synchroniser ce
                    mouvement au tiroir-caisse.
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={openQuickCashModal}
                  >
                    <Unlock size={12} />
                    Ouvrir la caisse
                  </Button>
                </div>
              )}

            {(movType === 'purchase' || movType === 'sale') && (
              <div className="form-grid-2">
                <Field>
                  <FieldLabel htmlFor="f-mv-pay">Mode de règlement</FieldLabel>
                  <Select value={movPayMethod} onValueChange={setMovPayMethod}>
                    <SelectTrigger id="f-mv-pay">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentMethods.map((m) => (
                        <SelectItem key={m.code} value={m.code}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {movType === 'purchase' && (
                  <Field>
                    <FieldLabel htmlFor="f-mv-sup">
                      Fournisseur (optionnel)
                    </FieldLabel>
                    <Input
                      id="f-mv-sup"
                      type="text"
                      value={movSupplier}
                      onChange={(e) => setMovSupplier(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}

            {(movType === 'purchase' || movType === 'sale') && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.82rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={movRecordFin}
                  onChange={(e) => setMovRecordFin(e.target.checked)}
                />
                Enregistrer automatiquement l&apos;écriture financière associée
                (sans double comptage)
              </label>
            )}

            <Field>
              <FieldLabel htmlFor="f-mv-reason">
                Motif {movType === 'adjustment' ? '(obligatoire)' : '(optionnel)'}
              </FieldLabel>
              <Input
                id="f-mv-reason"
                type="text"
                required={movType === 'adjustment'}
                placeholder={
                  movType === 'adjustment'
                    ? 'Ex. Inventaire physique de fin de mois'
                    : 'Observation sur le mouvement'
                }
                value={movReason}
                onChange={(e) => setMovReason(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMovOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Valider le mouvement
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <Modal
        open={historyProduct !== null}
        title={
          historyProduct
            ? `Fiche mouvements — ${historyProduct.name} (${historyProduct.sku})`
            : 'Historique produit'
        }
        subtitle={
          historyProduct
            ? `Stock actuel : ${historyProduct.quantity} ${historyProduct.unit} · Coût d'achat : ${formatFCFA(historyProduct.costPrice)}`
            : ''
        }
        maxWidth={680}
        onClose={() => setHistoryProduct(null)}
      >
        {historyProduct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.stockMovements.filter(
              (m) => m.productId === historyProduct.id,
            ).length === 0 ? (
              <div
                style={{
                  padding: 18,
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.84rem',
                }}
              >
                Aucun mouvement enregistré pour ce produit.
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 340 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Variation</th>
                      <th style={{ textAlign: 'right' }}>Stock après</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.stockMovements
                      .filter((m) => m.productId === historyProduct.id)
                      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                      .map((mv) => (
                        <tr key={mv.id}>
                          <td className="tabular-nums">
                            {formatDateFR(
                              mv.occurredAt,
                              state.settings.dateFormat,
                            )}
                          </td>
                          <td>{MOVEMENT_LABELS[mv.type]}</td>
                          <td
                            className="tabular-nums"
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              color:
                                mv.quantityDelta >= 0
                                  ? 'var(--color-success)'
                                  : 'var(--color-danger)',
                            }}
                          >
                            {mv.quantityDelta >= 0
                              ? `+${mv.quantityDelta}`
                              : mv.quantityDelta}{' '}
                            {historyProduct.unit}
                          </td>
                          <td
                            className="tabular-nums"
                            style={{ textAlign: 'right', fontWeight: 600 }}
                          >
                            {mv.quantityAfter} {historyProduct.unit}
                          </td>
                          <td style={{ fontSize: '0.78rem' }}>{mv.reason}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setHistoryProduct(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
