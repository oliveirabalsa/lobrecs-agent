import type { AppUpdateState } from '../../../../shared/types'

const MACOS_SIGNATURE_FAILURE_FRAGMENTS = [
  'code failed to satisfy specified code requirement',
  'did not pass validation',
]

interface CodeSigningErrorPatchOptions {
  platform?: NodeJS.Platform | string
  releaseUrl: string
}

export function isMacosCodeSigningError(
  error: unknown,
  platform: NodeJS.Platform | string = process.platform,
): boolean {
  if (platform !== 'darwin') return false

  const message = errorMessage(error)
  return MACOS_SIGNATURE_FAILURE_FRAGMENTS.some((fragment) =>
    message.includes(fragment),
  )
}

export function createMacosCodeSigningErrorPatch(
  error: unknown,
  options: CodeSigningErrorPatchOptions,
): Partial<AppUpdateState> | null {
  if (!isMacosCodeSigningError(error, options.platform)) return null

  return {
    phase: 'error',
    progress: undefined,
    error: errorMessage(error),
    message:
      'macOS rejected the downloaded update signature. Download the release from GitHub and replace the app manually, or publish a Developer ID signed and notarized build for automatic updates.',
    canManualDownload: true,
    releaseUrl: options.releaseUrl,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
