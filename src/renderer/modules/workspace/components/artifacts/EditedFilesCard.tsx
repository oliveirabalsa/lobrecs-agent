import { DiffEditor } from '@monaco-editor/react'
import { useMemo, useState } from 'react'
import type { DiffProposal } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import {
  DRACULA_THEME_NAME,
  languageFromPath,
  registerDraculaTheme,
} from '../../../../lib/monaco'
import { filePathsReferToSameFile } from '../../lib/diffProposalMatching'
import { AnimatedDiffStat } from './AnimatedDiffStat'
import { FileDiffModal } from './FileDiffModal'

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

export interface EditedFileEntry {
  filePath: string
  additions: number
  deletions: number
  proposal?: DiffProposal
}

const COLLAPSED_FILE_ROW_COUNT = 3

type OrderedEditedFileEntry = EditedFileEntry & {
  lastEditedIndex: number
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
  const entries = useMemo(
    () => buildEditedFileEntries(proposals, fallbackFiles),
    [proposals, fallbackFiles],
  )

  const totalAdditions = entries.reduce((sum, e) => sum + e.additions, 0)
  const totalDeletions = entries.reduce((sum, e) => sum + e.deletions, 0)
  const hasVisibleStats = totalAdditions + totalDeletions > 0
  const count = entries.length
  const [showAllRows, setShowAllRows] = useState(false)
  const visibleEntries = visibleEditedFileEntries(entries, showAllRows)
  const hiddenCount = Math.max(0, count - visibleEntries.length)

  // The file whose diff is shown full-screen. One modal serves every row.
  const [modalEntry, setModalEntry] = useState<EditedFileEntry | null>(null)

  if (count === 0) return null

  return (
    <>
      <article className="overflow-hidden rounded-card border border-hairline bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex shrink-0 text-secondary" aria-hidden="true">
              {iconFileEdit}
            </span>
            <div className="text-sm font-medium text-primary">
              Edited {count} file{count === 1 ? '' : 's'}
            </div>
            {hasVisibleStats ? (
              <AnimatedDiffStat
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
              />
            ) : null}
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
          {visibleEntries.map((entry) => (
            <FileRow
              key={entry.filePath}
              entry={entry}
              onReview={onReview}
              onOpenDiff={setModalEntry}
            />
          ))}
          {hiddenCount > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setShowAllRows(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-secondary transition-colors hover:bg-white/5 hover:text-primary"
              >
                <span aria-hidden="true">{iconChevronDown}</span>
                Show {hiddenCount} more file{hiddenCount === 1 ? '' : 's'}
              </button>
            </li>
          ) : showAllRows && count > COLLAPSED_FILE_ROW_COUNT ? (
            <li>
              <button
                type="button"
                onClick={() => setShowAllRows(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-secondary transition-colors hover:bg-white/5 hover:text-primary"
              >
                <span
                  aria-hidden="true"
                  style={{ display: 'inline-block', transform: 'rotate(180deg)' }}
                >
                  {iconChevronDown}
                </span>
                Show fewer files
              </button>
            </li>
          ) : null}
        </ul>
      </article>

      <FileDiffModal
        proposal={modalEntry?.proposal ?? null}
        additions={modalEntry?.additions ?? 0}
        deletions={modalEntry?.deletions ?? 0}
        onClose={() => setModalEntry(null)}
        onOpenInEditor={(filePath) => void window.agentforge.system.openInEditor(filePath)}
      />
    </>
  )
}

export function visibleEditedFileEntries<T>(
  entries: readonly T[],
  showAllRows: boolean,
): T[] {
  return showAllRows ? [...entries] : entries.slice(0, COLLAPSED_FILE_ROW_COUNT)
}

export function buildEditedFileEntries(
  proposals: readonly DiffProposal[],
  fallbackFiles: EditedFilesCardProps['fallbackFiles'],
): EditedFileEntry[] {
  const fallbackByPath = new Map<string, OrderedEditedFileEntry>()
  for (const [index, file] of (fallbackFiles ?? []).entries()) {
    const existing = fallbackByPath.get(file.filePath)
    if (existing) {
      existing.additions += file.additions ?? 0
      existing.deletions += file.deletions ?? 0
      existing.lastEditedIndex = index
      continue
    }
    fallbackByPath.set(file.filePath, {
      filePath: file.filePath,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      lastEditedIndex: index,
    })
  }

  const fallbackEntries = [...fallbackByPath.values()]
  if (proposals.length === 0) return newestEditedFilesFirst(fallbackEntries)

  const byPath = new Map<string, OrderedEditedFileEntry>()
  const consumedFallbackPaths = new Set<string>()
  for (const [proposalIndex, proposal] of proposals.entries()) {
    const stats = displayStatsForProposal(proposal)
    const fallback = fallbackEntries.find((entry) =>
      filePathsReferToSameFile(entry.filePath, proposal.filePath),
    )
    if (fallback) consumedFallbackPaths.add(fallback.filePath)
    const visibleStats = statsWithFallback(stats, fallback)

    byPath.set(proposal.filePath, {
      filePath: proposal.filePath,
      additions: visibleStats.additions,
      deletions: visibleStats.deletions,
      proposal,
      lastEditedIndex: fallback?.lastEditedIndex ?? proposalIndex,
    })
  }

  for (const fallback of fallbackEntries) {
    if (!consumedFallbackPaths.has(fallback.filePath)) {
      byPath.set(fallback.filePath, fallback)
    }
  }

  return newestEditedFilesFirst([...byPath.values()])
}

function newestEditedFilesFirst(entries: OrderedEditedFileEntry[]): EditedFileEntry[] {
  return entries
    .filter(hasLineChanges)
    .sort((a, b) => b.lastEditedIndex - a.lastEditedIndex)
    .map(toEditedFileEntry)
}

function toEditedFileEntry(entry: OrderedEditedFileEntry): EditedFileEntry {
  const editedFileEntry: EditedFileEntry = {
    filePath: entry.filePath,
    additions: entry.additions,
    deletions: entry.deletions,
  }
  if (entry.proposal) editedFileEntry.proposal = entry.proposal
  return editedFileEntry
}

function FileRow({
  entry,
  onReview,
  onOpenDiff,
}: {
  entry: EditedFileEntry
  onReview?: (filePath?: string) => void
  /** Opens the full-screen diff modal for this file. */
  onOpenDiff: (entry: EditedFileEntry) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { filePath, additions, deletions, proposal } = entry
  const hasVisibleStats = additions + deletions > 0

  const handlePathClick = () => {
    if (resolveRowClick(entry) === 'modal') {
      onOpenDiff(entry)
    } else {
      void window.agentforge.system.openInEditor(filePath)
    }
  }

  return (
    <li className="flex flex-col">
      <div className="group flex items-center gap-2 px-3 py-2">
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
          onClick={handlePathClick}
          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-secondary transition-colors hover:text-primary"
          dir="rtl"
          title={proposal ? `View diff — ${filePath}` : filePath}
        >
          {filePath}
        </button>
        {hasVisibleStats ? (
          <AnimatedDiffStat
            additions={additions}
            deletions={deletions}
            className="shrink-0 text-xs"
          />
        ) : null}
        <button
          type="button"
          onClick={() => void window.agentforge.system.openInEditor(filePath)}
          className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
          title="Open in editor"
        >
          {iconExternalLink}
        </button>
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
        theme={DRACULA_THEME_NAME}
        beforeMount={registerDraculaTheme}
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

/**
 * Decide what a click on a file row should do.
 *
 * Rows backed by a live `DiffProposal` carry the file's before/after content,
 * so they can render a real diff in the full-screen modal. "Fallback" rows are
 * built only from per-edit `file-change` activity metadata (path + line
 * counts) — they have no content, so there is nothing to diff.
 *
 * TODO(learning): implement the routing policy for a content-less row.
 * This shapes the feature's UX — pick the behavior you want:
 *   - `'editor'` — fall back to opening the user's external editor.
 *   - `'modal'`  — open the modal anyway (it would show empty panes today;
 *                  only choose this if the modal later gains a plain view).
 * Consider: a content-less click that silently does nothing feels broken,
 * but routing every row to the modal can surface an empty diff. The 'editor'
 * fallback is the safe default — but the call is yours.
 */
function resolveRowClick(entry: EditedFileEntry): 'modal' | 'editor' {
  // TODO(learning): replace this placeholder with your routing decision.
  return entry.proposal ? 'modal' : 'editor'
}

function displayStatsForProposal(proposal: DiffProposal): {
  additions: number
  deletions: number
} {
  const additions = proposal.additions ?? 0
  const deletions = proposal.deletions ?? 0

  if (
    (additions > 0 || deletions > 0) ||
    proposal.originalContent === proposal.proposedContent
  ) {
    return { additions, deletions }
  }

  return countChangedLines(proposal.originalContent, proposal.proposedContent)
}

function statsWithFallback(
  proposalStats: { additions: number; deletions: number },
  fallback?: EditedFileEntry,
): { additions: number; deletions: number } {
  if (!fallback) return proposalStats
  if (hasLineChanges(fallback)) return fallback
  return proposalStats
}

function hasLineChanges(entry: { additions: number; deletions: number }): boolean {
  return entry.additions + entry.deletions > 0
}

function countChangedLines(
  originalContent: string,
  proposedContent: string,
): { additions: number; deletions: number } {
  const originalLines = splitComparableLines(originalContent)
  const proposedLines = splitComparableLines(proposedContent)

  let prefix = 0
  while (
    prefix < originalLines.length &&
    prefix < proposedLines.length &&
    originalLines[prefix] === proposedLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix + prefix < originalLines.length &&
    suffix + prefix < proposedLines.length &&
    originalLines[originalLines.length - 1 - suffix] ===
      proposedLines[proposedLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    additions: Math.max(0, proposedLines.length - prefix - suffix),
    deletions: Math.max(0, originalLines.length - prefix - suffix),
  }
}

function splitComparableLines(content: string): string[] {
  if (!content) return []
  return content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
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

const iconChevronDown = (
  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const iconExternalLink = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6.5 3.5H3a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10" strokeLinecap="round" />
    <path d="M9.5 2.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 2.5 8 8" strokeLinecap="round" />
  </svg>
)
