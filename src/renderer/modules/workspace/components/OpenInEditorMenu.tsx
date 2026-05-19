import { useEffect, useRef, useState } from 'react'
import type { EditorInfo } from '../../../../shared/types'

interface Props {
  repoPath: string
  onOpenCliEditor?: (editor: EditorInfo) => void
  /** Optional toast/banner hook for errors — defaults to console + alert. */
  onError?: (message: string) => void
}

/**
 * Matches `SHELL_TERMINAL_EDITOR_ID` in the main process — selecting this
 * pseudo-editor spawns the user's $SHELL inside the project repo instead of
 * launching a detected CLI editor.
 */
const SHELL_TERMINAL_EDITOR: EditorInfo = {
  id: 'shell',
  name: 'Terminal',
  kind: 'cli',
}

export function OpenInEditorMenu({ repoPath, onOpenCliEditor, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [editors, setEditors] = useState<EditorInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open || editors !== null || loading) return
    setLoading(true)
    window.agentforge.system
      .listEditors()
      .then((result) => setEditors(result))
      .catch((error) => {
        console.error('[open-in-editor] list failed', error)
        setEditors([])
      })
      .finally(() => setLoading(false))
  }, [open, editors, loading])

  async function handleSelect(editor: EditorInfo) {
    setOpen(false)

    if (editor.kind === 'cli') {
      onOpenCliEditor?.(editor)
      return
    }

    try {
      await window.agentforge.system.openProjectIn({ editorId: editor.id, repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open editor'
      console.error('[open-in-editor] launch failed', error)
      if (onError) onError(message)
      else window.alert(message)
    }
  }

  const guiEditors = editors?.filter((e) => e.kind === 'gui') ?? []
  const cliEditors = editors?.filter((e) => e.kind === 'cli') ?? []
  const hasAny = (editors?.length ?? 0) > 0

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open project in editor"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
          open
            ? 'bg-white/10 text-primary'
            : 'text-secondary hover:bg-white/5 hover:text-primary'
        }`}
      >
        <ExternalLinkIcon />
        <span className="hidden sm:inline">Open in</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-56 overflow-hidden rounded-card border border-hairline bg-card-raised py-1 shadow-xl shadow-black/40"
        >
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted">Detecting editors…</div>
          ) : (
            <>
              <div className="border-b border-hairline pb-1">
                <div className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-muted">
                  Shell
                </div>
                <EditorRow editor={SHELL_TERMINAL_EDITOR} onSelect={handleSelect} />
              </div>
              {guiEditors.length > 0 ? (
                <div className="border-b border-hairline pb-1">
                  <div className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-muted">
                    Applications
                  </div>
                  {guiEditors.map((editor) => (
                    <EditorRow key={editor.id} editor={editor} onSelect={handleSelect} />
                  ))}
                </div>
              ) : null}
              {cliEditors.length > 0 ? (
                <div className="pt-1">
                  <div className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-muted">
                    Editor in terminal
                  </div>
                  {cliEditors.map((editor) => (
                    <EditorRow key={editor.id} editor={editor} onSelect={handleSelect} />
                  ))}
                </div>
              ) : null}
              {!hasAny ? (
                <div className="px-3 py-2 text-[10px] text-muted/70">
                  No editors detected. Install VS Code, Cursor, vim, etc. to launch them here.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function EditorRow({
  editor,
  onSelect,
}: {
  editor: EditorInfo
  onSelect: (editor: EditorInfo) => void | Promise<void>
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => void onSelect(editor)}
      className="block w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/5"
    >
      {editor.name}
    </button>
  )
}

function ExternalLinkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}
