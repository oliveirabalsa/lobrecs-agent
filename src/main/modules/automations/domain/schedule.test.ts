import { describe, expect, it } from 'vitest'
import {
  calculateNextRunAt,
  classifyDueState,
  previewAutomationSchedule,
} from './schedule'

describe('automation schedule rules', () => {
  it('calculates the next five-field cron run after the provided timestamp', () => {
    const after = new Date('2026-05-26T08:58:30').getTime()

    expect(calculateNextRunAt('0 9 * * 1-5', after)).toBe(
      new Date('2026-05-26T09:00:00').getTime(),
    )
  })

  it('classifies due and overdue scheduled runs', () => {
    const dueAt = new Date('2026-05-26T09:00:00').getTime()

    expect(classifyDueState(dueAt, dueAt)).toBe('due')
    expect(classifyDueState(dueAt, dueAt + 6 * 60_000)).toBe('overdue')
    expect(classifyDueState(dueAt, dueAt - 1)).toBe('not-due')
  })

  it('marks disabled and invalid schedules without throwing from preview', () => {
    expect(
      previewAutomationSchedule({
        enabled: false,
        schedule: 'bad',
      }),
    ).toMatchObject({ status: 'paused', due: false })

    expect(
      previewAutomationSchedule({
        enabled: true,
        schedule: 'bad',
      }),
    ).toMatchObject({ status: 'invalid', due: false })
  })
})
