import type { AgentForgeApi } from './api'

declare global {
  interface Window {
    agentforge: AgentForgeApi
  }
}

export {}
