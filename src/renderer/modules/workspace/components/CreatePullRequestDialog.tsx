import { useEffect, useState } from 'react'
import type { CreatePullRequestResult, Project, GitRemoteInfo } from '../../../../shared/types'
import { Button, Modal } from '../../../components/ui'

interface CreatePullRequestDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreatePullRequestDialog({
  project,
  open,
  onOpenChange,
}: CreatePullRequestDialogProps) {
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [creatingPr, setCreatingPr] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPr, setCreatedPr] = useState<CreatePullRequestResult | null>(null)

  const [remoteInfo, setRemoteInfo] = useState<GitRemoteInfo | null>(null)
  const [template, setTemplate] = useState<string>('')

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [headBranch, setHeadBranch] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function initializeDialog(): Promise<void> {
      setLoadingInfo(true)
      setGeneratingDraft(false)
      setCreatingPr(false)
      setError(null)
      setCreatedPr(null)
      setRemoteInfo(null)
      setTemplate('')
      setTitle('')
      setBody('')
      setHeadBranch('')
      setBaseBranch('main')

      if (!project) {
        setError('Select a project first.')
        setLoadingInfo(false)
        return
      }

      try {
        const [remote, prTemplate, currentBranch] = await Promise.all([
          window.agentforge.git.getRemote(project.id),
          window.agentforge.git.getPrTemplate(project.id),
          window.agentforge.git.getCurrentBranch(project.id),
        ])

        if (cancelled) return

        const branch = currentBranch.trim() || 'HEAD'
        const targetBranch = detectDefaultBranch(remote.provider)

        setRemoteInfo(remote)
        setTemplate(prTemplate)
        setHeadBranch(branch)
        setBaseBranch(targetBranch)
        setBody(prTemplate)

        if (remote.provider === 'unsupported') return

        setGeneratingDraft(true)
        try {
          const draft = await window.agentforge.git.generatePrDraft({
            projectId: project.id,
            headBranch: branch,
            baseBranch: targetBranch,
          })

          if (cancelled) return
          setTitle(draft.title.trim())
          setBody(draft.body.trim() ? draft.body : prTemplate)
        } catch (reason) {
          if (cancelled) return
          setError(reason instanceof Error ? reason.message : 'Failed to generate PR draft.')
        } finally {
          if (!cancelled) setGeneratingDraft(false)
        }
      } catch (reason) {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'Failed to load PR info.')
      } finally {
        if (!cancelled) setLoadingInfo(false)
      }
    }

    void initializeDialog()

    return () => {
      cancelled = true
    }
  }, [open, project])

  const loading = loadingInfo || generatingDraft || creatingPr
  const readyToGenerate = Boolean(project) && headBranch.trim().length > 0 && baseBranch.trim().length > 0
  const readyToSubmit =
    Boolean(remoteInfo) &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    headBranch.trim().length > 0 &&
    baseBranch.trim().length > 0

  async function handleGenerateDraft(): Promise<void> {
    if (!project || !readyToGenerate) return

    setGeneratingDraft(true)
    setError(null)

    try {
      const draft = await window.agentforge.git.generatePrDraft({
        projectId: project.id,
        headBranch: headBranch.trim(),
        baseBranch: baseBranch.trim(),
      })

      setTitle(draft.title.trim())
      setBody(draft.body.trim() ? draft.body : template)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to generate PR draft.')
    } finally {
      setGeneratingDraft(false)
    }
  }

  async function handleApprove(): Promise<void> {
    if (!project || !remoteInfo || !readyToSubmit) return

    setCreatingPr(true)
    setError(null)

    try {
      const result = await window.agentforge.git.createPrFromDraft({
        projectId: project.id,
        title: title.trim(),
        body: body.trim(),
        headBranch: headBranch.trim(),
        baseBranch: baseBranch.trim(),
      })
      setCreatedPr(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create PR.')
    } finally {
      setCreatingPr(false)
    }
  }

  const isUnsupported = remoteInfo?.provider === 'unsupported'

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) onOpenChange(nextOpen)
      }}
      title="Open Pull Request"
      description="Generate a draft with a lightweight model, review it, then approve PR creation."
      maxWidth={700}
      closeOnBackdrop={!loading}
      closeOnEsc={!loading}
    >
      <div className="flex max-h-[78vh] flex-col overflow-hidden">
        {/* ── Loading info ────────────────────────────────── */}
        {loadingInfo ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" />
              Loading repository info…
            </div>
          </div>

        /* ── Generating draft ────────────────────────────── */
        ) : generatingDraft ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-4">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-card-raised">
                <SparkleIcon className="text-accent-primary" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-primary">Generating PR draft…</p>
              {remoteInfo ? (
                <p className="mt-0.5 text-xs text-muted">
                  Claude Haiku · {remoteInfo.owner}/{remoteInfo.repo}
                </p>
              ) : null}
            </div>
          </div>

        /* ── Error before remote loaded ──────────────────── */
        ) : error && !remoteInfo ? (
          <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-4 py-4 text-sm text-accent-del">
            {error}
          </div>

        /* ── Unsupported remote ───────────────────────────── */
        ) : isUnsupported ? (
          <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-4 py-4 text-sm text-accent-del">
            Unsupported remote. Only GitHub (github.com) and Azure DevOps (dev.azure.com, visualstudio.com) are supported.
          </div>

        /* ── Success ─────────────────────────────────────── */
        ) : createdPr && remoteInfo ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-accent-add/30 bg-accent-add/10">
              <CheckIcon />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-primary">PR #{createdPr.number} opened</p>
              <p className="mt-0.5 text-xs text-muted">
                {remoteInfo.owner}/{remoteInfo.repo}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.open(createdPr.url, '_blank', 'noopener,noreferrer')}
              className="flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-xs text-accent-primary transition-colors hover:border-accent-primary/40 hover:bg-accent-primary/5"
            >
              View pull request
              <ExternalLinkIcon />
            </button>
          </div>

        /* ── Review form ─────────────────────────────────── */
        ) : remoteInfo ? (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            {/* Header: provider + repo + branch flow */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                <span className="rounded-pill border border-hairline px-2 py-0.5 text-primary">
                  {remoteInfo.provider.toUpperCase()}
                </span>
                <span>{remoteInfo.owner}/{remoteInfo.repo}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <BranchIcon />
                <span className="font-mono text-secondary">{headBranch}</span>
                <span>→</span>
                <span className="font-mono text-secondary">{baseBranch}</span>
              </div>
            </div>

            {/* AI draft badge */}
            {title ? (
              <div className="flex items-center gap-2 rounded-card border border-accent-primary/20 bg-accent-primary/5 px-3 py-2">
                <SparkleIcon className="shrink-0 text-accent-primary" />
                <span className="text-xs text-accent-primary">
                  AI-generated draft — review and edit before creating
                </span>
              </div>
            ) : null}

            {/* Branch inputs (compact grid) */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted">Source branch</label>
                <input
                  value={headBranch}
                  onChange={(e) => setHeadBranch(e.target.value)}
                  disabled={loading}
                  className="h-9 w-full rounded-card border border-hairline bg-card px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-white/20 disabled:opacity-40"
                  placeholder="feature/my-branch"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted">Target branch</label>
                <input
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  disabled={loading}
                  className="h-9 w-full rounded-card border border-hairline bg-card px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-white/20 disabled:opacity-40"
                  placeholder="main"
                />
              </div>
            </div>

            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={loading}
                className="h-9 w-full rounded-card border border-hairline bg-card px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-white/20 disabled:opacity-40"
                placeholder="Pull request title"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted">Description</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={loading}
                rows={12}
                className="w-full resize-none rounded-card border border-hairline bg-card p-3 font-mono text-xs text-primary outline-none placeholder:text-muted focus:border-white/20 disabled:opacity-40"
                placeholder={template}
              />
            </div>

            {error ? (
              <div className="whitespace-pre-wrap rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {createdPr ? 'Close' : 'Cancel'}
          </Button>
          {remoteInfo && !isUnsupported && !createdPr && !generatingDraft ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleGenerateDraft()}
                disabled={!readyToGenerate || loading}
                loading={generatingDraft}
              >
                Regenerate
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void handleApprove()}
                disabled={!readyToSubmit || loading}
                loading={creatingPr}
              >
                {creatingPr ? 'Creating…' : 'Create Pull Request'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M5 3l.9 2.1L8 6l-2.1.9L5 9l-.9-2.1L2 6l2.1-.9z" />
      <path d="M19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 01-9 9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-add">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function detectDefaultBranch(provider: string): string {
  if (provider === 'azure') return 'develop'
  return 'main'
}
