import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MotionConfig } from 'framer-motion'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '@/components/reui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import { Progress } from '@/components/ui/progress'
import {
  MOTION_DURATION,
  MOTION_EASE,
  SPRING_ELEVATION,
  SPRING_TILT_3D,
} from '@/lib/motion'

describe('Framer Motion — Effet 3D, Surélévation, Scale, Duration & Shadow', () => {
  it('expose les constantes calibrées de durée, courbe et ressorts 3D', () => {
    expect(MOTION_DURATION.instant).toBeLessThan(MOTION_DURATION.fast)
    expect(MOTION_DURATION.fast).toBeLessThan(MOTION_DURATION.base)
    expect(MOTION_DURATION.base).toBeLessThan(MOTION_DURATION.slow)
    expect(MOTION_EASE).toHaveLength(4)
    expect(SPRING_ELEVATION.type).toBe('spring')
    expect(SPRING_TILT_3D.stiffness).toBeGreaterThan(200)
  })

  it('active la perspective 3D et le reflet spéculaire sur Card et permet tilt3d={false}', () => {
    const { container, rerender } = render(
      <MotionConfig reducedMotion="user">
        <Card>
          <CardHeader>
            <CardTitle>Carte 3D SALON PRO</CardTitle>
            <CardDescription>Surélévation et inclinaison 3D</CardDescription>
          </CardHeader>
          <CardContent>Contenu test</CardContent>
        </Card>
      </MotionConfig>,
    )

    const card = container.querySelector<HTMLElement>('[data-slot="card"]')
    expect(card).toBeInTheDocument()
    expect(card).toHaveAttribute('data-3d', 'true')
    expect(
      container.querySelector('[data-slot="card-sheen"]'),
    ).toBeInTheDocument()

    if (card) {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 300,
        bottom: 200,
        width: 300,
        height: 200,
        toJSON: () => ({}),
      })
      fireEvent.mouseMove(card, { clientX: 240, clientY: 50 })
      fireEvent.mouseLeave(card)
    }

    rerender(
      <MotionConfig reducedMotion="user">
        <Card tilt3d={false}>
          <CardContent>Sans inclinaison</CardContent>
        </Card>
      </MotionConfig>,
    )
    expect(
      container.querySelector('[data-slot="card"]'),
    ).toHaveAttribute('data-3d', 'false')
    expect(
      container.querySelector('[data-slot="card-sheen"]'),
    ).not.toBeInTheDocument()
  })

  it('anime Button, Input, Badge, Avatar, Progress et Modal 3D sans régression fonctionnelle', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onAction = vi.fn()

    render(
      <MotionConfig reducedMotion="user">
        <div>
          <Button type="button" onClick={onAction}>
            Valider
          </Button>
          <Input aria-label="Montant FCFA" defaultValue="15000" />
          <Badge variant="success-light">Actif</Badge>
          <Avatar>
            <AvatarFallback>SP</AvatarFallback>
          </Avatar>
          <Progress value={72} aria-label="Objectif mensuel" />
          <Modal open title="Fenêtre 3D" subtitle="Sous-titre" onClose={onClose}>
            <p>Détails de l&apos;opération</p>
          </Modal>
        </div>
      </MotionConfig>,
    )

    await user.click(screen.getByRole('button', { name: 'Valider' }))
    expect(onAction).toHaveBeenCalledTimes(1)

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '72',
    )
    expect(
      screen.getByRole('dialog', { name: 'Fenêtre 3D' }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
