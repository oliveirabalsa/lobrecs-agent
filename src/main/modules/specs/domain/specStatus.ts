import type { SpecStatus } from '../../../../shared/types'

const transitions: Record<SpecStatus, SpecStatus[]> = {
  draft: ['approved', 'failed'],
  approved: ['running', 'draft', 'failed'],
  running: ['reviewing', 'failed'],
  reviewing: ['verified', 'failed', 'running'],
  verified: ['running', 'failed'],
  failed: ['draft', 'approved', 'running'],
}

export function canTransitionSpecStatus(from: SpecStatus, to: SpecStatus): boolean {
  return from === to || transitions[from].includes(to)
}

export function assertSpecStatusTransition(from: SpecStatus, to: SpecStatus): void {
  if (!canTransitionSpecStatus(from, to)) {
    throw new Error(`Invalid spec status transition: ${from} -> ${to}`)
  }
}
