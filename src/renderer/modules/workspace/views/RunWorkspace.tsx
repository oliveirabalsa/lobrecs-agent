import { useEffect, useMemo, useState } from 'react'
import type {
  AgentActivity,
  ApprovalRequest,
  DiffProposal,
  Project,
  SessionStatus,
} from '../../../../shared/types'
import { DiffViewer } from '../../../components/DiffViewer'
import {
  TaskInput,
  TerminalPanel,
  type StartedSessionSummary,
} from '../../sessions'
import { useSessionEvents } from '../hooks/useSessionEvents'

type InspectorTab = 'diff' | 'terminal' | 'approvals' | 'session'

interface RunWorkspaceProps {
  project: Project
  sessionId: string | null
  prompt: string
  status: SessionStatus | null
  model?: string
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  prefillPrompt?: string
  busy: boolean
  busyReason?: string
  onDiffProposals: (proposals: DiffProposal[]) => void
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void
  onRejectApproval: () => void
  onApproveDiff: (filePath: string) => void
  onRejectDiff: (filePath: string) => void
  onEditAndApproveDiff: (filePath: string, newContent: string) => void
  onSessionStarted: (session: StartedSessionSummary) => void
}

export function RunWorkspace({
  project,
  sessionId,
  prompt,
  status,
  model,
  diffProposals,
  approvalRequest,
  prefillPrompt,
  busy,
  busyReason,
  onDiffProposals,
  onApprovalRequest,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
  onApproveDiff,
  onRejectDiff,
  onEditAndApproveDiff,
  onSessionStarted,
}: RunWorkspaceProps) {
  const { activities, loading } = useSessionEvents(sessionId, {
    onApprovalRequest,
    onDiffProposals,
    onStatusChange,
  })
  const [activeTab, setActiveTab] = useState<InspectorTab>('session')

  useEffect(() => {
    if (approvalRequest) {
      setActiveTab('approvals')
      return
    }
    if (diffProposals.length > 0) {
      setActiveTab('diff')
    }
  }, [approvalRequest, diffProposals.length])

  const visibleActivities = useMemo(
    () => compactStreamingMessages(activities).slice(-120),
    [activities],
  )
  const pendingApprovals = approvalRequest ? 1 : 0
  const changedFiles = diffProposals.length
  const effectiveStatus = status ?? (sessionId ? 'running' : null)

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-zinc-950 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-h-0 flex-col border-r border-zinc-800/80">
        <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-medium uppercase text-zinc-400">
              Run workspace
            </span>
            <span className={`rounded border px-2 py-1 text-[11px] font-medium ${statusClass(effectiveStatus)}`}>
              {statusLabel(effectiveStatus)}
            </span>
            {pendingApprovals > 0 ? (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
                {pendingApprovals} approval
              </span>
            ) : null}
            {changedFiles > 0 ? (
              <span className="rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-200">
                {changedFiles} file{changedFiles === 1 ? '' : 's'} changed
              </span>
            ) : null}
          </div>
          <div className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-300">
            {prompt || 'Ask an agent to start a coding session.'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {sessionId ? (
            <ActivityTimeline
              activities={visibleActivities}
              loading={loading}
              running={effectiveStatus === 'running' || effectiveStatus === 'awaiting-approval'}
            />
          ) : (
            <EmptyRunState project={project} />
          )}
        </div>

        <TaskInput
          projectId={project.id}
          busy={busy}
          busyReason={busyReason}
          prefillPrompt={prefillPrompt}
          onSessionStarted={onSessionStarted}
        />
      </div>

      <aside className="flex min-h-[360px] min-w-0 flex-col border-t border-zinc-800 bg-zinc-950 xl:min-h-0 xl:border-t-0">
        <InspectorTabs
          activeTab={activeTab}
          changedFiles={changedFiles}
          pendingApprovals={pendingApprovals}
          onChange={setActiveTab}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'diff' ? (
            diffProposals.length > 0 ? (
              <DiffViewer
                proposals={diffProposals}
                onApprove={onApproveDiff}
                onReject={onRejectDiff}
                onEditAndApprove={onEditAndApproveDiff}
              />
            ) : (
              <InspectorEmpty title="No diff pending" detail="Code changes will appear here before they can be applied." />
            )
          ) : activeTab === 'terminal' ? (
            <TerminalPanel
              sessionId={sessionId}
              diffProposals={[]}
              approvalRequest={null}
              onDiffProposals={onDiffProposals}
              onApprovalRequest={onApprovalRequest}
              onStatusChange={onStatusChange}
              onApproveApproval={onApproveApproval}
              onRejectApproval={onRejectApproval}
              onApproveDiff={onApproveDiff}
              onRejectDiff={onRejectDiff}
              onEditAndApproveDiff={onEditAndApproveDiff}
            />
          ) : activeTab === 'approvals' ? (
            <ApprovalQueue
              request={approvalRequest}
              sessionId={sessionId}
              onApprove={onApproveApproval}
              onReject={onRejectApproval}
              onOpenTerminal={() => setActiveTab('terminal')}
            />
          ) : (
            <SessionInspector
              sessionId={sessionId}
              project={project}
              model={model}
              status={effectiveStatus}
              activityCount={visibleActivities.length}
              changedFiles={changedFiles}
              pendingApprovals={pendingApprovals}
            />
          )}
        </div>
      </aside>
    </section>
  )
}

function ActivityTimeline({
  activities,
  loading,
  running,
}: {
  activities: AgentActivity[]
  loading: boolean
  running: boolean
}) {
  if (loading && activities.length === 0) {
    return <TimelineSkeleton />
  }

  if (activities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Waiting for agent output...
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      {activities.map((activity, index) => (
        <ActivityItem key={`${activity.kind}-${index}`} activity={activity} />
      ))}
      {running ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          Agent is working
        </div>
      ) : null}
    </div>
  )
}

function ActivityItem({ activity }: { activity: AgentActivity }) {
  if (activity.kind === 'message') {
    return (
      <article className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="mb-2 text-[11px] font-medium uppercase text-zinc-500">
          {activity.role}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">{activity.text}</p>
      </article>
    )
  }

  if (activity.kind === 'approval') {
    return (
      <article className="rounded-md border border-amber-800/70 bg-amber-950/30 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-amber-100">{activity.request.description}</div>
          <span className="rounded border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-200">
            {activity.status}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 font-mono text-xs text-amber-200/80">
          {activity.request.details}
        </p>
      </article>
    )
  }

  if (activity.kind === 'completion') {
    return (
      <article className={`rounded-md border px-4 py-3 ${activity.status === 'error' ? 'border-red-900/70 bg-red-950/30' : 'border-emerald-900/70 bg-emerald-950/25'}`}>
        <div className="text-sm font-semibold text-zinc-100">{activity.summary}</div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
          {activity.tokensIn !== undefined ? <span>{activity.tokensIn} input tokens</span> : null}
          {activity.tokensOut !== undefined ? <span>{activity.tokensOut} output tokens</span> : null}
          {activity.costUsd !== undefined ? <span>${activity.costUsd.toFixed(4)}</span> : null}
        </div>
      </article>
    )
  }

  if (activity.kind === 'file-change') {
    return (
      <article className="rounded-md border border-blue-900/60 bg-blue-950/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm text-blue-100">{activity.filePath}</div>
            <div className="mt-1 text-xs text-blue-200/70">{activity.changeType}</div>
          </div>
          <div className="shrink-0 text-xs text-zinc-400">
            +{activity.additions ?? 0} -{activity.deletions ?? 0}
          </div>
        </div>
      </article>
    )
  }

  if (activity.kind === 'diff-summary') {
    return (
      <article className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="text-sm font-semibold text-zinc-100">{activity.summary}</div>
        <div className="mt-1 text-xs text-zinc-500">
          +{activity.additions} -{activity.deletions} across {activity.filesChanged} file{activity.filesChanged === 1 ? '' : 's'}
        </div>
      </article>
    )
  }

  if (activity.kind === 'command') {
    return (
      <article className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="text-xs font-medium uppercase text-zinc-500">Command</div>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
          {activity.command}
        </pre>
        {activity.cwd ? <div className="mt-2 truncate text-xs text-zinc-500">{activity.cwd}</div> : null}
      </article>
    )
  }

  if (activity.kind === 'tool-call' || activity.kind === 'tool-result') {
    return (
      <article className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-100">{activity.name}</div>
          <span className="text-xs text-zinc-500">{activity.status}</span>
        </div>
        {'output' in activity && activity.output ? (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
            {activity.output}
          </pre>
        ) : null}
      </article>
    )
  }

  return (
    <article className={`rounded-md border px-4 py-3 ${stepClass(activity.status)}`}>
      <div className="text-sm font-semibold text-zinc-100">{activity.title}</div>
      {activity.detail ? <p className="mt-2 text-sm leading-6 text-zinc-400">{activity.detail}</p> : null}
    </article>
  )
}

function InspectorTabs({
  activeTab,
  changedFiles,
  pendingApprovals,
  onChange,
}: {
  activeTab: InspectorTab
  changedFiles: number
  pendingApprovals: number
  onChange: (tab: InspectorTab) => void
}) {
  const tabs: Array<{ id: InspectorTab; label: string; count?: number }> = [
    { id: 'diff', label: 'Diff', count: changedFiles },
    { id: 'approvals', label: 'Approvals', count: pendingApprovals },
    { id: 'terminal', label: 'Terminal' },
    { id: 'session', label: 'Session' },
  ]

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded px-2 py-1.5 text-xs font-medium ${
            activeTab === tab.id
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
          }`}
        >
          {tab.label}
          {tab.count ? <span className="ml-1 text-[10px] text-blue-300">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

function ApprovalQueue({
  request,
  sessionId,
  onApprove,
  onReject,
  onOpenTerminal,
}: {
  request: ApprovalRequest | null
  sessionId: string | null
  onApprove: () => void
  onReject: () => void
  onOpenTerminal: () => void
}) {
  if (!request || !sessionId) {
    return <InspectorEmpty title="No approvals pending" detail="Command and file-write requests will queue here." />
  }

  return (
    <div className="h-full overflow-auto p-3">
      <article className="rounded-md border border-amber-800/70 bg-amber-950/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-200">
            {request.action}
          </span>
          <span className={`rounded px-2 py-0.5 text-[11px] ${riskClass(request.risk)}`}>
            {request.risk ?? 'medium'} risk
          </span>
        </div>
        <h3 className="mt-3 text-sm font-semibold text-amber-100">{request.description}</h3>
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-zinc-950/80 px-3 py-2 text-xs text-amber-100/90">
          {request.command ?? request.details}
        </pre>
        {request.cwd || request.filePath ? (
          <div className="mt-3 space-y-1 text-xs text-amber-200/70">
            {request.cwd ? <div className="truncate">cwd: {request.cwd}</div> : null}
            {request.filePath ? <div className="truncate">file: {request.filePath}</div> : null}
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onReject}
            className="rounded-md border border-red-800 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-950/70"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={onOpenTerminal}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Terminal
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="rounded-md border border-emerald-700 bg-emerald-950/60 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-900/70"
          >
            Approve
          </button>
        </div>
      </article>
    </div>
  )
}

function SessionInspector({
  sessionId,
  project,
  model,
  status,
  activityCount,
  changedFiles,
  pendingApprovals,
}: {
  sessionId: string | null
  project: Project
  model?: string
  status: SessionStatus | null
  activityCount: number
  changedFiles: number
  pendingApprovals: number
}) {
  const rows = [
    ['Project', project.name],
    ['Repository', project.repoPath],
    ['Session', sessionId ?? 'No active session'],
    ['Status', statusLabel(status)],
    ['Model', model ?? project.modelTier],
    ['Timeline items', String(activityCount)],
    ['Changed files', String(changedFiles)],
    ['Pending approvals', String(pendingApprovals)],
  ]

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="border-b border-zinc-800 pb-3 last:border-b-0">
            <div className="text-[11px] font-medium uppercase text-zinc-500">{label}</div>
            <div className="mt-1 break-words text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyRunState({ project }: { project: Project }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center py-10">
      <div className="text-sm font-semibold text-zinc-100">Ready for {project.name}</div>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Ask for a code change, review, or investigation. The run timeline will show model output,
        commands, approvals, and code changes as structured events.
      </p>
      <div className="mt-5 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">Structured timeline</div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">Inline approvals</div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">Diff review</div>
      </div>
    </div>
  )
}

function InspectorEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center">
      <div>
        <div className="text-sm font-semibold text-zinc-200">{title}</div>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{detail}</p>
      </div>
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-md border border-zinc-800 bg-zinc-900/70" />
      ))}
    </div>
  )
}

function compactStreamingMessages(activities: AgentActivity[]): AgentActivity[] {
  const compacted: AgentActivity[] = []

  for (const activity of activities) {
    const previous = compacted.at(-1)
    if (
      activity.kind === 'message' &&
      previous?.kind === 'message' &&
      activity.role === previous.role &&
      activity.stream &&
      previous.stream
    ) {
      compacted[compacted.length - 1] = {
        ...previous,
        text: `${previous.text}${activity.text}`,
      }
    } else {
      compacted.push(activity)
    }
  }

  return compacted
}

function statusLabel(status: SessionStatus | null): string {
  if (!status) return 'idle'
  if (status === 'awaiting-approval') return 'awaiting review'
  return status
}

function statusClass(status: SessionStatus | null): string {
  switch (status) {
    case 'running':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-200'
    case 'awaiting-approval':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    case 'done':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    case 'error':
      return 'border-red-500/40 bg-red-500/10 text-red-200'
    case 'cancelled':
      return 'border-zinc-600 bg-zinc-800 text-zinc-300'
    default:
      return 'border-zinc-700 bg-zinc-900 text-zinc-400'
  }
}

function stepClass(status: 'pending' | 'running' | 'done' | 'error'): string {
  switch (status) {
    case 'error':
      return 'border-red-900/70 bg-red-950/30'
    case 'done':
      return 'border-emerald-900/70 bg-emerald-950/25'
    case 'pending':
      return 'border-amber-900/70 bg-amber-950/25'
    case 'running':
      return 'border-blue-900/70 bg-blue-950/25'
  }
}

function riskClass(risk: ApprovalRequest['risk']): string {
  switch (risk) {
    case 'high':
      return 'bg-red-500/15 text-red-200'
    case 'low':
      return 'bg-emerald-500/15 text-emerald-200'
    case 'medium':
    default:
      return 'bg-amber-500/15 text-amber-200'
  }
}
