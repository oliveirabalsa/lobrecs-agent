import { DiffEditor } from '@monaco-editor/react'
import { useMemo, useState } from 'react'
import type { DiffProposal } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import { AnimatedDiffStat } from './AnimatedDiffStat'

export interface EditedFilesCardProps {
  /** Real-time proposals from the parent run state. */
  proposals: DiffProposal[]
  /**
   * Optional fallback when no proposals are available (e.g. the file-change
   * activities arrived but no DiffProposal exists yet). Each entry just
   * provides the path + per-file numbers for header display.
   */
  fallbackFiles?: Array<{
    filePath: string
    additions?: number
    deletions?: number
    changeType?: 'added' | 'modified' | 'deleted'
  }>
  onReview?: (filePath?: string) => void
}

interface FileEntry {
  filePath: string
  additions: number
  deletions: number
  proposal?: DiffProposal
}

/**
 * EditedFilesCard — Codex-style "Edited N files" card.
 *
 * Header: file-edit icon + count + diff summary (+N -M) on the left;
 * Review control on the right.
 * Body: per-file rows (path truncated from left, +N -M, expand chevron).
 * Expanded row shows a simplified inline preview of the proposed content
 * (no Monaco — that lives in the right panel via the "View full diff" CTA).
 */
export function EditedFilesCard({
  proposals,
  fallbackFiles,
  onReview,
}: EditedFilesCardProps) {
  const entries = useMemo<FileEntry[]>(() => {
    // Live proposals carry a whole-file diff — one per path, last wins.
    if (proposals.length > 0) {
      const byPath = new Map<string, FileEntry>()
      for (const proposal of proposals) {
        byPath.set(proposal.filePath, {
          filePath: proposal.filePath,
          additions: proposal.additions ?? 0,
          deletions: proposal.deletions ?? 0,
          proposal,
        })
      }
      return [...byPath.values()]
    }
    // Fallback rows come from per-edit `file-change` activities, so the same
    // file can appear several times in one turn — sum those into one row.
    const byPath = new Map<string, FileEntry>()
    for (const file of fallbackFiles ?? []) {
      const existing = byPath.get(file.filePath)
      if (existing) {
        existing.additions += file.additions ?? 0
        existing.deletions += file.deletions ?? 0
        continue
      }
      byPath.set(file.filePath, {
        filePath: file.filePath,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
      })
    }
    return [...byPath.values()]
  }, [proposals, fallbackFiles])

  const totalAdditions = entries.reduce((sum, e) => sum + e.additions, 0)
  const totalDeletions = entries.reduce((sum, e) => sum + e.deletions, 0)
  const count = entries.length

  if (count === 0) return null

  return (
    <article className="overflow-hidden rounded-card border border-hairline bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 text-secondary" aria-hidden="true">
            {iconFileEdit}
          </span>
          <div className="text-sm font-medium text-primary">
            Edited {count} file{count === 1 ? '' : 's'}
          </div>
          <AnimatedDiffStat
            additions={totalAdditions}
            deletions={totalDeletions}
            className="text-xs"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onReview ? (
            <Button variant="primary" size="sm" onClick={() => onReview()}>
              Review
            </Button>
          ) : null}
        </div>
      </header>

      <ul className="divide-y divide-hairline">
        {entries.map((entry) => (
          <FileRow
            key={entry.filePath}
            entry={entry}
            onReview={onReview}
          />
        ))}
      </ul>
    </article>
  )
}

function FileRow({
  entry,
  onReview,
}: {
  entry: FileEntry
  onReview?: (filePath?: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { filePath, additions, deletions, proposal } = entry

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-secondary transition-colors hover:text-primary"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 120ms ease-out',
            }}
          >
            {iconChevronRight}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void window.agentforge.system.openInEditor(filePath)}
          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-secondary transition-colors hover:text-primary"
          dir="rtl"
          title={filePath}
        >
          {filePath}
        </button>
        <AnimatedDiffStat
          additions={additions}
          deletions={deletions}
          className="shrink-0 text-xs"
        />
      </div>

      {expanded ? (
        <div className="border-t border-hairline bg-canvas/40 px-3 py-2">
          {proposal ? (
            <InlineDiffPreview proposal={proposal} />
          ) : (
            <div className="text-xs text-muted">No diff content available.</div>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            {onReview ? (
              <button
                type="button"
                onClick={() => onReview(filePath)}
                className="rounded px-2 py-1 text-xs text-secondary hover:bg-white/5 hover:text-primary"
              >
                View full diff
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}

function InlineDiffPreview({ proposal }: { proposal: DiffProposal }) {
  return (
    <div className="h-72 min-w-0 overflow-hidden rounded border border-hairline bg-card">
      <DiffEditor
        key={proposal.filePath}
        height="100%"
        theme="vs-dark"
        original={proposal.originalContent || ''}
        modified={proposal.proposedContent || ''}
        language={languageFromPath(proposal.filePath)}
        options={{
          readOnly: true,
          originalEditable: false,
          renderSideBySide: false,
          minimap: { enabled: false },
          fontSize: 11,
          lineHeight: 17,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
        }}
      />
    </div>
  )
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

const iconFileEdit = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 1.75H4A1.5 1.5 0 0 0 2.5 3.25v9.5A1.5 1.5 0 0 0 4 14.25h8a1.5 1.5 0 0 0 1.5-1.5V6.25" />
    <path d="M9 1.75v3.5h4.5" strokeLinejoin="round" />
    <path d="m10.5 10.25 2.5-2.5 1.25 1.25-2.5 2.5h-1.25v-1.25Z" strokeLinejoin="round" />
  </svg>
)

const iconChevronRight = (
  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
