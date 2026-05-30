import { describe, expect, it, vi } from 'vitest'
import { createAgentForgeApi, type AgentForgeApi } from './api'
import type { AgentEvent } from '../shared/contracts/sessions'
import type { SettingsUpdateEvent } from '../shared/contracts/settings'
import type { SwarmConfig } from '../shared/contracts/swarms'
import type { ThreadDeletedEvent } from '../shared/contracts/threads'
import type { AppUpdateState } from '../shared/contracts/updates'

type IpcListener = (event: unknown, payload?: unknown) => void

function createIpcRendererMock() {
  const listeners = new Map<string, IpcListener[]>()

  const ipcRenderer = {
    invoke: vi.fn(() => Promise.resolve(undefined)),
    on: vi.fn((event: string, listener: IpcListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return ipcRenderer
    }),
    removeListener: vi.fn((event: string, listener: IpcListener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((item) => item !== listener),
      )
      return ipcRenderer
    }),
    emit: (event: string, payload?: unknown) => {
      for (const listener of listeners.get(event) ?? []) {
        listener({}, payload)
      }
    },
  }

  return ipcRenderer
}

describe('preload api shape', () => {
  it('keeps the renderer-facing API grouped by feature', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )

    expect(Object.keys(api)).toEqual([
      'projects',
      'sessions',
      'threads',
      'agent',
      'swarm',
      'multitask',
      'router',
      'reviews',
      'feedback',
      'cost',
      'context',
      'extensions',
      'automations',
      'specs',
      'runs',
      'git',
      'memory',
      'notifications',
      'settings',
      'updates',
      'on',
      'onShortcut',
      'system',
    ])
  })

  it('keeps existing invoke channel mappings', async () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const projectInput = {
      name: 'Lobrecs',
      repoPath: '/tmp/lobrecs',
      agentId: 'codex' as const,
      modelTier: 'balanced' as const,
    }
    const automationInput = {
      projectId: 'project-1',
      name: 'Nightly review',
      prompt: 'Review current branch',
      schedule: '0 9 * * *',
      agentId: 'codex' as const,
      enabled: true,
    }
    const swarmConfig: SwarmConfig = {
      projectId: 'project-1',
      prompt: 'Refactor safely',
      strategy: 'parallel',
      agents: [{ role: 'reviewer', agentId: 'codex' }],
    }
    const cases: Array<{
      call: (agentforge: AgentForgeApi) => Promise<unknown>
      expected: unknown[]
    }> = [
      { call: (agentforge) => agentforge.projects.list(), expected: ['projects:list'] },
      {
        call: (agentforge) => agentforge.projects.create(projectInput),
        expected: ['projects:create', projectInput],
      },
      {
        call: (agentforge) => agentforge.projects.update('project-1', { name: 'Next' }),
        expected: ['projects:update', 'project-1', { name: 'Next' }],
      },
      {
        call: (agentforge) => agentforge.projects.delete('project-1'),
        expected: ['projects:delete', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.list('project-1'),
        expected: ['sessions:list', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.listByThread('thread-1'),
        expected: ['sessions:list-by-thread', 'thread-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.get('session-1'),
        expected: ['sessions:get', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.fork('session-1'),
        expected: ['sessions:fork', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.listEvents('session-1'),
        expected: ['sessions:list-events', 'session-1'],
      },
      {
        call: (agentforge) =>
          agentforge.sessions.listEventsForSessions(['session-1', 'session-2']),
        expected: ['sessions:list-events-for-sessions', ['session-1', 'session-2']],
      },
      {
        call: (agentforge) =>
          agentforge.sessions.listThreadTranscript('thread-1', { limit: 4 }),
        expected: ['sessions:list-thread-transcript', 'thread-1', { limit: 4 }],
      },
      {
        call: (agentforge) => agentforge.threads.list('project-1'),
        expected: ['threads:list', 'project-1', undefined],
      },
      {
        call: (agentforge) => agentforge.threads.list('project-1', { includeArchived: true }),
        expected: ['threads:list', 'project-1', { includeArchived: true }],
      },
      {
        call: (agentforge) => agentforge.threads.get('thread-1'),
        expected: ['threads:get', 'thread-1'],
      },
      {
        call: (agentforge) => agentforge.threads.search({ query: 'diff', limit: 12 }),
        expected: ['threads:search', { query: 'diff', limit: 12 }],
      },
      {
        call: (agentforge) =>
          agentforge.threads.create({ projectId: 'project-1', title: 'New thread' }),
        expected: ['threads:create', { projectId: 'project-1', title: 'New thread' }],
      },
      {
        call: (agentforge) =>
          agentforge.threads.rename({ id: 'thread-1', title: 'Renamed' }),
        expected: ['threads:rename', { id: 'thread-1', title: 'Renamed' }],
      },
      {
        call: (agentforge) => agentforge.threads.delete('thread-1'),
        expected: ['threads:delete', 'thread-1'],
      },
      {
        call: (agentforge) => agentforge.threads.pin({ id: 'thread-1', pinned: true }),
        expected: ['threads:pin', { id: 'thread-1', pinned: true }],
      },
      {
        call: (agentforge) => agentforge.threads.archive('thread-1'),
        expected: ['threads:archive', 'thread-1'],
      },
      {
        call: (agentforge) =>
          agentforge.agent.dispatch({
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
            approvalMode: 'manual',
          }),
        expected: [
          'agent:dispatch',
          {
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
            approvalMode: 'manual',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.agent.listProfiles('project-1'),
        expected: ['agent:list-profiles', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.agent.approve('session-1'),
        expected: ['agent:approve', 'session-1'],
      },
      {
        call: (agentforge) =>
          agentforge.agent.planReviewDecision({
            reviewId: 'review-1',
            sessionId: 'session-1',
            decision: 'approve',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
          }),
        expected: [
          'agent:plan-review-decision',
          {
            reviewId: 'review-1',
            sessionId: 'session-1',
            decision: 'approve',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.agent.modelRecoveryDecision({
            recoveryId: 'recovery-1',
            sessionId: 'session-1',
            decision: 'continue',
            agentId: 'codex',
            modelOverride: 'gpt-5.4',
          }),
        expected: [
          'agent:model-recovery-decision',
          {
            recoveryId: 'recovery-1',
            sessionId: 'session-1',
            decision: 'continue',
            agentId: 'codex',
            modelOverride: 'gpt-5.4',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.agent.reject('session-1'),
        expected: ['agent:reject', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.agent.cancel('session-1'),
        expected: ['agent:cancel', 'session-1'],
      },
      { call: (agentforge) => agentforge.agent.killAll(), expected: ['agent:kill-all'] },
      {
        call: (agentforge) => agentforge.swarm.spawn(swarmConfig),
        expected: ['swarm:spawn', swarmConfig],
      },
      {
        call: (agentforge) => agentforge.swarm.status('swarm-1'),
        expected: ['swarm:status', 'swarm-1'],
      },
      {
        call: (agentforge) => agentforge.swarm.cancel('swarm-1'),
        expected: ['swarm:cancel', 'swarm-1'],
      },
      {
        call: (agentforge) => agentforge.swarm.applyResult('session-1', '/tmp/repo'),
        expected: ['swarm:apply-result', 'session-1', '/tmp/repo'],
      },
      {
        call: (agentforge) => agentforge.router.preview('Refactor safely', 'project-1'),
        expected: ['router:preview', 'Refactor safely', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.reviews.list({ projectId: 'project-1', status: 'active' }),
        expected: ['reviews:list', { projectId: 'project-1', status: 'active' }],
      },
      {
        call: (agentforge) =>
          agentforge.reviews.update('issue-1', {
            status: 'resolved',
            fixSessionId: 'session-1',
          }),
        expected: [
          'reviews:update',
          'issue-1',
          {
            status: 'resolved',
            fixSessionId: 'session-1',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.reviews.listProviders('project-1'),
        expected: ['reviews:list-providers', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.feedback.save('session-1', 'success', 'Looks good'),
        expected: ['feedback:save', 'session-1', 'success', 'Looks good'],
      },
      {
        call: (agentforge) => agentforge.cost.byProject('project-1'),
        expected: ['cost:by-project', 'project-1'],
      },
      { call: (agentforge) => agentforge.cost.byPeriod(30), expected: ['cost:by-period', 30] },
      { call: (agentforge) => agentforge.cost.providerUsage(), expected: ['cost:provider-usage'] },
      {
        call: (agentforge) => agentforge.context.index('project-1'),
        expected: ['context:index', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.context.status('project-1'),
        expected: ['context:status', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.context.search({ projectId: 'project-1', query: 'session routing' }),
        expected: ['context:search', { projectId: 'project-1', query: 'session routing' }],
      },
      {
        call: (agentforge) => agentforge.extensions.getState(),
        expected: ['extensions:get-state'],
      },
      {
        call: (agentforge) => agentforge.extensions.listCatalog(),
        expected: ['extensions:list-catalog'],
      },
      {
        call: (agentforge) =>
          agentforge.extensions.searchCatalog({
            query: 'playwright',
            categories: ['mcp-server'],
            targetAgents: ['codex'],
          }),
        expected: [
          'extensions:search-catalog',
          {
            query: 'playwright',
            categories: ['mcp-server'],
            targetAgents: ['codex'],
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.extensions.searchCatalog({
            query: '',
            limit: 100,
          }),
        expected: [
          'extensions:search-catalog',
          {
            limit: 100,
          },
        ],
      },
      {
        call: (agentforge) => agentforge.extensions.listInstalled(),
        expected: ['extensions:list-installed'],
      },
      {
        call: (agentforge) =>
          agentforge.extensions.install({
            extensionId: 'openai-developer-docs',
            scope: 'project',
            projectPath: '/tmp/repo',
            targetAgents: ['codex'],
          }),
        expected: [
          'extensions:install',
          {
            extensionId: 'openai-developer-docs',
            scope: 'project',
            projectPath: '/tmp/repo',
            targetAgents: ['codex'],
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.extensions.updateRuntimeState({
            installationId: 'install-1',
            trusted: true,
            enabled: false,
          }),
        expected: [
          'extensions:update-runtime-state',
          {
            installationId: 'install-1',
            trusted: true,
            enabled: false,
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.extensions.runDoctor({
            installationId: 'install-1',
          }),
        expected: [
          'extensions:run-doctor',
          {
            installationId: 'install-1',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.automations.list('project-1'),
        expected: ['automations:list', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.automations.create(automationInput),
        expected: ['automations:create', automationInput],
      },
      {
        call: (agentforge) =>
          agentforge.automations.update('automation-1', { enabled: false }),
        expected: ['automations:update', 'automation-1', { enabled: false }],
      },
      {
        call: (agentforge) => agentforge.automations.delete('automation-1'),
        expected: ['automations:delete', 'automation-1'],
      },
      {
        call: (agentforge) => agentforge.automations.runNow('automation-1'),
        expected: ['automations:run-now', 'automation-1'],
      },
      {
        call: (agentforge) => agentforge.automations.listRuns('project-1'),
        expected: ['automations:list-runs', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.automations.acknowledgeRun('run-1'),
        expected: ['automations:acknowledge-run', 'run-1'],
      },
      {
        call: (agentforge) => agentforge.automations.reviewRun('run-1'),
        expected: ['automations:review-run', 'run-1'],
      },
      {
        call: (agentforge) => agentforge.automations.retryRun('run-1'),
        expected: ['automations:retry-run', 'run-1'],
      },
      {
        call: (agentforge) => agentforge.specs.list('project-1'),
        expected: ['specs:list', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.specs.create({
            projectId: 'project-1',
            title: 'Spec',
            goal: 'Implement the work',
          }),
        expected: [
          'specs:create',
          {
            projectId: 'project-1',
            title: 'Spec',
            goal: 'Implement the work',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.specs.update('spec-1', { goal: 'Refine the goal' }),
        expected: ['specs:update', 'spec-1', { goal: 'Refine the goal' }],
      },
      {
        call: (agentforge) => agentforge.specs.get('spec-1'),
        expected: ['specs:get', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.specs.approve('spec-1'),
        expected: ['specs:approve', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.specs.listArtifacts('spec-1'),
        expected: ['specs:list-artifacts', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.specs.readArtifact('spec-1', 'prd'),
        expected: ['specs:read-artifact', { specId: 'spec-1', artifactId: 'prd' }],
      },
      {
        call: (agentforge) =>
          agentforge.specs.writeArtifact({
            specId: 'spec-1',
            kind: 'prd',
            markdown: '# PRD',
          }),
        expected: [
          'specs:write-artifact',
          {
            specId: 'spec-1',
            kind: 'prd',
            markdown: '# PRD',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.runs.start({ specId: 'spec-1', mode: 'worktree' }),
        expected: ['runs:start', { specId: 'spec-1', mode: 'worktree' }],
      },
      {
        call: (agentforge) => agentforge.runs.cancel('run-1'),
        expected: ['runs:cancel', 'run-1'],
      },
      {
        call: (agentforge) => agentforge.runs.compare('spec-1'),
        expected: ['runs:compare', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.runs.verify('run-1', 'rtk npm run build'),
        expected: ['runs:verify', 'run-1', 'rtk npm run build'],
      },
      {
        call: (agentforge) => agentforge.runs.getPromptEvidence('session-1'),
        expected: ['runs:getPromptEvidence', 'session-1'],
      },
      {
        call: (agentforge) =>
          agentforge.runs.captureVisualEvidence('session-1', {
            url: 'http://localhost:5173/',
            viewport: { width: 390, height: 844 },
            replayNotes: 'mobile smoke',
          }),
        expected: [
          'runs:captureVisualEvidence',
          'session-1',
          {
            url: 'http://localhost:5173/',
            viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
            replayNotes: 'mobile smoke',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.git.diff({ projectId: 'project-1' }),
        expected: ['git:diff', { projectId: 'project-1' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.stage({ projectId: 'project-1', paths: ['src/main.ts'] }),
        expected: ['git:stage', { projectId: 'project-1', paths: ['src/main.ts'] }],
      },
      {
        call: (agentforge) =>
          agentforge.git.revert({ projectId: 'project-1', paths: ['src/main.ts'] }),
        expected: ['git:revert', { projectId: 'project-1', paths: ['src/main.ts'] }],
      },
      {
        call: (agentforge) =>
          agentforge.git.commit({ projectId: 'project-1', message: 'feat: add spec' }),
        expected: ['git:commit', { projectId: 'project-1', message: 'feat: add spec' }],
      },
      {
        call: (agentforge) => agentforge.git.push('project-1'),
        expected: ['git:push', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.createBranch('project-1', 'feat/git-menu'),
        expected: ['git:create-branch', 'project-1', 'feat/git-menu'],
      },
      {
        call: (agentforge) => agentforge.git.checkoutBranch('project-1', 'main'),
        expected: ['git:checkout-branch', 'project-1', 'main'],
      },
      {
        call: (agentforge) => agentforge.git.listBranches('project-1'),
        expected: ['git:list-branches', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.fetch('project-1'),
        expected: ['git:fetch', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.pull('project-1'),
        expected: ['git:pull', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.getSnapshot({ projectId: 'project-1' }),
        expected: ['git:get-snapshot', { projectId: 'project-1' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.getFileDiff({ projectId: 'project-1', path: 'src/main.ts' }),
        expected: ['git:get-file-diff', { projectId: 'project-1', path: 'src/main.ts' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.getWorktreeHandoffState({
            projectId: 'project-1',
            threadId: 'thread-1',
          }),
        expected: [
          'git:get-worktree-handoff-state',
          { projectId: 'project-1', threadId: 'thread-1' },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.previewWorktreeHandoff({
            projectId: 'project-1',
            threadId: 'thread-1',
          }),
        expected: [
          'git:preview-worktree-handoff',
          { projectId: 'project-1', threadId: 'thread-1' },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.moveThreadToWorktree({
            projectId: 'project-1',
            threadId: 'thread-1',
            cleanupPolicy: 'manual',
          }),
        expected: [
          'git:move-thread-to-worktree',
          { projectId: 'project-1', threadId: 'thread-1', cleanupPolicy: 'manual' },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.bringThreadToLocal({
            projectId: 'project-1',
            threadId: 'thread-1',
            removeAfterApply: false,
          }),
        expected: [
          'git:bring-thread-to-local',
          { projectId: 'project-1', threadId: 'thread-1', removeAfterApply: false },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.createBranchHere({
            projectId: 'project-1',
            threadId: 'thread-1',
            branchName: 'feat/thread-handoff',
          }),
        expected: [
          'git:create-branch-here',
          {
            projectId: 'project-1',
            threadId: 'thread-1',
            branchName: 'feat/thread-handoff',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.restoreWorktreeSnapshot({
            projectId: 'project-1',
            threadId: 'thread-1',
          }),
        expected: [
          'git:restore-worktree-snapshot',
          { projectId: 'project-1', threadId: 'thread-1' },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.openWorktree({
            projectId: 'project-1',
            threadId: 'thread-1',
          }),
        expected: ['git:open-worktree', { projectId: 'project-1', threadId: 'thread-1' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.getCommitDetail({ projectId: 'project-1', sha: 'abc1234' }),
        expected: ['git:get-commit-detail', { projectId: 'project-1', sha: 'abc1234' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.getStashDetail({ projectId: 'project-1', ref: 'stash@{0}' }),
        expected: ['git:get-stash-detail', { projectId: 'project-1', ref: 'stash@{0}' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.stageFile({ projectId: 'project-1', path: 'src/main.ts' }),
        expected: ['git:stage-file', { projectId: 'project-1', path: 'src/main.ts' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.unstageFile({ projectId: 'project-1', path: 'src/main.ts' }),
        expected: ['git:unstage-file', { projectId: 'project-1', path: 'src/main.ts' }],
      },
      {
        call: (agentforge) => agentforge.git.stageAll('project-1'),
        expected: ['git:stage-all', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.unstageAll('project-1'),
        expected: ['git:unstage-all', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.git.deleteBranch({ projectId: 'project-1', branchName: 'old-branch' }),
        expected: ['git:delete-branch', { projectId: 'project-1', branchName: 'old-branch' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.discardFile({ projectId: 'project-1', path: 'src/main.ts' }),
        expected: ['git:discard-file', { projectId: 'project-1', path: 'src/main.ts' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.checkoutBranchAction({
            projectId: 'project-1',
            branchName: 'feat/git-menu',
          }),
        expected: [
          'git:checkout-branch-action',
          { projectId: 'project-1', branchName: 'feat/git-menu' },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.applyStash({ projectId: 'project-1', ref: 'stash@{0}' }),
        expected: ['git:apply-stash', { projectId: 'project-1', ref: 'stash@{0}' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.popStash({
            projectId: 'project-1',
            ref: 'stash@{0}',
            confirmed: true,
          }),
        expected: [
          'git:pop-stash',
          { projectId: 'project-1', ref: 'stash@{0}', confirmed: true },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.git.dropStash({
            projectId: 'project-1',
            ref: 'stash@{0}',
            confirmed: true,
          }),
        expected: [
          'git:drop-stash',
          { projectId: 'project-1', ref: 'stash@{0}', confirmed: true },
        ],
      },
      {
        call: (agentforge) => agentforge.git.getPendingChanges('project-1'),
        expected: ['git:get-pending-changes', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.analyzeCommitPlan('project-1'),
        expected: ['git:analyze-commit-plan', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.git.reviewCurrentDiff('project-1'),
        expected: ['git:review-current-diff', 'project-1', undefined],
      },
      {
        call: (agentforge) =>
          agentforge.git.executeCommitPlan({
            projectId: 'project-1',
            fingerprint: 'fingerprint-1',
            suggestions: [
              {
                id: 'commit-1',
                message: 'feat(workspace): refresh commit review flow',
                summary: 'UI updates.',
                files: ['src/renderer/CommitAndPushDialog.tsx'],
              },
            ],
          }),
        expected: [
          'git:execute-commit-plan',
          {
            projectId: 'project-1',
            fingerprint: 'fingerprint-1',
            suggestions: [
              {
                id: 'commit-1',
                message: 'feat(workspace): refresh commit review flow',
                summary: 'UI updates.',
                files: ['src/renderer/CommitAndPushDialog.tsx'],
              },
            ],
          },
        ],
      },
      {
        call: (agentforge) => agentforge.memory.list('project-1'),
        expected: ['memory:list', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.memory.save({
            projectId: 'project-1',
            kind: 'architecture',
            summary: 'Keep privileged filesystem access in the main process.',
          }),
        expected: [
          'memory:save',
          {
            projectId: 'project-1',
            kind: 'architecture',
            summary: 'Keep privileged filesystem access in the main process.',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.memory.delete({ projectId: 'project-1', entryId: 'memory-1' }),
        expected: ['memory:delete', { projectId: 'project-1', entryId: 'memory-1' }],
      },
      {
        call: (agentforge) => agentforge.settings.getGlobal(),
        expected: ['settings:get-global'],
      },
      {
        call: (agentforge) =>
          agentforge.settings.updateGlobal({ ui: { compactMode: true } }),
        expected: ['settings:update-global', { ui: { compactMode: true } }],
      },
      {
        call: (agentforge) => agentforge.settings.getEffective('project-1'),
        expected: ['settings:get-effective', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.settings.getProjectOverrides('project-1'),
        expected: ['settings:get-project-overrides', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.settings.updateProjectOverrides('project-1', {
            swarms: { maxAgents: 4 },
          }),
        expected: [
          'settings:update-project-overrides',
          'project-1',
          { swarms: { maxAgents: 4 } },
        ],
      },
      {
        call: (agentforge) => agentforge.settings.resetProjectOverrides('project-1'),
        expected: ['settings:reset-project-overrides', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.updates.getState(),
        expected: ['updates:get-state'],
      },
      {
        call: (agentforge) => agentforge.updates.check(),
        expected: ['updates:check'],
      },
      {
        call: (agentforge) => agentforge.updates.download(),
        expected: ['updates:download'],
      },
      {
        call: (agentforge) => agentforge.updates.installAndRestart(),
        expected: ['updates:install-and-restart'],
      },
      {
        call: (agentforge) => agentforge.system.openInEditor('/tmp/file.ts'),
        expected: ['system:open-editor', '/tmp/file.ts'],
      },
      {
        call: (agentforge) =>
          agentforge.system.readMarkdownDocument({
            href: 'docs/PLAN.md',
            repoPath: '/tmp/repo',
          }),
        expected: [
          'system:read-markdown-document',
          {
            href: 'docs/PLAN.md',
            repoPath: '/tmp/repo',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.system.selectDirectory(),
        expected: ['system:select-directory'],
      },
      {
        call: (agentforge) => agentforge.system.checkAgentInstalled('codex'),
        expected: ['system:check-agent', 'codex'],
      },
      {
        call: (agentforge) => agentforge.system.listAgentModels(),
        expected: ['system:list-agent-models'],
      },
      {
        call: (agentforge) => agentforge.system.listCapabilities(),
        expected: ['system:list-capabilities'],
      },
      {
        call: (agentforge) => agentforge.system.getAgentProfileDoctor('project-1'),
        expected: ['system:agent-profile-doctor', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.system.listVerificationRecipes('project-1'),
        expected: ['system:list-verification-recipes', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.system.listManagedCliRuntimes(),
        expected: ['system:list-managed-cli-runtimes'],
      },
      {
        call: (agentforge) =>
          agentforge.system.runManagedCliAction({
            agentId: 'codex',
            actionId: 'doctor',
            repoPath: '/tmp/repo',
          }),
        expected: [
          'system:run-managed-cli-action',
          {
            agentId: 'codex',
            actionId: 'doctor',
            repoPath: '/tmp/repo',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.saveAttachment({
            dataUrl: 'data:application/pdf;base64,AAAA',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
          }),
        expected: [
          'system:save-attachment',
          {
            dataUrl: 'data:application/pdf;base64,AAAA',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.copyImageToClipboard({
            source: 'file:///tmp/paste.png',
            suggestedName: 'paste.png',
          }),
        expected: [
          'system:copy-image-to-clipboard',
          {
            source: 'file:///tmp/paste.png',
            suggestedName: 'paste.png',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.saveImageFile({
            source: 'file:///tmp/paste.png',
            suggestedName: 'paste.png',
          }),
        expected: [
          'system:save-image-file',
          {
            source: 'file:///tmp/paste.png',
            suggestedName: 'paste.png',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.startCliEditorTerminal({
            sessionId: 'terminal-1',
            editorId: 'vim',
            repoPath: '/tmp/repo',
            cols: 120,
            rows: 40,
          }),
        expected: [
          'system:start-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            editorId: 'vim',
            repoPath: '/tmp/repo',
            cols: 120,
            rows: 40,
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.writeCliEditorTerminal({
            sessionId: 'terminal-1',
            data: ':q\r',
          }),
        expected: [
          'system:write-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            data: ':q\r',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.resizeCliEditorTerminal({
            sessionId: 'terminal-1',
            cols: 100,
            rows: 32,
          }),
        expected: [
          'system:resize-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            cols: 100,
            rows: 32,
          },
        ],
      },
      {
        call: (agentforge) => agentforge.system.stopCliEditorTerminal('terminal-1'),
        expected: ['system:stop-cli-editor-terminal', 'terminal-1'],
      },
    ]

    for (const { call, expected } of cases) {
      ipcRenderer.invoke.mockClear()

      await call(api)

      expect(ipcRenderer.invoke).toHaveBeenCalledWith(...expected)
    }
  })

  it('passes interactive terminal control keys through the preload bridge', async () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )

    await api.system.writeCliEditorTerminal({
      sessionId: 'terminal-1',
      data: 'abc\u007f\u001b[D\u0003\r',
    })

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('system:write-cli-editor-terminal', {
      sessionId: 'terminal-1',
      data: 'abc\u007f\u001b[D\u0003\r',
    })
  })

  it('keeps event subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: AgentEvent = {
      type: 'stdout',
      sessionId: 'session-1',
      payload: 'ready',
      timestamp: 1,
    }
    const callback = vi.fn()

    const unsubscribe = api.on('session:session-1', callback)
    ipcRenderer.emit('session:session-1', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('session:session-1', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('session:session-1', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'session:session-1',
      expect.any(Function),
    )
  })

  it('keeps shortcut subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const callback = vi.fn()

    const unsubscribe = api.onShortcut('shortcut:approve', callback)
    ipcRenderer.emit('shortcut:approve')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.on).toHaveBeenCalledWith('shortcut:approve', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('shortcut:approve')

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'shortcut:approve',
      expect.any(Function),
    )
  })

  it('keeps cli editor terminal subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const dataEvent = {
      sessionId: 'terminal-1',
      data: 'ready',
    }
    const exitEvent = {
      sessionId: 'terminal-1',
      exitCode: 0,
    }
    const dataCallback = vi.fn()
    const exitCallback = vi.fn()

    const unsubscribeData = api.system.onCliEditorTerminalData(dataCallback)
    const unsubscribeExit = api.system.onCliEditorTerminalExit(exitCallback)
    ipcRenderer.emit('system:cli-editor-terminal:data', dataEvent)
    ipcRenderer.emit('system:cli-editor-terminal:exit', exitEvent)

    expect(dataCallback).toHaveBeenCalledWith(dataEvent)
    expect(exitCallback).toHaveBeenCalledWith(exitEvent)
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'system:cli-editor-terminal:data',
      expect.any(Function),
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'system:cli-editor-terminal:exit',
      expect.any(Function),
    )

    dataCallback.mockClear()
    exitCallback.mockClear()
    unsubscribeData()
    unsubscribeExit()
    ipcRenderer.emit('system:cli-editor-terminal:data', dataEvent)
    ipcRenderer.emit('system:cli-editor-terminal:exit', exitEvent)

    expect(dataCallback).not.toHaveBeenCalled()
    expect(exitCallback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'system:cli-editor-terminal:data',
      expect.any(Function),
    )
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'system:cli-editor-terminal:exit',
      expect.any(Function),
    )
  })

  it('keeps thread deletion subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: ThreadDeletedEvent = {
      threadId: 'thread-1',
      projectId: 'project-1',
    }
    const callback = vi.fn()

    const unsubscribe = api.threads.onDeleted(callback)
    ipcRenderer.emit('thread:deleted', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('thread:deleted', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('thread:deleted', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'thread:deleted',
      expect.any(Function),
    )
  })

  it('keeps settings subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: SettingsUpdateEvent = {
      scope: 'global',
      settings: {} as SettingsUpdateEvent['settings'],
      effective: {} as SettingsUpdateEvent['effective'],
      updatedAt: 1,
    }
    const callback = vi.fn()

    const unsubscribe = api.settings.onUpdated(callback)
    ipcRenderer.emit('settings:updated', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('settings:updated', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('settings:updated', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'settings:updated',
      expect.any(Function),
    )
  })

  it('keeps update status subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: AppUpdateState = {
      currentVersion: '0.1.1',
      phase: 'available',
      canCheck: true,
      canDownload: true,
      canInstall: false,
      update: { version: '0.1.2' },
    }
    const callback = vi.fn()

    const unsubscribe = api.updates.onStatus(callback)
    ipcRenderer.emit('updates:status', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('updates:status', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('updates:status', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'updates:status',
      expect.any(Function),
    )
  })
})
