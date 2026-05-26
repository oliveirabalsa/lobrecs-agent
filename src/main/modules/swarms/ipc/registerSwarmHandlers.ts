import { ipcMain } from 'electron'
import { applyPatch, createPatch } from '../../../git/utils'
import {
  applyProfileToSwarmAgent,
  getAgentProfile,
} from '../../agents/application/agentProfileService'
import type { MainIpcContext } from '../../shared/ipcContext'
import { dispatchSwarmFinalizer } from '../application/swarmFinalizer'
import type { SwarmConfig } from '../../../../shared/types'

export function registerSwarmHandlers(context: MainIpcContext): void {
  context.swarmOrchestrator.setOnSwarmComplete((event) => {
    void dispatchSwarmFinalizer(context, event).catch((error) => {
      console.error('[swarm:finalizer] dispatch failed', error)
    })

    try {
      context.notificationService.dispatch({
        type: 'swarm.completed',
        title: 'Swarm complete',
        body: `${event.sessionCount} ${event.sessionCount === 1 ? 'agent' : 'agents'} finished`,
        click: {
          type: 'swarm.completed',
          projectId: event.projectId,
          threadId: event.threadId,
        },
      })
    } catch (error) {
      console.error('[swarm:notification] dispatch failed', error)
    }
  })

  ipcMain.handle('swarm:spawn', async (_event, config: SwarmConfig) =>
    context.swarmOrchestrator.spawn(await applySwarmAgentProfiles(config)),
  )
  ipcMain.handle('swarm:status', async (_event, swarmId: string) =>
    context.swarmOrchestrator.get(swarmId),
  )
  ipcMain.handle('swarm:cancel', async (_event, swarmId: string) => {
    await context.swarmOrchestrator.cancel(swarmId)
  })
  ipcMain.handle(
    'swarm:apply-result',
    async (_event, sessionId: string, targetRepoPath: string) => {
      const worktreePath = context.worktreeManager.getPath(sessionId)
      if (!worktreePath) {
        throw new Error('Swarm agents now run locally, so there is no worktree result to apply')
      }

      const patch = await createPatch(worktreePath)
      if (patch.trim()) {
        await applyPatch(targetRepoPath, patch)
      }
      await context.worktreeManager.remove(sessionId, targetRepoPath)
    },
  )
}

async function applySwarmAgentProfiles(config: SwarmConfig): Promise<SwarmConfig> {
  if (!config.agents.some((agent) => agent.profileId)) return config

  const agents = await Promise.all(
    config.agents.map(async (agent) => {
      const profile = await getAgentProfile(config.projectId, agent.profileId)
      if (agent.profileId && !profile) {
        throw new Error(`Agent profile not found: ${agent.profileId}`)
      }
      return applyProfileToSwarmAgent(agent, profile)
    }),
  )

  return { ...config, agents }
}
