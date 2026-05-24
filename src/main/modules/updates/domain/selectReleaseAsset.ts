import type { GithubReleaseAsset } from './githubRelease'

export interface AssetSelectionContext {
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
}

/**
 * Picks the GitHub release asset that matches the current platform and arch.
 *
 * Artifacts published by this project follow the pattern:
 *   `lobrecs-agent-${version}-${os}-${arch}.${ext}`
 *
 * Examples:
 *   lobrecs-agent-0.4.12-mac-arm64.dmg
 *   lobrecs-agent-0.4.12-mac-x64.dmg
 *   lobrecs-agent-0.4.12-win-x64.exe
 *   lobrecs-agent-0.4.12-linux-amd64.deb
 *   lobrecs-agent-0.4.12-linux-x86_64.AppImage
 *
 * Decisions you need to make:
 *   - macOS: prefer `.dmg` (drag-to-Applications UI) over `.zip`.
 *   - Windows: only `.exe` (NSIS installer) is published — keep it simple.
 *   - Linux: this codebase emits BOTH `.deb` and `.AppImage`. Which do we
 *     prefer? AppImage runs without root and is portable; .deb integrates
 *     with apt/dpkg but needs sudo. Make a call and document it inline.
 *   - Arch naming asymmetry: `process.arch === 'x64'` matches:
 *       * `x64` in mac DMG names
 *       * `x64` in win EXE names
 *       * `amd64` in linux DEB names
 *       * `x86_64` in linux AppImage names
 *     Plan for this.
 *
 * Return `null` if no matching asset exists — the caller will surface a
 * "no asset for your platform" error to the user.
 */
export function selectReleaseAsset(
  assets: GithubReleaseAsset[],
  context: AssetSelectionContext,
): GithubReleaseAsset | null {
  const candidates = assets.filter((asset) => isInstallableAsset(asset.name))
  const preferences = assetPreferencesFor(context)

  for (const preference of preferences) {
    for (const extension of preference.extensions) {
      const match = candidates.find((asset) =>
        assetMatchesPreference(asset.name, preference, extension),
      )
      if (match) {
        return match
      }
    }
  }

  return null
}

interface AssetPreference {
  os: string
  archAliases: readonly string[]
  extensions: readonly string[]
}

function assetPreferencesFor(context: AssetSelectionContext): AssetPreference[] {
  if (context.platform === 'darwin') {
    return [
      {
        os: 'mac',
        archAliases: archAliasesFor(context.arch),
        extensions: ['.dmg', '.zip'],
      },
    ]
  }

  if (context.platform === 'win32') {
    return [
      {
        os: 'win',
        archAliases: archAliasesFor(context.arch),
        extensions: ['.exe'],
      },
    ]
  }

  if (context.platform === 'linux') {
    return [
      {
        os: 'linux',
        archAliases: archAliasesFor(context.arch),
        // Prefer AppImage because it runs without sudo and is portable across
        // common distributions; fall back to .deb when that is all we publish.
        extensions: ['.appimage', '.deb'],
      },
    ]
  }

  return []
}

function archAliasesFor(arch: NodeJS.Architecture): string[] {
  if (arch === 'x64') {
    return ['x64', 'amd64', 'x86_64']
  }

  if (arch === 'arm64') {
    return ['arm64', 'aarch64']
  }

  return [arch]
}

function isInstallableAsset(name: string): boolean {
  const normalizedName = name.toLowerCase()
  return !(
    normalizedName.endsWith('.blockmap') ||
    normalizedName.endsWith('.yml') ||
    normalizedName.endsWith('.yaml')
  )
}

function assetMatchesPreference(
  name: string,
  preference: AssetPreference,
  extension: string,
): boolean {
  const normalizedName = name.toLowerCase()

  return preference.archAliases.some((arch) =>
    normalizedName.endsWith(`-${preference.os}-${arch.toLowerCase()}${extension}`),
  )
}
