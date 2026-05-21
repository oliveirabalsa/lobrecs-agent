import type {
  AgentEvent,
  ApprovalRequest,
  DiffProposal,
  SessionStatus,
} from '../../../shared/types'

export interface TerminalLike {
  write(message: string): void
  scrollToBottom?(): void
}

export interface TerminalEventCallbacks {
  onDiffProposals(proposals: DiffProposal[]): void
  onApprovalRequest(request: ApprovalRequest | null): void
  onStatusChange(status: SessionStatus): void
}

interface TextOptions {
  fallbackToJson?: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function textFromPayload(payload: unknown, options: TextOptions = {}): string {
  if (typeof payload === 'string') return payload
  if (isRecord(payload) && typeof payload.text === 'string') return payload.text

  const structuredText = textFromStructuredPayload(payload)
  if (structuredText) return structuredText
  if (payload === undefined || payload === null) return ''
  if (!options.fallbackToJson) return ''

  try {
    return `${JSON.stringify(payload, null, 2)}\r\n`
  } catch {
    return String(payload)
  }
}

export function normalizeDiffPayload(payload: unknown): DiffProposal[] {
  const proposals = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.proposals)
      ? payload.proposals
      : []

  return proposals
    .filter((proposal): proposal is DiffProposal => {
      return (
        isRecord(proposal) &&
        typeof proposal.filePath === 'string' &&
        typeof proposal.originalContent === 'string' &&
        typeof proposal.proposedContent === 'string'
      )
    })
    .map((proposal) => ({
      ...proposal,
      changeType: proposal.changeType ?? inferChangeType(proposal),
      additions: proposal.additions ?? countLines(proposal.proposedContent),
      deletions: proposal.deletions ?? countLines(proposal.originalContent),
      status: proposal.status ?? 'pending',
    }))
}

export function isLiveDiffPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.live === true
}

export function normalizeApprovalPayload(payload: unknown): ApprovalRequest {
  if (isRecord(payload)) {
    const action =
      payload.action === 'write-file' ||
      payload.action === 'run-command' ||
      payload.action === 'delete-file' ||
      payload.action === 'other'
        ? payload.action
        : 'other'

    return {
      action,
      description:
        typeof payload.description === 'string'
          ? payload.description
          : typeof payload.summary === 'string'
            ? payload.summary
            : 'Agent requested approval',
      details:
        typeof payload.details === 'string'
          ? payload.details
          : typeof payload.command === 'string'
            ? payload.command
            : textFromPayload(payload, { fallbackToJson: true }),
      risk:
        payload.risk === 'low' || payload.risk === 'medium' || payload.risk === 'high'
          ? payload.risk
          : action === 'delete-file'
            ? 'high'
            : action === 'other'
              ? 'low'
              : 'medium',
      command: typeof payload.command === 'string' ? payload.command : commandFromPayload(payload),
      cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
      filePath:
        typeof payload.filePath === 'string'
          ? payload.filePath
          : typeof payload.file_path === 'string'
            ? payload.file_path
            : typeof payload.path === 'string'
              ? payload.path
              : undefined,
      raw: payload,
    }
  }

  return {
    action: 'other',
    description: 'Agent requested approval',
    details: textFromPayload(payload, { fallbackToJson: true }),
    risk: 'medium',
    raw: payload,
  }
}

export function completionStatus(payload: unknown): SessionStatus {
  if (!isRecord(payload)) return 'done'
  if (payload.subtype === 'error' || payload.is_error === true) return 'error'

  if (
    payload.status === 'done' ||
    payload.status === 'error' ||
    payload.status === 'cancelled'
  ) {
    return payload.status
  }

  const exitCode = payload.exitCode ?? payload.exit_code
  return exitCode === 0 || exitCode === undefined || exitCode === null ? 'done' : 'error'
}

export function eventKey(event: AgentEvent): string {
  return `${event.timestamp}:${event.type}:${stringifyPayload(event.payload)}`
}

export function createTerminalEventHandler(
  term: TerminalLike,
  callbacks: TerminalEventCallbacks,
  seenEvents: Set<string>,
): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    const key = eventKey(event)
    if (seenEvents.has(key)) return
    seenEvents.add(key)

    if (event.type === 'stdout' || event.type === 'stderr') {
      writeAndScroll(term, textFromPayload(event.payload))
      return
    }

    if (event.type === 'diff') {
      const proposals = normalizeDiffPayload(event.payload)
      if (proposals.length > 0) {
        callbacks.onDiffProposals(proposals)
        if (!isLiveDiffPayload(event.payload)) {
          writeLine(term, `Diff proposal received for ${proposals.length} file(s).`)
        }
      }
      return
    }

    if (event.type === 'approval-request') {
      callbacks.onStatusChange('awaiting-approval')
      callbacks.onApprovalRequest(normalizeApprovalPayload(event.payload))
      writeLine(term, 'Approval requested.')
      return
    }

    if (event.type === 'session-complete') {
      const finalOutput = shouldPrintCompletionPayload(event.payload)
        ? textFromPayload(event.payload)
        : ''
      if (finalOutput) writeAndScroll(term, finalOutput)

      const status = completionStatus(event.payload)
      callbacks.onStatusChange(status)
      callbacks.onApprovalRequest(null)
      writeLine(term, status === 'error' ? 'Session failed.' : 'Session complete.')
      return
    }

    if (event.type === 'error') {
      callbacks.onStatusChange('error')
      callbacks.onApprovalRequest(null)
      writeLine(term, textFromPayload(event.payload, { fallbackToJson: true }) || 'Session failed.')
    }
  }
}

function shouldPrintCompletionPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  if (payload.type !== 'result') return true

  return payload.subtype === 'error' || payload.is_error === true
}

function textFromStructuredPayload(payload: unknown): string {
  if (!isRecord(payload)) return ''
  if (typeof payload.text === 'string') return payload.text

  const directFields = [
    'part',
    'state',
    'metadata',
    'result',
    'message',
    'content',
    'delta',
    'output',
    'formatted',
    'summary',
    'error',
  ]

  for (const field of directFields) {
    const value = payload[field]
    if (typeof value === 'string') return `${value}\r\n`
    if (Array.isArray(value)) {
      const text = value.map(textFromStructuredPayload).join('')
      if (text) return text
    }
    if (isRecord(value)) {
      const text = textFromStructuredPayload(value)
      if (text) return text
    }
  }

  if (payload.type === 'text' && typeof payload.text === 'string') {
    return payload.text
  }

  return ''
}

function writeLine(term: TerminalLike, message: string) {
  writeAndScroll(term, `\r\n${message}\r\n`)
}

function writeAndScroll(term: TerminalLike, message: string) {
  if (!message) return
  term.write(message)
  term.scrollToBottom?.()
}

function inferChangeType(proposal: DiffProposal): 'added' | 'modified' | 'deleted' {
  if (!proposal.originalContent && proposal.proposedContent) return 'added'
  if (proposal.originalContent && !proposal.proposedContent) return 'deleted'
  return 'modified'
}

function countLines(content: string): number {
  if (!content) return 0
  return content.split('\n').filter(Boolean).length
}

function commandFromPayload(payload: Record<string, unknown>): string | undefined {
  const argv = payload.argv
  if (Array.isArray(argv) && argv.every((item) => typeof item === 'string')) {
    return argv.join(' ')
  }

  return undefined
}

function stringifyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}
