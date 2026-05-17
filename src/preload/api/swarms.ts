import type { SwarmConfig, SwarmResult, SwarmStatus } from '../../shared/contracts/swarms'
import type { IpcInvoker } from './ipc'

export interface SwarmApi {
  spawn(config: SwarmConfig): Promise<SwarmResult>
  status(swarmId: string): Promise<SwarmStatus | undefined>
  cancel(swarmId: string): Promise<void>
  applyResult(sessionId: string, targetRepoPath: string): Promise<void>
}

export function createSwarmApi(ipcRenderer: IpcInvoker): SwarmApi {
  return {
    spawn: (config) => ipcRenderer.invoke('swarm:spawn', config),
    status: (swarmId) => ipcRenderer.invoke('swarm:status', swarmId),
    cancel: (swarmId) => ipcRenderer.invoke('swarm:cancel', swarmId),
    applyResult: (sessionId, targetRepoPath) =>
      ipcRenderer.invoke('swarm:apply-result', sessionId, targetRepoPath),
  }
}
