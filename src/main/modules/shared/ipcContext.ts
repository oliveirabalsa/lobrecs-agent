import type { AgentAdapter } from '../../agents'
import type { WorktreeManager } from '../../git/WorktreeManager'
import type { RepositoryContextService } from '../context'
import type { ProjectMemoryService } from '../memory'
import type { NotificationService } from '../notifications'
import type { ModelRouter } from '../../router'
import type { SessionManager } from '../../session'
import type { SettingsService } from '../settings'
import type { SwarmOrchestrator } from '../../swarm/SwarmOrchestrator'
import type { SupportedAgentId } from '../../../shared/types'

export interface MainIpcContext {
  adapters: ReadonlyMap<SupportedAgentId, AgentAdapter>
  modelRouter: ModelRouter
  notificationService: NotificationService
  projectMemoryService: ProjectMemoryService
  repositoryContext: RepositoryContextService
  sessionManager: SessionManager
  settingsService: SettingsService
  swarmOrchestrator: SwarmOrchestrator
  worktreeManager: WorktreeManager
}
