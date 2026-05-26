import { createRequire } from 'node:module'
import type { ThreadTranscriptTurn, ThreadUpdatedEvent, Thread } from '../../../../shared/types'
import { buildBoundedPromptContext, truncateForContext } from '../../../modules/context/application/contextBudget'
import { redactSensitiveText } from '../../../modules/context/domain/secretRedaction'
import { sessionsStore, threadsStore } from '../../../store'
import type {
  DispatchSessionParams,
  SessionContextResolver,
} from '../../../session/SessionManager'

const THREAD_CONTEXT_SESSION_LIMIT = 6
const THREAD_CONTEXT_RECENT_TURNS = 2
const THREAD_CONTEXT_PROMPT_CHARS = 1_200
const THREAD_CONTEXT_ASSISTANT_CHARS = 2_000
const THREAD_CONTEXT_SUMMARY_CHARS = 350
const MAX_ADAPTER_CONTEXT_CHARS = 24_000
const require = createRequire(import.meta.url)

export type SessionDispatchBootstrapServiceOptions = {
  broadcastThreadUpdated(thread: Thread): void
  getContextResolver(): SessionContextResolver | undefined
}

export class SessionDispatchBootstrapService {
  constructor(private readonly options: SessionDispatchBootstrapServiceOptions) {}

  resolveOrCreateThread(params: DispatchSessionParams): string {
    if (params.threadId) {
      const existing = threadsStore.get(params.threadId)
      if (!existing) {
        throw new Error(`Thread not found: ${params.threadId}`)
      }
      if (existing.projectId !== params.projectId) {
        throw new Error(
          `Thread ${params.threadId} belongs to a different project (${existing.projectId})`,
        )
      }
      return existing.id
    }

    const title = params.prompt.trim().slice(0, 60) || 'Untitled thread'
    const created = threadsStore.create({ projectId: params.projectId, title })
    this.options.broadcastThreadUpdated(created)
    return created.id
  }

  async resolveDispatchContext(
    params: DispatchSessionParams,
  ): Promise<string | null | undefined> {
    const resolveContext = this.options.getContextResolver()
    if (!resolveContext) return params.context

    return resolveContext({
      projectId: params.projectId,
      repoPath: params.repoPath,
      prompt: params.contextQuery ?? params.prompt,
      baseContext: params.context,
      planMode: params.planMode ?? false,
    })
  }

  buildAdapterContext(
    baseContext: string | null | undefined,
    threadId: string,
    excludeSessionId: string,
  ): string | null | undefined {
    return buildAdapterContext(
      baseContext,
      sessionsStore.listThreadTranscript(threadId, {
        limit: THREAD_CONTEXT_SESSION_LIMIT,
        excludeSessionId,
      }),
    )
  }
}

export function broadcastThreadUpdatedToRenderer(thread: Thread): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{
          webContents: { send(channel: string, payload: ThreadUpdatedEvent): void }
        }>
      }
    }

    const payload: ThreadUpdatedEvent = { threadId: thread.id, thread }
    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send('thread:updated', payload)
    }
  } catch {
    // Unit tests and non-Electron contexts: silently noop.
  }
}

function buildAdapterContext(
  baseContext: string | null | undefined,
  transcript: ThreadTranscriptTurn[],
): string | null | undefined {
  const trimmedBaseContext = baseContext?.trim()
  const historyBlock = buildThreadHistoryBlock(transcript)
  if (!historyBlock) {
    return trimmedBaseContext
      ? truncateForContext(redactSensitiveText(trimmedBaseContext), MAX_ADAPTER_CONTEXT_CHARS)
      : null
  }

  return buildBoundedPromptContext(
    [
      { title: 'Prepared project context:', content: baseContext, maxChars: 18_000 },
      { title: 'Conversation context:', content: historyBlock, maxChars: 6_000 },
    ],
    { maxChars: MAX_ADAPTER_CONTEXT_CHARS },
  )
}

function buildThreadHistoryBlock(transcript: ThreadTranscriptTurn[]): string | null {
  const relevantTurns = transcript.filter(
    (turn) => turn.prompt.trim() || turn.assistantText?.trim(),
  )
  if (relevantTurns.length === 0) return null

  const summaryTurns = relevantTurns.slice(
    0,
    Math.max(0, relevantTurns.length - THREAD_CONTEXT_RECENT_TURNS),
  )
  const recentTurns = relevantTurns.slice(-THREAD_CONTEXT_RECENT_TURNS)
  const sections: string[] = []

  if (summaryTurns.length > 0) {
    sections.push(
      [
        `Older conversation summary (${summaryTurns.length} turn${
          summaryTurns.length === 1 ? '' : 's'
        }):`,
        ...summaryTurns.map(
          (turn, index) =>
            `${index + 1}. User: ${truncateForContext(
              turn.prompt,
              THREAD_CONTEXT_SUMMARY_CHARS,
            )}${
              turn.assistantText?.trim()
                ? `\n   Assistant: ${truncateForContext(
                    turn.assistantText,
                    THREAD_CONTEXT_SUMMARY_CHARS,
                  )}`
                : ''
            }`,
        ),
      ].join('\n'),
    )
  }

  const recent = recentTurns.map((turn, index) => {
    const parts = [
      `Turn ${index + 1}`,
      `User: ${truncateForContext(turn.prompt, THREAD_CONTEXT_PROMPT_CHARS)}`,
    ]
    const assistantText = turn.assistantText?.trim()
    if (assistantText) {
      parts.push(
        `Assistant: ${truncateForContext(assistantText, THREAD_CONTEXT_ASSISTANT_CHARS)}`,
      )
    }

    return parts.join('\n')
  })

  if (recent.length > 0) {
    sections.push(['Recent conversation turns:', ...recent].join('\n\n'))
  }

  return `Conversation history (same thread, oldest to newest):\n${sections.join('\n\n')}`
}
