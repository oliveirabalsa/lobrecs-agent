import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import { CodexAdapter } from './CodexAdapter'
import { GeminiAdapter } from './GeminiAdapter'
import { OpenCodeAdapter } from './OpenCodeAdapter'
import type { SupportedAgentId } from '../../shared/types'
import type { AgentAdapter } from './AgentAdapter'

export { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
export { CodexAdapter } from './CodexAdapter'
export { GeminiAdapter } from './GeminiAdapter'
export { OpenCodeAdapter } from './OpenCodeAdapter'
export type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'

export const adapterRegistry = new Map<SupportedAgentId, AgentAdapter>([
  ['claude-code', new ClaudeCodeAdapter()],
  ['codex', new CodexAdapter()],
  ['opencode', new OpenCodeAdapter()],
  ['gemini', new GeminiAdapter()],
])
