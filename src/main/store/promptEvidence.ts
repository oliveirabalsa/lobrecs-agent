import { randomUUID } from 'node:crypto'
import type { AgentId, PromptEvidenceRecord } from '../../shared/types'
import { getDb } from './db'

type PromptEvidenceRow = {
  id: string
  session_id: string
  project_id: string
  thread_id: string | null
  agent_id: AgentId
  model: string
  prompt: string
  resolved_context: string | null
  adapter_context: string | null
  context_bytes: number
  redacted: number
  created_at: number
}

export interface CreatePromptEvidenceInput {
  sessionId: string
  projectId: string
  threadId?: string
  agentId: AgentId
  model: string
  prompt: string
  resolvedContext?: string | null
  adapterContext?: string | null
}

const SECRET_ASSIGNMENT =
  /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*([^\s"'`]+)/gi

function rowToRecord(row: PromptEvidenceRow): PromptEvidenceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    threadId: row.thread_id ?? undefined,
    agentId: row.agent_id,
    model: row.model,
    prompt: row.prompt,
    resolvedContext: row.resolved_context ?? undefined,
    adapterContext: row.adapter_context ?? undefined,
    contextBytes: row.context_bytes,
    redacted: row.redacted === 1,
    createdAt: row.created_at,
  }
}

function redactSecrets(value: string | null | undefined): { value: string | null; redacted: boolean } {
  if (!value) return { value: value ?? null, redacted: false }

  let redacted = false
  const next = value.replace(SECRET_ASSIGNMENT, (_match, key: string) => {
    redacted = true
    return `${key}=<redacted>`
  })

  return { value: next, redacted }
}

export const promptEvidenceStore = {
  create(input: CreatePromptEvidenceInput): PromptEvidenceRecord {
    const id = randomUUID()
    const now = Date.now()
    const resolved = redactSecrets(input.resolvedContext)
    const adapter = redactSecrets(input.adapterContext)
    const redacted = resolved.redacted || adapter.redacted
    const contextBytes = Buffer.byteLength(
      [resolved.value, adapter.value].filter(Boolean).join('\n\n'),
      'utf-8',
    )

    getDb()
      .prepare(
        `
          INSERT OR REPLACE INTO prompt_evidence_records (
            id, session_id, project_id, thread_id, agent_id, model, prompt,
            resolved_context, adapter_context, context_bytes, redacted, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.sessionId,
        input.projectId,
        input.threadId ?? null,
        input.agentId,
        input.model,
        input.prompt,
        resolved.value,
        adapter.value,
        contextBytes,
        redacted ? 1 : 0,
        now,
      )

    const record = this.getForSession(input.sessionId)
    if (!record) {
      throw new Error(`Prompt evidence was not persisted for session ${input.sessionId}`)
    }
    return record
  },

  getForSession(sessionId: string): PromptEvidenceRecord | null {
    const row = getDb()
      .prepare('SELECT * FROM prompt_evidence_records WHERE session_id = ?')
      .get(sessionId) as PromptEvidenceRow | undefined

    return row ? rowToRecord(row) : null
  },
}

