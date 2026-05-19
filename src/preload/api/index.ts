import type { IpcRenderer } from 'electron'
import { createAgentApi, type AgentApi } from './agents'
import { createAutomationsApi, type AutomationsApi } from './automations'
import { createCostApi, type CostApi } from './cost'
import { createEventApi, type AgentForgeEventsApi } from './events'
import { createFeedbackApi, type FeedbackApi } from './feedback'
import { createGitApi, type GitApi } from './git'
import { createProjectsApi, type ProjectsApi } from './projects'
import { createRouterApi, type RouterApi } from './routing'
import { createRunsApi, type RunsApi } from './runs'
import { createSettingsApi, type SettingsApi } from './settings'
import { createSessionsApi, type SessionsApi } from './sessions'
import { createSpecsApi, type SpecsApi } from './specs'
import { createSwarmApi, type SwarmApi } from './swarms'
import { createSystemApi, type SystemApi } from './system'
import { createThreadsApi, type ThreadsApi } from './threads'
import { createUpdatesApi, type UpdatesApi } from './updates'

export interface AgentForgeApi extends AgentForgeEventsApi {
  projects: ProjectsApi
  sessions: SessionsApi
  threads: ThreadsApi
  agent: AgentApi
  swarm: SwarmApi
  router: RouterApi
  feedback: FeedbackApi
  cost: CostApi
  automations: AutomationsApi
  specs: SpecsApi
  runs: RunsApi
  git: GitApi
  settings: SettingsApi
  system: SystemApi
  updates: UpdatesApi
}

export function createAgentForgeApi(ipcRenderer: IpcRenderer): AgentForgeApi {
  const events = createEventApi(ipcRenderer)

  return {
    projects: createProjectsApi(ipcRenderer),
    sessions: createSessionsApi(ipcRenderer),
    threads: createThreadsApi(ipcRenderer),
    agent: createAgentApi(ipcRenderer),
    swarm: createSwarmApi(ipcRenderer),
    router: createRouterApi(ipcRenderer),
    feedback: createFeedbackApi(ipcRenderer),
    cost: createCostApi(ipcRenderer),
    automations: createAutomationsApi(ipcRenderer),
    specs: createSpecsApi(ipcRenderer),
    runs: createRunsApi(ipcRenderer),
    git: createGitApi(ipcRenderer),
    settings: createSettingsApi(ipcRenderer),
    updates: createUpdatesApi(ipcRenderer),
    on: events.on,
    onShortcut: events.onShortcut,
    system: createSystemApi(ipcRenderer),
  }
}
