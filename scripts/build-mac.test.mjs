import { describe, expect, it, vi } from 'vitest'

import {
  createElectronBuilderEnv,
  resolvePublishToken,
} from './build-mac.mjs'

describe('resolvePublishToken', () => {
  it('prefers GH_TOKEN from the environment', () => {
    const getGhToken = vi.fn(() => 'cli-token')

    expect(
      resolvePublishToken(
        { GH_TOKEN: ' env-token ', GITHUB_TOKEN: 'fallback-token' },
        getGhToken,
      ),
    ).toBe('env-token')
    expect(getGhToken).not.toHaveBeenCalled()
  })

  it('falls back to GITHUB_TOKEN when GH_TOKEN is missing', () => {
    expect(resolvePublishToken({ GITHUB_TOKEN: ' github-token ' }, vi.fn())).toBe(
      'github-token',
    )
  })

  it('reads and trims the GitHub CLI token when env vars are missing', () => {
    expect(resolvePublishToken({}, () => ' cli-token \n')).toBe('cli-token')
  })

  it('throws a helpful error when no token source is available', () => {
    expect(() => resolvePublishToken({}, () => '')).toThrowError(
      /Publishing requires GH_TOKEN or GITHUB_TOKEN/,
    )
  })
})

describe('createElectronBuilderEnv', () => {
  it('injects GH_TOKEN for electron-builder without dropping other env vars', () => {
    expect(
      createElectronBuilderEnv(
        { PATH: '/tmp/bin', GITHUB_TOKEN: 'github-token' },
        vi.fn(),
      ),
    ).toEqual({
      PATH: '/tmp/bin',
      GITHUB_TOKEN: 'github-token',
      GH_TOKEN: 'github-token',
    })
  })
})
