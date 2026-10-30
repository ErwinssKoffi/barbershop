import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pattern as Tabs4Pattern } from '@/components/patterns/c-tabs-4'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

describe('Primitives ReUI Tabs / Label & Pattern @reui/c-tabs-4', () => {
  it('rend fidèlement @reui/c-tabs-4 en orientation verticale (variant="line") et bascule entre Account, Password et Settings', async () => {
    const user = userEvent.setup()
    render(<Tabs4Pattern />)

    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
    expect(tablist).toHaveAttribute('data-variant', 'line')

    const accountTab = screen.getByRole('tab', { name: 'Account' })
    const passwordTab = screen.getByRole('tab', { name: 'Password' })
    const settingsTab = screen.getByRole('tab', { name: 'Settings' })

    expect(accountTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Michael Brown')
    expect(screen.getByLabelText('Email')).toHaveValue(
      'michael.brown@example.com',
    )

    // Basculer sur Password au clic
    await user.click(passwordTab)
    expect(passwordTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Update password' }),
    ).toBeInTheDocument()

    // Navigation clavier verticale (ArrowDown -> Settings)
    passwordTab.focus()
    await user.keyboard('{ArrowDown}')
    expect(settingsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Theme')).toHaveValue('Light')
    expect(screen.getByLabelText('Language')).toHaveValue('English')
  })

  it('supporte le mode contrôlé horizontal et la navigation clavier ArrowRight / ArrowLeft', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <Tabs defaultValue="recettes" onValueChange={onValueChange}>
        <TabsList variant="line">
          <TabsTrigger value="recettes">Recettes</TabsTrigger>
          <TabsTrigger value="depenses">Dépenses</TabsTrigger>
        </TabsList>
        <TabsContent value="recettes">Contenu Recettes</TabsContent>
        <TabsContent value="depenses">Contenu Dépenses</TabsContent>
      </Tabs>,
    )

    const revTab = screen.getByRole('tab', { name: 'Recettes' })
    revTab.focus()
    await user.keyboard('{ArrowRight}')

    expect(onValueChange).toHaveBeenCalledWith('depenses')
    expect(screen.getByText('Contenu Dépenses')).toBeInTheDocument()
  })
})
