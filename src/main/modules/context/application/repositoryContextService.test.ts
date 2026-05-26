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
    expect(context).toContain('Repository file structure')
    expect(context).toContain('- src/routing.ts')
    expect(context).toContain('Repository context')
    expect(context).toContain('src/routing.ts:1-3')
    expect(context).toContain('routeModel')
    expect(context?.indexOf('Repository symbol map')).toBeLessThan(
      context?.indexOf('Repository context') ?? 0,
    )
  })

  it('skips cold repository indexing for opportunistic prompt context', async () => {
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
      freshness: 'opportunistic',
    })

    expect(context).toBeNull()
    expect(service.status('project-1')).toMatchObject({
      indexedChunks: 0,
      indexedFiles: 0,
    })
  })

  it('uses existing chunks without rebuilding symbols for opportunistic prompt context', async () => {
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
    await service.indexProject({ projectId: 'project-1', repoPath })

    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'model routing for security work',
      freshness: 'opportunistic',
    })

    expect(context).not.toContain('Repository symbol map')
    expect(context).toContain('Repository file structure')
    expect(context).toContain('- src/routing.ts')
    expect(context).toContain('Repository context')
    expect(context).toContain('src/routing.ts:1-3')
    expect(context).toContain('routeModel')
  })

  it('skips uncached persisted chunks for opportunistic prompt context', async () => {
    await mkdir(path.join(repoPath, 'src'), { recursive: true })
    await writeFile(
      path.join(repoPath, 'src', 'routing.ts'),
      [
        'export function routeModel(prompt: string) {',
        '  return prompt.includes("security") ? "frontier" : "balanced"',
        '}',
      ].join('\n'),
    )

    await new RepositoryContextService().indexProject({ projectId: 'project-1', repoPath })

    const context = await new RepositoryContextService().buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'model routing for security work',
      freshness: 'opportunistic',
    })

    expect(context).toBeNull()
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
    expect(context).toContain('Repository file structure')
    expect(context).toContain('- src/sessions.ts')
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

  it('redacts secrets before indexing and prompt injection', async () => {
    await writeFile(
      path.join(repoPath, 'config.ts'),
      [
        'export const githubToken = "ghp_1234567890abcdefghijklmnop"',
        'export const openAiKey = "sk-1234567890abcdefghijklmnop"',
        'export const publicName = "visible context"',
      ].join('\n'),
    )
    await writeFile(path.join(repoPath, '.env'), 'SECRET_TOKEN=do-not-index-this-value\n')

    const service = new RepositoryContextService()
    const result = await service.indexProject({ projectId: 'project-1', repoPath })
    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'github token openai key visible context',
    })
    const storedRows = getDb()
      .prepare('SELECT path, content FROM project_context_chunks ORDER BY path ASC')
      .all() as Array<{ path: string; content: string }>

    expect(result.indexedFiles).toBe(1)
    expect(storedRows.map((row) => row.path)).toEqual(['config.ts'])
    expect(JSON.stringify(storedRows)).not.toContain('ghp_1234567890abcdefghijklmnop')
    expect(JSON.stringify(storedRows)).not.toContain('sk-1234567890abcdefghijklmnop')
    expect(context).toContain('[REDACTED_SECRET]')
    expect(context).toContain('visible context')
    expect(context).not.toContain('do-not-index-this-value')
  })

  it('keeps injected repository context under its budget', async () => {
    await mkdir(path.join(repoPath, 'src'), { recursive: true })
    for (let index = 0; index < 20; index += 1) {
      await writeFile(
        path.join(repoPath, 'src', `workflow-${index}.ts`),
        Array.from(
          { length: 120 },
          (_, line) =>
            `export function workflow${index}_${line}() { return "dispatch context memory ${index} ${line}" }`,
        ).join('\n'),
      )
    }

    const service = new RepositoryContextService()
    const context = await service.buildPromptContext({
      projectId: 'project-1',
      repoPath,
      prompt: 'dispatch context memory workflow',
    })

    expect(context?.length).toBeLessThanOrEqual(12_000)
    expect(context).toContain('Repository symbol map')
    expect(context).toContain('Repository context')
  })

  it('uses candidate pre-filter to avoid loading all chunks', async () => {
    await mkdir(path.join(repoPath, 'src'), { recursive: true })
    await writeFile(
      path.join(repoPath, 'src', 'auth.ts'),
      ['export function authenticate() { return true }'].join('\n'),
    )
    await writeFile(
      path.join(repoPath, 'src', 'database.ts'),
      ['export function query(sql: string) { return [] }'].join('\n'),
    )
    await writeFile(
      path.join(repoPath, 'src', 'cache.ts'),
      ['export function getCached(key: string) { return null }'].join('\n'),
    )

    const service = new RepositoryContextService()
    await service.indexProject({ projectId: 'project-1', repoPath })

    const candidateRows = getDb()
      .prepare('SELECT path, path_tokens, content_tokens FROM project_context_candidates')
      .all() as Array<{ path: string; path_tokens: string; content_tokens: string }>

    expect(candidateRows.length).toBe(3)
    expect(candidateRows.map((r) => r.path).sort()).toEqual([
      'src/auth.ts',
      'src/cache.ts',
      'src/database.ts',
    ])

    const matches = await service.search({
      projectId: 'project-1',
      repoPath,
      query: 'authentication function',
      limit: 1,
    })

    expect(matches.length).toBe(1)
    expect(matches[0].path).toBe('src/auth.ts')
  })

  it('schedules background reindex without blocking when index is stale', async () => {
    await writeFile(
      path.join(repoPath, 'SessionManager.ts'),
      ['export class SessionManager {}'].join('\n'),
    )

    const service = new RepositoryContextService()
    await service.indexProject({ projectId: 'project-1', repoPath })

    const statusBefore = service.status('project-1')
    expect(statusBefore.indexedChunks).toBeGreaterThan(0)

    const fakeStaleStatus = getDb()
      .prepare(
        `UPDATE project_context_chunks SET updated_at = ? WHERE project_id = ?`,
      )
      .run(Date.now() - 10 * 60 * 1000, 'project-1')

    const searchPromise = service.search({
      projectId: 'project-1',
      repoPath,
      query: 'session manager',
      limit: 1,
    })

    const results = await searchPromise
    expect(results.length).toBeGreaterThan(0)
  })

  it('populates candidate table during indexing', async () => {
    await writeFile(
      path.join(repoPath, 'handler.ts'),
      ['export async function handleRequest(req: Request) {}'].join('\n'),
    )

    const service = new RepositoryContextService()
    await service.indexProject({ projectId: 'project-1', repoPath })

    const candidateRows = getDb()
      .prepare('SELECT * FROM project_context_candidates WHERE project_id = ?')
      .all('project-1') as Array<{
      project_id: string
      path: string
      path_tokens: string
      content_tokens: string
    }>

    expect(candidateRows.length).toBe(1)
    expect(candidateRows[0].path).toBe('handler.ts')
    expect(candidateRows[0].path_tokens).toContain('handler')
    expect(candidateRows[0].content_tokens).toContain('handle')
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
