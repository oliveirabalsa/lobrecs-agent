import { adapterRegistry } from '../agents'
import { getMainWindow } from '../app/bootstrap'
import { estimateCost } from '../cost'
import { worktreeManager } from '../git/WorktreeManager'
import { registerAgentHandlers } from '../modules/agents/ipc/registerAgentHandlers'
import { delegateTask } from '../modules/agents/application/delegateTask'
import { registerAutomationHandlers } from '../modules/automations/ipc/registerAutomationHandlers'
import { registerCostHandlers } from '../modules/cost/ipc/registerCostHandlers'
import { registerContextHandlers, repositoryContextService } from '../modules/context'
import { buildBoundedPromptContext } from '../modules/context/application/contextBudget'
import { extensionMarketplaceService, registerExtensionHandlers } from '../modules/extensions'
import { registerFeedbackHandlers } from '../modules/feedback/ipc/registerFeedbackHandlers'
import { registerGitHandlers } from '../modules/git/ipc/registerGitHandlers'
import { projectMemoryService, registerMemoryHandlers } from '../modules/memory'
import { NotificationService, type NotificationDispatch } from '../modules/notifications'
import { registerProjectHandlers } from '../modules/projects/ipc/registerProjectHandlers'
import { runQualityGate } from '../modules/quality/application/qualityGateService'
import { registerReviewHandlers } from '../modules/reviews'
import { registerRoutingHandlers } from '../modules/routing/ipc/registerRoutingHandlers'
import { registerRunHandlers } from '../modules/runs/ipc/registerRunHandlers'
import { registerSessionHandlers } from '../modules/sessions/ipc/registerSessionHandlers'
import { registerSettingsHandlers, settingsService } from '../modules/settings'
import type { MainIpcContext } from '../modules/shared/ipcContext'
import { registerSpecHandlers } from '../modules/specs/ipc/registerSpecHandlers'
import { registerSwarmHandlers } from '../modules/swarms/ipc/registerSwarmHandlers'
import { registerSystemHandlers } from '../modules/system/ipc/registerSystemHandlers'
import { registerThreadHandlers } from '../modules/threads/ipc/registerThreadHandlers'
import { registerUpdateHandlers } from '../modules/updates'
import { ModelRouter } from '../router'
import { capacityFallbackModelsForAgent } from '../router/modelCapacityFallbacks'
import { sessionManager } from '../session'
import type { NotifierEvent } from '../session/SessionManager'
import { projectsStore, runAuditStore, specRunsStore, threadsStore } from '../store'
import { swarmOrchestrator } from '../swarm/SwarmOrchestrator'


const modelRouter = new ModelRouter({
  adapterRegistry,
  settingsProvider: (projectId) => settingsService.getEffective(projectId).settings,
})

const notificationService = new NotificationService({
  getSettings: (projectId) => settingsService.getEffective(projectId).settings,
  getMainWindow,
  sendToRenderer: (channel, payload) => {
    getMainWindow()?.webContents.send(channel, payload)
  },
})

export function registerIpcHandlers(): void {
  const context = createMainIpcContext()

  configureSessionManager(context)
  configureSwarmOrchestrator(context)
  configureNotifications(context)

  registerProjectHandlers()
  registerReviewHandlers()
  registerSessionHandlers()
  registerThreadHandlers()
  registerAgentHandlers(context)
  registerSwarmHandlers(context)
  registerRoutingHandlers(context)
  registerFeedbackHandlers(context)
  registerCostHandlers(context)
  registerContextHandlers(context)
  registerExtensionHandlers(extensionMarketplaceService)
  registerMemoryHandlers(context)
  registerAutomationHandlers(context)
  registerSpecHandlers(context)
  registerRunHandlers(context)
  registerGitHandlers(context)
  registerSettingsHandlers(context)
  registerSystemHandlers(context)
  registerUpdateHandlers()
}

function createMainIpcContext(): MainIpcContext {
  return {
    adapters: adapterRegistry,
    modelRouter,
    notificationService,
    projectMemoryService,
    repositoryContext: repositoryContextService,
    sessionManager,
    settingsService,
    swarmOrchestrator,
    worktreeManager,
  }
}

function configureNotifications(context: MainIpcContext): void {
  context.sessionManager.setNotifier((event) => {
    const dispatch = mapNotifierEventToDispatch(event)
    if (dispatch) context.notificationService.dispatch(dispatch)
  })
}

function mapNotifierEventToDispatch(event: NotifierEvent): NotificationDispatch | null {
  const kind = event.spawnedAgent?.kind
  if (kind === 'quality-repair' || kind === 'swarm' || kind === 'delegation') return null

  const baseClick = {
    projectId: event.projectId,
    threadId: event.threadId,
    sessionId: event.sessionId,
  }

  if (event.type === 'diff.ready') {
    if (kind === 'automation') return null

    return {
      type: 'diff.ready',
      title: 'Diff ready for review',
      body: `${event.count} file${event.count === 1 ? '' : 's'} changed`,
      click: { type: 'diff.ready', ...baseClick },
    }
  }

  if (kind === 'automation') {
    const name = event.spawnedAgent?.role ?? 'Automation'
    if (event.type === 'session.done') {
      return {
        type: 'automation.success',
        title: `${name} succeeded`,
        body: 'Automation finished cleanly',
        click: { type: 'automation.success', ...baseClick },
      }
    }
    return {
      type: 'automation.failure',
      title: `${name} failed`,
      body: truncate(event.message, 100),
      click: { type: 'automation.failure', ...baseClick },
    }
  }

  if (event.type === 'session.error') {
    return {
      type: 'session.error',
      title: 'Agent session error',
      body: truncate(event.message, 100),
      click: { type: 'session.error', ...baseClick },
    }
  }

  return null
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function configureSessionManager(context: MainIpcContext): void {
  for (const adapter of context.adapters.values()) {
    context.sessionManager.registerAdapter(adapter)
  }
  context.sessionManager.setCostEstimator((model, tokensIn, tokensOut) =>
    estimateCost(model, tokensIn, tokensOut, context.settingsService.getGlobal().costs.pricing),
  )
  context.sessionManager.setContextResolver((input) =>
    buildSessionContext(context, input.projectId, input.repoPath, input.prompt, input.baseContext),
  )
  context.sessionManager.setQualityGateRunner((input) =>
    runQualityGate(input, {
      getSettings: (projectId) => context.settingsService.getEffective(projectId).settings,
      routeModel: (routeInput) => context.modelRouter.route(routeInput),
      recordAudit: (auditInput) => {
        runAuditStore.create({
          ...auditInput,
          specRunId: specRunsStore.findSpecRunIdBySessionId(auditInput.sessionId) ?? undefined,
        })
      },
      getLastAudit: (sessionId) => {
        const records = runAuditStore.listForSession(sessionId)
        const last = records[records.length - 1]
        if (!last) return null
        return { recipeId: last.recipeId, exitCode: last.exitCode, phase: last.phase }
      },
      isRepairInFlight: () => context.sessionManager.hasActiveRepairSession(),
      dispatchRepair: async (repairInput) => {
        const settings = context.settingsService.getEffective(repairInput.projectId).settings
        return context.sessionManager.dispatch({
          projectId: repairInput.projectId,
          threadId: repairInput.threadId,
          prompt: repairInput.prompt,
          agentId: repairInput.agentId,
          model: repairInput.model,
          modelFallbacks: capacityFallbackModelsForAgent({
            settings,
            agentId: repairInput.agentId,
            currentModel: repairInput.model,
          }),
          repoPath: repairInput.repoPath,
          context: projectsStore.getContext(repairInput.projectId),
          isolate: settings.execution.worktreeIsolation,
          runtimeSettings: settings.agents.runtimes[repairInput.agentId],
          qualityAttempt: repairInput.qualityAttempt,
          spawnedAgent: { kind: 'quality-repair', role: 'QA repair agent' },
        })
      },
    }),
  )
  context.sessionManager.setDelegateTaskRunner((input) =>
    delegateTask(context, {
      projectId: input.projectId,
      threadId: input.threadId,
      parentSessionId: input.parentSessionId,
      goal: input.goal,
      context: input.context,
    }),
  )
}

function configureSwarmOrchestrator(context: MainIpcContext): void {
  context.swarmOrchestrator.configure({
    getProject: (projectId) => projectsStore.get(projectId) ?? undefined,
    createThread: (input) => threadsStore.create(input),
    routeModel: (input) => context.modelRouter.route(input),
    dispatchSession: async (input) => {
      const settings = context.settingsService.getEffective(input.projectId).settings
      const { sessionId, threadId } = await context.sessionManager.dispatch({
        projectId: input.projectId,
        threadId: input.threadId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        modelFallbacks: capacityFallbackModelsForAgent({
          settings,
          agentId: input.agentId,
          currentModel: input.model,
          requiresImageSupport: (input.imageAttachments?.length ?? 0) > 0,
        }),
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: settings.execution.worktreeIsolation,
        runtimeSettings: settings.agents.runtimes[input.agentId],
        imageAttachments: input.imageAttachments,
        spawnedAgent: { kind: 'swarm', role: input.role },
        modelRecoveryMode: input.strategy === 'managed' ? 'auto' : 'prompt',
      })

      return { sessionId, threadId, status: 'running' }
    },
    cancelSession: (sessionId) => context.sessionManager.cancel(sessionId),
    worktrees: context.worktreeManager,
    getSettings: (projectId) => context.settingsService.getEffective(projectId).settings,
  })
}

async function buildSessionContext(
  context: MainIpcContext,
  projectId: string,
  repoPath: string,
  prompt: string,
  baseContext?: string | null,
): Promise<string | null> {
  const projectContext = (baseContext ?? projectsStore.getContext(projectId))?.trim()
  const repositoryContext = await context.repositoryContext.buildPromptContext({
    projectId,
    repoPath,
    prompt,
  })
  const memoryContext = await context.projectMemoryService.buildPromptContext({
    repoPath,
    baseContext: null,
  })

  return buildBoundedPromptContext(
    [
      { title: 'Project instructions:', content: projectContext, maxChars: 4_000 },
      { title: 'Project memory:', content: memoryContext, maxChars: 3_000 },
      { title: 'Repository evidence:', content: repositoryContext, maxChars: 12_000 },
      { title: 'Delegation guidance:', content: DELEGATION_CONTEXT, maxChars: 1_000 },
    ],
    { maxChars: 20_000 },
  )
}

const DELEGATION_CONTEXT = [
  'Lobrecs background delegation:',
  'When an independent background agent would help, call `DelegateTask` with',
  'JSON input like {"goal":"specific task","context":"only the context needed"}.',
  'Use it for isolated research, review, comparison, or investigation work that',
  'would otherwise flood the main context. Keep the goal self-contained; the',
  'child agent starts fresh and only its final summary returns to the thread.',
].join('\n')
