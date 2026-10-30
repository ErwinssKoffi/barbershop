import { motion } from 'framer-motion'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Minus,
  MoreHorizontalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SPRING_SNAPPY } from '@/lib/motion'
import { Sparkline } from './Sparkline'

export type KpiTone = 'emerald' | 'teal' | 'blue' | 'amber' | 'danger'

export interface KpiMenuAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  variant?: 'default' | 'destructive'
  separatorBefore?: boolean
}

const TONES: Record<KpiTone, { bg: string; fg: string; stroke: string }> = {
  emerald: {
    bg: 'var(--accent-emerald-soft)',
    fg: 'var(--accent-emerald)',
    stroke: '#10b981',
  },
  teal: {
    bg: 'var(--accent-teal-soft)',
    fg: 'var(--accent-teal)',
    stroke: '#0891b2',
  },
  blue: {
    bg: 'var(--accent-blue-soft)',
    fg: 'var(--accent-blue)',
    stroke: '#2563eb',
  },
  amber: {
    bg: 'var(--accent-amber-soft)',
    fg: 'var(--accent-amber)',
    stroke: '#d97706',
  },
  danger: {
    bg: 'var(--color-danger-bg)',
    fg: 'var(--color-danger)',
    stroke: '#ef4444',
  },
}

interface KpiCardProps {
  label: string
  value: string
  icon: ReactNode
  tone?: KpiTone
  evolutionPercent?: number | null
  invertEvolutionColor?: boolean
  subtitle?: ReactNode
  sparkId?: string
  sparkValues?: number[]
  menuActions?: KpiMenuAction[]
}

export function KpiCard({
  label,
  value,
  icon,
  tone = 'emerald',
  evolutionPercent,
  invertEvolutionColor = false,
  subtitle,
  sparkId,
  sparkValues,
  menuActions,
}: KpiCardProps) {
  const palette = TONES[tone]
  const hasNumericDelta =
    evolutionPercent !== undefined && evolutionPercent !== null
  const isPositive = hasNumericDelta && evolutionPercent >= 0
  const isGood = hasNumericDelta
    ? invertEvolutionColor
      ? !isPositive
      : isPositive
    : true

  const renderFooterNote = () => {
    if (evolutionPercent === undefined) {
      return subtitle ?? null
    }
    if (evolutionPercent === null) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--text-muted)',
          }}
        >
          <Minus size={12} />
          Pas assez de données antérieures
        </span>
      )
    }
    return <span>{subtitle ?? 'Vs période précédente'}</span>
  }

  const footerNote = renderFooterNote()

  return (
    <Card
      className="overflow-hidden p-0"
      style={{ justifyContent: 'space-between', gap: 0 }}
    >
      <CardContent
        className="flex flex-col gap-3"
        style={{ padding: sparkId ? '16px 18px 8px' : '16px 18px 16px' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3
            className="text-muted-foreground font-medium"
            style={{ margin: 0, fontSize: '0.8rem' }}
          >
            {label}
          </h3>

          <div className="flex items-center gap-1">
            <motion.div
              className="kpi-icon-box"
              whileHover={{
                y: -2.5,
                scale: 1.1,
                rotateZ: -5,
                transition: SPRING_SNAPPY,
              }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: palette.bg,
                color: palette.fg,
              }}
            >
              {icon}
            </motion.div>

            {menuActions && menuActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="-me-1.5"
                      aria-label={`Options pour ${label}`}
                    />
                  }
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    {menuActions.map((act) => (
                      <div key={act.label}>
                        {act.separatorBefore && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          variant={act.variant}
                          onSelect={act.onSelect}
                        >
                          {act.icon}
                          <span>{act.label}</span>
                        </DropdownMenuItem>
                      </div>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          <div
            className="flex items-center gap-2.5"
            style={{ flexWrap: 'wrap' }}
          >
            <span className="kpi-value tabular-nums" style={{ marginTop: 0 }}>
              {value}
            </span>

            {hasNumericDelta && (
              <Badge variant={isGood ? 'success-light' : 'destructive-light'}>
                {isPositive ? (
                  <ArrowUpIcon aria-hidden="true" />
                ) : (
                  <ArrowDownIcon aria-hidden="true" />
                )}
                {isPositive ? '+' : ''}
                {evolutionPercent}%
              </Badge>
            )}
          </div>

          {footerNote && (
            <>
              <Separator />
              <div className="text-muted-foreground text-xs">{footerNote}</div>
            </>
          )}
        </div>
      </CardContent>

      {sparkId && (
        <Sparkline
          id={sparkId}
          color={palette.stroke}
          values={sparkValues ?? [10, 13, 12, 15, 14, 18]}
        />
      )}
    </Card>
  )
}
