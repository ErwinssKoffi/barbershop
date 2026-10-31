import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  SettingsIcon,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type {
  AppSettings,
  CategoryItem,
  CategoryScope,
  ReceiptFormat,
  SalonBackupPayload,
  SalonInfo,
} from '../../domain/models'
import { useCloudSync } from '../../contexts/cloudSyncContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { formatDateTimeFR, todayISO } from '../../utils/format'

const SCOPE_LABELS: Record<CategoryScope, string> = {
  expense: 'Catégories de dépenses',
  revenue: 'Catégories de recettes',
  service: 'Catégories de prestations',
  product: 'Catégories de produits',
  payment_method: 'Modes de paiement',
}

function SalonInfoForm({
  salon,
  busy,
  onSave,
  onError,
}: {
  salon: SalonInfo
  busy: boolean
  onSave: (changes: Partial<SalonInfo>) => Promise<void>
  onError: (msg: string) => void
}) {
  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const [salonName, setSalonName] = useState(salon.name)
  const [address, setAddress] = useState(salon.address)
  const [phone, setPhone] = useState(salon.phone)
  const [managerName, setManagerName] = useState(salon.managerName)
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(
    salon.logoDataUrl,
  )

  const handleLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 512_000) {
      onError('Le logo ne doit pas dépasser 500 Ko.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await onSave({
      name: salonName,
      address,
      phone,
      managerName,
      logoDataUrl,
    })
  }

  return (
    <form className="space-y-4 w-full" onSubmit={(e) => void handleSubmit(e)}>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="set-salon-name" className="text-sm">
            Nom du salon
          </Label>
          <Input
            id="set-salon-name"
            type="text"
            required
            className="h-9"
            placeholder="Nom de votre salon"
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="set-manager" className="text-sm">
            Nom du responsable
          </Label>
          <Input
            id="set-manager"
            type="text"
            required
            className="h-9"
            placeholder="Nom et prénom du responsable"
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="set-phone" className="text-sm">
            Téléphone
          </Label>
          <Input
            id="set-phone"
            type="tel"
            className="h-9"
            placeholder="Numéro de téléphone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="set-address" className="text-sm">
            Adresse du salon
          </Label>
          <Input
            id="set-address"
            type="text"
            className="h-9"
            placeholder="Quartier, rue et ville"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Logo optionnel du salon</Label>
        <div className="flex items-center gap-2">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            style={{ display: 'none' }}
            onChange={handleLogoFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => logoInputRef.current?.click()}
          >
            Choisir une image
          </Button>
          {logoDataUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLogoDataUrl(undefined)}
            >
              Retirer le logo
            </Button>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-3">
        <Button type="submit" size="sm" disabled={busy}>
          <Save size={15} />
          Enregistrer les informations
        </Button>
      </div>
    </form>
  )
}

function AppPreferencesForm({
  settings,
  busy,
  onSave,
}: {
  settings: AppSettings
  busy: boolean
  onSave: (changes: Partial<AppSettings>) => Promise<void>
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(settings.theme)
  const [dateFormat, setDateFormat] = useState<'dd/MM/yyyy' | 'long-fr'>(
    settings.dateFormat,
  )
  const [printHeaderNote, setPrintHeaderNote] = useState(
    settings.printHeaderNote,
  )
  const [receiptFormat, setReceiptFormat] = useState<ReceiptFormat>(
    settings.receiptFormat ?? 'thermal_80mm',
  )
  const [receiptFooterNote, setReceiptFooterNote] = useState(
    settings.receiptFooterNote ??
      'Merci de votre visite et de votre fidélité !',
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await onSave({
      theme,
      dateFormat,
      printHeaderNote,
      receiptFormat,
      receiptFooterNote,
    })
  }

  return (
    <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="set-theme">Thème visuel</FieldLabel>
            <Select
              value={theme}
              onValueChange={(v) => setTheme(v as 'light' | 'dark')}
            >
              <SelectTrigger id="set-theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Thème clair (recommandé)</SelectItem>
                <SelectItem value="dark">Thème sombre</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="set-datefmt">Format de date</FieldLabel>
            <Select
              value={dateFormat}
              onValueChange={(v) =>
                setDateFormat(v as 'dd/MM/yyyy' | 'long-fr')
              }
            >
              <SelectTrigger id="set-datefmt">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dd/MM/yyyy">Court (JJ/MM/AAAA)</SelectItem>
                <SelectItem value="long-fr">
                  Long en français (29 oct. 2026)
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="set-print-note">
            Mention sur les rapports A4 imprimables
          </FieldLabel>
          <Input
            id="set-print-note"
            type="text"
            placeholder="Ex. État financier interne"
            value={printHeaderNote}
            onChange={(e) => setPrintHeaderNote(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="set-receipt-fmt">
              Format par défaut du Reçu Client
            </FieldLabel>
            <Select
              value={receiptFormat}
              onValueChange={(v) => setReceiptFormat(v as ReceiptFormat)}
            >
              <SelectTrigger id="set-receipt-fmt">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thermal_80mm">
                  Ticket thermique 80 mm (rouleau caisse)
                </SelectItem>
                <SelectItem value="a5_sheet">
                  Fiche client A5 (bureau)
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="set-receipt-footer">
              Message de bas de reçu client
            </FieldLabel>
            <Input
              id="set-receipt-footer"
              type="text"
              placeholder="Merci de votre visite et de votre fidélité !"
              value={receiptFooterNote}
              onChange={(e) => setReceiptFooterNote(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="submit" disabled={busy}>
            <Save size={15} />
            Enregistrer les préférences
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

export function SettingsPage() {
  const { state, mutate, syncWithRepo } = useSalonStore()
  const [archivedSyncConflicts, setArchivedSyncConflicts] = useState(0)
  useEffect(() => {
    let cancelled = false
    void syncWithRepo((repo) => repo.exportCloudConflicts()).then((journal) => {
      if (!cancelled) setArchivedSyncConflicts((JSON.parse(journal) as unknown[]).length)
    })
    return () => { cancelled = true }
  }, [syncWithRepo])

  const cloudSync = useCloudSync()
  const { checkServerHealth } = cloudSync
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void checkServerHealth()
  }, [checkServerHealth])

  const [activeScope, setActiveScope] = useState<CategoryScope>('expense')
  const [newCatLabel, setNewCatLabel] = useState('')
  const [editCat, setEditCat] = useState<CategoryItem | null>(null)
  const [editCatLabel, setEditCatLabel] = useState('')

  const [pendingImportRaw, setPendingImportRaw] = useState<string | null>(null)
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [resetConfirmWord, setResetConfirmWord] = useState('')
  const [busy, setBusy] = useState(false)

  const scopedCategories = useMemo(
    () =>
      state.categories
        .filter((c) => c.scope === activeScope)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [state.categories, activeScope],
  )

  const totalRecordsCount = useMemo(
    () =>
      state.revenues.length +
      state.expenses.length +
      state.cashSessions.length +
      state.cashMovements.length +
      state.services.length +
      state.employees.length +
      state.products.length +
      state.stockMovements.length +
      state.salaryPayments.length +
      state.budgets.length +
      state.correctionLogs.length,
    [state],
  )

  const importPreview = useMemo(() => {
    if (!pendingImportRaw) return null
    try {
      const parsed = JSON.parse(pendingImportRaw) as Partial<SalonBackupPayload>
      if (
        !parsed ||
        parsed.format !== 'SALON_PRO_BACKUP_V1' ||
        !parsed.salon ||
        !Array.isArray(parsed.revenues) ||
        !Array.isArray(parsed.expenses)
      ) {
        return {
          valid: false as const,
          error:
            'Format non reconnu : ce fichier JSON ne correspond pas à une sauvegarde SALON_PRO_BACKUP_V1 valide.',
        }
      }
      return {
        valid: true as const,
        salonName: parsed.salon.name,
        exportedAt: parsed.exportedAt,
        revenuesCount: parsed.revenues.length,
        expensesCount: parsed.expenses.length,
        employeesCount: parsed.employees?.length ?? 0,
        productsCount: parsed.products?.length ?? 0,
        sessionsCount: parsed.cashSessions?.length ?? 0,
      }
    } catch {
      return {
        valid: false as const,
        error: 'Le fichier sélectionné n’est pas un JSON lisible.',
      }
    }
  }, [pendingImportRaw])

  const handleSaveSalonInfo = async (changes: Partial<SalonInfo>) => {
    setBusy(true)
    try {
      await mutate((repo) => repo.updateSalonInfo(changes))
      toast.success('Informations du salon enregistrées.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur sauvegarde.')
    } finally {
      setBusy(false)
    }
  }

  const handleSavePreferences = async (changes: Partial<AppSettings>) => {
    setBusy(true)
    try {
      await mutate((repo) => repo.updateSettings(changes))
      toast.success("Préférences de l'application mises à jour.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur préférences.')
    } finally {
      setBusy(false)
    }
  }

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault()
    if (!newCatLabel.trim()) return
    try {
      await mutate((repo) =>
        repo.addCustomCategory({ scope: activeScope, label: newCatLabel }),
      )
      setNewCatLabel('')
      toast.success('Catégorie ajoutée.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur catégorie.')
    }
  }

  const handleRenameCategory = async (e: FormEvent) => {
    e.preventDefault()
    if (!editCat) return
    try {
      await mutate((repo) =>
        repo.updateCategory(editCat.id, { label: editCatLabel }),
      )
      setEditCat(null)
      toast.success('Libellé de la catégorie modifié.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Modification refusée.')
    }
  }

  const handleToggleCategory = async (cat: CategoryItem) => {
    try {
      await mutate((repo) =>
        repo.updateCategory(cat.id, { isArchived: !cat.isArchived }),
      )
      toast.success(
        cat.isArchived ? 'Catégorie réactivée.' : 'Catégorie désactivée.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur statut.')
    }
  }

  const handleExportJSON = async () => {
    setBusy(true)
    try {
      const payload = await mutate((repo) => repo.exportBackupPayload())
      const json = JSON.stringify(payload, null, 2)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `salon-pro-sauvegarde-${todayISO()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Sauvegarde JSON complète exportée avec succès.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export impossible.')
    } finally {
      setBusy(false)
    }
  }

  const handleSelectImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPendingImportRaw(reader.result)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleConfirmImport = async () => {
    if (!pendingImportRaw) return
    setBusy(true)
    try {
      const parsed: unknown = JSON.parse(pendingImportRaw)
      await mutate((repo) => repo.importBackupPayload(parsed))
      setPendingImportRaw(null)
      toast.success('Sauvegarde JSON restaurée avec succès.')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Fichier JSON invalide ou corrompu.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleResetAll = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.resetAllDataWithConfirmation(resetConfirmWord),
      )
      setResetModalOpen(false)
      setResetConfirmWord('')
      toast.warning(
        'Toutes les données locales ont été réinitialisées aux catégories par défaut.',
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Réinitialisation refusée.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres &amp; Sauvegarde</h1>
          <p className="page-subtitle">
            Identité du salon, catégories comptables personnalisables et
            sauvegarde locale JSON
          </p>
        </div>
      </div>

      {/* Mention obligatoire de la Section 16 */}
      <div
        className="surface-card"
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderLeft: '4px solid var(--accent-emerald)',
        }}
      >
        {cloudSync.syncEnabled ? (
          <Cloud size={20} color="var(--accent-emerald)" />
        ) : (
          <HardDrive size={20} color="var(--accent-emerald)" />
        )}
        <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>
          {cloudSync.syncEnabled
            ? 'Mode Hybride actif : stockage local IndexedDB instantané + synchronisation multi-appareils PostgreSQL (Neon ou Supabase).'
            : "Version locale : les données sont enregistrées sur cet appareil. La synchronisation entre plusieurs appareils n'est pas encore activée."}
        </div>
      </div>

      {/* Onglets verticaux ReUI (@reui/c-tabs-4) */}
      <Tabs defaultValue="salon" orientation="vertical" className="gap-5">
        <TabsList variant="line" className="w-52 shrink-0">
          <TabsTrigger value="salon">Identité du salon</TabsTrigger>
          <TabsTrigger value="preferences">Préférences</TabsTrigger>
          <TabsTrigger value="categories">Catégories</TabsTrigger>
          <TabsTrigger value="cloud">Cloud PostgreSQL</TabsTrigger>
          <TabsTrigger value="sauvegarde">Sauvegarde &amp; Données</TabsTrigger>
        </TabsList>

        <TabsContent value="salon">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                Informations sur le salon
              </CardTitle>
              <CardDescription className="text-sm">
                Affichées dans la barre latérale et sur tous les rapports
                imprimables
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SalonInfoForm
                key={state.salon.updatedAt}
                salon={state.salon}
                busy={busy}
                onSave={handleSaveSalonInfo}
                onError={(msg) => toast.error(msg)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                Préférences de l&apos;application
              </CardTitle>
              <CardDescription className="text-sm">
                Thème d&apos;affichage, format des dates et pied de page
                imprimable
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AppPreferencesForm
                key={state.settings.updatedAt}
                settings={state.settings}
                busy={busy}
                onSave={handleSavePreferences}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                Catégories personnalisables
              </CardTitle>
              <CardDescription className="text-sm">
                Adaptez les catégories de recettes, dépenses, prestations,
                produits et modes de paiement à votre salon
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Tabs
                value={activeScope}
                onValueChange={(v) => setActiveScope(v as CategoryScope)}
              >
                <TabsList variant="line">
                  {(Object.keys(SCOPE_LABELS) as CategoryScope[]).map((sc) => (
                    <TabsTrigger key={sc} value={sc}>
                      {SCOPE_LABELS[sc]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <form
                onSubmit={(e) => void handleAddCategory(e)}
                style={{
                  display: 'flex',
                  gap: 8,
                  maxWidth: 460,
                }}
              >
                <Field className="w-full">
                  <Input
                    type="text"
                    className="h-9"
                    placeholder={`Nouvelle entrée dans ${SCOPE_LABELS[activeScope]}...`}
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                  />
                </Field>
                <Button type="submit" size="sm">
                  <Plus size={15} />
                  Ajouter
                </Button>
              </form>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Origine</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scopedCategories.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {cat.label}
                          </span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            Code : {cat.code}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={cat.isSystem ? 'secondary' : 'info-light'}
                          size="sm"
                        >
                          {cat.isSystem ? 'Système' : 'Personnalisée'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            !cat.isArchived ? 'success-light' : 'warning-light'
                          }
                          size="sm"
                        >
                          {!cat.isArchived ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            title="Renommer"
                            onClick={() => {
                              setEditCat(cat)
                              setEditCatLabel(cat.label)
                            }}
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
                            title={cat.isArchived ? 'Réactiver' : 'Désactiver'}
                            onClick={() => void handleToggleCategory(cat)}
                          >
                            <Power size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sauvegarde">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                Sauvegarde et restauration locale (IndexedDB)
              </CardTitle>
              <CardDescription className="text-sm">
                {totalRecordsCount} enregistrement(s) stockés sur cet appareil ·
                Dernier export JSON :{' '}
                {state.settings.lastBackupExportedAt
                  ? formatDateTimeFR(state.settings.lastBackupExportedAt)
                  : 'Non exporté'}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleExportJSON()}
                  disabled={busy}
                >
                  <Download size={15} />
                  Exporter une sauvegarde JSON complète
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={handleSelectImportFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  <Upload size={15} />
                  Importer un fichier JSON
                </Button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  style={{ color: 'var(--color-danger)' }}
                  onClick={() => {
                    setResetConfirmWord('')
                    setResetModalOpen(true)
                  }}
                >
                  <RotateCcw size={15} />
                  Réinitialisation complète des données
                </Button>
              </div>
            </CardContent>

            <CardFooter className="pt-3 border-t">
              <ShieldCheck size={16} color="var(--accent-emerald)" />
              <span className="text-muted-foreground text-xs">
                Journal d&apos;audit actif ({state.correctionLogs.length}{' '}
                rectification(s)) ·{' '}
                <Link
                  to="/reports"
                  style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}
                >
                  Consulter dans Rapports →
                </Link>
              </span>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="cloud">
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    Synchronisation Hybride PostgreSQL
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Fonctionnement local instantané (IndexedDB) + réplication
                    multi-appareils vers votre base PostgreSQL Neon ou Supabase
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    cloudSync.status === 'synced'
                      ? 'success-light'
                      : cloudSync.status === 'syncing'
                        ? 'info-light'
                        : cloudSync.status === 'offline'
                          ? 'warning-light'
                          : cloudSync.status === 'unauthorized' ||
                              cloudSync.status === 'error'
                            ? 'destructive-light'
                            : 'outline'
                  }
                >
                  {cloudSync.status === 'synced'
                    ? 'Synchronisé'
                    : cloudSync.status === 'syncing'
                      ? 'Synchronisation…'
                      : cloudSync.status === 'offline'
                        ? 'Hors-ligne (Local actif)'
                        : cloudSync.status === 'unauthorized'
                          ? 'Session requise'
                          : cloudSync.status === 'error'
                            ? 'Erreur réseau'
                            : cloudSync.syncEnabled
                              ? 'Prêt'
                              : 'Désactivé'}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-muted)',
                  }}
                >
                  <div className="text-xs text-muted-foreground">
                    Serveur API (/api/sync)
                  </div>
                  <div className="text-sm font-semibold mt-0.5">
                    {cloudSync.databaseConfiguredOnServer === null
                      ? 'Vérification locale…'
                      : cloudSync.databaseConfiguredOnServer
                        ? 'DATABASE_URL configurée'
                        : 'DATABASE_URL absente (.env)'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-muted)',
                  }}
                >
                  <div className="text-xs text-muted-foreground">
                    Dernière synchronisation Cloud
                  </div>
                  <div className="text-sm font-semibold mt-0.5">
                    {cloudSync.lastSyncedAt
                      ? formatDateTimeFR(cloudSync.lastSyncedAt)
                      : 'Aucune pour le moment'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-muted)',
                  }}
                >
                  <div className="text-xs text-muted-foreground">
                    Enregistrements Cloud
                  </div>
                  <div className="text-sm font-semibold mt-0.5 tabular-nums">
                    {cloudSync.remoteRecordsCount !== null
                      ? `${cloudSync.remoteRecordsCount} ligne(s)`
                      : '—'}
                  </div>
                </div>
              </div>

              {archivedSyncConflicts > 0 && <p role="status">{archivedSyncConflicts} version(s) locale(s) écartée(s) ou tentative(s) refusée(s) sont conservées dans le journal. Consultez-le avant de ressaisir une opération.</p>}
              <Button variant="outline" onClick={() => void (async () => {
                const journal = await syncWithRepo((repo) => repo.exportCloudConflicts())
                const url = URL.createObjectURL(new Blob([journal], { type: 'application/json' }))
                const link = document.createElement('a')
                link.href = url; link.download = `salon-pro-conflits-${todayISO()}.json`; link.click()
                URL.revokeObjectURL(url)
              })()}>
                Télécharger le journal des conflits
              </Button>

              {cloudSync.lastError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background:
                      cloudSync.status === 'offline'
                        ? 'var(--color-warning-bg)'
                        : 'var(--color-danger-bg)',
                    color:
                      cloudSync.status === 'offline'
                        ? 'var(--color-warning)'
                        : 'var(--color-danger)',
                    fontSize: '0.82rem',
                  }}
                >
                  {cloudSync.status === 'offline' ? (
                    <CloudOff size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <AlertTriangle
                      size={17}
                      style={{ flexShrink: 0, marginTop: 1 }}
                    />
                  )}
                  <span>{cloudSync.lastError}</span>
                </div>
              )}

              <form
                className="space-y-4 pt-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  void cloudSync
                    .configureAndConnect({
                      autoSync: cloudSync.autoSync,
                    })
                    .then((res) => {
                      if (res.ok) {
                        toast.success(res.message)
                      } else {
                        toast.warning(res.message)
                      }
                    })
                }}
              >
                <div className="flex flex-col gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cloudSync.autoSync}
                      onChange={(e) => cloudSync.setAutoSync(e.target.checked)}
                    />
                    <span>
                      Synchronisation automatique après chaque saisie
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  <Button
                    type="submit"
                    disabled={cloudSync.status === 'syncing'}
                  >
                    <Cloud size={15} />
                    {cloudSync.syncEnabled
                      ? 'Mettre à jour & Synchroniser'
                      : 'Activer la synchronisation Cloud'}
                  </Button>

                  {cloudSync.syncEnabled && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={cloudSync.status === 'syncing'}
                        onClick={() => void cloudSync.syncNow()}
                      >
                        <RefreshCw size={15} />
                        Synchroniser maintenant
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          cloudSync.disconnectCloudSync()
                          toast.success(
                            'Synchronisation Cloud désactivée sur cet appareil (vos données locales restent intactes).',
                          )
                        }}
                      >
                        Repasser en local uniquement
                      </Button>
                    </>
                  )}
                </div>
              </form>
            </CardContent>

            <CardFooter className="pt-3 border-t text-xs text-muted-foreground">
              La chaîne DATABASE_URL et la clé de signature des sessions restent
              strictement côté serveur et ne sont jamais exposées au navigateur.
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal
        open={editCat !== null}
        title="Modifier le libellé de la catégorie"
        onClose={() => setEditCat(null)}
      >
        <form className="w-full" onSubmit={(e) => void handleRenameCategory(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-cat-lbl">Nouveau nom</FieldLabel>
              <Input
                id="edit-cat-lbl"
                type="text"
                required
                value={editCatLabel}
                onChange={(e) => setEditCatLabel(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditCat(null)}
              >
                Annuler
              </Button>
              <Button type="submit">Enregistrer</Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <Modal
        open={pendingImportRaw !== null}
        title="Restaurer cette sauvegarde JSON ?"
        subtitle="Attention : les données actuelles de l'appareil seront remplacées par celles du fichier JSON."
        onClose={() => setPendingImportRaw(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {importPreview && !importPreview.valid ? (
            <div
              style={{
                display: 'flex',
                gap: 10,
                padding: 12,
                borderRadius: 10,
                background: 'var(--color-danger-bg)',
                color: 'var(--color-danger)',
                fontSize: '0.83rem',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>{importPreview.error}</span>
            </div>
          ) : importPreview && importPreview.valid ? (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'var(--bg-surface-muted)',
                fontSize: '0.83rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 700,
                  color: 'var(--color-success)',
                }}
              >
                <CheckCircle2 size={16} />
                Fichier SALON_PRO_BACKUP_V1 vérifié
              </div>
              <div>
                <strong>Salon :</strong> {importPreview.salonName}
              </div>
              {importPreview.exportedAt && (
                <div>
                  <strong>Exporté le :</strong>{' '}
                  {formatDateTimeFR(importPreview.exportedAt)}
                </div>
              )}
              <div>
                <strong>Contenu :</strong> {importPreview.revenuesCount} recette(s),{' '}
                {importPreview.expensesCount} dépense(s),{' '}
                {importPreview.sessionsCount} session(s) de caisse,{' '}
                {importPreview.employeesCount} employé(s),{' '}
                {importPreview.productsCount} produit(s).
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingImportRaw(null)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              disabled={busy || !importPreview || !importPreview.valid}
              onClick={() => void handleConfirmImport()}
            >
              Confirmer la restauration
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={resetModalOpen}
        title="Réinitialisation complète des données"
        subtitle="Action irréversible : exportez d'abord une sauvegarde JSON si nécessaire."
        onClose={() => setResetModalOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleResetAll(e)}>
          <FieldGroup>
            <div
              style={{
                display: 'flex',
                gap: 10,
                padding: 12,
                borderRadius: 10,
                background: 'var(--color-danger-bg)',
                color: 'var(--color-danger)',
                fontSize: '0.83rem',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>
                Toutes les recettes, dépenses, sessions de caisse, fiches du
                personnel et stocks enregistrés sur cet appareil seront effacés.
              </span>
            </div>

            <Field>
              <FieldLabel htmlFor="reset-word">
                Saisissez exactement <strong>SUPPRIMER</strong> pour confirmer :
              </FieldLabel>
              <Input
                id="reset-word"
                type="text"
                required
                placeholder="SUPPRIMER"
                value={resetConfirmWord}
                onChange={(e) => setResetConfirmWord(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetModalOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || resetConfirmWord.trim() !== 'SUPPRIMER'}
              >
                Tout réinitialiser
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>
    </div>
  )
}
