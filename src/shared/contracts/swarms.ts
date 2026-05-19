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
  /**
   * Existing conversation thread to append the swarm to. When omitted, the
   * main process creates one thread for the whole swarm.
   */
  threadId?: string
  prompt: string
  strategy: 'parallel' | 'sequential' | 'fan-out'
  agents: SwarmAgentConfig[]
  /**
   * Max reviewer cycles when a sequential step has a "reviewer" role. Hard
   * cap prevents infinite loops when the reviewer is never satisfied.
   * Defaults to 3 when omitted.
   */
  maxIterations?: number
}

export interface SwarmResult {
  swarmId: string
  threadId: string
  strategy: SwarmConfig['strategy']
  sessions: Array<{
    sessionId: string
    threadId: string
    role: string
    worktreePath: string | null
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
