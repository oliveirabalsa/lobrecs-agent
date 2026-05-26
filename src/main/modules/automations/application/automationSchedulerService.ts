import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import {
  automationsStore,
  projectsStore,
  sessionsStore,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '../../../store'
import type {
  Automation,
  AutomationRun,
  AutomationRunResult,
  AutomationRunStatus,
  AutomationRunTrigger,
} from '../../../../shared/types'
import type { NotifierEvent } from '../../../session/SessionManager'
import { calculateNextRunAt, previewAutomationSchedule } from '../domain/schedule'

const DEFAULT_TICK_MS = 60_000

export class AutomationSchedulerService {
  private context: MainIpcContext | null = null
  private timer: NodeJS.Timeout | null = null
  private runningTick: Promise<void> | null = null

  configure(context: MainIpcContext): void {
    this.context = context
  }

  start(intervalMs = DEFAULT_TICK_MS): void {
    if (this.timer) return

    void this.reconcileRunningRuns()
    void this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  list(projectId: string): Automation[] {
    return automationsStore.list(projectId).map((automation) => this.refreshAutomationState(automation))
  }

  listRuns(projectId: string): AutomationRun[] {
    return automationsStore.listRuns(projectId)
  }

  createAutomation(data: CreateAutomationInput): Automation {
    const nextRunAt = data.enabled ? calculateNextRunAt(data.schedule) : null
    return automationsStore.create({
      ...data,
      nextRunAt,
      status: data.enabled ? 'scheduled' : 'paused',
      reviewState: 'reviewed',
      unreadRunCount: 0,
    })
  }

  updateAutomation(id: string, data: UpdateAutomationInput): Automation {
    const current = requireAutomation(id)
    const nextEnabled = data.enabled ?? current.enabled
    const nextSchedule = data.schedule ?? current.schedule
    const nextRunAt =
      data.nextRunAt !== undefined
        ? data.nextRunAt
        : nextEnabled
          ? calculateNextRunAt(nextSchedule)
          : null

    return automationsStore.update(id, {
      ...data,
      nextRunAt,
      status: nextEnabled ? 'scheduled' : 'paused',
    })
  }

  deleteAutomation(id: string): void {
    automationsStore.delete(id)
  }

  async runNow(id: string): Promise<AutomationRunResult> {
    return this.dispatchAutomation(requireAutomation(id), 'manual')
  }

  async retryRun(runId: string): Promise<AutomationRunResult> {
    const run = automationsStore.getRun(runId)
    if (!run) throw new Error('Automation run not found')

    const automation = requireAutomation(run.automationId)
    return this.dispatchAutomation(automation, 'retry', run.attempt + 1)
  }

  acknowledgeRun(runId: string): AutomationRun {
    const run = automationsStore.markRunAcknowledged(runId)
    automationsStore.reconcileTriageState(run.automationId)
    return run
  }

  reviewRun(runId: string): AutomationRun {
    const run = automationsStore.markRunReviewed(runId)
    automationsStore.reconcileTriageState(run.automationId)
    return run
  }

  handleNotifierEvent(event: NotifierEvent): void {
    if (event.type === 'diff.ready') return

    const run = automationsStore.getRunBySessionId(event.sessionId)
    if (!run) return

    const status: AutomationRunStatus = event.type === 'session.done' ? 'succeeded' : 'failed'
    automationsStore.updateRun(run.id, {
      status,
      completedAt: Date.now(),
      error: event.type === 'session.error' ? event.message : undefined,
      reviewState: 'unread',
      unread: true,
    })

    const automation = automationsStore.get(run.automationId)
    if (automation) {
      const nextRunAt = automation.enabled
        ? calculateNextRunAt(automation.schedule, Date.now())
        : null
      automationsStore.update(automation.id, {
        status: automation.enabled ? 'scheduled' : 'paused',
        nextRunAt,
      })
      automationsStore.reconcileTriageState(automation.id)
    }
  }

  private async tick(): Promise<void> {
    if (this.runningTick) return this.runningTick

    this.runningTick = this.runDueAutomations().finally(() => {
      this.runningTick = null
    })
    return this.runningTick
  }

  private async runDueAutomations(): Promise<void> {
    if (!this.context) return

    for (const automation of automationsStore.listEnabled()) {
      const refreshed = this.refreshAutomationState(automation)
      if (refreshed.status !== 'due' && refreshed.status !== 'overdue') continue
      if (automationsStore.getRunningRun(refreshed.id)) continue

      await this.dispatchAutomation(refreshed, 'schedule').catch((error) => {
        console.error('[automations] scheduled run failed:', error)
      })
    }
  }

  private async dispatchAutomation(
    automation: Automation,
    trigger: AutomationRunTrigger,
    attempt = 1,
  ): Promise<AutomationRunResult> {
    const context = this.requireContext()
    const existing = automationsStore.getRunningRun(automation.id)
    if (existing?.sessionId) {
      return { sessionId: existing.sessionId, runId: existing.id }
    }
    if (existing) {
      throw new Error('Automation is already starting.')
    }

    const project = requireProject(automation.projectId)
    const startedAt = Date.now()
    const run = automationsStore.createRun({
      automationId: automation.id,
      projectId: automation.projectId,
      trigger,
      status: 'queued',
      reviewState: 'acknowledged',
      unread: false,
      attempt,
      createdAt: startedAt,
    })

    automationsStore.update(automation.id, {
      status: 'running',
      lastRunAt: startedAt,
      nextRunAt: automation.enabled ? calculateNextRunAt(automation.schedule, startedAt) : null,
    })

    try {
      const decision = await context.modelRouter.route({
        prompt: automation.prompt,
        preferredAgentId: automation.agentId,
      })
      const { sessionId } = await context.sessionManager.dispatch({
        projectId: project.id,
        prompt: `[Automation: ${automation.name}]\n${automation.prompt}`,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: project.repoPath,
        context: projectsStore.getContext(project.id),
        spawnedAgent: { kind: 'automation', role: automation.name },
      })

      automationsStore.updateRun(run.id, {
        sessionId,
        status: 'running',
        startedAt,
      })

      return { sessionId, runId: run.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation dispatch failed.'
      automationsStore.updateRun(run.id, {
        status: 'failed',
        completedAt: Date.now(),
        error: message,
        reviewState: 'unread',
        unread: true,
      })
      automationsStore.update(automation.id, {
        status: automation.enabled ? 'scheduled' : 'paused',
        nextRunAt: automation.enabled ? calculateNextRunAt(automation.schedule) : null,
      })
      automationsStore.reconcileTriageState(automation.id)
      throw error
    }
  }

  private refreshAutomationState(automation: Automation): Automation {
    if (automation.status === 'running' && automationsStore.getRunningRun(automation.id)) {
      return automation
    }

    const preview = previewAutomationSchedule(automation)
    if (preview.status === automation.status && preview.nextRunAt === automation.nextRunAt) {
      return automation
    }

    return automationsStore.update(automation.id, {
      status: preview.status,
      nextRunAt: preview.nextRunAt ?? null,
    })
  }

  private async reconcileRunningRuns(): Promise<void> {
    for (const run of automationsStore.listActiveRuns()) {
      if (!run.sessionId) continue

      const session = sessionsStore.get(run.sessionId)
      if (!session || session.status === 'running' || session.status === 'awaiting-approval' || session.status === 'awaiting-input') {
        continue
      }

      const status: AutomationRunStatus =
        session.status === 'done' ? 'succeeded' : session.status === 'cancelled' ? 'cancelled' : 'failed'
      automationsStore.updateRun(run.id, {
        status,
        completedAt: session.completedAt ?? Date.now(),
        reviewState: 'unread',
        unread: true,
      })
      automationsStore.reconcileTriageState(run.automationId)
    }
  }

  private requireContext(): MainIpcContext {
    if (!this.context) {
      throw new Error('Automation scheduler is not configured.')
    }
    return this.context
  }
}

function requireAutomation(id: string): Automation {
  const automation = automationsStore.get(id)
  if (!automation) throw new Error('Automation not found')
  return automation
}

export const automationSchedulerService = new AutomationSchedulerService()
