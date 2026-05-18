import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { specRunsStore } from './runs'
import { specsStore } from './specs'

describe('specsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('creates, lists, and hydrates specs with requirements and criteria', () => {
    const project = createProject()
    const spec = specsStore.create({
      projectId: project.id,
      title: 'Improve approvals',
      goal: 'Make approval requests inline',
      context: 'Current flow blocks with modal dialogs.',
      constraints: 'Keep renderer behind preload.',
      doneWhen: 'Approval cards drive approve and deny actions.',
      targetFiles: ['src/renderer/App.tsx'],
      selectedAgents: ['codex', 'claude-code'],
      runMode: 'worktree',
      requirements: ['Timeline shows approval cards', 'Terminal remains available'],
      acceptanceCriteria: ['No window.confirm approval flow'],
    })

    expect(spec).toMatchObject({
      projectId: project.id,
      title: 'Improve approvals',
      status: 'draft',
      targetFiles: ['src/renderer/App.tsx'],
      selectedAgents: ['codex', 'claude-code'],
    })
    expect(spec.requirements.map((item) => item.body)).toEqual([
      'Timeline shows approval cards',
      'Terminal remains available',
    ])
    expect(spec.acceptanceCriteria.map((item) => item.body)).toEqual([
      'No window.confirm approval flow',
    ])
    expect(specsStore.list(project.id).map((item) => item.id)).toEqual([spec.id])
  })

  it('updates spec fields transactionally', () => {
    const project = createProject()
    const spec = specsStore.create({
      projectId: project.id,
      title: 'Draft',
      goal: 'Initial goal',
      requirements: ['old requirement'],
      acceptanceCriteria: ['old criterion'],
    })

    const updated = specsStore.update(spec.id, {
      title: 'Approved contract',
      goal: 'Better goal',
      requirements: ['new requirement'],
      acceptanceCriteria: ['new criterion', 'second criterion'],
      targetFiles: ['src/main/session/SessionManager.ts'],
    })

    expect(updated.title).toBe('Approved contract')
    expect(updated.goal).toBe('Better goal')
    expect(updated.targetFiles).toEqual(['src/main/session/SessionManager.ts'])
    expect(updated.requirements.map((item) => item.body)).toEqual(['new requirement'])
    expect(updated.acceptanceCriteria.map((item) => item.body)).toEqual([
      'new criterion',
      'second criterion',
    ])
  })

  it('gates runs behind spec approval and tracks verification', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const project = createProject()
    const spec = specsStore.create({
      projectId: project.id,
      title: 'Run approved work',
      goal: 'Only approved specs run',
      selectedAgents: ['codex'],
    })

    expect(() => specRunsStore.start(spec.id)).toThrow('Approve the spec before starting a run')

    vi.setSystemTime(2_000)
    const approved = specsStore.approve(spec.id)
    expect(approved.status).toBe('approved')
    expect(approved.approvedAt).toBe(2_000)

    const { run, attempts } = specRunsStore.start(spec.id)
    expect(run.status).toBe('running')
    expect(attempts).toHaveLength(1)
    expect(specsStore.get(spec.id)?.status).toBe('running')
    expect(() => specRunsStore.createVerification(run.id, 'rtk npm test')).toThrow(
      'Cannot verify before the agent run has completed',
    )

    specRunsStore.updateAttempt(attempts[0].id, { status: 'done' })
    const reviewing = specRunsStore.complete(run.id, 'done')
    expect(reviewing.status).toBe('done')
    expect(specsStore.get(spec.id)?.status).toBe('reviewing')

    const cancelledAfterCompletion = specRunsStore.cancel(run.id)
    expect(cancelledAfterCompletion.status).toBe('done')
    expect(specsStore.get(spec.id)?.status).toBe('reviewing')

    const verification = specRunsStore.createVerification(run.id, 'rtk npm run build')
    const finished = specRunsStore.finishVerification(verification.id, 'passed', 'ok')
    expect(finished.status).toBe('passed')
    expect(specRunsStore.compare(spec.id).verificationResults).toHaveLength(1)
    expect(specRunsStore.get(run.id)?.status).toBe('done')
    expect(specsStore.get(spec.id)?.status).toBe('verified')
  })
})

function createProject() {
  return projectsStore.create({
    name: 'Lobrecs Agent',
    repoPath: '/repo/lobrecs-agent',
    agentId: 'codex',
    modelTier: 'balanced',
  })
}
