import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installArtifactForAgent } from './agentConfigInstallers'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, stdout?: string, stderr?: string) => void,
    ) => callback(null, '', ''),
  ),
}))

let repoPath: string

describe('installArtifactForAgent', () => {
  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-installer-'))
    vi.mocked(execFile).mockClear()
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  it('writes inline Codex skills to the project skill folder', async () => {
    const action = await installArtifactForAgent({
      artifact: {
        kind: 'skill',
        skillName: 'inline-skill',
        description: 'Inline skill',
        body: '# Inline Skill\n',
      },
      agentId: 'codex',
      scope: 'project',
      projectPath: repoPath,
    })

    expect(action.status).toBe('installed')
    await expect(
      readFile(path.join(repoPath, '.codex/skills/inline-skill/SKILL.md'), 'utf8'),
    ).resolves.toBe('# Inline Skill\n')
  })

  it('installs skills.sh artifacts through the CLI instead of writing body files', async () => {
    const action = await installArtifactForAgent({
      artifact: {
        kind: 'skill',
        skillName: 'react-best-practices',
        description: 'React best practices',
        packageName: 'vercel-labs/agent-skills',
        cliSkillName: 'react-best-practices',
      },
      agentId: 'codex',
      scope: 'project',
      projectPath: repoPath,
    })

    const [command, args, options, callback] = vi.mocked(execFile).mock.calls[0] ?? []
    expect(command).toBe('npx')
    expect(args).toEqual([
      '-y',
      'skills',
      'add',
      'vercel-labs/agent-skills',
      '--skill',
      'react-best-practices',
      '--agent',
      'codex',
      '--copy',
      '--yes',
    ])
    expect(options).toEqual(
      expect.objectContaining({
        cwd: repoPath,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: expect.objectContaining({
          DISABLE_TELEMETRY: '1',
        }),
      }),
    )
    expect(callback).toEqual(expect.any(Function))
    expect(action).toMatchObject({
      agentId: 'codex',
      artifactKind: 'skill',
      status: 'installed',
      filePath: repoPath,
      followUpCommand:
        'npx -y skills add vercel-labs/agent-skills --skill react-best-practices --agent codex --copy --yes',
    })
  })

  it('retries skills.sh installs with the login shell npx path when the app PATH is missing npx', async () => {
    const missingNpx = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' })
    mockExecFileOnce(missingNpx)
    mockExecFileOnce(
      null,
      '/opt/homebrew/bin/npx\n__LOBRECS_AGENT_SKILLS_PATH__\n/opt/homebrew/bin:/usr/bin',
      '',
    )
    mockExecFileOnce(null, '', '')

    const action = await installArtifactForAgent({
      artifact: {
        kind: 'skill',
        skillName: 'frontend-design',
        description: 'Frontend design',
        packageName: 'anthropics/skills',
        cliSkillName: 'frontend-design',
      },
      agentId: 'codex',
      scope: 'project',
      projectPath: repoPath,
    })

    const calls = vi.mocked(execFile).mock.calls
    expect(calls[0]?.[0]).toBe('npx')
    expect(calls[1]?.[1]).toEqual([
      '-lc',
      "command -v npx\nprintf '\\n__LOBRECS_AGENT_SKILLS_PATH__\\n'\nprintf '%s' \"$PATH\"",
    ])
    expect(calls[2]?.[0]).toBe('/opt/homebrew/bin/npx')
    expect(calls[2]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringMatching(/^\/opt\/homebrew\/bin:\/usr\/bin/),
        }),
      }),
    )
    expect(action.status).toBe('installed')
  })
})

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void

function mockExecFileOnce(error: Error | null, stdout = '', stderr = ''): void {
  const implementation = ((...args: unknown[]) => {
    const callback = args.at(-1) as ExecFileCallback
    callback(error, stdout, stderr)
    return undefined
  }) as unknown as typeof execFile
  vi.mocked(execFile).mockImplementationOnce(implementation)
}
