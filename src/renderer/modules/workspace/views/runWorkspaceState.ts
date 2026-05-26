import type { AgentActivity, DiffProposal, SessionStatus } from '../../../../shared/types'

export interface SessionDiffReviewState<TReview = unknown> {
  result: TReview | null
  loading: boolean
  error: string | null
}

export type DiffReviewStateBySession<TReview = unknown> = Record<
  string,
  SessionDiffReviewState<TReview>
>

export const EMPTY_DIFF_REVIEW_STATE: SessionDiffReviewState = {
  result: null,
  loading: false,
  error: null,
}

export function getSessionDiffReviewState<TReview>(
  state: Readonly<DiffReviewStateBySession<TReview>>,
  sessionId: string | null,
): SessionDiffReviewState<TReview> {
  if (!sessionId) return EMPTY_DIFF_REVIEW_STATE as SessionDiffReviewState<TReview>
  return state[sessionId] ?? (EMPTY_DIFF_REVIEW_STATE as SessionDiffReviewState<TReview>)
}

export interface SessionChangedLineStats {
  filesChanged: number
  additions: number
  deletions: number
}

export function isFinishedSessionStatus(status: SessionStatus | null): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function sessionHasCodeChanges(
  activities: readonly AgentActivity[],
  diffProposals: readonly DiffProposal[],
): boolean {
  if (diffProposals.length > 0) return true

  return activities.some(
    (activity) => activity.kind === 'file-change' || activity.kind === 'diff-summary',
  )
}

export function getSessionChangedLineStats(
  activities: readonly AgentActivity[],
  diffProposals: readonly DiffProposal[],
): SessionChangedLineStats | null {
  const proposalStats = statsFromDiffProposals(diffProposals)
  if (proposalStats) return proposalStats

  const fileChangeStats = statsFromFileChangeActivities(activities)
  if (fileChangeStats) return fileChangeStats

  return latestDiffSummaryStats(activities)
}

function statsFromDiffProposals(
  diffProposals: readonly DiffProposal[],
): SessionChangedLineStats | null {
  if (diffProposals.length === 0) return null

  const byPath = new Map<string, { additions: number; deletions: number }>()
  for (const proposal of diffProposals) {
    const stats = diffProposalLineStats(proposal)
    if (stats.additions + stats.deletions === 0) continue
    byPath.set(proposal.filePath, stats)
  }

  return summarizePathStats(byPath)
}

function statsFromFileChangeActivities(
  activities: readonly AgentActivity[],
): SessionChangedLineStats | null {
  const byPath = new Map<string, { additions: number; deletions: number }>()

  for (const activity of activities) {
    if (activity.kind !== 'file-change') continue
    const current = byPath.get(activity.filePath) ?? { additions: 0, deletions: 0 }
    current.additions += activity.additions ?? 0
    current.deletions += activity.deletions ?? 0
    byPath.set(activity.filePath, current)
  }

  return summarizePathStats(byPath)
}

function latestDiffSummaryStats(
  activities: readonly AgentActivity[],
): SessionChangedLineStats | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity.kind !== 'diff-summary') continue
    if (activity.additions + activity.deletions === 0) return null

    return {
      filesChanged: activity.filesChanged,
      additions: activity.additions,
      deletions: activity.deletions,
    }
  }

  return null
}

function summarizePathStats(
  byPath: ReadonlyMap<string, { additions: number; deletions: number }>,
): SessionChangedLineStats | null {
  let filesChanged = 0
  let additions = 0
  let deletions = 0

  for (const stats of byPath.values()) {
    if (stats.additions + stats.deletions === 0) continue
    filesChanged += 1
    additions += stats.additions
    deletions += stats.deletions
  }

  if (filesChanged === 0) return null
  return { filesChanged, additions, deletions }
}

function diffProposalLineStats(proposal: DiffProposal): {
  additions: number
  deletions: number
} {
  const additions = proposal.additions ?? 0
  const deletions = proposal.deletions ?? 0

  if (
    additions > 0 ||
    deletions > 0 ||
    proposal.originalContent === proposal.proposedContent
  ) {
    return { additions, deletions }
  }

  return countChangedLines(proposal.originalContent, proposal.proposedContent)
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
