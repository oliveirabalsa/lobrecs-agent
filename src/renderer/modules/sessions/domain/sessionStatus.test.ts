import { describe, expect, it } from 'vitest'
import { isSessionStatus } from './sessionStatus'

describe('isSessionStatus', () => {
  it('accepts known session statuses and rejects unknown values', () => {
    expect(isSessionStatus('running')).toBe(true)
    expect(isSessionStatus('awaiting-approval')).toBe(true)
    expect(isSessionStatus('done')).toBe(true)
    expect(isSessionStatus('unknown')).toBe(false)
  })
})
