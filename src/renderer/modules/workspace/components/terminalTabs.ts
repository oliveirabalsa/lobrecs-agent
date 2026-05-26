export interface TerminalTab {
  id: string
  label: string
  editorId: string
  editorName: string
  repoPath: string
}

export function createTerminalTab(
  editorId: string,
  editorName: string,
  repoPath: string,
  index: number,
): TerminalTab {
  return {
    id: createTerminalSessionId(),
    label: index > 1 ? `${editorName} ${index}` : editorName,
    editorId,
    editorName,
    repoPath,
  }
}

function createTerminalSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
