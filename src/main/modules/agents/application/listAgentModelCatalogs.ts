import { fallbackModelsForAgent } from '../../../agents/modelDiscovery'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { AgentModelCatalog } from '../../../../shared/types'

export async function listAgentModelCatalogs(
  context: Pick<MainIpcContext, 'adapters'>,
): Promise<AgentModelCatalog[]> {
  return Promise.all(
    [...context.adapters.entries()].map(async ([agentId, adapter]) => {
      const installed = await adapter.isInstalled().catch(() => false)

      if (!installed) {
        return {
          agentId,
          name: adapter.name,
          installed,
          models: [],
          error: 'CLI not found',
        }
      }

      try {
        const models = adapter.listModels
          ? await adapter.listModels()
          : fallbackModelsForAgent(agentId)

        return {
          agentId,
          name: adapter.name,
          installed,
          models,
        }
      } catch (error) {
        return {
          agentId,
          name: adapter.name,
          installed,
          models: fallbackModelsForAgent(agentId),
          error: error instanceof Error ? error.message : 'Failed to list models',
        }
      }
    }),
  )
}
