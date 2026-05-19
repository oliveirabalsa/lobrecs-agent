import { adapterRegistry } from '../agents'
import { estimateCost } from '../cost'
import { worktreeManager } from '../git/WorktreeManager'
import { registerAgentHandlers } from '../modules/agents/ipc/registerAgentHandlers'
import { registerAutomationHandlers } from '../modules/automations/ipc/registerAutomationHandlers'
import { registerCostHandlers } from '../modules/cost/ipc/registerCostHandlers'
import { registerFeedbackHandlers } from '../modules/feedback/ipc/registerFeedbackHandlers'
import { registerGitHandlers } from '../modules/git/ipc/registerGitHandlers'
import { registerProjectHandlers } from '../modules/projects/ipc/registerProjectHandlers'
import { registerRoutingHandlers } from '../modules/routing/ipc/registerRoutingHandlers'
import { registerRunHandlers } from '../modules/runs/ipc/registerRunHandlers'
import { registerSessionHandlers } from '../modules/sessions/ipc/registerSessionHandlers'
import { registerSettingsHandlers, settingsService } from '../modules/settings'
import type { MainIpcContext } from '../modules/shared/ipcContext'
import { registerSpecHandlers } from '../modules/specs/ipc/registerSpecHandlers'
import { registerSwarmHandlers } from '../modules/swarms/ipc/registerSwarmHandlers'
import { registerSystemHandlers } from '../modules/system/ipc/registerSystemHandlers'
import { registerThreadHandlers } from '../modules/threads/ipc/registerThreadHandlers'
import { ModelRouter } from '../router'
import { sessionManager } from '../session'
import { projectsStore, threadsStore } from '../store'
import { swarmOrchestrator } from '../swarm/SwarmOrchestrator'

const modelRouter = new ModelRouter({
  adapterRegistry,
  settingsProvider: (projectId) => settingsService.getEffective(projectId).settings,
})

export function registerIpcHandlers(): void {
  const context = createMainIpcContext()

  configureSessionManager(context)
  configureSwarmOrchestrator(context)

  registerProjectHandlers()
  registerSessionHandlers()
  registerThreadHandlers()
  registerAgentHandlers(context)
  registerSwarmHandlers(context)
  registerRoutingHandlers(context)
  registerFeedbackHandlers()
  registerCostHandlers()
  registerAutomationHandlers(context)
  registerSpecHandlers()
  registerRunHandlers(context)
  registerGitHandlers()
  registerSettingsHandlers(context)
  registerSystemHandlers(context)
}

function createMainIpcContext(): MainIpcContext {
  return {
    adapters: adapterRegistry,
    modelRouter,
    sessionManager,
    settingsService,
    swarmOrchestrator,
    worktreeManager,
  }
}

function configureSessionManager(context: MainIpcContext): void {
  for (const adapter of context.adapters.values()) {
    context.sessionManager.registerAdapter(adapter)
  }
  context.sessionManager.setCostEstimator((model, tokensIn, tokensOut) =>
    estimateCost(model, tokensIn, tokensOut, context.settingsService.getGlobal().costs.pricing),
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
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: settings.execution.worktreeIsolation,
        runtimeSettings: settings.agents.runtimes[input.agentId],
      })

      return { sessionId, threadId, status: 'running' }
    },
    cancelSession: (sessionId) => context.sessionManager.cancel(sessionId),
    worktrees: context.worktreeManager,
    getSettings: (projectId) => context.settingsService.getEffective(projectId).settings,
  })
}
