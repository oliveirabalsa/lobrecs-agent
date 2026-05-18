const CLAUDE_SESSION_END_HOOK = 'sessionend hook'
const CLAUDE_SESSION_COMPLETE_HOOK = 'claude-code session-complete'
const DELETED_CWD_ERROR = 'current working directory was deleted'

export function isClaudeSessionEndCwdDeletedWarning(text: string): boolean {
  const normalized = text.toLowerCase()

  return (
    normalized.includes(CLAUDE_SESSION_END_HOOK) &&
    normalized.includes(CLAUDE_SESSION_COMPLETE_HOOK) &&
    normalized.includes(DELETED_CWD_ERROR)
  )
}

export function processWarningKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
