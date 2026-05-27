import { describe, expect, it } from 'vitest'
import {
  CODEX_PLAN_MODE_MAX_STALL_MS,
  maxStallMsForSession,
} from './sessionLivenessService'

describe('maxStallMsForSession', () => {
  it('extends the stall window for silent Codex plan-mode planning turns', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: true }, 300_000)).toBe(
      CODEX_PLAN_MODE_MAX_STALL_MS,
    )
  })

  it('keeps normal sessions on the configured stall window', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: false }, 300_000)).toBe(300_000)
    expect(maxStallMsForSession({ agentId: 'claude-code', planMode: true }, 300_000)).toBe(
      300_000,
    )
  })

  it('preserves disabled stall detection', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: true }, false)).toBe(false)
  })
})
