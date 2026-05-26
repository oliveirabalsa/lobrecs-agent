import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLI_EDITOR_TERMINAL_DATA_CHANNEL,
  CLI_EDITOR_TERMINAL_EXIT_CHANNEL,
  CliEditorTerminalService,
  SHELL_TERMINAL_EDITOR_ID,
  type PtyProcessLike,
  type PtySpawnOptions,
} from './cliEditorTerminal'
import type { EditorInfo } from './detectEditors'

class FakePty implements PtyProcessLike {
  readonly writes: string[] = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  readonly kills: Array<string | undefined> = []
  private readonly dataHandlers = new Set<(data: string) => void>()
  private readonly exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>()

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  kill(signal?: string): void {
    this.kills.push(signal)
  }

  onData(callback: (data: string) => void): { dispose: () => void } {
    this.dataHandlers.add(callback)
    return { dispose: () => this.dataHandlers.delete(callback) }
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void } {
    this.exitHandlers.add(callback)
    return { dispose: () => this.exitHandlers.delete(callback) }
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data)
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const handler of [...this.exitHandlers]) handler(event)
  }
}

const cliEditors: EditorInfo[] = [
  {
    id: 'vim',
    name: 'Vim',
    kind: 'cli',
    target: 'vim',
    binPath: '/usr/bin/vim',
  },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CliEditorTerminalService', () => {
  it('starts a pty-backed cli editor session and streams events', async () => {
    vi.stubEnv('SHELL', '/bin/zsh')

    const pty = new FakePty()
    const spawnPty = vi.fn(
      (_command: string, _args: string[], _options: PtySpawnOptions) => pty,
    )
    const emit = vi.fn()
    const service = new CliEditorTerminalService({
      spawnPty,
      detectEditors: async () => cliEditors,
    })

    const session = await service.start(
      {
        sessionId: 'terminal-1',
        editorId: 'vim',
        repoPath: '/tmp/repo',
        cols: 132,
        rows: 42,
      },
      emit,
    )

    expect(session).toEqual({
      sessionId: 'terminal-1',
      editorId: 'vim',
      editorName: 'Vim',
      repoPath: path.resolve('/tmp/repo'),
      command: 'vim .',
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/zsh',
      [
        '-i',
        '-c',
        'vim --cmd \'let &t_SI="\\e[6 q" | let &t_SR="\\e[4 q" | let &t_EI="\\e[1 q"\' .',
      ],
      expect.objectContaining({
        name: 'xterm-256color',
        cols: 132,
        rows: 42,
        cwd: path.resolve('/tmp/repo'),
        env: expect.objectContaining({
          SHELL: '/bin/zsh',
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        }),
      }),
    )

    pty.emitData('hello')
    expect(emit).toHaveBeenCalledWith(CLI_EDITOR_TERMINAL_DATA_CHANNEL, {
      sessionId: 'terminal-1',
      data: 'hello',
    })

    service.write({ sessionId: 'terminal-1', data: ':q\r' })
    service.resize({ sessionId: 'terminal-1', cols: 140, rows: 50 })
    service.stop('terminal-1')

    expect(pty.writes).toEqual([':q\r'])
    expect(pty.resizes).toEqual([{ cols: 140, rows: 50 }])
    expect(pty.kills).toEqual([undefined])

    pty.emitExit({ exitCode: 0 })
    expect(emit).toHaveBeenCalledWith(CLI_EDITOR_TERMINAL_EXIT_CHANNEL, {
      sessionId: 'terminal-1',
      exitCode: 0,
      signal: undefined,
    })
    expect(service.has('terminal-1')).toBe(false)
  })

  it('leaves non-vim cli editor commands untouched', async () => {
    vi.stubEnv('SHELL', '/bin/zsh')

    const pty = new FakePty()
    const spawnPty = vi.fn(
      (_command: string, _args: string[], _options: PtySpawnOptions) => pty,
    )
    const service = new CliEditorTerminalService({
      spawnPty,
      detectEditors: async () => [
        {
          id: 'nvim',
          name: 'Neovim',
          kind: 'cli',
          target: 'nvim',
          binPath: '/opt/homebrew/bin/nvim',
        },
      ],
    })

    const session = await service.start(
      {
        sessionId: 'terminal-nvim',
        editorId: 'nvim',
        repoPath: '/tmp/repo',
      },
      vi.fn(),
    )

    expect(session.command).toBe('nvim .')
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-i', '-c', 'nvim .'],
      expect.any(Object),
    )
  })

  it('starts lazygit without appending a project path argument', async () => {
    vi.stubEnv('SHELL', '/bin/zsh')

    const pty = new FakePty()
    const spawnPty = vi.fn(
      (_command: string, _args: string[], _options: PtySpawnOptions) => pty,
    )
    const service = new CliEditorTerminalService({
      spawnPty,
      detectEditors: async () => [
        {
          id: 'lazygit',
          name: 'LazyGit',
          kind: 'cli',
          target: 'lazygit',
          binPath: '/opt/homebrew/bin/lazygit',
        },
      ],
    })

    const session = await service.start(
      {
        sessionId: 'terminal-lazygit',
        editorId: 'lazygit',
        repoPath: '/tmp/repo',
      },
      vi.fn(),
    )

    expect(session.command).toBe('lazygit')
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-i', '-c', 'lazygit'],
      expect.any(Object),
    )
  })

  it('spawns the user shell when editorId is the shell sentinel', async () => {
    vi.stubEnv('SHELL', '/bin/zsh')

    const pty = new FakePty()
    const spawnPty = vi.fn(
      (_command: string, _args: string[], _options: PtySpawnOptions) => pty,
    )
    const detectEditors = vi.fn(async () => cliEditors)
    const service = new CliEditorTerminalService({ spawnPty, detectEditors })

    const session = await service.start(
      {
        sessionId: 'terminal-shell',
        editorId: SHELL_TERMINAL_EDITOR_ID,
        repoPath: '/tmp/repo',
      },
      vi.fn(),
    )

    expect(session).toEqual({
      sessionId: 'terminal-shell',
      editorId: SHELL_TERMINAL_EDITOR_ID,
      editorName: 'Terminal',
      repoPath: path.resolve('/tmp/repo'),
      command: '/bin/zsh',
    })
    // Shell mode must not pay the cost of editor detection.
    expect(detectEditors).not.toHaveBeenCalled()
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-i'],
      expect.objectContaining({
        cwd: path.resolve('/tmp/repo'),
        env: expect.objectContaining({ SHELL: '/bin/zsh' }),
      }),
    )
  })

  it('rejects non-cli editors before spawning a terminal', async () => {
    const spawnPty = vi.fn()
    const service = new CliEditorTerminalService({
      spawnPty,
      detectEditors: async () => [
        {
          id: 'cursor',
          name: 'Cursor',
          kind: 'gui',
          target: 'Cursor',
        },
      ],
    })

    await expect(
      service.start(
        {
          editorId: 'cursor',
          repoPath: '/tmp/repo',
        },
        vi.fn(),
      ),
    ).rejects.toThrow('Cursor is not a terminal editor')
    expect(spawnPty).not.toHaveBeenCalled()
  })
})
