import { execFile } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listManagedCliRuntimes, runManagedCliAction } from './managedCliRuntimes'
import type { MainIpcContext } from '../../shared/ipcContext'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

const execFileMock = vi.mocked(execFile)

function createContext(
  commands: Partial<Record<'claude-code' | 'codex' | 'opencode' | 'antigravity', string>> = {},
): MainIpcContext {
  return {
    settingsService: {
      getGlobal: () => ({
        agents: {
          runtimes: {
            'claude-code': { command: commands['claude-code'] ?? 'claude-test' },
            codex: { command: commands.codex ?? 'codex-test' },
            opencode: { command: commands.opencode ?? 'opencode-test' },
            antigravity: { command: commands.antigravity ?? 'agy-test' },
          },
        },
      }),
    },
  } as unknown as MainIpcContext
}

describe('managed CLI runtimes', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('runs only fixed installer commands for renderer requests', async () => {
    execFileMock.mockImplementation((command, args, _options, callback) => {
      if (command === 'which') {
        callback?.(new Error('not found'), '', '')
        return undefined as never
      }

      expect(command).toBe('npm')
      expect(args).toEqual(['install', '-g', '@openai/codex'])
      callback?.(null, 'installed', '')
      return undefined as never
    })

    const result = await runManagedCliAction(createContext(), {
      agentId: 'codex',
      actionId: 'install',
    })

    expect(result).toMatchObject({
      agentId: 'codex',
      actionId: 'install',
      command: 'npm install -g @openai/codex',
      exitCode: 0,
    })
  })

  it('disables install for installed runtimes and upgrade until a newer version exists', async () => {
    execFileMock.mockImplementation((command, args, _options, callback) => {
      if (command === 'which') {
        callback?.(null, `/bin/${args?.[0] ?? 'cli'}\n`, '')
        return undefined as never
      }

      if (command === 'claude-test') {
        callback?.(null, '2.1.149 (Claude Code)\n', '')
        return undefined as never
      }

      if (command === 'codex-test') {
        callback?.(null, 'codex-cli 0.130.0\n', '')
        return undefined as never
      }

      if (command === 'opencode-test') {
        callback?.(null, '1.15.10\n', '')
        return undefined as never
      }

      if (command === 'agy-test') {
        callback?.(null, '0.1.0\n', '')
        return undefined as never
      }

      if (command === 'npm' && args?.[0] === 'view') {
        const packageName = args[1]
        const versions: Record<string, string> = {
          '@anthropic-ai/claude-code': '2.1.150',
          '@openai/codex': '0.130.0',
          'opencode-ai': '1.15.10',
        }
        callback?.(null, `${versions[String(packageName)]}\n`, '')
        return undefined as never
      }

      throw new Error(`Unexpected command: ${command} ${args?.join(' ')}`)
    })

    const runtimes = await listManagedCliRuntimes(createContext())
    const claude = runtimes.find((runtime) => runtime.agentId === 'claude-code')
    const codex = runtimes.find((runtime) => runtime.agentId === 'codex')

    expect(claude).toMatchObject({
      version: '2.1.149 (Claude Code)',
      latestVersion: '2.1.150',
      updateAvailable: true,
    })
    expect(claude?.actions.find((action) => action.id === 'install')).toMatchObject({
      available: false,
      unavailableReason: 'Already installed.',
    })
    expect(claude?.actions.find((action) => action.id === 'upgrade')).toMatchObject({
      available: true,
    })
    expect(codex).toMatchObject({
      latestVersion: '0.130.0',
      updateAvailable: false,
    })
    expect(codex?.actions.find((action) => action.id === 'upgrade')).toMatchObject({
      available: false,
      unavailableReason: 'Already on the latest version (0.130.0).',
    })
  })

  it('rejects install when the runtime is already installed before spawning an installer', async () => {
    execFileMock.mockImplementation((command, _args, _options, callback) => {
      expect(command).toBe('which')
      callback?.(null, '/bin/codex-test\n', '')
      return undefined as never
    })

    await expect(
      runManagedCliAction(createContext(), {
        agentId: 'codex',
        actionId: 'install',
      }),
    ).rejects.toThrow('OpenAI Codex is already installed.')

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('rejects upgrade when the installed runtime is already current', async () => {
    execFileMock.mockImplementation((command, args, _options, callback) => {
      if (command === 'which') {
        callback?.(null, '/bin/codex-test\n', '')
        return undefined as never
      }
      if (command === 'codex-test') {
        callback?.(null, 'codex-cli 0.130.0\n', '')
        return undefined as never
      }
      if (command === 'npm' && args?.[0] === 'view') {
        callback?.(null, '0.130.0\n', '')
        return undefined as never
      }

      throw new Error(`Unexpected command: ${command} ${args?.join(' ')}`)
    })

    await expect(
      runManagedCliAction(createContext(), {
        agentId: 'codex',
        actionId: 'upgrade',
      }),
    ).rejects.toThrow('OpenAI Codex is already on the latest version.')
  })

  it('rejects unsupported agent action pairs before spawning', async () => {
    await expect(
      runManagedCliAction(createContext(), {
        agentId: 'antigravity',
        actionId: 'models',
      }),
    ).rejects.toThrow('Unsupported CLI action: models')

    expect(execFileMock).not.toHaveBeenCalled()
  })
})
