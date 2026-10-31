import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaStatus } from '../components/layout/PwaStatus'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('État PWA navigateur', () => {
  it('distingue hors-ligne et synchronisation Cloud, puis suit le retour réseau', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<PwaStatus />)
    expect(screen.getByRole('status')).toHaveTextContent('synchronisation Cloud non confirmée')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('ne promet pas un cache prêt sur la seule présence de l’invitation à installer', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<PwaStatus />)
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) })
    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('premier chargement complet')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Installer l’application' })))
    expect(prompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
