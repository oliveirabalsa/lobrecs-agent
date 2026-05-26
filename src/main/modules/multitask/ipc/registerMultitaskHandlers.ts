import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  MultitaskDecomposeRequest,
  MultitaskDecomposeResult,
  MultitaskDecisionPayload,
  MultitaskExecuteRequest,
  MultitaskPlan,
} from '../../../../shared/contracts/multitask'
import type { AgentEvent, SupportedAgentId } from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'
import { TaskDecomposer } from '../../../multitask'
import { estimateFromPrompt } from '../../../cost/pricing'
import { sessionsStore, threadsStore, projectsStore } from '../../../store'
import { extractSessionOutput } from '../../../store/sessionOutput'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import { broadcastThreadUpdated } from '../../threads/ipc/registerThreadHandlers'
import {
  finishMultitaskPlanningSession,
  recordMultitaskSessionEvent,
} from '../application/multitaskSessionEvents'

const pendingPlans = new Map<string, MultitaskPlan>()

export function registerMultitaskHandlers(context: MainIpcContext): void {
  const decomposer = new TaskDecomposer({
    dispatchAndWait: (input) => dispatchAndWait(context, input),
    routeModel: (input) =>
      context.modelRouter.route({
        prompt: input.prompt,
        preferredAgentId: input.preferredAgentId,
        autoAgentSelection: input.autoAgentSelection,
        minimumTier: input.minimumTier,
        agentPreference: input.agentPreference,
        projectId: input.projectId,
      }),
    estimateCost: (model, prompt) => estimateFromPrompt(model, prompt.length),
  })

  ipcMain.handle(
    'multitask:decompose',
    async (_event, request: MultitaskDecomposeRequest): Promise<MultitaskDecomposeResult> => {
      ensureProjectExists(request.projectId)
      const threadId = resolveOrCreateThread(request.projectId, request.threadId, request.prompt)
      const sessionId = randomUUID()

      const session = sessionsStore.create({
        id: sessionId,
        projectId: request.projectId,
        agentId: 'opencode',
        model: 'multitask-decomposer',
        prompt: request.prompt,
        imageAttachments: request.imageAttachments,
        status: 'running',
        threadId,
      })

      const linkedThread = threadsStore.linkSession(threadId, session.id)
      broadcastThreadUpdated(linkedThread)

      emitMultitaskSessionEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Decomposing into parallel tasks',
          status: 'running',
        },
        timestamp: Date.now(),
      })

      try {
        const settings = context.settingsService.getEffective(request.projectId).settings
        const plan = await decomposer.decompose(
          { ...request, threadId },
          { threadId, parentSessionId: sessionId, maxTasks: settings.swarms.maxAgents },
        )
        pendingPlans.set(plan.planId, plan)

        emitMultitaskSessionEvent({
          type: 'activity',
          sessionId,
          payload: {
            kind: 'multitask-plan',
            planId: plan.planId,
            tasks: plan.tasks,
            totalEstimatedCostUsd: plan.totalEstimatedCostUsd,
            decomposedBy: plan.decomposedBy,
            originalPrompt: plan.originalPrompt,
          },
          timestamp: Date.now(),
        })

        sessionsStore.updateStatus(sessionId, 'awaiting-input')

        return { plan, sessionId, threadId }
      } catch (error) {
        sessionsStore.updateStatus(sessionId, 'error')
        emitMultitaskSessionEvent({
          type: 'activity',
          sessionId,
          payload: {
            kind: 'step',
            title: 'Failed to decompose tasks',
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
          },
          timestamp: Date.now(),
        })
        emitMultitaskSessionEvent({
          type: 'session-complete',
          sessionId,
          payload: { status: 'error' },
          timestamp: Date.now(),
        })
        throw error
      }
    },
  )

  ipcMain.handle(
    'multitask:execute',
    async (_event, request: MultitaskExecuteRequest) => {
      const plan = pendingPlans.get(request.planId)
      if (!plan) throw new Error(`Multitask plan not found: ${request.planId}`)
      pendingPlans.delete(request.planId)

      const tasks = request.tasks.length > 0 ? request.tasks : plan.tasks
      return context.swarmOrchestrator.spawn({
        projectId: request.projectId,
        threadId: request.threadId,
        prompt: plan.originalPrompt,
        strategy: 'parallel',
        agents: tasks.map((task) => ({
          role: task.title,
          agentId: task.agentId,
          modelOverride: task.model,
          promptSuffix: task.description,
        })),
        imageAttachments: request.imageAttachments,
      })
    },
  )

  ipcMain.handle(
    'multitask:decision',
    async (_event, payload: MultitaskDecisionPayload) => {
      const plan = pendingPlans.get(payload.planId)
      if (!plan) return

      if (payload.decision === 'reject') {
        pendingPlans.delete(payload.planId)
        finishMultitaskPlanningSession(payload.sessionId, 'cancelled', broadcastSessionEvent)
        return
      }

      const tasks = payload.editedTasks ?? plan.tasks
      pendingPlans.delete(payload.planId)

      const session = sessionsStore.get(payload.sessionId)
      if (!session) return

      try {
        const result = await context.swarmOrchestrator.spawn({
          projectId: session.projectId,
          threadId: session.threadId,
          prompt: plan.originalPrompt,
          strategy: 'parallel',
          agents: tasks.map((task) => ({
            role: task.title,
            agentId: task.agentId,
            modelOverride: task.model,
            promptSuffix: task.description,
          })),
        })
        finishMultitaskPlanningSession(payload.sessionId, 'done', broadcastSessionEvent)
        return result
      } catch (error) {
        sessionsStore.updateStatus(payload.sessionId, 'error')
        emitMultitaskSessionEvent({
          type: 'activity',
          sessionId: payload.sessionId,
          payload: {
            kind: 'step',
            title: 'Failed to launch background tasks',
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
          },
          timestamp: Date.now(),
        })
        emitMultitaskSessionEvent({
          type: 'session-complete',
          sessionId: payload.sessionId,
          payload: { status: 'error' },
          timestamp: Date.now(),
        })
        throw error
      }
    },
  )
}

function ensureProjectExists(projectId: string): void {
  const project = projectsStore.get(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }
}

function resolveOrCreateThread(
  projectId: string,
  requestThreadId: string | undefined,
  prompt: string,
): string {
  if (requestThreadId) return requestThreadId

  const title = prompt.trim().slice(0, 60) || 'Multitask'
  const thread = threadsStore.create({ projectId, title })
  broadcastThreadUpdated(thread)
  return thread.id
}

async function dispatchAndWait(
  context: MainIpcContext,
  input: {
    projectId: string
    threadId?: string
    parentSessionId?: string
    prompt: string
    agentId: SupportedAgentId
    model: string
  },
): Promise<string> {
  const project = projectsStore.get(input.projectId)
  if (!project) throw new Error(`Project not found: ${input.projectId}`)

  const settings = context.settingsService.getEffective(input.projectId).settings
  const delegationId = randomUUID()

  const { sessionId } = await context.sessionManager.dispatch({
    projectId: input.projectId,
    threadId: input.threadId,
    prompt: input.prompt,
    agentId: input.agentId,
    model: input.model,
    modelFallbacks: capacityFallbackModelsForAgent({
      settings,
      agentId: input.agentId,
      currentModel: input.model,
    }),
    repoPath: project.repoPath,
    context: projectsStore.getContext(input.projectId),
    runtimeSettings: settings.agents.runtimes[input.agentId],
    spawnedAgent: { kind: 'delegation', role: 'multitask-decomposer' },
    ...(input.parentSessionId
      ? {
          delegatedTask: {
            delegationId,
            parentSessionId: input.parentSessionId,
            goal: 'Decompose the request into parallel background tasks',
          },
        }
      : {}),
  })

  const output = await waitForSessionOutput(sessionId)
  if (!output) throw new Error('Decomposer session produced no output')
  return output
}

function waitForSessionOutput(sessionId: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const check = () => {
      const events = sessionsStore.listEvents(sessionId)
      const last = events.at(-1)
      if (last?.type === 'session-complete') {
        resolve(extractSessionOutput(events))
        return true
      }
      return false
    }

    if (check()) return

    const interval = setInterval(() => {
      if (check()) clearInterval(interval)
    }, 500)

    setTimeout(() => {
      clearInterval(interval)
      resolve(extractSessionOutput(sessionsStore.listEvents(sessionId)))
    }, 5 * 60 * 1000)
  })
}

function emitMultitaskSessionEvent(event: AgentEvent): void {
  recordMultitaskSessionEvent(event, broadcastSessionEvent)
}

function broadcastSessionEvent(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`session:${event.sessionId}`, event)
  }
}
