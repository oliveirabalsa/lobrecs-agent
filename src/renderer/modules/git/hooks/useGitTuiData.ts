import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '../../../../shared/types'
import type {
  GitCommandResult,
  GitCommitAnalysisResult,
  GitDiffReviewResult,
} from '../../../../shared/contracts/git'
import {
  gitCommandResultToOperation,
  type GitOperationState,
  type GitRepositorySnapshot,
  type GitTuiAction,
} from '../state/gitTuiState'

interface GitDetailState {
  title: string
  body: string
  kind: 'status' | 'file' | 'branch' | 'commit' | 'stash' | 'operation'
}

interface GitWorkspaceApi {
  getSnapshot?: (request: { projectId: string }) => Promise<GitRepositorySnapshot>
  getFileDiff?: (request: { projectId: string; path?: string }) => Promise<GitCommandResult>
  getCommitDetail?: (request: { projectId: string; hash?: string }) => Promise<GitCommandResult>
  getStashDetail?: (request: { projectId: string; stashId?: string }) => Promise<GitCommandResult>
  stageFile?: (request: { projectId: string; path: string }) => Promise<GitCommandResult>
  unstageFile?: (request: { projectId: string; path: string }) => Promise<GitCommandResult>
  stageAll?: (projectId: string) => Promise<GitCommandResult>
  discardFile?: (request: { projectId: string; path: string }) => Promise<GitCommandResult>
  deleteBranch?: (request: { projectId: string; branchName: string }) => Promise<GitCommandResult>
  applyStash?: (request: { projectId: string; stashId: string }) => Promise<GitCommandResult>
  popStash?: (request: { projectId: string; stashId: string }) => Promise<GitCommandResult>
  dropStash?: (request: {
    projectId: string
    stashId: string
    confirmed?: boolean
  }) => Promise<GitCommandResult>
  analyzeCommitPlan?: (projectId: string) => Promise<GitCommitAnalysisResult>
  reviewCurrentDiff?: (projectId: string, threadId?: string) => Promise<GitDiffReviewResult>
}

export interface UseGitTuiDataResult {
  snapshot: GitRepositorySnapshot | null
  loading: boolean
  error: string | null
  operation: GitOperationState
  detail: GitDetailState
  refresh: () => void
  runAction: (action: GitTuiAction) => Promise<void>
  generateCommitMessage: () => Promise<string | null>
}

const IDLE_OPERATION: GitOperationState = { status: 'idle' }

export function useGitTuiData(project: Project | null): UseGitTuiDataResult {
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [operation, setOperation] = useState<GitOperationState>(IDLE_OPERATION)
  const [detail, setDetail] = useState<GitDetailState>({
    title: 'Repository',
    body: 'Select a repository item to inspect details.',
    kind: 'status',
  })

  const gitApi = useMemo(
    () => window.agentforge.git as typeof window.agentforge.git & GitWorkspaceApi,
    [],
  )

  useEffect(() => {
    if (!project) {
      setSnapshot(null)
      setLoading(false)
      setError(null)
      setOperation(IDLE_OPERATION)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    loadSnapshot(project, gitApi)
      .then((next) => {
        if (!active) return
        setSnapshot(next)
        setDetail((current) =>
          current.kind === 'status'
            ? {
                title: 'Repository',
                body: buildStatusDetail(next),
                kind: 'status',
              }
            : current,
        )
      })
      .catch((reason: unknown) => {
        if (!active) return
        setSnapshot(null)
        setError(reason instanceof Error ? reason.message : 'Unable to load git data.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [gitApi, project, refreshKey])

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  const runAction = useCallback(
    async (action: GitTuiAction) => {
      if (!project || action.type === 'none') return

      if (isDetailAction(action)) {
        await loadDetail(project.id, action, gitApi, setDetail, setOperation)
        return
      }

      const result = await executeAction(project.id, action, gitApi)
      if (!result) return

      const nextOperation = gitCommandResultToOperation(result, operationMessage(action, result))
      setOperation(nextOperation)
      setDetail({
        title: action.type,
        body: [nextOperation.message, result.stdout, result.stderr].filter(Boolean).join('\n\n'),
        kind: 'operation',
      })
      refresh()
    },
    [gitApi, project, refresh],
  )

  const generateCommitMessage = useCallback(async (): Promise<string | null> => {
    if (!project) return null
    if (!gitApi.analyzeCommitPlan) return null
    setOperation({ status: 'running', message: 'AI is generating commit message...' })
    try {
      const analysis = await gitApi.analyzeCommitPlan(project.id)
      if (analysis.suggestions.length > 0) {
        setOperation({ status: 'success', message: 'AI commit message generated' })
        return analysis.suggestions[0].message
      }
      setOperation({ status: 'error', message: 'AI returned no suggestions.' })
      return null
    } catch (err) {
      setOperation({
        status: 'error',
        message: err instanceof Error ? err.message : 'AI commit analysis failed.',
      })
      return null
    }
  }, [gitApi, project])

  return { snapshot, loading, error, operation, detail, refresh, runAction, generateCommitMessage }
}

async function loadSnapshot(
  project: Project,
  gitApi: typeof window.agentforge.git & GitWorkspaceApi,
): Promise<GitRepositorySnapshot> {
  if (gitApi.getSnapshot) return gitApi.getSnapshot({ projectId: project.id })

  const [currentBranch, pending, branches] = await Promise.all([
    gitApi.getCurrentBranch(project.id).catch(() => ''),
    gitApi.getPendingChanges(project.id).catch(() => ({
      projectId: project.id,
      fileCount: 0,
      hasChanges: false,
    })),
    gitApi.listBranches(project.id).catch(() => []),
  ])

  return {
    projectId: project.id,
    repoPath: project.repoPath,
    branch: {
      currentBranch: currentBranch || undefined,
      upstreamBranch: undefined,
      detached: false,
      ahead: 0,
      behind: 0,
    },
    files: [],
    branches: branches.map((branch) => ({
      name: branch.replace(/^\*\s*/, '').trim(),
      current: branch.replace(/^\*\s*/, '').trim() === currentBranch,
      ahead: 0,
      behind: 0,
    })),
    commits: [],
    stash: [],
    remotes: [],
    pending,
    capturedAt: new Date().toISOString(),
  }
}

function buildStatusDetail(snapshot: GitRepositorySnapshot): string {
  const lines = [
    `branch ${snapshot.branch.currentBranch ?? 'detached'}`,
    snapshot.branch.upstreamBranch ? `upstream ${snapshot.branch.upstreamBranch}` : 'upstream none',
    `ahead ${snapshot.branch.ahead} behind ${snapshot.branch.behind}`,
    `files ${snapshot.files.length || snapshot.pending?.fileCount || 0}`,
    `branches ${snapshot.branches.length}`,
    `commits ${snapshot.commits.length}`,
    `stash ${snapshot.stash.length}`,
  ]
  return lines.join('\n')
}

function isDetailAction(action: GitTuiAction): boolean {
  return (
    action.type === 'open-file-diff' ||
    action.type === 'open-commit-detail' ||
    action.type === 'open-stash-detail' ||
    action.type === 'open-branch-detail' ||
    action.type === 'ai-review-diff'
  )
}

async function loadDetail(
  projectId: string,
  action: GitTuiAction,
  gitApi: typeof window.agentforge.git & GitWorkspaceApi,
  setDetail: (detail: GitDetailState) => void,
  setOperation: (operation: GitOperationState) => void,
) {
  if (action.type === 'open-file-diff') {
    const result = gitApi.getFileDiff
      ? await gitApi.getFileDiff({ projectId, path: action.path })
      : await gitApi.diff({ projectId, scope: 'working-tree' })
    setDetail({
      title: action.path ?? 'Working tree diff',
      body: result.stdout || result.stderr || 'No diff output.',
      kind: 'file',
    })
    return
  }

  if (action.type === 'open-commit-detail') {
    if (!gitApi.getCommitDetail) {
      setOperation({
        status: 'error',
        message: 'Commit details are waiting for the Git workspace backend.',
      })
      return
    }
    const result = await gitApi.getCommitDetail({ projectId, hash: action.hash })
    setDetail({
      title: action.hash ?? 'Commit',
      body: result.stdout || result.stderr || 'No commit detail output.',
      kind: 'commit',
    })
    return
  }

  if (action.type === 'open-stash-detail') {
    if (!gitApi.getStashDetail) {
      setOperation({
        status: 'error',
        message: 'Stash details are waiting for the Git workspace backend.',
      })
      return
    }
    const result = await gitApi.getStashDetail({ projectId, stashId: action.stashId })
    setDetail({
      title: action.stashId ?? 'Stash',
      body: result.stdout || result.stderr || 'No stash detail output.',
      kind: 'stash',
    })
    return
  }

  if (action.type === 'open-branch-detail') {
    setDetail({
      title: action.branchName ?? 'Branch',
      body: 'Space checks out the selected branch. D deletes after confirmation when backend support is available.',
      kind: 'branch',
    })
    return
  }

  if (action.type === 'ai-review-diff') {
    if (!gitApi.reviewCurrentDiff) {
      setOperation({ status: 'error', message: 'AI diff review requires a configured agent.' })
      return
    }
    setOperation({ status: 'running', message: 'AI is reviewing your changes...' })
    setDetail({ title: 'AI Review', body: 'Analyzing diff with AI agent...', kind: 'operation' })
    try {
      const review = await gitApi.reviewCurrentDiff(projectId)
      const body = formatDiffReview(review)
      setDetail({ title: 'AI Review', body, kind: 'operation' })
      setOperation({
        status: 'success',
        message: `AI review complete — ${review.findings.length} finding${review.findings.length === 1 ? '' : 's'}`,
      })
    } catch (err) {
      setOperation({
        status: 'error',
        message: err instanceof Error ? err.message : 'AI review failed.',
      })
    }
  }
}

function formatDiffReview(review: GitDiffReviewResult): string {
  const lines: string[] = []
  lines.push(`Branch: ${review.branch}`)
  lines.push(`Files: ${review.changedFiles.length} changed`)
  lines.push('')
  lines.push(review.summary)

  if (review.findings.length > 0) {
    lines.push('')
    lines.push('─── Findings ───')
    for (const finding of review.findings) {
      const loc = finding.filePath ? ` (${finding.filePath}${finding.line ? `:${finding.line}` : ''})` : ''
      lines.push('')
      lines.push(`[${finding.severity.toUpperCase()}] ${finding.category} — ${finding.title}${loc}`)
      lines.push(finding.detail)
      if (finding.recommendation) {
        lines.push(`→ ${finding.recommendation}`)
      }
    }
  } else {
    lines.push('')
    lines.push('No issues found.')
  }

  return lines.join('\n')
}

async function executeAction(
  projectId: string,
  action: GitTuiAction,
  gitApi: typeof window.agentforge.git & GitWorkspaceApi,
): Promise<GitCommandResult | null> {
  switch (action.type) {
    case 'refresh':
      return { exitCode: 0, stdout: 'Refreshed', stderr: '' }
    case 'pull':
      return gitApi.pull(projectId)
    case 'push':
      return gitApi.push(projectId)
    case 'stage-all':
      return gitApi.stageAll ? gitApi.stageAll(projectId) : gitApi.stage({ projectId })
    case 'unstage-all':
      return gitApi.unstageAll ? gitApi.unstageAll(projectId) : blocked('Unstage all is not available.')
    case 'commit':
      if (!action.message?.trim()) return blocked('Commit message is required.')
      return gitApi.commit({ projectId, message: action.message })
    case 'unstage-file':
      if (!action.path) return blocked('No file selected.')
      if (gitApi.unstageFile) return gitApi.unstageFile({ projectId, path: action.path })
      return blocked('Unstage is not available.')
    case 'toggle-file-stage':
      if (!action.path) return blocked('No file selected.')
      if (action.staged) {
        if (gitApi.unstageFile) return gitApi.unstageFile({ projectId, path: action.path })
        return blocked('Unstage is waiting for backend support.')
      }
      if (gitApi.stageFile) return gitApi.stageFile({ projectId, path: action.path })
      return gitApi.stage({ projectId, paths: [action.path] })
    case 'discard-file':
      if (!action.path) return blocked('No file selected.')
      return gitApi.discardFile
        ? gitApi.discardFile({ projectId, path: action.path })
        : gitApi.revert({ projectId, paths: [action.path] })
    case 'checkout-branch':
      if (!action.branchName) return blocked('No branch selected.')
      return gitApi.checkoutBranch(projectId, action.branchName)
    case 'delete-branch':
      if (!action.branchName) return blocked('No branch selected.')
      return gitApi.deleteBranch
        ? gitApi.deleteBranch({ projectId, branchName: action.branchName })
        : blocked('Branch deletion is not available.')
    case 'apply-stash':
      if (!action.stashId) return blocked('No stash selected.')
      if (!gitApi.applyStash) return blocked('Stash apply is waiting for backend support.')
      return gitApi.applyStash({ projectId, stashId: action.stashId })
    case 'drop-stash':
      if (!action.stashId) return blocked('No stash selected.')
      if (!gitApi.dropStash) return blocked('Stash drop is waiting for backend support.')
      return gitApi.dropStash({ projectId, stashId: action.stashId, confirmed: true })
    case 'create-branch':
      return blocked('Use the existing branch manager until native branch creation input lands here.')
    default:
      return null
  }
}

function blocked(message: string): GitCommandResult {
  return { exitCode: 1, stdout: '', stderr: message }
}

function operationMessage(action: GitTuiAction, result: GitCommandResult): string {
  if (result.exitCode !== 0) return `${action.type} failed`
  return `${action.type} completed`
}
