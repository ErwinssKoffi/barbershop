import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Scissors } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { Pattern as Card1 } from '@/components/patterns/c-card-1'
import { Pattern as Card2 } from '@/components/patterns/c-card-2'
import { Pattern as Card6 } from '@/components/patterns/c-card-6'
import { Pattern as Card7 } from '@/components/patterns/c-card-7'
import { Pattern as Card13 } from '@/components/patterns/c-card-13'
import { Pattern as Card14 } from '@/components/patterns/c-card-14'
import { Pattern as Card15 } from '@/components/patterns/c-card-15'
import { Pattern as Card17 } from '@/components/patterns/c-card-17'
import { KpiCard } from '@/components/ui/KpiCard'

describe('Composants shadcn / ReUI Cards (@reui/c-card-1, 2, 6, 7, 13, 14, 15, 17)', () => {
  it('rend les motifs @reui/c-card-1 et @reui/c-card-2 (en-tête avec bordure)', () => {
    const { unmount } = render(<Card1 />)
    expect(screen.getByText('Default Card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
    unmount()

    const { container } = render(<Card2 />)
    expect(screen.getByText('Header with Border')).toBeInTheDocument()
    const header = container.querySelector('[data-slot="card-header"]')
    expect(header).toHaveClass('border-b')
  })

  it('rend @reui/c-card-6 avec AvatarFallback et menu déroulant DropdownMenu (render prop)', async () => {
    const user = userEvent.setup()
    render(<Card6 />)

    expect(screen.getByText('Need a help in Claim?')).toBeInTheDocument()
    // Tant que l'image externe n'est pas chargée en environnement local/jsdom, le fallback CH s'affiche
    expect(screen.getByText('CH')).toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: /Team options/i })
    await user.click(trigger)

    expect(await screen.findByText('Team Settings')).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /Manage members/i }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('rend @reui/c-card-7 (Badge outline + média) et @reui/c-card-14 (lignes de statut)', () => {
    const { unmount } = render(<Card7 />)
    expect(screen.getByText('Trending')).toBeInTheDocument()
    expect(screen.getByText('Featured')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Get Started/i }),
    ).toBeInTheDocument()
    unmount()

    render(<Card14 />)
    expect(screen.getByText('Deployment Successful')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('bascule le panneau extensible et la barre Progress dans @reui/c-card-13', async () => {
    const user = userEvent.setup()
    const { container } = render(<Card13 />)

    expect(screen.getByText('3 days remaining in cycle')).toBeInTheDocument()
    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '90')

    const content = container.querySelector('[data-slot="card-content"]')
    expect(content).toHaveClass('max-h-48')

    const toggleBtn = screen.getByRole('button', { name: /Toggle card/i })
    await user.click(toggleBtn)
    expect(content).toHaveClass('max-h-[500px]')
  })

  it('rend @reui/c-card-15 et KpiCard SALON PRO avec Badge delta, Separator et menu contextuel', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Card15 />)

    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('$12.4k')).toBeInTheDocument()
    expect(screen.getByText('12.5%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /More options/i }))
    const removeItem = await screen.findByRole('menuitem', { name: /Remove/i })
    expect(removeItem).toHaveAttribute('data-variant', 'destructive')
    await user.click(removeItem)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    unmount()

    const onOpenRev = vi.fn()
    render(
      <KpiCard
        label="Chiffre d'affaires"
        value="185 000 FCFA"
        icon={<Scissors size={16} />}
        evolutionPercent={14.2}
        menuActions={[
          { label: 'Ouvrir les recettes', onSelect: onOpenRev },
        ]}
      />,
    )

    expect(screen.getByText('+14.2%')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Options pour Chiffre d'affaires/i }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: /Ouvrir les recettes/i }),
    )
    expect(onOpenRev).toHaveBeenCalledTimes(1)
  })

  it("rend @reui/c-card-17 avec badge d'icône bg-primary, description et lien d'action", () => {
    render(<Card17 />)

    expect(
      screen.getByRole('link', { name: 'Recent Orders Overview' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Track and review all recent purchases/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /View Orders/i }),
    ).toBeInTheDocument()
  })
})
