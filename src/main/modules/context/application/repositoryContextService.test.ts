import Database from 'better-sqlite3'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDbForTests, closeDb, getDb } from '../../../store/db'
import { RepositoryContextService } from './repositoryContextService'

let repoPath: string

describe('RepositoryContextService', () => {
  beforeEach(async () => {
    setDbForTests(new Database(':memory:'))
    seedProject('project-1')
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-context-'))
  })

  afterEach(async () => {
    closeDb()
    if (repoPath) {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  it('indexes repository files and retrieves relevant snippets for a prompt', async () => {
    await writeFile(
      path.join(repoPath, 'SessionManager.ts'),
      [
        'export class SessionManager {',
        '  dispatchNextQueued(threadId: string) {',
        '    return `dispatch queued message for ${threadId}`',
        '  }',
        '}',
      ].join('\n'),
    )
    await writeFile(
      path.join(repoPath, 'pricing.ts'),
      'export function estimateCost() { return 1 }',
    )

    const service = new RepositoryContextService()
    const result = await service.indexProject({ projectId: 'project-1', repoPath })
    const matches = await service.search({
      projectId: 'project-1',
      repoPath,
      query: 'queued dispatch session manager thread',
      limit: 1,
    })

    expect(result.indexedFiles).toBe(2)
    expect(result.indexedChunks).toBeGreaterThanOrEqual(2)
    expect(matches[0]).toMatchObject({
      path: 'SessionManager.ts',
      startLine: 1,
    })
  })

  it('builds a bounded prompt context block', async () => {
    await mkdir(path.join(repoPath, 'src'), { recursive: true })
    await writeFile(
      path.join(repoPath, 'src', 'routing.ts'),
      [
        'export function routeModel(prompt: string) {',
        '  return prompt.includes("security") ? "frontier" : "balanced"',
        '}',
      ].join('\n'),
    )

    const service = new RepositoryContextService()
    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'model routing for security work',
    })

    expect(context).toContain('Repository symbol map')
    expect(context).toContain('function routeModel(prompt: string)')
    expect(context).toContain('Repository context')
    expect(context).toContain('src/routing.ts:1-3')
    expect(context).toContain('routeModel')
    expect(context?.indexOf('Repository symbol map')).toBeLessThan(
      context?.indexOf('Repository context') ?? 0,
    )
  })

  it('builds a repo-wide symbol map even when no snippets match the prompt', async () => {
    await mkdir(path.join(repoPath, 'src'), { recursive: true })
    await writeFile(
      path.join(repoPath, 'src', 'sessions.ts'),
      [
        'export interface AgentRun {',
        '  stop(reason: string): Promise<void>',
        '}',
        '',
        'export class SessionManager {',
        '  dispatchNextQueued(threadId: string): string {',
        '    return threadId',
        '  }',
        '',
        '  private readSecret(): string {',
        '    return "secret"',
        '  }',
        '}',
        '',
        'export function createSession(prompt: string): AgentRun {',
        '  return { stop: async () => undefined }',
        '}',
      ].join('\n'),
    )

    const service = new RepositoryContextService()
    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: '   ',
    })

    expect(context).toContain('Repository symbol map')
    expect(context).toContain('- src/sessions.ts')
    expect(context).toContain('interface AgentRun')
    expect(context).toContain('stop(reason: string): Promise<void>')
    expect(context).toContain('class SessionManager')
    expect(context).toContain('dispatchNextQueued(threadId: string): string')
    expect(context).toContain('function createSession(prompt: string): AgentRun')
    expect(context).not.toContain('readSecret')
    expect(context).not.toContain('Repository context (retrieved automatically')
  })

  it('uses compact context when one large file dominates the matches', async () => {
    const lines = Array.from(
      { length: 320 },
      (_, index) => `function renderGuest${index}() { return "firebase mobile layout ${index}" }`,
    )
    await writeFile(path.join(repoPath, 'index.html'), lines.join('\n'))

    const service = new RepositoryContextService()
    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'improve firebase mobile layout guest delete password',
    })

    expect(context).toContain('Repository context (compact)')
    expect(context).toContain('Likely target file: index.html:')
    expect(context).toContain('full snippet was not injected')
    expect(context).not.toContain('function renderGuest')
  })
})

function seedProject(projectId: string): void {
  getDb()
    .prepare(
      `
        INSERT INTO projects (
          id, name, repo_path, agent_id, model_tier, context, created_at, updated_at
        )
        VALUES (?, 'Project', '/tmp/project', 'codex', 'balanced', NULL, 1, 1)
      `,
    )
    .run(projectId)
}
