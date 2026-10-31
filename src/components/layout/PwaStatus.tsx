import { useEffect, useState } from 'react'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Connectivity is not a confirmation of Cloud synchronization. */
export function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [ready, setReady] = useState(false)
  const [update, setUpdate] = useState(false)
  const [install, setInstall] = useState<InstallPrompt | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let disposed = false
    let registration: ServiceWorkerRegistration | undefined
    const cleanups: (() => void)[] = []
    const connectivity = () => setOnline(navigator.onLine)
    const installPrompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt) }
    const installed = () => setInstall(null)
    window.addEventListener('online', connectivity)
    window.addEventListener('offline', connectivity)
    window.addEventListener('beforeinstallprompt', installPrompt)
    window.addEventListener('appinstalled', installed)
    const check = () => { if (registration && navigator.onLine) void registration.update().catch(() => {}) }
    const visible = () => { if (document.visibilityState === 'visible') check() }
    const watch = (worker: ServiceWorker) => {
      const changed = () => {
        if (disposed) return
        if (worker.state === 'activated') setReady(true)
        if (worker.state === 'installed' && registration?.active) setUpdate(true)
      }
      worker.addEventListener('statechange', changed)
      cleanups.push(() => worker.removeEventListener('statechange', changed))
      changed()
    }
    if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((reg) => {
        if (disposed) return
        registration = reg
        setReady(Boolean(reg.active))
        setUpdate(Boolean(reg.waiting))
        if (reg.installing) watch(reg.installing)
        const found = () => { if (reg.installing) watch(reg.installing) }
        reg.addEventListener('updatefound', found)
        cleanups.push(() => reg.removeEventListener('updatefound', found))
      }).catch(() => { /* Local data remains available; do not claim an offline shell. */ })
    }
    const timer = window.setInterval(check, 60 * 60 * 1000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', check)
    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', check)
      window.removeEventListener('online', connectivity)
      window.removeEventListener('offline', connectivity)
      window.removeEventListener('beforeinstallprompt', installPrompt)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  if (online && !update && !install && (!ready || dismissed)) return null
  return (
    <aside aria-label="État de l’application" className="pwa-status">
      <p role="status">{!online
        ? 'Hors ligne — données locales sur cet appareil ; synchronisation Cloud non confirmée.'
        : update
          ? 'Mise à jour prête. Terminez vos saisies, puis fermez toutes les fenêtres SALON PRO (application installée comprise) et rouvrez-la. Aucun rechargement forcé.'
          : ready ? 'Application disponible hors ligne sur cet appareil. Cela ne remplace pas une sauvegarde Cloud.'
            : 'Installer SALON PRO sur cet appareil. L’ouverture hors ligne nécessite un premier chargement complet.'}</p>
      {install && <button type="button" onClick={() => {
        void install.prompt().then(() => install.userChoice).then(() => setInstall(null)).catch(() => setInstall(null))
      }}>Installer l’application</button>}
      {online && !update && <button type="button" aria-label="Masquer l’information d’installation" onClick={() => { setDismissed(true); setInstall(null) }}>Fermer</button>}
    </aside>
  )
}
