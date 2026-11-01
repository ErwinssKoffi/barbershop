import type { CheckoutCommand, CheckoutResult } from './checkout'

export interface QueuedCheckout {
  idempotencyKey: string
  tenantId: string
  actorId: string
  scope: string
  command: CheckoutCommand
  state: 'pending' | 'confirmed' | 'rejected'
  createdAt: number
  updatedAt: number
  attempts: number
  nextAttemptAt: number
  leaseToken?: string
  leaseUntil?: number
  error?: { code: string; message: string }
  paused?: boolean
  reviewHistory?: {at:number;outcome:'confirmed' | 'not_found' | 'unavailable' | 'mismatch' | 'resumed'}[]
  result?: CheckoutResult
}
