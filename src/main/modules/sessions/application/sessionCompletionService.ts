import type { AgentActivity, AgentEvent, DiffProposal, Session } from '../../../../shared/types'
import { applyDiffContent } from '../../../modules/diffs/application/applyDiff'
import { worktreeManager } from '../../../git/WorktreeManager'
import { sessionsStore } from '../../../store'
import { buildLocalDiffProposals } from '../../../session/localDiff'
import { buildDiffProposals } from '../../../session/worktreeDiff'
import type { CostEstimator, NotifierEvent, QualityGateRunner } from '../../../session/SessionManager'
import type { ActiveSession } from './sessionWorkflowTypes'
import { completionStatus, errorMessage, extractUsage, textFromUnknownPayload } from './sessionWorkflowUtils'

export type SessionCompletionServiceOptions = {
  getCostEstimator(): CostEstimator
  getQualityGateRunner(): QualityGateRunner | undefined
  recordEvent(event: AgentEvent): void
  handleAgentEvent(event: AgentEvent): void
  emitNotifierEvent(event: NotifierEvent): void
  stopLiveDiff(sessionId: string): void
  filterLocalDiffProposals(
    active: ActiveSession,
    proposals: readonly DiffProposal[],
  ): DiffProposal[]
}

export class SessionCompletionService {
  constructor(private readonly options: SessionCompletionServiceOptions) {}

  async emitCompletionDiffs(
    sessionId: string,
    active: ActiveSession | undefined,
    finalEvent: AgentEvent,
  ): Promise<void> {
    if (!this.sessionExists(sessionId)) return

    if (!active) {
      this.recordEventIfSessionExists(finalEvent)
      return
    }

    if (!active.worktreePath && !active.localBaseline) {
      this.recordEventIfSessionExists(finalEvent)
      return
    }

    let changedFiles: DiffProposal[] = []

    try {
      active.liveDiffSignature = undefined
      const proposals = active.worktreePath
        ? await buildDiffProposals(active.worktreePath, active.repoPath)
        : active.localBaseline
          ? this.options.filterLocalDiffProposals(
              active,
              await buildLocalDiffProposals(active.repoPath, active.localBaseline),
            )
          : []
      if (proposals.length > 0) {
        const reviewedProposals = active.worktreePath && !active.persistentWorktree
          ? await this.applyDiffProposals(sessionId, proposals)
          : proposals
        changedFiles = reviewedProposals.filter((proposal) => proposal.status === 'applied')
        if (!this.sessionExists(sessionId)) return

        this.options.handleAgentEvent({
          type: 'diff',
          sessionId,
          payload: reviewedProposals,
          timestamp: Date.now(),
        })
        const sessionForDiff = sessionsStore.get(sessionId)
        if (sessionForDiff) {
          this.options.emitNotifierEvent({
            type: 'diff.ready',
            sessionId,
            projectId: sessionForDiff.projectId,
            threadId: active.threadId,
            count: reviewedProposals.length,
            spawnedAgent: sessionForDiff.spawnedAgent,
          })
        }
      } else if (active.localBaseline) {
        this.recordEventIfSessionExists({
          type: 'activity',
          sessionId,
          payload: {
            kind: 'step',
            title: 'No code changes detected',
            detail: 'Agent finished without modifying tracked files.',
            status: 'done',
          },
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      this.recordEventIfSessionExists({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Review preparation failed',
          detail: errorMessage(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    } finally {
      try {
        if (!active.persistentWorktree) {
          await this.removeWorktree(sessionId, active)
        }
      } finally {
        const status = completionStatus(finalEvent)
        if (status === 'done') {
          await this.runQualityGate(sessionId, active, changedFiles)
        }
        this.recordEventIfSessionExists(finalEvent)
      }
    }
  }

  private sessionExists(sessionId: string): boolean {
    return sessionsStore.get(sessionId) !== null
  }

  private recordEventIfSessionExists(event: AgentEvent): void {
    if (!this.sessionExists(event.sessionId)) return

    this.options.recordEvent(event)
  }

  emitTerminalNotifierEvent(
    sessionId: string,
    active: ActiveSession | undefined,
    finalEvent: AgentEvent,
  ): void {
    const status = completionStatus(finalEvent)
    if (status !== 'done' && status !== 'error') return

    const completedSession = sessionsStore.get(sessionId)
    const threadId = active?.threadId ?? completedSession?.threadId
    if (!completedSession || !threadId) return

    if (status === 'done') {
      this.options.emitNotifierEvent({
        type: 'session.done',
        sessionId,
        projectId: completedSession.projectId,
        threadId,
        spawnedAgent: completedSession.spawnedAgent,
      })
      return
    }

    this.options.emitNotifierEvent({
      type: 'session.error',
      sessionId,
      projectId: completedSession.projectId,
      threadId,
      message: textFromUnknownPayload(finalEvent.payload) || 'Session error',
      spawnedAgent: completedSession.spawnedAgent,
    })
  }

  async removeWorktree(
    sessionId: string,
    active: ActiveSession | undefined,
  ): Promise<void> {
    this.options.stopLiveDiff(sessionId)
    if (active?.persistentWorktree) return
    await worktreeManager.remove(sessionId, active?.repoPath)
  }

  applyUsage(event: AgentEvent): void {
    const usage = extractUsage(event.payload)
    if (!usage) return

    const session = sessionsStore.get(event.sessionId)
    if (!session) return

    const costUsd =
      usage.costUsd ?? this.options.getCostEstimator()(session.model, usage.tokensIn, usage.tokensOut)

    sessionsStore.updateUsage(event.sessionId, usage.tokensIn, usage.tokensOut, costUsd)
  }

  async runQualityGate(
    sessionId: string,
    active: ActiveSession,
    changedFiles: DiffProposal[],
  ): Promise<void> {
    const qualityGateRunner = this.options.getQualityGateRunner()
    if (!qualityGateRunner || changedFiles.length === 0) return

    const session = sessionsStore.get(sessionId)
    if (!session) return
    if (!shouldRunQualityGateForSession(session)) return

    try {
      await qualityGateRunner({
        sessionId,
        threadId: active.threadId,
        projectId: session.projectId,
        repoPath: active.repoPath,
        changedFiles,
        attempt: active.qualityAttempt,
        emitActivity: (payload: AgentActivity) => {
          this.options.recordEvent({
            type: 'activity',
            sessionId,
            payload,
            timestamp: Date.now(),
          })
        },
      })
    } catch (error) {
      this.options.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Automated QA failed to run',
          detail: errorMessage(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    }
  }

  async applyDiffProposals(
    sessionId: string,
    proposals: DiffProposal[],
  ): Promise<DiffProposal[]> {
    const reviewedProposals: DiffProposal[] = []
    const conflicts: string[] = []

    for (const proposal of proposals) {
      try {
        await applyDiffContent(
          proposal.filePath,
          proposal.proposedContent,
          proposal.originalContent,
        )
        reviewedProposals.push({ ...proposal, status: 'applied' })
      } catch (error) {
        conflicts.push(`${proposal.filePath}: ${errorMessage(error)}`)
        reviewedProposals.push({ ...proposal, status: 'conflict' })
      }
    }

    const appliedCount = reviewedProposals.filter(
      (proposal) => proposal.status === 'applied',
    ).length

    if (appliedCount > 0) {
      this.options.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Applied code changes',
          detail: `${appliedCount} file${appliedCount === 1 ? '' : 's'} applied automatically.`,
          status: 'done',
        },
        timestamp: Date.now(),
      })
    }

    if (conflicts.length > 0) {
      this.options.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Some code changes could not be applied',
          detail: conflicts.join('\n'),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    }

    return reviewedProposals
  }
}

function shouldRunQualityGateForSession(session: Session): boolean {
  const spawnedKind = session.spawnedAgent?.kind
  return spawnedKind !== 'swarm' && spawnedKind !== 'delegation'
}
