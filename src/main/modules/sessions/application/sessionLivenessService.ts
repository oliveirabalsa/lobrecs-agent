import { createHash } from 'node:crypto'
import type { AgentActivity, AgentEvent, DiffProposal } from '../../../../shared/types'
import { sessionsStore } from '../../../store'
import { noteTouchedFilesFromActivity } from '../../../session/fileTouchTracking'
import { buildLocalDiffProposals } from '../../../session/localDiff'
import {
  LIVE_DIFF_DEBOUNCE_MS,
  type ActiveSession,
} from './sessionWorkflowTypes'

export type SessionLivenessServiceOptions = {
  activeSessions: Map<string, ActiveSession>
  idleHeartbeatMs: number | false
  maxStallMs: number | false
  recordEvent(event: AgentEvent): void
  cancel(sessionId: string): void
  handleAgentEvent(event: AgentEvent): void
  filterLocalDiffProposals(
    active: ActiveSession,
    proposals: readonly DiffProposal[],
  ): DiffProposal[]
}

export class SessionLivenessService {
  constructor(private readonly options: SessionLivenessServiceOptions) {}

  noteAgentEvent(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active) return

    active.lastAgentEventAt = Date.now()
    this.scheduleIdleHeartbeat(sessionId)
  }

  markSharedLocalRepoSessions(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active || active.worktreePath || !active.localBaseline) return

    for (const [otherSessionId, other] of this.options.activeSessions) {
      if (otherSessionId === sessionId) continue
      if (other.worktreePath || !other.localBaseline) continue
      if (other.repoPath !== active.repoPath) continue

      active.sharedLocalRepo = true
      other.sharedLocalRepo = true
    }
  }

  noteTouchedFiles(sessionId: string, activity: AgentActivity): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.worktreePath) return

    noteTouchedFilesFromActivity(active.localTouchedFiles, active.repoPath, activity)
  }

  scheduleIdleHeartbeat(sessionId: string): void {
    if (this.options.idleHeartbeatMs === false) return

    const active = this.options.activeSessions.get(sessionId)
    if (!active) return

    if (active.idleHeartbeatTimer) {
      clearTimeout(active.idleHeartbeatTimer)
    }

    active.idleHeartbeatTimer = setTimeout(() => {
      this.emitIdleHeartbeat(sessionId)
    }, this.options.idleHeartbeatMs)
    active.idleHeartbeatTimer.unref?.()
  }

  emitIdleHeartbeat(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active || this.options.idleHeartbeatMs === false) return

    const session = sessionsStore.get(sessionId)
    if (!session || session.status !== 'running') return

    const now = Date.now()
    if (now - active.lastIdleHeartbeatAt < this.options.idleHeartbeatMs) {
      this.scheduleIdleHeartbeat(sessionId)
      return
    }

    const stallDuration = now - active.lastAgentEventAt
    if (this.options.maxStallMs !== false && stallDuration >= this.options.maxStallMs) {
      const stallSeconds = Math.round(stallDuration / 1000)
      this.options.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Agent process stalled',
          detail: `No output for ${stallSeconds}s — force-completing the session.`,
          status: 'error',
        },
        timestamp: now,
      })
      this.options.cancel(sessionId)
      return
    }

    active.lastIdleHeartbeatAt = now
    const idleSeconds = Math.max(1, Math.round(stallDuration / 1000))
    this.options.recordEvent({
      type: 'activity',
      sessionId,
      payload: {
        kind: 'step',
        title: 'Waiting for agent output',
        detail: `The agent process is still running; no new stream events for ${idleSeconds}s.`,
        status: 'running',
      },
      timestamp: now,
    })
    this.scheduleIdleHeartbeat(sessionId)
  }

  stopIdleHeartbeat(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active?.idleHeartbeatTimer) return

    clearTimeout(active.idleHeartbeatTimer)
    active.idleHeartbeatTimer = undefined
  }

  scheduleLiveLocalDiff(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.planMode) return

    if (active.liveDiffTimer) {
      clearTimeout(active.liveDiffTimer)
    }

    active.liveDiffTimer = setTimeout(() => {
      active.liveDiffTimer = undefined
      void this.emitLiveLocalDiff(sessionId)
    }, LIVE_DIFF_DEBOUNCE_MS)
    active.liveDiffTimer.unref?.()
  }

  stopLiveDiff(sessionId: string): void {
    const active = this.options.activeSessions.get(sessionId)
    if (!active?.liveDiffTimer) return

    clearTimeout(active.liveDiffTimer)
    active.liveDiffTimer = undefined
  }

  async emitLiveLocalDiff(sessionId: string): Promise<void> {
    const active = this.options.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.planMode) return

    try {
      const proposals = this.options.filterLocalDiffProposals(
        active,
        await buildLocalDiffProposals(active.repoPath, active.localBaseline),
      )
      if (proposals.length === 0) return

      const signature = diffProposalSignature(proposals)
      if (signature === active.liveDiffSignature) return

      active.liveDiffSignature = signature
      this.options.handleAgentEvent({
        type: 'diff',
        sessionId,
        payload: { proposals, live: true },
        timestamp: Date.now(),
      })
    } catch {
      // Live counters are best-effort; completion still performs the authoritative diff.
    }
  }
}

export function shouldTriggerLiveLocalDiff(event: AgentEvent): boolean {
  if (event.type !== 'activity') return false

  const payload = event.payload
  if (!payload || typeof payload !== 'object') return false

  const kind = (payload as { kind?: unknown }).kind
  return kind === 'file-change' || kind === 'tool-call' || kind === 'command'
}

function diffProposalSignature(proposals: readonly DiffProposal[]): string {
  const hash = createHash('sha256')
  for (const proposal of [...proposals].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    hash.update(proposal.filePath)
    hash.update('\0')
    hash.update(proposal.changeType ?? '')
    hash.update('\0')
    hash.update(String(proposal.additions ?? 0))
    hash.update('\0')
    hash.update(String(proposal.deletions ?? 0))
    hash.update('\0')
    hash.update(proposal.proposedContent)
    hash.update('\0')
  }
  return hash.digest('hex')
}
