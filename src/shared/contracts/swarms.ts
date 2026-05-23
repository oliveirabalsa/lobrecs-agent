import type { ImageAttachment, ModelTier, SupportedAgentId } from './agents'
import type { SessionStatus } from './sessions'

export const SWARM_STRATEGIES = ['managed', 'parallel', 'sequential', 'fan-out'] as const

export type SwarmStrategy = (typeof SWARM_STRATEGIES)[number]

export interface SwarmAgentConfig {
  role: string
  agentId: SupportedAgentId
  modelOverride?: string
  promptSuffix?: string
  /**
   * When true and the swarm strategy is `sequential`, the orchestrator pauses
   * after this agent finishes and waits for the user to approve continuing
   * (optionally editing the next agent's promptSuffix or model). The flag is
   * ignored for parallel / fan-out strategies — there is no meaningful "next
   * step" to gate.
   */
  requireApprovalAfter?: boolean
}

export interface SwarmConfig {
  projectId: string
  /**
   * Existing conversation thread to append the swarm to. When omitted, the
   * main process creates one thread for the whole swarm.
   */
  threadId?: string
  prompt: string
  /**
   * `managed` starts with a frontier manager agent that produces a dynamic
   * sub-agent plan. `agents` is ignored for that strategy.
   */
  strategy: SwarmStrategy
  agents: SwarmAgentConfig[]
  /**
   * Max reviewer cycles when a sequential step has a "reviewer" role. Hard
   * cap prevents infinite loops when the reviewer is never satisfied.
   * Defaults to 3 when omitted.
   */
  maxIterations?: number
  imageAttachments?: ImageAttachment[]
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
