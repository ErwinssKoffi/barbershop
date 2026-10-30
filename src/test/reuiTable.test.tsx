import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pattern as Table10Pattern } from '@/components/patterns/c-table-10'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

describe('Primitives ReUI Table & Pattern @reui/c-table-10', () => {
  it('rend fidèlement le pattern @reui/c-table-10 avec ses colonnes, badges et boutons Manage', () => {
    render(<Table10Pattern />)

    expect(
      screen.getByRole('columnheader', { name: 'Service' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Plan' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Billing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Status' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Actions' }),
    ).toBeInTheDocument()

    expect(screen.getByText('Vercel Pro')).toBeInTheDocument()
    expect(screen.getByText('GitHub Enterprise')).toBeInTheDocument()
    expect(screen.getByText('Figma Organization')).toBeInTheDocument()
    expect(screen.getByText('Slack Business+')).toBeInTheDocument()
    expect(screen.getByText('Linear Standard')).toBeInTheDocument()

    const manageButtons = screen.getAllByRole('button', { name: /Manage/i })
    expect(manageButtons).toHaveLength(5)
  })

  it('rend tous les sous-composants Table (Header, Body, Footer, Caption) avec leurs data-slot', () => {
    const { container } = render(
      <Table>
        <TableCaption>Récapitulatif mensuel</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Prestation</TableHead>
            <TableHead className="text-right">Tarif</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Coupe dégradée</TableCell>
            <TableCell className="text-right">3 500 FCFA</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right">3 500 FCFA</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )

    expect(
      container.querySelector('[data-slot="table-container"]'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table"]')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="table-header"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="table-body"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="table-footer"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="table-caption"]'),
    ).toHaveTextContent('Récapitulatif mensuel')
  })
})
