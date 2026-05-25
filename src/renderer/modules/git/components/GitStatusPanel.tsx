import type { GitRepositorySnapshot, GitTuiPanelId } from '../state/gitTuiState'
import { GitSidePanel } from './GitSidePanel'

interface GitStatusPanelProps {
  snapshot: GitRepositorySnapshot | null
  active: boolean
  onFocus: (panelId: GitTuiPanelId) => void
}

export function GitStatusPanel({ snapshot, active, onFocus }: GitStatusPanelProps) {
  const branch = snapshot?.branch
  const fileCount = snapshot?.files.length || snapshot?.pending?.fileCount || 0

  return (
    <GitSidePanel
      id="status"
      title="Status"
      hotkey="1"
      active={active}
      compact
      onFocus={onFocus}
    >
      <div className="grid gap-1 px-2 py-2 font-mono text-[11px] leading-5 text-secondary">
        <StatusLine label="branch" value={branch?.currentBranch ?? 'detached'} />
        <StatusLine label="upstream" value={branch?.upstreamBranch ?? 'none'} />
        <StatusLine label="sync" value={`ahead ${branch?.ahead ?? 0} / behind ${branch?.behind ?? 0}`} />
        <StatusLine label="changes" value={`${fileCount}`} />
      </div>
    </GitSidePanel>
  )
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-primary">{value}</span>
    </div>
  )
}
