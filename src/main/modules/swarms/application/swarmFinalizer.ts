import type { AppSettings, Session, SupportedAgentId } from '../../../../shared/types'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import type { SwarmCompletionEvent } from '../../../swarm/SwarmOrchestrator'
import { projectsStore, sessionsStore } from '../../../store'
import { extractSessionOutput } from '../../../store/sessionOutput'
import type { MainIpcContext } from '../../shared/ipcContext'

const FINALIZER_PROMPT_MARKER = '[Background agent completion]'

export async function dispatchSwarmFinalizer(
  context: MainIpcContext,
  event: SwarmCompletionEvent,
): Promise<void> {
  const project = projectsStore.get(event.projectId)
  if (!project) return

  const threadSessions = sessionsStore
    .list(event.projectId)
    .filter((session) => session.threadId === event.threadId)
    .sort((a, b) => a.createdAt - b.createdAt)
  const backgroundSessions = latestBackgroundSessionBlock(threadSessions)
  if (backgroundSessions.length === 0) return
  if (hasFinalizerAfterLastBackgroundSession(threadSessions, backgroundSessions)) return

  const settings = context.settingsService.getEffective(event.projectId).settings
  const finalizer = selectFinalizerAgent(threadSessions, backgroundSessions, settings)
  const prompt = buildSwarmFinalizerPrompt(backgroundSessions)

  await context.sessionManager.dispatch({
    projectId: event.projectId,
    threadId: event.threadId,
    prompt,
    agentId: finalizer.agentId,
    model: finalizer.model,
    modelFallbacks: capacityFallbackModelsForAgent({
      settings,
      agentId: finalizer.agentId,
      currentModel: finalizer.model,
    }),
    repoPath: project.repoPath,
    context: projectsStore.getContext(event.projectId),
    runtimeSettings: settings.agents.runtimes[finalizer.agentId],
  })
}

export function buildSwarmFinalizerPrompt(backgroundSessions: readonly Session[]): string {
  return [
    FINALIZER_PROMPT_MARKER,
    '',
    'The background agents in this thread have finished. Take the main-agent turn now.',
    '',
    'What to do:',
    '- Read the background-agent outputs below and the current working tree.',
    '- Give the user clear feedback: what happened, which files changed, verification status, and remaining risks.',
    '- If a tiny integration fix is obviously required, make it; otherwise do not change files.',
    '- Do not call DelegateTask or spawn more background agents in this finalization turn.',
    '',
    'Background agent outputs:',
    ...backgroundSessions.map(formatBackgroundSessionSummary),
  ].join('\n')
}

export function latestBackgroundSessionBlock(
  sessions: readonly Session[],
): Session[] {
  let lastIndex = -1
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    if (sessions[index].spawnedAgent) {
      lastIndex = index
      break
    }
  }
  if (lastIndex < 0) return []

  let firstIndex = lastIndex
  while (firstIndex > 0 && sessions[firstIndex - 1].spawnedAgent) {
    firstIndex -= 1
  }

  return sessions.slice(firstIndex, lastIndex + 1).filter((session) => session.spawnedAgent)
}

function hasFinalizerAfterLastBackgroundSession(
  threadSessions: readonly Session[],
  backgroundSessions: readonly Session[],
): boolean {
  const lastBackgroundCreatedAt = backgroundSessions.at(-1)?.createdAt
  if (lastBackgroundCreatedAt === undefined) return false

  return threadSessions.some(
    (session) =>
      !session.spawnedAgent &&
      session.createdAt > lastBackgroundCreatedAt &&
      session.prompt.startsWith(FINALIZER_PROMPT_MARKER),
  )
}

function selectFinalizerAgent(
  threadSessions: readonly Session[],
  backgroundSessions: readonly Session[],
  settings: AppSettings,
): { agentId: SupportedAgentId; model: string } {
  const firstBackgroundCreatedAt = backgroundSessions[0]?.createdAt ?? 0
  const parent = [...threadSessions]
    .reverse()
    .find(
      (session) =>
        !session.spawnedAgent &&
        session.createdAt < firstBackgroundCreatedAt &&
        session.model !== 'multitask-decomposer',
    )

  if (parent) {
    return { agentId: parent.agentId as SupportedAgentId, model: parent.model }
  }

  const agentId = settings.agents.defaultAgentId
  return {
    agentId,
    model: settings.agents.modelMap[agentId].balanced,
  }
}

function formatBackgroundSessionSummary(session: Session): string {
  const events = sessionsStore.listEvents(session.id)
  const output = extractSessionOutput(events, { maxChars: 2_500 })
  const diffSummary = summarizeDiffEvents(events)

  return [
    '',
    `## ${session.spawnedAgent?.role ?? 'Background agent'}`,
    `- Session: ${session.id}`,
    `- Agent: ${session.agentId} / ${session.model}`,
    `- Status: ${session.status}`,
    diffSummary ? `- Changes: ${diffSummary}` : '- Changes: no diff event recorded',
    '',
    output ?? '(No assistant output captured.)',
  ].join('\n')
}

function summarizeDiffEvents(events: readonly { type: string; payload: unknown }[]): string | null {
  const diffEvent = [...events].reverse().find((event) => event.type === 'diff')
  if (!diffEvent) return null
  const payload = diffEvent.payload
  const proposals = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { proposals?: unknown }).proposals)
      ? (payload as { proposals: unknown[] }).proposals
      : []
  if (proposals.length === 0) return null

  return proposals
    .map((proposal) => {
      if (!proposal || typeof proposal !== 'object') return null
      const record = proposal as { filePath?: unknown; status?: unknown }
      const filePath = typeof record.filePath === 'string' ? record.filePath : null
      const status = typeof record.status === 'string' ? record.status : null
      return filePath ? `${filePath}${status ? ` (${status})` : ''}` : null
    })
    .filter((value): value is string => Boolean(value))
    .join(', ') || null
}
