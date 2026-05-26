import type {
  Automation,
  AutomationSchedulePreview,
  AutomationStatus,
} from '../../../../shared/contracts/automations'

const MINUTE_MS = 60_000
const OVERDUE_MS = 5 * MINUTE_MS
const MAX_SCAN_MINUTES = 366 * 24 * 60

type CronField = {
  min: number
  max: number
  values: ReadonlySet<number>
}

type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

export type DueClassification = 'not-due' | 'due' | 'overdue'

export function calculateNextRunAt(schedule: string, after = Date.now()): number | undefined {
  const parsed = parseCronSchedule(schedule)
  const start = floorToMinute(after) + MINUTE_MS

  for (let offset = 0; offset < MAX_SCAN_MINUTES; offset += 1) {
    const candidate = start + offset * MINUTE_MS
    if (matchesCron(parsed, new Date(candidate))) {
      return candidate
    }
  }

  return undefined
}

export function classifyDueState(nextRunAt: number | undefined, now = Date.now()): DueClassification {
  if (!nextRunAt || now < nextRunAt) return 'not-due'
  return now - nextRunAt >= OVERDUE_MS ? 'overdue' : 'due'
}

export function previewAutomationSchedule(
  automation: Pick<Automation, 'enabled' | 'schedule' | 'nextRunAt'>,
  now = Date.now(),
): AutomationSchedulePreview {
  if (!automation.enabled) {
    return { status: 'paused', due: false, overdue: false }
  }

  let nextRunAt = automation.nextRunAt
  try {
    nextRunAt = nextRunAt ?? calculateNextRunAt(automation.schedule, now)
  } catch {
    return { status: 'invalid', due: false, overdue: false }
  }

  const dueState = classifyDueState(nextRunAt, now)
  const status: AutomationStatus =
    dueState === 'overdue' ? 'overdue' : dueState === 'due' ? 'due' : 'scheduled'

  return {
    status,
    nextRunAt,
    due: dueState !== 'not-due',
    overdue: dueState === 'overdue',
  }
}

export function parseCronSchedule(schedule: string): ParsedCron {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Cron schedule must use five fields: minute hour day month weekday.')
  }

  return {
    minute: parseField(parts[0] ?? '', 0, 59),
    hour: parseField(parts[1] ?? '', 0, 23),
    dayOfMonth: parseField(parts[2] ?? '', 1, 31),
    month: parseField(parts[3] ?? '', 1, 12),
    dayOfWeek: parseField(parts[4] ?? '', 0, 7),
  }
}

function parseField(source: string, min: number, max: number): CronField {
  const values = new Set<number>()

  for (const segment of source.split(',')) {
    addSegmentValues(values, segment.trim(), min, max)
  }

  if (values.size === 0) {
    throw new Error(`Cron field "${source}" has no values.`)
  }

  return { min, max, values }
}

function addSegmentValues(values: Set<number>, segment: string, min: number, max: number): void {
  if (!segment) throw new Error('Cron fields cannot contain empty segments.')

  const [rangePart, stepPart] = segment.split('/')
  const step = stepPart === undefined ? 1 : parsePositiveInteger(stepPart)
  if (step < 1) throw new Error('Cron step must be greater than zero.')

  const [start, end] = parseRange(rangePart ?? '', min, max)
  for (let value = start; value <= end; value += step) {
    values.add(normalizeDayOfWeek(value, max))
  }
}

function parseRange(source: string, min: number, max: number): [number, number] {
  if (source === '*') return [min, max]

  const parts = source.split('-')
  if (parts.length === 1) {
    const value = parseBound(parts[0] ?? '', min, max)
    return [value, value]
  }

  if (parts.length === 2) {
    const start = parseBound(parts[0] ?? '', min, max)
    const end = parseBound(parts[1] ?? '', min, max)
    if (start > end) throw new Error('Cron ranges must be ascending.')
    return [start, end]
  }

  throw new Error(`Invalid cron range: ${source}`)
}

function parseBound(source: string, min: number, max: number): number {
  const value = parsePositiveInteger(source)
  if (value < min || value > max) {
    throw new Error(`Cron value ${value} is outside ${min}-${max}.`)
  }
  return value
}

function parsePositiveInteger(source: string): number {
  if (!/^\d+$/.test(source)) {
    throw new Error(`Invalid cron value: ${source}`)
  }
  return Number(source)
}

function matchesCron(parsed: ParsedCron, date: Date): boolean {
  const dayOfWeek = date.getDay()
  return (
    parsed.minute.values.has(date.getMinutes()) &&
    parsed.hour.values.has(date.getHours()) &&
    parsed.dayOfMonth.values.has(date.getDate()) &&
    parsed.month.values.has(date.getMonth() + 1) &&
    (parsed.dayOfWeek.values.has(dayOfWeek) ||
      (dayOfWeek === 0 && parsed.dayOfWeek.values.has(7)))
  )
}

function normalizeDayOfWeek(value: number, max: number): number {
  return max === 7 && value === 7 ? 0 : value
}

function floorToMinute(timestamp: number): number {
  return Math.floor(timestamp / MINUTE_MS) * MINUTE_MS
}
