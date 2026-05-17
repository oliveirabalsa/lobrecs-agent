import type { IpcRenderer } from 'electron'
import { createAgentApi, type AgentApi } from './agents'
import { createAutomationsApi, type AutomationsApi } from './automations'
import { createCostApi, type CostApi } from './cost'
import { createDiffApi, type DiffApi } from './diffs'
import { createEventApi, type AgentForgeEventsApi } from './events'
import { createFeedbackApi, type FeedbackApi } from './feedback'
import { createProjectsApi, type ProjectsApi } from './projects'
import { createRouterApi, type RouterApi } from './routing'
import { createSessionsApi, type SessionsApi } from './sessions'
import { createSwarmApi, type SwarmApi } from './swarms'
import { createSystemApi, type SystemApi } from './system'

export interface AgentForgeApi extends AgentForgeEventsApi {
  projects: ProjectsApi
  sessions: SessionsApi
  agent: AgentApi
  swarm: SwarmApi
  router: RouterApi
  feedback: FeedbackApi
  cost: CostApi
  automations: AutomationsApi
  diff: DiffApi
  system: SystemApi
}

export function createAgentForgeApi(ipcRenderer: IpcRenderer): AgentForgeApi {
  const events = createEventApi(ipcRenderer)

  return {
    projects: createProjectsApi(ipcRenderer),
    sessions: createSessionsApi(ipcRenderer),
    agent: createAgentApi(ipcRenderer),
    swarm: createSwarmApi(ipcRenderer),
    router: createRouterApi(ipcRenderer),
    feedback: createFeedbackApi(ipcRenderer),
    cost: createCostApi(ipcRenderer),
    automations: createAutomationsApi(ipcRenderer),
    diff: createDiffApi(ipcRenderer),
    on: events.on,
    onShortcut: events.onShortcut,
    system: createSystemApi(ipcRenderer),
  }
}
