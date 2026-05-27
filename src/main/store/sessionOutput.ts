import type { AgentEvent } from '../../shared/types'

export interface ExtractSessionOutputOptions {
  maxChars?: number
}

export interface MergeSessionOutputFragmentOptions extends ExtractSessionOutputOptions {
  currentTrailingWhitespace?: string
}

const TRUNCATED_OUTPUT_SUFFIX = '\n[truncated]'

export function extractSessionOutput(
  events: readonly AgentEvent[],
  options: ExtractSessionOutputOptions = {},
): string | undefined {
  const assistantOutput = mergeSessionOutputFragments(
    events.flatMap(assistantMessageTextFromActivity),
  )
  if (assistantOutput) return truncateOutput(assistantOutput, options.maxChars)

  const stdoutOutput = mergeSessionOutputFragments(
    events
      .filter((event) => event.type === 'stdout')
      .map((event) => textFromPayload(event.payload)),
  )

  return stdoutOutput ? truncateOutput(stdoutOutput, options.maxChars) : undefined
}

export function mergeSessionOutputFragment(
  current: string | null | undefined,
  incoming: string | null | undefined,
  options: MergeSessionOutputFragmentOptions = {},
): string | undefined {
  const currentText = typeof current === 'string' ? current.trim() : ''
  const incomingText = typeof incoming === 'string' ? incoming : ''

  if (!incomingText.trim()) return currentText || undefined
  if (currentText.endsWith(TRUNCATED_OUTPUT_SUFFIX)) return currentText

  const restoredCurrent =
    currentText &&
    options.currentTrailingWhitespace &&
    !/\s$/.test(currentText) &&
    !/^\s/.test(incomingText)
      ? `${currentText}${options.currentTrailingWhitespace}`
      : currentText

  const merged = mergeSessionOutputFragments(
    restoredCurrent ? [restoredCurrent, incomingText] : [incomingText],
  )

  return merged ? truncateOutput(merged, options.maxChars) : undefined
}

export function mergeSessionOutputFragments(values: readonly string[]): string | undefined {
  let output = ''

  for (const value of values) {
    output = mergeSessionOutputText(output, value)
  }

  const trimmed = output.trim()
  return trimmed ? trimmed : undefined
}

function assistantMessageTextFromActivity(event: AgentEvent): string[] {
  if (event.type !== 'activity' || !isRecord(event.payload)) return []

  const payload = event.payload
  if (
    payload.kind === 'message' &&
    payload.role === 'assistant' &&
    typeof payload.text === 'string'
  ) {
    return [payload.text]
  }

  return []
}

function mergeSessionOutputText(current: string, incoming: string): string {
  if (!incoming.trim()) return current
  if (!current) return incoming

  const currentKey = normalizeOutputText(current)
  const incomingKey = normalizeOutputText(incoming)
  if (!incomingKey || incomingKey === currentKey) return current

  if (incoming.startsWith(current)) return incoming
  if (current.endsWith(incoming)) return current

  if (currentKey.length >= 12 && incomingKey.startsWith(currentKey)) return incoming
  if (incomingKey.length >= 12 && currentKey.endsWith(incomingKey)) return current

  return current + incoming
}

function normalizeOutputText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function textFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!isRecord(payload)) return ''

  for (const field of ['text', 'result', 'message', 'content', 'summary', 'output']) {
    const value = payload[field]
    if (typeof value === 'string') return value
  }

  return ''
}

function truncateOutput(text: string, maxChars: number | undefined): string {
  const trimmed = text.trim()
  if (maxChars === undefined || trimmed.length <= maxChars) return trimmed

  return `${trimmed.slice(0, maxChars).trimEnd()}${TRUNCATED_OUTPUT_SUFFIX}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
