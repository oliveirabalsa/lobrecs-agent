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
import type { MainIpcContext } from '../modules/shared/ipcContext'
import { registerSpecHandlers } from '../modules/specs/ipc/registerSpecHandlers'
import { registerSwarmHandlers } from '../modules/swarms/ipc/registerSwarmHandlers'
import { registerSystemHandlers } from '../modules/system/ipc/registerSystemHandlers'
import { registerThreadHandlers } from '../modules/threads/ipc/registerThreadHandlers'
import { ModelRouter } from '../router'
import { sessionManager } from '../session'
import { projectsStore } from '../store'
import { swarmOrchestrator } from '../swarm/SwarmOrchestrator'

const modelRouter = new ModelRouter({ adapterRegistry })

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
  registerSystemHandlers(context)
}

function createMainIpcContext(): MainIpcContext {
  return {
    adapters: adapterRegistry,
    modelRouter,
    sessionManager,
    swarmOrchestrator,
    worktreeManager,
  }
}

function configureSessionManager(context: MainIpcContext): void {
  for (const adapter of context.adapters.values()) {
    context.sessionManager.registerAdapter(adapter)
  }
  context.sessionManager.setCostEstimator(estimateCost)
}

function configureSwarmOrchestrator(context: MainIpcContext): void {
  context.swarmOrchestrator.configure({
    getProject: (projectId) => projectsStore.get(projectId) ?? undefined,
    routeModel: (input) => context.modelRouter.route(input),
    dispatchSession: async (input) => {
      const { sessionId } = await context.sessionManager.dispatch({
        projectId: input.projectId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: false,
      })

      return { sessionId, status: 'running' }
    },
    cancelSession: (sessionId) => context.sessionManager.cancel(sessionId),
    worktrees: context.worktreeManager,
  })
}
