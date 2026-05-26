import type { GitTuiAction } from '../state/gitTuiState'

interface GitCommandPaletteProps {
  open: boolean
  onClose: () => void
  onAction: (action: GitTuiAction) => void
}

const COMMANDS: Array<{ label: string; action: GitTuiAction }> = [
  { label: 'refresh snapshot', action: { type: 'refresh' } },
  { label: 'pull current branch', action: { type: 'pull' } },
  { label: 'push current branch', action: { type: 'push' } },
  { label: 'stage all files', action: { type: 'stage-all' } },
  { label: 'create branch', action: { type: 'create-branch' } },
]

export function GitCommandPalette({ open, onClose, onAction }: GitCommandPaletteProps) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/45 p-6 pt-[12vh]">
      <div className="w-full max-w-xl border border-hairline bg-canvas shadow-2xl shadow-black/50">
        <header className="border-b border-hairline px-3 py-2 font-mono text-[12px] text-primary">
          : git command
        </header>
        <div className="grid p-2 font-mono text-[12px]">
          {COMMANDS.map((command) => (
            <button
              key={command.label}
              type="button"
              onClick={() => {
                onAction(command.action)
                onClose()
              }}
              className="grid h-8 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 px-2 text-left text-secondary hover:bg-accent-primary/18 hover:text-primary"
            >
              <span className="text-accent-primary">&gt;</span>
              <span>{command.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
