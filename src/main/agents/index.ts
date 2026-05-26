import { AntigravityAdapter } from './AntigravityAdapter'
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import { CodexAdapter } from './CodexAdapter'
import { CursorAdapter } from './CursorAdapter'
import { OpenCodeAdapter } from './OpenCodeAdapter'
import type { AgentAdapter } from './AgentAdapter'
import type { SupportedAgentId } from '../../shared/types'

export { AntigravityAdapter } from './AntigravityAdapter'
export { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
export { CodexAdapter } from './CodexAdapter'
export { CursorAdapter } from './CursorAdapter'
export { OpenCodeAdapter } from './OpenCodeAdapter'
export type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'

export const adapterRegistry = new Map<SupportedAgentId, AgentAdapter>([
  ['claude-code', new ClaudeCodeAdapter()],
  ['codex', new CodexAdapter()],
  ['opencode', new OpenCodeAdapter()],
  ['antigravity', new AntigravityAdapter()],
  ['cursor', new CursorAdapter()],
])
