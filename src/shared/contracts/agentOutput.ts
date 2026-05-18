const CLAUDE_SESSION_END_HOOK = 'sessionend hook'
const CLAUDE_SESSION_COMPLETE_HOOK = 'claude-code session-complete'
const DELETED_CWD_ERROR = 'current working directory was deleted'
const CLAUDE_PLUGIN_WORKER = 'worker-service.cjs'
const CLAUDE_PLUGIN_CACHE = '.claude/plugins/cache'
const CLAUDE_MEM_PLUGIN = 'claude-mem'
const TEMP_WORKTREE_PREFIX = 'agentforge-'

export function isClaudeSessionEndHookWarning(text: string): boolean {
  const normalized = text.toLowerCase()

  if (normalized.includes(CLAUDE_SESSION_END_HOOK)) {
    return (
      normalized.includes(CLAUDE_SESSION_COMPLETE_HOOK) ||
      normalized.includes(CLAUDE_PLUGIN_WORKER) ||
      normalized.includes(CLAUDE_PLUGIN_CACHE) ||
      normalized.includes(CLAUDE_MEM_PLUGIN)
    )
  }

  if (
    normalized.includes(CLAUDE_PLUGIN_WORKER) &&
    normalized.includes('enoent') &&
    normalized.includes(TEMP_WORKTREE_PREFIX) &&
    (normalized.includes(CLAUDE_PLUGIN_CACHE) || normalized.includes(CLAUDE_MEM_PLUGIN))
  ) {
    return true
  }

  return (
    normalized.includes(DELETED_CWD_ERROR) &&
    (normalized.includes(CLAUDE_SESSION_END_HOOK) ||
      normalized.includes(CLAUDE_PLUGIN_WORKER))
  )
}

export function isClaudeSessionEndCwdDeletedWarning(text: string): boolean {
  const normalized = text.toLowerCase()

  return (
    isClaudeSessionEndHookWarning(text) &&
    normalized.includes(DELETED_CWD_ERROR)
  )
}

export function processWarningKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
