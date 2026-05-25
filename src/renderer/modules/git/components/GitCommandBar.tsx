import type { GitTuiPanelId } from '../state/gitTuiState'

interface GitCommandBarProps {
  activePanel: GitTuiPanelId
}

const PANEL_HINTS: Record<GitTuiPanelId, string[]> = {
  status: ['R refresh', 'p pull', 'P push', 'c commit', 'A ai review', ': commands', '? keys'],
  files: ['space stage', 'u unstage', 'a stage all', 'c commit', 'enter diff', 'd discard', 'A ai review', '/ filter'],
  branches: ['space checkout', 'n new', 'D delete', 'enter inspect', 'h/l panels', '/ filter'],
  commits: ['enter details', 'h/l panels', 'j/k move', '/ filter'],
  stash: ['space apply', 'D drop', 'enter inspect', 'h/l panels', '/ filter'],
}

export function GitCommandBar({ activePanel }: GitCommandBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-hairline bg-black/20 px-3 font-mono text-[11px] text-muted">
      <span className="text-primary">GIT</span>
      <span className="text-muted">focus {activePanel}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {PANEL_HINTS[activePanel].map((hint) => (
          <span
            key={hint}
            className="shrink-0 border border-hairline bg-white/[0.025] px-1.5 py-0.5"
          >
            {hint}
          </span>
        ))}
      </div>
    </footer>
  )
}
