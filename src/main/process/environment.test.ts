import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildProcessEnvironment,
  buildExecutableSearchPath,
  getUserShell,
} from './environment'

describe('process environment', () => {
  it('adds the current Node runtime directory to packaged child process PATH', () => {
    const searchPath = buildExecutableSearchPath('/usr/bin')
    const entries = searchPath.split(path.delimiter)

    expect(entries).toContain('/usr/bin')
    expect(entries).toContain(path.dirname(process.execPath))
  })

  it('preserves overrides while hydrating executable lookup paths', () => {
    const env = buildProcessEnvironment({ PATH: '/bin', CUSTOM_ENV: '1' })

    expect(env.CUSTOM_ENV).toBe('1')
    expect(env.PATH?.split(path.delimiter)).toContain(path.dirname(process.execPath))
  })

  it('prefers the configured user shell when SHELL is present', () => {
    expect(getUserShell({ SHELL: '/opt/homebrew/bin/zsh' })).toBe('/opt/homebrew/bin/zsh')
  })

  it('falls back to the platform default shell when SHELL is missing', () => {
    const expectedShell =
      process.platform === 'darwin'
        ? '/bin/zsh'
        : process.platform === 'linux'
          ? '/bin/bash'
          : process.platform === 'win32'
            ? 'cmd.exe'
            : '/bin/sh'

    expect(getUserShell({})).toBe(expectedShell)
  })
})
