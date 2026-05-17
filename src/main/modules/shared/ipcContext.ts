import type { AgentAdapter } from '../../agents'
import type { WorktreeManager } from '../../git/WorktreeManager'
import type { ModelRouter } from '../../router'
import type { SessionManager } from '../../session'
import type { SwarmOrchestrator } from '../../swarm/SwarmOrchestrator'
import type { SupportedAgentId } from '../../../shared/types'

export interface MainIpcContext {
  adapters: ReadonlyMap<SupportedAgentId, AgentAdapter>
  modelRouter: ModelRouter
  sessionManager: SessionManager
  swarmOrchestrator: SwarmOrchestrator
  worktreeManager: WorktreeManager
}
