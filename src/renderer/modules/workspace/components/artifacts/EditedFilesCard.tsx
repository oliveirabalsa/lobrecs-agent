import { memo, useMemo, useState } from 'react'
import type { DiffProposal } from '../../../../../shared/types'
import { filePathsReferToSameFile } from '../../lib/diffProposalMatching'
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
}

export interface EditedFileEntry {
  filePath: string
  additions: number
  deletions: number
  proposal?: DiffProposal
}

const COLLAPSED_FILE_ROW_COUNT = 5

type OrderedEditedFileEntry = EditedFileEntry & {
  lastEditedIndex: number
}

export function EditedFilesCard({
  proposals,
  fallbackFiles,
}: EditedFilesCardProps) {
  const entries = useMemo(
    () => buildEditedFileEntries(proposals, fallbackFiles),
    [proposals, fallbackFiles],
  )

  const count = entries.length
  const [showAllRows, setShowAllRows] = useState(false)
  const visibleEntries = visibleEditedFileEntries(entries, showAllRows)
  const hiddenCount = Math.max(0, count - visibleEntries.length)

  const [modalEntry, setModalEntry] = useState<EditedFileEntry | null>(null)
  const singleFileDisplayName =
    count === 1 ? editedFileDisplayName(entries[0]?.filePath ?? '') : null

  if (count === 0) return null

  return (
    <>
      <section className="flex flex-col gap-0.5">
        <header className="flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex shrink-0 text-muted" aria-hidden="true">
              {iconFileEdit}
            </span>
            <span className="text-xs font-medium text-secondary">
              Edited {count} file{count === 1 ? '' : 's'}
              {singleFileDisplayName ? ` - ${singleFileDisplayName}` : ''}
            </span>
          </div>
        </header>

        <ul className="flex flex-col">
          {visibleEntries.map((entry) => (
            <FileRow
              key={entry.filePath}
              entry={entry}
              onOpenDiff={setModalEntry}
            />
          ))}
          {hiddenCount > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setShowAllRows(true)}
                className="flex w-full items-center gap-2 py-0.5 pl-5 text-left text-[11px] font-medium text-muted transition-colors hover:text-secondary"
              >
                {hiddenCount} more file{hiddenCount === 1 ? '' : 's'}…
              </button>
            </li>
          ) : showAllRows && count > COLLAPSED_FILE_ROW_COUNT ? (
            <li>
              <button
                type="button"
                onClick={() => setShowAllRows(false)}
                className="flex w-full items-center gap-2 py-0.5 pl-5 text-left text-[11px] font-medium text-muted transition-colors hover:text-secondary"
              >
                Show fewer
              </button>
            </li>
          ) : null}
        </ul>
      </section>

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

export function editedFileDisplayName(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  return normalizedPath.split('/').filter(Boolean).at(-1) ?? filePath
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

export interface FileRowProps {
  entry: EditedFileEntry
  /** Opens the full-screen diff modal for this file. */
  onOpenDiff: (entry: EditedFileEntry) => void
}

const FileRow = memo(function FileRow({
  entry,
  onOpenDiff,
}: FileRowProps) {
  const { filePath, additions, deletions, proposal } = entry
  const hasVisibleStats = additions + deletions > 0
  const displayName = editedFileDisplayName(filePath)

  const handleClick = () => {
    if (resolveRowClick(entry) === 'modal') {
      onOpenDiff(entry)
    } else {
      void window.agentforge.system.openInEditor(filePath)
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className="group flex w-full items-center gap-2 py-0.5 pl-5 text-left transition-colors hover:bg-white/[.03]"
        title={proposal ? `View diff — ${filePath}` : filePath}
      >
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] leading-5 text-secondary transition-colors group-hover:text-primary"
        >
          {displayName}
        </span>
        {hasVisibleStats ? (
          <span className="shrink-0 rounded-sm bg-card-raised px-1.5 py-0.5 font-mono text-[11px] leading-none tabular-nums ring-1 ring-hairline">
            <span className="text-diff-add-text">+{additions}</span>
            <span className="mx-0.5 text-muted">-</span>
            <span className="text-diff-del-text">{deletions}</span>
          </span>
        ) : null}
      </button>
    </li>
  )
}, areFileRowPropsEqual)

export function areFileRowPropsEqual(
  previous: FileRowProps,
  next: FileRowProps,
): boolean {
  return (
    previous.onOpenDiff === next.onOpenDiff &&
    editedFileEntriesAreEqual(previous.entry, next.entry)
  )
}

function editedFileEntriesAreEqual(
  previous: EditedFileEntry,
  next: EditedFileEntry,
): boolean {
  return (
    previous.filePath === next.filePath &&
    previous.additions === next.additions &&
    previous.deletions === next.deletions &&
    diffProposalsAreEqual(previous.proposal, next.proposal)
  )
}

function diffProposalsAreEqual(
  previous: DiffProposal | undefined,
  next: DiffProposal | undefined,
): boolean {
  if (previous === next) return true
  if (!previous || !next) return false

  return (
    previous.filePath === next.filePath &&
    previous.originalContent === next.originalContent &&
    previous.proposedContent === next.proposedContent &&
    previous.description === next.description &&
    previous.changeType === next.changeType &&
    previous.additions === next.additions &&
    previous.deletions === next.deletions &&
    previous.baseHash === next.baseHash &&
    previous.status === next.status
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
  if (hasLineChanges(proposalStats)) return proposalStats
  if (fallback && hasLineChanges(fallback)) return fallback
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
