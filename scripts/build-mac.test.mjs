import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  createElectronBuilderEnv,
  createElectronBuilderEnvContext,
  createMacBuilderArgs,
  resolvePublishToken,
  validateMacPublishEnvironment,
} from './build-mac.mjs'

const privateKey = '-----BEGIN PRIVATE KEY-----\nmock-key\n-----END PRIVATE KEY-----\n'
const privateKeyBase64 = Buffer.from(privateKey).toString('base64')

describe('createMacBuilderArgs', () => {
  it('uses unsigned local mac packaging args by default', () => {
    expect(createMacBuilderArgs()).toEqual(['--mac', '--arm64', '--x64', '--config.npmRebuild=false'])
  })

  it('forces signing and notarization for publish builds', () => {
    expect(createMacBuilderArgs(true)).toEqual([
      '--mac',
      '--arm64',
      '--x64',
      '--config.npmRebuild=false',
      '--publish',
      'always',
      '--config.mac.forceCodeSigning=true',
      '--config.mac.notarize=true',
    ])
  })

  it('rejects unsigned publish builds because macOS auto-update requires signing', () => {
    expect(() =>
      createMacBuilderArgs(true, { allowUnsignedPublish: true }),
    ).toThrowError(/Unsigned macOS builds cannot be published/)
  })

  it('keeps unsigned local builds local', () => {
    expect(createMacBuilderArgs(false, { allowUnsignedPublish: true })).toEqual([
      '--mac',
      '--arm64',
      '--x64',
      '--config.npmRebuild=false',
    ])
  })
})

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

  it('writes a base64 App Store Connect key to a temporary p8 file', () => {
    const writeFile = vi.fn()
    const removeDir = vi.fn()

    const context = createElectronBuilderEnvContext(
      {
        GITHUB_TOKEN: 'github-token',
        APPLE_API_KEY_BASE64: privateKeyBase64,
      },
      vi.fn(),
      {
        createTempDir: () => '/tmp/notary',
        writeFile,
        removeDir,
      },
    )

    expect(context.env.APPLE_API_KEY).toBe(path.join('/tmp/notary', 'AuthKey.p8'))
    expect(writeFile).toHaveBeenCalledWith(path.join('/tmp/notary', 'AuthKey.p8'), privateKey, {
      mode: 0o600,
    })

    context.cleanup()
    expect(removeDir).toHaveBeenCalledWith('/tmp/notary')
  })

  it('keeps an existing p8 APPLE_API_KEY path unchanged', () => {
    expect(
      createElectronBuilderEnv(
        {
          GITHUB_TOKEN: 'github-token',
          APPLE_API_KEY: '/tmp/AuthKey_TEST.p8',
        },
        vi.fn(),
      ),
    ).toMatchObject({
      APPLE_API_KEY: '/tmp/AuthKey_TEST.p8',
      GH_TOKEN: 'github-token',
    })
  })

  it('rejects malformed base64 App Store Connect keys before electron-builder runs', () => {
    expect(() =>
      createElectronBuilderEnv(
        {
          GITHUB_TOKEN: 'github-token',
          APPLE_API_KEY_BASE64: 'not-a-private-key',
        },
        vi.fn(),
      ),
    ).toThrowError(/APPLE_API_KEY_BASE64/)
  })
})

describe('validateMacPublishEnvironment', () => {
  const apiKeyNotarization = {
    APPLE_API_KEY: '/tmp/AuthKey_TEST.p8',
    APPLE_API_KEY_ID: 'key-id',
    APPLE_API_ISSUER: 'issuer-id',
  }

  it('accepts API key notarization credentials with certificate material from env', () => {
    expect(() =>
      validateMacPublishEnvironment(
        {
          ...apiKeyNotarization,
          CSC_LINK: '/tmp/developer-id.p12',
          CSC_KEY_PASSWORD: 'password',
        },
        { platform: 'linux' },
      ),
    ).not.toThrow()
  })

  it('accepts base64 API key notarization credentials with certificate material from env', () => {
    expect(() =>
      validateMacPublishEnvironment(
        {
          APPLE_API_KEY_BASE64: privateKeyBase64,
          APPLE_API_KEY_ID: 'key-id',
          APPLE_API_ISSUER: 'issuer-id',
          CSC_LINK: '/tmp/developer-id.p12',
        },
        { platform: 'linux' },
      ),
    ).not.toThrow()
  })

  it('rejects malformed base64 API key notarization credentials before version bumps', () => {
    expect(() =>
      validateMacPublishEnvironment(
        {
          APPLE_API_KEY_BASE64: 'not-a-private-key',
          APPLE_API_KEY_ID: 'key-id',
          APPLE_API_ISSUER: 'issuer-id',
          CSC_LINK: '/tmp/developer-id.p12',
        },
        { platform: 'linux' },
      ),
    ).toThrowError(/APPLE_API_KEY_BASE64/)
  })

  it('accepts Apple ID notarization credentials with a named signing identity', () => {
    expect(() =>
      validateMacPublishEnvironment(
        {
          APPLE_ID: 'developer@example.com',
          APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
          APPLE_TEAM_ID: 'TEAMID1234',
          CSC_NAME: 'Developer ID Application: Lobrecs',
        },
        { platform: 'linux' },
      ),
    ).not.toThrow()
  })

  it('accepts keychain notarization with a local macOS Developer ID identity', () => {
    const hasLocalDeveloperIdApplicationIdentity = vi.fn(() => true)

    expect(() =>
      validateMacPublishEnvironment(
        { APPLE_KEYCHAIN_PROFILE: 'lobrecs-notary' },
        { platform: 'darwin', hasLocalDeveloperIdApplicationIdentity },
      ),
    ).not.toThrow()
    expect(hasLocalDeveloperIdApplicationIdentity).toHaveBeenCalledOnce()
  })

  it('rejects publish builds without notarization credentials', () => {
    expect(() =>
      validateMacPublishEnvironment(
        { CSC_LINK: '/tmp/developer-id.p12' },
        { platform: 'linux' },
      ),
    ).toThrowError(/must be notarized/)
  })

  it('rejects publish builds without signing material', () => {
    expect(() =>
      validateMacPublishEnvironment(apiKeyNotarization, { platform: 'linux' }),
    ).toThrowError(/Developer ID Application certificate/)
  })

  it('does not rely on local identity discovery when auto discovery is disabled', () => {
    const hasLocalDeveloperIdApplicationIdentity = vi.fn(() => true)

    expect(() =>
      validateMacPublishEnvironment(
        {
          ...apiKeyNotarization,
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        },
        { platform: 'darwin', hasLocalDeveloperIdApplicationIdentity },
      ),
    ).toThrowError(/Developer ID Application certificate/)
    expect(hasLocalDeveloperIdApplicationIdentity).not.toHaveBeenCalled()
  })
})
