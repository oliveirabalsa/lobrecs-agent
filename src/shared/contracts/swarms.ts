import type { ModelTier, SupportedAgentId } from './agents'
import type { SessionStatus } from './sessions'

export interface SwarmAgentConfig {
  role: string
  agentId: SupportedAgentId
  modelOverride?: string
  promptSuffix?: string
}

export interface SwarmConfig {
  projectId: string
  prompt: string
  strategy: 'parallel' | 'sequential' | 'fan-out'
  agents: SwarmAgentConfig[]
}

export interface SwarmResult {
  swarmId: string
  strategy: SwarmConfig['strategy']
  sessions: Array<{
    sessionId: string
    role: string
    worktreePath: string
    status: SessionStatus | string
    agentId?: SupportedAgentId
    model?: string
  }>
  consolidatedAt?: number
}

export interface SwarmStatus {
  swarmId: string
  sessions: Array<{ sessionId: string; role: string; status: string }>
}

export interface SwarmTabSummary {
  sessionId: string
  role: string
  status: string
  agentId?: SupportedAgentId
  model?: string
  tier?: ModelTier
}
