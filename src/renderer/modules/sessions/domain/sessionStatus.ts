import type { SessionStatus } from '../../../../shared/types'

export function isSessionStatus(status: string): status is SessionStatus {
  return (
    status === 'running' ||
    status === 'awaiting-approval' ||
    status === 'awaiting-input' ||
    status === 'done' ||
    status === 'error' ||
    status === 'cancelled'
  )
}
