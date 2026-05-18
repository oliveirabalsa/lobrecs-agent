import type {
  AgentActivity,
  AgentEvent,
  ApprovalRequest,
  DiffProposal,
  SessionStatus,
} from '../../shared/types'
import { isClaudeSessionEndCwdDeletedWarning } from '../../shared/contracts/agentOutput'

export function deriveActivityEvents(event: AgentEvent): AgentEvent[] {
  if (event.type === 'activity') return []

  const activity = activityFromEvent(event)
  if (!activity) return []

  const activities = Array.isArray(activity) ? activity : [activity]
  return activities.map((payload, index) => ({
    type: 'activity',
    sessionId: event.sessionId,
    payload,
    timestamp: event.timestamp + index / 1000,
  }))
}

export function activityFromEvent(event: AgentEvent): AgentActivity | AgentActivity[] | null {
  if (event.type === 'stdout') {
    return activityFromStdout(event.payload)
  }

  if (event.type === 'stderr') {
    const text = textFromPayload(event.payload)
    if (!text.trim()) return null
    if (isClaudeSessionEndCwdDeletedWarning(text)) return null

    return {
      kind: 'step',
      title: 'Process warning',
      detail: text.trim(),
      status: 'error',
    }
  }

  if (event.type === 'approval-request') {
    return {
      kind: 'approval',
      request: normalizeApproval(event.payload),
      status: 'pending',
    }
  }

  if (event.type === 'diff') {
    const proposals = normalizeDiffs(event.payload)
    if (proposals.length === 0) return null

    const additions = proposals.reduce((sum, proposal) => sum + (proposal.additions ?? 0), 0)
    const deletions = proposals.reduce((sum, proposal) => sum + (proposal.deletions ?? 0), 0)

    return [
      {
        kind: 'diff-summary',
        filesChanged: proposals.length,
        additions,
        deletions,
        summary: `${proposals.length} file${proposals.length === 1 ? '' : 's'} changed`,
      },
      ...proposals.map((proposal): AgentActivity => ({
        kind: 'file-change',
        filePath: proposal.filePath,
        changeType: proposal.changeType ?? inferChangeType(proposal),
        additions: proposal.additions,
        deletions: proposal.deletions,
        status: proposal.status ?? 'pending',
      })),
    ]
  }

  if (event.type === 'session-complete') {
    const status = completionStatus(event.payload)
    return {
      kind: 'completion',
      status,
      summary: status === 'error' ? 'Session failed' : 'Session complete',
      ...usageFromPayload(event.payload),
    }
  }

  if (event.type === 'error') {
    const text = textFromPayload(event.payload, true).trim()
    return {
      kind: 'step',
      title: 'Session failed',
      detail: text || 'The agent session failed.',
      status: 'error',
    }
  }

  return null
}

function activityFromStdout(payload: unknown): AgentActivity | AgentActivity[] | null {
  if (!isRecord(payload)) {
    const text = textFromPayload(payload)
    return text.trim()
      ? { kind: 'message', role: 'assistant', text, stream: true }
      : null
  }

  const type = typeof payload.type === 'string' ? payload.type : ''
  const codexActivity = activityFromCodexPayload(payload, type)
  if (codexActivity !== undefined) return codexActivity

  if (type.includes('tool_call') || type.includes('tool-call') || type.includes('tool.use')) {
    return {
      kind: 'tool-call',
      name: stringField(payload, 'name') ?? stringField(payload, 'tool') ?? 'tool',
      input: payload.input ?? payload.arguments ?? payload.params,
      status: 'running',
    }
  }

  if (type.includes('tool_result') || type.includes('tool-result')) {
    return {
      kind: 'tool-result',
      name: stringField(payload, 'name') ?? stringField(payload, 'tool') ?? 'tool',
      output: textFromPayload(payload),
      status: type.includes('error') ? 'error' : 'done',
    }
  }

  const command = commandFromPayload(payload)
  if (command) {
    return {
      kind: 'command',
      command,
      cwd: stringField(payload, 'cwd'),
      status: type.includes('complete') || type.includes('result') ? 'done' : 'running',
    }
  }

  const text = textFromPayload(payload)
  if (text.trim()) {
    return { kind: 'message', role: 'assistant', text, stream: true }
  }

  if (type) {
    return {
      kind: 'step',
      title: labelFromType(type),
      status: type.includes('error') ? 'error' : 'running',
    }
  }

  return null
}

function activityFromCodexPayload(
  payload: Record<string, unknown>,
  type: string,
): AgentActivity | AgentActivity[] | null | undefined {
  if (type === 'thread.started') {
    return null
  }

  if (type === 'turn.started') {
    return { kind: 'step', title: 'Thinking', status: 'running' }
  }

  const item = isRecord(payload.item) ? payload.item : payload
  const itemType = stringField(item, 'type') ?? type

  if (type === 'item.started') {
    if (isReasoningItem(itemType)) {
      return { kind: 'step', title: 'Thinking', status: 'running' }
    }

    const toolName = toolNameFromItem(item, itemType)
    if (toolName) {
      return {
        kind: 'tool-call',
        name: toolName,
        input: toolInputFromItem(item),
        status: 'running',
      }
    }

    return null
  }

  if (type === 'item.completed') {
    const text = textFromPayload(item)
    if (isMessageItem(itemType) && text.trim()) {
      return { kind: 'message', role: 'assistant', text, stream: true }
    }

    if (isReasoningItem(itemType)) {
      const detail = text.trim()
      return { kind: 'step', title: 'Thinking', detail: detail || undefined, status: 'done' }
    }

    if (isToolResultItem(itemType)) {
      return {
        kind: 'tool-result',
        name: toolNameFromItem(item, itemType) ?? 'tool',
        output: text.trim() ? text : undefined,
        status: type.includes('error') ? 'error' : 'done',
      }
    }

    const toolName = toolNameFromItem(item, itemType)
    if (toolName) {
      const output = commandOutputFromItem(item)
      const call: AgentActivity = {
        kind: 'tool-call',
        name: toolName,
        input: toolInputFromItem(item),
        status: itemIncludesError(item) ? 'error' : 'done',
      }

      return output
        ? [
            call,
            {
              kind: 'tool-result',
              name: toolName,
              output,
              status: itemIncludesError(item) ? 'error' : 'done',
            },
          ]
        : call
    }

    return null
  }

  if (type === 'response.output_text.delta' || type === 'agent_message') {
    const text = textFromPayload(payload)
    return text.trim() ? { kind: 'message', role: 'assistant', text, stream: true } : null
  }

  if (type.startsWith('thread.') || type.startsWith('turn.') || type.startsWith('item.')) {
    return null
  }

  return undefined
}

function normalizeApproval(payload: unknown): ApprovalRequest {
  if (!isRecord(payload)) {
    return {
      action: 'other',
      description: 'Agent requested approval',
      details: textFromPayload(payload, true),
      risk: 'medium',
      raw: payload,
    }
  }

  const action =
    payload.action === 'write-file' ||
    payload.action === 'run-command' ||
    payload.action === 'delete-file' ||
    payload.action === 'other'
      ? payload.action
      : commandFromPayload(payload)
        ? 'run-command'
        : 'other'

  const command = commandFromPayload(payload)
  const filePath =
    stringField(payload, 'filePath') ??
    stringField(payload, 'file_path') ??
    stringField(payload, 'path')

  return {
    action,
    description:
      stringField(payload, 'description') ??
      stringField(payload, 'summary') ??
      (command ? `Run ${command}` : 'Agent requested approval'),
    details:
      stringField(payload, 'details') ??
      command ??
      filePath ??
      textFromPayload(payload, true),
    risk: riskForAction(action),
    command,
    cwd: stringField(payload, 'cwd'),
    filePath,
    raw: payload,
  }
}

function normalizeDiffs(payload: unknown): DiffProposal[] {
  const proposals = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.proposals)
      ? payload.proposals
      : []

  return proposals.filter((proposal): proposal is DiffProposal => {
    return (
      isRecord(proposal) &&
      typeof proposal.filePath === 'string' &&
      typeof proposal.originalContent === 'string' &&
      typeof proposal.proposedContent === 'string'
    )
  })
}

function inferChangeType(proposal: DiffProposal): 'added' | 'modified' | 'deleted' {
  if (!proposal.originalContent && proposal.proposedContent) return 'added'
  if (proposal.originalContent && !proposal.proposedContent) return 'deleted'
  return 'modified'
}

function riskForAction(action: ApprovalRequest['action']): ApprovalRequest['risk'] {
  if (action === 'delete-file') return 'high'
  if (action === 'write-file' || action === 'run-command') return 'medium'
  return 'low'
}

function completionStatus(payload: unknown): SessionStatus {
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

function usageFromPayload(
  payload: unknown,
): Pick<Extract<AgentActivity, { kind: 'completion' }>, 'tokensIn' | 'tokensOut' | 'costUsd'> {
  const object = isRecord(payload) ? payload : {}
  const usage = isRecord(object.usage) ? object.usage : object

  return {
    tokensIn: numberField(usage, 'input_tokens') ?? numberField(usage, 'tokensIn'),
    tokensOut: numberField(usage, 'output_tokens') ?? numberField(usage, 'tokensOut'),
    costUsd: numberField(usage, 'cost_usd') ?? numberField(usage, 'costUsd'),
  }
}

function textFromPayload(payload: unknown, fallbackToJson = false): string {
  if (typeof payload === 'string') return payload
  if (!isRecord(payload)) return fallbackToJson ? String(payload ?? '') : ''

  const text = stringField(payload, 'text')
  if (text) return text

  for (const field of ['message', 'content', 'delta', 'output', 'result', 'summary', 'error', 'item']) {
    const value = payload[field]
    if (typeof value === 'string') return `${value}\n`
    if (Array.isArray(value)) {
      const nested = value.map((item) => textFromPayload(item)).join('')
      if (nested) return nested
    }
    if (isRecord(value)) {
      const nested = textFromPayload(value)
      if (nested) return nested
    }
  }

  if (!fallbackToJson) return ''

  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function commandFromPayload(payload: Record<string, unknown>): string | undefined {
  const command = stringField(payload, 'command')
  if (command) return command

  const argv = payload.argv
  if (Array.isArray(argv) && argv.every((item) => typeof item === 'string')) {
    return argv.join(' ')
  }

  return undefined
}

function labelFromType(type: string): string {
  return type
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isMessageItem(type: string): boolean {
  return (
    type === 'message' ||
    type === 'agent_message' ||
    type === 'assistant_message' ||
    type === 'output_text'
  )
}

function isReasoningItem(type: string): boolean {
  return type === 'reasoning' || type === 'thinking' || type.includes('reasoning')
}

function isToolResultItem(type: string): boolean {
  return (
    type === 'function_call_output' ||
    type === 'tool_result' ||
    type === 'tool-result' ||
    type.includes('tool_result')
  )
}

function toolNameFromItem(
  item: Record<string, unknown>,
  itemType: string,
): string | undefined {
  const directName = stringField(item, 'name') ?? stringField(item, 'tool')
  if (directName) return directName

  if (
    itemType === 'function_call' ||
    itemType === 'tool_call' ||
    itemType === 'tool-call' ||
    itemType === 'command_execution' ||
    itemType === 'local_shell_call' ||
    itemType.includes('tool_call')
  ) {
    return itemType === 'local_shell_call' || itemType === 'command_execution' ? 'shell' : 'tool'
  }

  return undefined
}

function toolInputFromItem(item: Record<string, unknown>): unknown {
  return item.input ?? item.arguments ?? stringField(item, 'command')
}

function commandOutputFromItem(item: Record<string, unknown>): string | undefined {
  return stringField(item, 'aggregated_output') ?? stringField(item, 'output')
}

function itemIncludesError(item: Record<string, unknown>): boolean {
  return (
    item.status === 'failed' ||
    item.status === 'error' ||
    (typeof item.exit_code === 'number' && item.exit_code !== 0)
  )
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberField(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
