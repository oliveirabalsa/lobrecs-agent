import { describe, expect, it } from 'vitest'

import {
  createWinBuilderArgs,
  isWsl,
  resolveWindowsBuildDir,
  resolveWindowsUser,
  toWindowsPath,
} from './build-win.mjs'

describe('createWinBuilderArgs', () => {
  it('uses unsigned local Windows packaging args by default', () => {
    expect(createWinBuilderArgs()).toEqual([
      '--win',
      '--config.npmRebuild=false',
      '--config.win.signAndEditExecutable=false',
    ])
  })
})

describe('resolveWindowsUser', () => {
  it('throws when the Windows users directory is missing', () => {
    expect(() => resolveWindowsUser('/tmp/does-not-exist-win-users')).toThrow(
      /Windows user profile directory was not found/,
    )
  })
})

describe('resolveWindowsBuildDir', () => {
  it('places the Windows build workspace under the resolved user profile', () => {
    expect(
      resolveWindowsBuildDir({
        usersRoot: '/tmp/fake-users',
        windowsUser: 'Balsa',
      }),
    ).toBe('/tmp/fake-users/Balsa/lobrecs-agent-build')
  })
})

describe('toWindowsPath', () => {
  it('converts WSL mount paths to Windows drive paths', () => {
    expect(toWindowsPath('/mnt/c/Users/Balsa/lobrecs-agent-build')).toBe(
      'C:\\Users\\Balsa\\lobrecs-agent-build',
    )
  })
})

describe('isWsl', () => {
  it('returns false outside Linux', () => {
    expect(isWsl()).toBe(process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME))
  })
})
