import { describe, expect, it } from 'vitest'

import {
  createMacosCodeSigningErrorPatch,
  isMacosCodeSigningError,
} from './codeSigningErrors'

const shipItError = new Error(
  'Code signature at URL file:///Users/me/Library/Caches/com.lobrecs.agent.ShipIt/update/Lobrecs%20Agent.app/ did not pass validation: code failed to satisfy specified code requirement(s)',
)

describe('macOS code signing update errors', () => {
  it('detects Squirrel.Mac signature validation failures only on macOS', () => {
    expect(isMacosCodeSigningError(shipItError, 'darwin')).toBe(true)
    expect(isMacosCodeSigningError(shipItError, 'linux')).toBe(false)
  })

  it('creates a manual-download state patch for rejected macOS updates', () => {
    expect(
      createMacosCodeSigningErrorPatch(shipItError, {
        platform: 'darwin',
        releaseUrl: 'https://github.com/example/releases/latest',
      }),
    ).toMatchObject({
      phase: 'error',
      error: shipItError.message,
      canManualDownload: true,
      releaseUrl: 'https://github.com/example/releases/latest',
    })
  })

  it('ignores unrelated errors', () => {
    expect(
      createMacosCodeSigningErrorPatch(new Error('network failed'), {
        platform: 'darwin',
        releaseUrl: 'https://github.com/example/releases/latest',
      }),
    ).toBeNull()
  })
})
