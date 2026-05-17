import { describe, expect, it } from 'vitest'
import { assertSpecStatusTransition, canTransitionSpecStatus } from './specStatus'

describe('spec status transitions', () => {
  it('allows the approved execution loop', () => {
    expect(canTransitionSpecStatus('draft', 'approved')).toBe(true)
    expect(canTransitionSpecStatus('approved', 'running')).toBe(true)
    expect(canTransitionSpecStatus('running', 'reviewing')).toBe(true)
    expect(canTransitionSpecStatus('reviewing', 'verified')).toBe(true)
  })

  it('allows failed specs to be revised or rerun', () => {
    expect(canTransitionSpecStatus('failed', 'draft')).toBe(true)
    expect(canTransitionSpecStatus('failed', 'approved')).toBe(true)
    expect(canTransitionSpecStatus('failed', 'running')).toBe(true)
  })

  it('rejects skipping approval from draft to running', () => {
    expect(canTransitionSpecStatus('draft', 'running')).toBe(false)
    expect(() => assertSpecStatusTransition('draft', 'running')).toThrow(
      'Invalid spec status transition: draft -> running',
    )
  })
})
