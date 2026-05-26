import { useCallback, useState } from 'react'

interface GitBranchCreateModalProps {
  open: boolean
  onClose: () => void
  onCreate: (branchName: string) => void
}

export function GitBranchCreateModal({ open, onClose, onCreate }: GitBranchCreateModalProps) {
  const [branchName, setBranchName] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = branchName.trim()
    if (!trimmed) return
    onCreate(trimmed)
    setBranchName('')
    onClose()
  }, [branchName, onClose, onCreate])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[10vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="w-full max-w-lg border border-hairline bg-canvas shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-hairline px-3 py-2 font-mono text-[12px]">
          <span className="text-primary">create branch</span>
          <span className="text-muted">enter to submit</span>
        </header>
        <div className="p-3">
          <input
            autoFocus
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSubmit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder="feat/native-branch"
            className="h-9 w-full border border-hairline bg-black/30 px-3 font-mono text-[12px] text-primary outline-none placeholder:text-muted focus:border-accent-primary/50"
          />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-hairline px-3 py-1 font-mono text-[11px] text-muted hover:border-white/20 hover:text-primary"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!branchName.trim()}
            className="border border-accent-primary/40 bg-accent-primary/10 px-3 py-1 font-mono text-[11px] text-accent-primary hover:bg-accent-primary/20 disabled:opacity-40 disabled:hover:bg-accent-primary/10"
          >
            create
          </button>
        </footer>
      </div>
    </div>
  )
}
