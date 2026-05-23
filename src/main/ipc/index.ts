import { adapterRegistry } from '../agents'
import { estimateCost } from '../cost'
import { worktreeManager } from '../git/WorktreeManager'
import { registerAgentHandlers } from '../modules/agents/ipc/registerAgentHandlers'
import { registerAutomationHandlers } from '../modules/automations/ipc/registerAutomationHandlers'
import { registerCostHandlers } from '../modules/cost/ipc/registerCostHandlers'
import { registerContextHandlers, repositoryContextService } from '../modules/context'
import { extensionMarketplaceService, registerExtensionHandlers } from '../modules/extensions'
import { registerFeedbackHandlers } from '../modules/feedback/ipc/registerFeedbackHandlers'
import { registerGitHandlers } from '../modules/git/ipc/registerGitHandlers'
import { projectMemoryService, registerMemoryHandlers } from '../modules/memory'
import { registerProjectHandlers } from '../modules/projects/ipc/registerProjectHandlers'
import { runQualityGate } from '../modules/quality/application/qualityGateService'
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
import { projectsStore, runAuditStore, specRunsStore, threadsStore } from '../store'
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
    projectMemoryService,
    repositoryContext: repositoryContextService,
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
        })
      },
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

  return [projectContext, memoryContext, repositoryContext].filter(Boolean).join('\n\n') || null
}
