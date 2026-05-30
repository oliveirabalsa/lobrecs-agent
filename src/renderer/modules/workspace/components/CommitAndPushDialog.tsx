import { useEffect, useMemo, useState } from 'react'
import type {
  GitChangedFile,
  GitCommitAnalysisResult,
  GitCommitSuggestion,
  Project,
} from '../../../../shared/types'
import { Button, Modal, Spinner } from '../../../components/ui'
import { AGENT_SHORT, formatModelLabel } from './Composer/modelDisplay'

interface CommitAndPushDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface DraftCommit {
  id: string
  message: string
  summary: string
}

type FileAssignments = Record<string, string>

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function CommitAndPushDialog({ project, open, onOpenChange }: CommitAndPushDialogProps) {
  const [analysis, setAnalysis] = useState<GitCommitAnalysisResult | null>(null)
  const [drafts, setDrafts] = useState<DraftCommit[]>([])
  const [assignments, setAssignments] = useState<FileAssignments>({})
  const [analyzing, setAnalyzing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!project) {
      setAnalysis(null)
      setDrafts([])
      setAssignments({})
      setError('Select a project before committing and pushing.')
      setAnalyzing(false)
      setSubmitting(false)
      setSuccessMessage(null)
      return
    }

    let cancelled = false

    setAnalysis(null)
    setDrafts([])
    setAssignments({})
    setError(null)
    setAnalyzing(true)
    setSubmitting(false)
    setSuccessMessage(null)

    void window.agentforge.git
      .analyzeCommitPlan(project.id)
      .then((result) => {
        if (cancelled) return
        setAnalysis(result)
        setDrafts(result.suggestions.map(toDraftCommit))
        setAssignments(buildAssignments(result))
      })
      .catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'Failed to analyze changes.')
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, project])

  const filesByCommitId = useMemo(() => {
    if (!analysis) return {}

    return Object.fromEntries(
      drafts.map((draft) => [
        draft.id,
        analysis.changedFiles.filter((file) => assignments[file.path] === draft.id),
      ]),
    ) as Record<string, GitChangedFile[]>
  }, [analysis, assignments, drafts])

  const unassignedFiles = useMemo(() => {
    if (!analysis) return []

    return analysis.changedFiles.filter((file) => !assignments[file.path])
  }, [analysis, assignments])

  const emptyDrafts = useMemo(
    () => drafts.filter((draft) => (filesByCommitId[draft.id] ?? []).length === 0),
    [drafts, filesByCommitId],
  )

  const readyToSubmit =
    Boolean(analysis) &&
    !analyzing &&
    !submitting &&
    !successMessage &&
    drafts.length > 0 &&
    unassignedFiles.length === 0 &&
    emptyDrafts.length === 0 &&
    drafts.every((draft) => draft.message.trim())

  async function refreshAnalysis(): Promise<void> {
    if (!project || submitting) return

    setAnalysis(null)
    setDrafts([])
    setAssignments({})
    setError(null)
    setAnalyzing(true)
    setSuccessMessage(null)

    try {
      const result = await window.agentforge.git.analyzeCommitPlan(project.id)
      setAnalysis(result)
      setDrafts(result.suggestions.map(toDraftCommit))
      setAssignments(buildAssignments(result))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to analyze changes.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleApprove(): Promise<void> {
    if (!project || !analysis || !readyToSubmit) return

    setSubmitting(true)
    setError(null)

    try {
      const suggestions = buildSuggestions(drafts, analysis.changedFiles, assignments)
      const result = await window.agentforge.git.executeCommitPlan({
        projectId: project.id,
        fingerprint: analysis.fingerprint,
        suggestions,
      })
      const message = `Pushed ${result.commits.length} commit${result.commits.length === 1 ? '' : 's'} successfully.`
      setSuccessMessage(message)

      window.setTimeout(() => {
        onOpenChange(false)
      }, 1200)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Commit and push failed.')
    } finally {
      setSubmitting(false)
    }
  }

  function addCommit(): void {
    setDrafts((current) => [
      ...current,
      {
        id: `commit-${Date.now()}-${current.length + 1}`,
        message: '',
        summary: '',
      },
    ])
  }

  function removeCommit(commitId: string): void {
    setDrafts((current) => current.filter((draft) => draft.id !== commitId))
    setAssignments((current) => {
      const next: FileAssignments = { ...current }
      for (const [filePath, assignedCommitId] of Object.entries(current)) {
        if (assignedCommitId === commitId) next[filePath] = ''
      }
      return next
    })
  }

  const busy = analyzing || submitting

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen)
      }}
      title="Commit & Push"
      description="Review AI-suggested commit splits before committing and pushing."
      maxWidth={760}
      closeOnBackdrop={!submitting}
      closeOnEsc={!submitting}
    >
      <div className="flex max-h-[78vh] flex-col">
        <div className="min-h-0 overflow-y-auto pr-1">
          {analyzing ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
              <Spinner size={16} />
              <div className="space-y-1">
                <p className="text-sm font-medium text-primary">
                  Reviewing the current diff with a lightweight model
                </p>
                <p className="text-xs text-muted">
                  Generating commit splits before anything is staged or pushed.
                </p>
              </div>
            </div>
          ) : successMessage ? (
            <div className="rounded-card border border-accent-add/30 bg-accent-add/10 px-4 py-4 text-sm text-accent-add">
              {successMessage}
            </div>
          ) : analysis ? (
            <div className="flex flex-col gap-4">
              <section className="rounded-card border border-hairline bg-card/70 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  <span className="rounded-pill border border-hairline px-2 py-1 text-primary">
                    {analysis.branch}
                  </span>
                  <span>{analysis.changedFiles.length} files</span>
                  <span>{drafts.length} commits</span>
                  <span>
                    {AGENT_SHORT[analysis.analysis.agentId]} ·{' '}
                    {formatModelLabel(analysis.analysis.agentId, analysis.analysis.model)}
                  </span>
                </div>
                <p className="mt-3 text-sm text-primary">{analysis.analysisSummary}</p>
                <p className="mt-1 text-xs text-secondary">{analysis.statusSummary}</p>
              </section>

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted">
                  {unassignedFiles.length > 0
                    ? `${unassignedFiles.length} file${unassignedFiles.length === 1 ? '' : 's'} still need a commit`
                    : 'Every changed file is assigned'}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => void refreshAnalysis()} disabled={busy}>
                    Refresh
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={addCommit} disabled={busy}>
                    Add commit
                  </Button>
                </div>
              </div>

              {drafts.map((draft, index) => {
                const files = filesByCommitId[draft.id] ?? []

                return (
                  <section
                    key={draft.id}
                    className="rounded-card border border-hairline bg-card-raised/60 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                          Commit {index + 1}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {files.length} file{files.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      {drafts.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeCommit(draft.id)}
                          disabled={busy}
                          className="focus-ring rounded-card px-2 py-1 text-xs text-muted transition-colors hover:bg-white/5 hover:text-primary disabled:opacity-40"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <input
                      value={draft.message}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id ? { ...item, message: event.target.value } : item,
                          ),
                        )
                      }
                      disabled={busy}
                      className="mt-3 h-10 w-full rounded-card border border-hairline bg-card px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-accent-primary/60"
                      placeholder="feat(scope): short message"
                      aria-label={`Commit ${index + 1} message`}
                    />

                    {draft.summary ? (
                      <p className="mt-2 text-xs leading-5 text-secondary">{draft.summary}</p>
                    ) : null}

                    {files.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {files.map((file) => (
                          <FileAssignmentRow
                            key={file.path}
                            file={file}
                            commitId={draft.id}
                            assignments={assignments}
                            drafts={drafts}
                            disabled={busy}
                            onAssign={(nextCommitId) =>
                              setAssignments((current) => ({
                                ...current,
                                [file.path]: nextCommitId,
                              }))
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-card border border-dashed border-hairline px-3 py-2 text-xs text-muted">
                        No files assigned yet.
                      </div>
                    )}
                  </section>
                )
              })}

              {unassignedFiles.length > 0 ? (
                <section className="rounded-card border border-accent-warn/30 bg-accent-warn/10 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent-warn">
                    Unassigned Files
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {unassignedFiles.map((file) => (
                      <FileAssignmentRow
                        key={file.path}
                        file={file}
                        commitId=""
                        assignments={assignments}
                        drafts={drafts}
                        disabled={busy}
                        onAssign={(nextCommitId) =>
                          setAssignments((current) => ({
                            ...current,
                            [file.path]: nextCommitId,
                          }))
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-4 py-4 text-sm text-accent-del">
              {error ?? 'Unable to prepare commit suggestions.'}
            </div>
          )}
        </div>

        {error && analysis ? (
          <div className="mt-4 whitespace-pre-wrap rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            {error}
          </div>
        ) : null}

        {analysis && emptyDrafts.length > 0 && !successMessage ? (
          <div className="mt-4 rounded-card border border-accent-warn/30 bg-accent-warn/10 px-3 py-2 text-xs text-accent-warn">
            Remove empty commits or assign files to them before approving.
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Close
          </Button>
          {analysis && !successMessage ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleApprove()}
              disabled={!readyToSubmit}
              loading={submitting}
            >
              {submitting ? 'Committing & Pushing' : 'Approve & Push'}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

interface FileAssignmentRowProps {
  file: GitChangedFile
  commitId: string
  assignments: FileAssignments
  drafts: readonly DraftCommit[]
  disabled: boolean
  onAssign: (commitId: string) => void
}

function FileAssignmentRow({
  file,
  commitId,
  assignments,
  drafts,
  disabled,
  onAssign,
}: FileAssignmentRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-card border border-hairline bg-card/80 px-3 py-2">
      <span className={statusPillClass(file.status)}>{statusLabel(file.status)}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-primary">
        {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
      </span>
      <select
        value={assignments[file.path] ?? commitId}
        disabled={disabled}
        onChange={(event) => onAssign(event.target.value)}
        className={cx(
          'h-8 rounded-card border border-hairline bg-card px-2 text-xs text-primary outline-none',
          'focus:border-accent-primary/60 disabled:opacity-40',
        )}
        aria-label={`Assign ${file.path} to a commit`}
      >
        <option value="">Unassigned</option>
        {drafts.map((draft, index) => (
          <option key={draft.id} value={draft.id}>
            Commit {index + 1}
          </option>
        ))}
      </select>
    </div>
  )
}

function buildAssignments(result: GitCommitAnalysisResult): FileAssignments {
  const next: FileAssignments = {}

  for (const suggestion of result.suggestions) {
    for (const filePath of suggestion.files) {
      next[filePath] = suggestion.id
    }
  }

  for (const file of result.changedFiles) {
    if (!next[file.path]) next[file.path] = ''
  }

  return next
}

function buildSuggestions(
  drafts: readonly DraftCommit[],
  changedFiles: readonly GitChangedFile[],
  assignments: FileAssignments,
): GitCommitSuggestion[] {
  return drafts
    .map((draft) => ({
      id: draft.id,
      message: draft.message.trim(),
      summary: draft.summary,
      files: changedFiles
        .filter((file) => assignments[file.path] === draft.id)
        .map((file) => file.path),
    }))
    .filter((suggestion) => suggestion.files.length > 0)
}

function toDraftCommit(suggestion: GitCommitSuggestion): DraftCommit {
  return {
    id: suggestion.id,
    message: suggestion.message,
    summary: suggestion.summary,
  }
}

function statusLabel(status: GitChangedFile['status']): string {
  if (status === 'added') return 'Added'
  if (status === 'deleted') return 'Deleted'
  if (status === 'renamed') return 'Renamed'
  if (status === 'copied') return 'Copied'
  if (status === 'untracked') return 'New'
  if (status === 'type-changed') return 'Type'
  return 'Modified'
}

function statusPillClass(status: GitChangedFile['status']): string {
  return cx(
    'inline-flex h-6 shrink-0 items-center rounded-pill border px-2 text-[11px] font-medium uppercase tracking-[0.12em]',
    status === 'added' || status === 'untracked'
      ? 'border-accent-add/30 bg-accent-add/10 text-accent-add'
      : status === 'deleted'
        ? 'border-accent-del/30 bg-accent-del/10 text-accent-del'
        : status === 'renamed' || status === 'copied'
          ? 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary'
          : 'border-hairline bg-card text-secondary',
  )
}
