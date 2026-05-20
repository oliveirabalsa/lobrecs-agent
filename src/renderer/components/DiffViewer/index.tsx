import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import type { DiffProposal } from '../../../shared/types'

interface Props {
  proposals: DiffProposal[]
  /**
   * When provided, focuses the matching proposal in the tab strip whenever it
   * changes. Used by the "Review" button in `<EditedFilesCard>` so clicking a
   * specific file row jumps straight to that diff.
   */
  focusFilePath?: string | null
}

function fileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? filePath
}

function languageFromPath(filePath: string) {
  const extension = filePath.split('.').at(-1)?.toLowerCase()

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    default:
      return 'plaintext'
  }
}

export function DiffViewer({ proposals, focusFilePath }: Props) {
  const [selected, setSelected] = useState(0)
  const current = proposals[selected] ?? proposals[0]

  useEffect(() => {
    if (selected >= proposals.length) {
      setSelected(Math.max(0, proposals.length - 1))
    }
  }, [proposals.length, selected])

  // External focus request — e.g. clicking "Review" on a file row in the
  // <EditedFilesCard> jumps to that tab in the diff strip.
  useEffect(() => {
    if (!focusFilePath) return
    const idx = proposals.findIndex((p) => p.filePath === focusFilePath)
    if (idx >= 0) setSelected(idx)
  }, [focusFilePath, proposals])

  if (!current) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        No code changes to review.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-hairline bg-sidebar">
      <div className="flex min-h-10 items-center border-b border-hairline">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {proposals.map((proposal, index) => (
            <button
              key={proposal.filePath}
              type="button"
              onClick={() => setSelected(index)}
              className={`min-w-0 shrink-0 border-b-2 px-3 py-2 text-xs ${
                index === selected
                  ? 'border-accent-primary text-primary'
                  : 'border-transparent text-muted hover:text-secondary'
              }`}
              title={proposal.filePath}
            >
              <span className="block max-w-44 truncate">{fileName(proposal.filePath)}</span>
            </button>
          ))}
        </div>
        {current.status ? (
          <span
            className={`rounded-pill border px-2 py-0.5 text-[11px] capitalize ${
              current.status === 'conflict'
                ? 'border-accent-del/40 bg-accent-del/10 text-accent-del'
                : 'border-accent-add/40 bg-accent-add/10 text-accent-add'
            }`}
          >
            {current.status}
          </span>
        ) : null}
        <span className="px-3 text-xs text-muted">
          {selected + 1} / {proposals.length} files
        </span>
      </div>

      {current.description ? (
        <div className="border-b border-hairline px-3 py-2 text-xs text-muted">
          {current.description}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DiffEditor
          key={current.filePath}
          height="100%"
          theme="vs-dark"
          original={current.originalContent}
          modified={current.proposedContent}
          language={languageFromPath(current.filePath)}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 18,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}
