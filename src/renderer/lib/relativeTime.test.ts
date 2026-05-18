import { describe, expect, it } from 'vitest'
import { formatRelative } from './relativeTime'

const NOW = Date.parse('2026-05-17T12:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

describe('formatRelative', () => {
  it('returns "now" for sub-minute differences', () => {
    expect(formatRelative(NOW, NOW)).toBe('now')
    expect(formatRelative(NOW - 30 * SECOND, NOW)).toBe('now')
    expect(formatRelative(NOW - 59 * SECOND, NOW)).toBe('now')
  })

  it('returns minutes for < 1 hour', () => {
    expect(formatRelative(NOW - MINUTE, NOW)).toBe('1m')
    expect(formatRelative(NOW - 5 * MINUTE, NOW)).toBe('5m')
    expect(formatRelative(NOW - 59 * MINUTE, NOW)).toBe('59m')
  })

  it('returns hours for < 1 day at the 60-minute boundary', () => {
    expect(formatRelative(NOW - 60 * MINUTE, NOW)).toBe('1h')
    expect(formatRelative(NOW - 2 * HOUR, NOW)).toBe('2h')
    expect(formatRelative(NOW - 23 * HOUR, NOW)).toBe('23h')
  })

  it('returns days for < 7 days at the 24-hour boundary', () => {
    expect(formatRelative(NOW - 24 * HOUR, NOW)).toBe('1d')
    expect(formatRelative(NOW - 3 * DAY, NOW)).toBe('3d')
    expect(formatRelative(NOW - 6 * DAY, NOW)).toBe('6d')
  })

  it('returns weeks for < 5 weeks at the 7-day boundary', () => {
    expect(formatRelative(NOW - 7 * DAY, NOW)).toBe('1w')
    expect(formatRelative(NOW - 2 * WEEK, NOW)).toBe('2w')
    expect(formatRelative(NOW - 4 * WEEK, NOW)).toBe('4w')
  })

  it('returns a short date for ≥ 5 weeks', () => {
    const out = formatRelative(NOW - 6 * WEEK, NOW)
    // Locale-dependent but always contains a digit and a non-digit char.
    expect(out).toMatch(/[A-Za-z0-9]/)
    expect(out).not.toMatch(/^\d+[mhdw]$/)
    expect(out).not.toBe('now')
  })

  it('accepts ISO strings and Date instances', () => {
    const iso = new Date(NOW - 2 * HOUR).toISOString()
    expect(formatRelative(iso, NOW)).toBe('2h')
    expect(formatRelative(new Date(NOW - 5 * MINUTE), NOW)).toBe('5m')
  })

  it('treats future timestamps as "now" (clamps negative diffs)', () => {
    expect(formatRelative(NOW + 60 * MINUTE, NOW)).toBe('now')
  })

  it('returns empty string for invalid input', () => {
    expect(formatRelative('not-a-date', NOW)).toBe('')
    expect(formatRelative(Number.NaN, NOW)).toBe('')
  })
})
