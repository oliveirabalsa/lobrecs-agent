import type { AgentEvent, SessionStatus } from '../../../../shared/types'
import { TERMINAL_SESSION_STATUSES } from './sessionWorkflowTypes'

export function completionStatus(event: AgentEvent): SessionStatus {
  const payload = objectPayload(event.payload)
  const status = readSessionStatus(payload, 'status')
  if (status && TERMINAL_SESSION_STATUSES.has(status)) return status

  const exitCode = readNumber(payload, 'exitCode')
  const signal = payload.signal

  if (exitCode !== undefined && exitCode !== 0) return 'error'
  if (typeof signal === 'string' && signal.trim()) return 'cancelled'

  return 'done'
}

export function withCompletionStatus(event: AgentEvent, status: SessionStatus): AgentEvent {
  const payload = objectPayload(event.payload)
  return {
    ...event,
    payload:
      Object.keys(payload).length > 0
        ? { ...payload, status }
        : { status, value: event.payload },
  }
}

export function textFromUnknownPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload === null || payload === undefined) return ''
  if (typeof payload !== 'object') return String(payload)

  const record = payload as Record<string, unknown>
  const directFields = [
    'text',
    'message',
    'error',
    'detail',
    'reason',
    'result',
    'summary',
    'output',
    'content',
  ]

  for (const field of directFields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value)) {
      const text = value.map(textFromUnknownPayload).join(' ')
      if (text.trim()) return text
    }
    if (value && typeof value === 'object') {
      const text = textFromUnknownPayload(value)
      if (text.trim()) return text
    }
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

export function extractUsage(payload: unknown):
  | { tokensIn: number; tokensOut: number; costUsd?: number }
  | null {
  const payloadObject = objectPayload(payload)
  const usageObject = objectPayload(payloadObject.usage) ?? payloadObject

  const tokensIn =
    readNumber(usageObject, 'input_tokens') ??
    readNumber(usageObject, 'inputTokens') ??
    readNumber(usageObject, 'tokens_in') ??
    readNumber(usageObject, 'tokensIn') ??
    0
  const tokensOut =
    readNumber(usageObject, 'output_tokens') ??
    readNumber(usageObject, 'outputTokens') ??
    readNumber(usageObject, 'tokens_out') ??
    readNumber(usageObject, 'tokensOut') ??
    0
  const costUsd =
    readNumber(usageObject, 'cost_usd') ??
    readNumber(usageObject, 'costUsd') ??
    readNumber(payloadObject, 'cost_usd') ??
    readNumber(payloadObject, 'costUsd')

  if (tokensIn === 0 && tokensOut === 0 && costUsd === undefined) {
    return null
  }

  return { tokensIn, tokensOut, costUsd }
}

export function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function readNumber(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readSessionStatus(
  object: Record<string, unknown>,
  key: string,
): SessionStatus | undefined {
  const value = object[key]
  return typeof value === 'string' && isSessionStatus(value) ? value : undefined
}

function isSessionStatus(value: string): value is SessionStatus {
  return (
    value === 'running' ||
    value === 'awaiting-approval' ||
    value === 'awaiting-input' ||
    value === 'done' ||
    value === 'error' ||
    value === 'cancelled'
  )
}
