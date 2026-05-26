import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstalledExtensionRecord } from '../../../../shared/types'
import { ExtensionRuntime } from './extensionRuntime'

let repoPath: string
let records: InstalledExtensionRecord[]

describe('ExtensionRuntime', () => {
  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-extension-runtime-'))
    records = []
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  it('runs only trusted, enabled hooks with the required capability', async () => {
    await writeHook(
      'hook.mjs',
      "process.stdout.write(JSON.stringify({ result: { append: 'hook-added' } }))",
    )
    records.push(executableRecord({ trusted: true, enabled: true }))
    records.push(executableRecord({ id: 'disabled', trusted: true, enabled: false }))
    records.push(executableRecord({ id: 'untrusted', trusted: false, enabled: true }))

    const runtime = new ExtensionRuntime({ list: () => records })
    const executions = await runtime.runHook(
      {
        hook: 'prompt-decoration',
        requiredCapabilities: ['prompt:decorate'],
        projectPath: repoPath,
      },
      { prompt: 'original' },
    )

    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({
      installationId: 'enabled',
      result: { append: 'hook-added' },
    })
  })

  it('filters project-scoped hooks by installed project path', async () => {
    await writeHook(
      'hook.mjs',
      "process.stdout.write(JSON.stringify({ result: { append: 'wrong' } }))",
    )
    records.push(executableRecord({ trusted: true, enabled: true, projectPath: '/tmp/other' }))

    const runtime = new ExtensionRuntime({ list: () => records })

    await expect(
      runtime.runHook(
        {
          hook: 'prompt-decoration',
          requiredCapabilities: ['prompt:decorate'],
          projectPath: repoPath,
        },
        { prompt: 'original' },
      ),
    ).resolves.toEqual([])
  })

  it('fails timed-out hook processes', async () => {
    await writeHook('hook.mjs', 'setTimeout(() => {}, 10_000)')
    records.push(executableRecord({ trusted: true, enabled: true, timeoutMs: 100 }))

    const runtime = new ExtensionRuntime({ list: () => records })

    await expect(
      runtime.runHook(
        {
          hook: 'prompt-decoration',
          requiredCapabilities: ['prompt:decorate'],
          projectPath: repoPath,
        },
        { prompt: 'original' },
      ),
    ).rejects.toThrow('timed out')
  })
})

async function writeHook(fileName: string, body: string): Promise<void> {
  await writeFile(path.join(repoPath, fileName), body)
}

function executableRecord({
  id = 'enabled',
  trusted,
  enabled,
  projectPath = repoPath,
  timeoutMs = 2_000,
}: {
  id?: string
  trusted: boolean
  enabled: boolean
  projectPath?: string
  timeoutMs?: number
}): InstalledExtensionRecord {
  return {
    id,
    extensionId: `extension-${id}`,
    scope: 'project',
    projectPath,
    targetAgents: ['codex'],
    actions: [],
    installedAt: Date.now(),
    executable: {
      trusted,
      enabled,
      scope: 'project',
      manifest: {
        command: 'hook.mjs',
        runtime: 'node',
        hooks: ['prompt-decoration'],
        capabilities: ['prompt:decorate'],
        scope: 'project',
        timeoutMs,
      },
    },
  }
}
