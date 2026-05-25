interface GitKeybindingsOverlayProps {
  open: boolean
  onClose: () => void
}

const KEYBINDINGS = [
  ['h/l or arrows', 'switch panels (left/right)'],
  ['j/k or arrows', 'move selection (up/down)'],
  ['tab / shift+tab', 'cycle focused panel'],
  ['1..5', 'focus status, files, branches, commits, stash'],
  ['space', 'primary action (stage, checkout, apply)'],
  ['enter', 'open detail or diff'],
  ['a', 'stage all / unstage all (toggle)'],
  ['u', 'unstage selected file'],
  ['c', 'open commit dialog (AI generate available)'],
  ['d', 'discard changes in file'],
  ['D', 'delete item (branch / stash)'],
  ['n', 'create new branch'],
  ['R', 'refresh repository snapshot'],
  ['p / P', 'pull / push'],
  ['A', 'AI review current diff'],
  [':', 'open command palette'],
  ['/', 'filter active panel'],
  ['?', 'show this keybindings overlay'],
  ['esc', 'close overlays'],
]

export function GitKeybindingsOverlay({ open, onClose }: GitKeybindingsOverlayProps) {
  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg border border-hairline bg-canvas shadow-2xl shadow-black/50">
        <header className="flex h-9 items-center justify-between border-b border-hairline px-3 font-mono text-[12px]">
          <span className="text-primary">keybindings</span>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary">
            esc
          </button>
        </header>
        <div className="grid gap-0.5 p-3 font-mono text-[12px]">
          {KEYBINDINGS.map(([key, label]) => (
            <div key={key} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-1">
              <span className="text-accent-primary">{key}</span>
              <span className="text-secondary">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
