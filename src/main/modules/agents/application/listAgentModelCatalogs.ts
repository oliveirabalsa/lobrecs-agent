import { fallbackModelsForAgent } from '../../../agents/modelDiscovery'
import type { AgentAdapter } from '../../../agents/AgentAdapter'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { AgentAccountInfo, AgentModelCatalog } from '../../../../shared/types'

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
        const [models, account] = await Promise.all([
          adapter.listModels ? adapter.listModels() : fallbackModelsForAgent(agentId),
          readAccountInfo(adapter),
        ])

        return {
          agentId,
          name: adapter.name,
          installed,
          models,
          ...(account ? { account } : {}),
        }
      } catch (error) {
        const account = await readAccountInfo(adapter)
        return {
          agentId,
          name: adapter.name,
          installed,
          models: fallbackModelsForAgent(agentId),
          ...(account ? { account } : {}),
          error: error instanceof Error ? error.message : 'Failed to list models',
        }
      }
    }),
  )
}

async function readAccountInfo(
  adapter: Pick<AgentAdapter, 'getAccountInfo'>,
): Promise<AgentAccountInfo | undefined> {
  if (!adapter.getAccountInfo) return undefined

  try {
    return await adapter.getAccountInfo()
  } catch {
    return {
      status: 'unknown',
      label: 'Status unavailable',
    }
  }
}
