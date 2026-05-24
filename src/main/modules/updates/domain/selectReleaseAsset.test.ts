import { describe, expect, it } from 'vitest'
import type { GithubReleaseAsset } from './githubRelease'
import { selectReleaseAsset } from './selectReleaseAsset'

function asset(name: string): GithubReleaseAsset {
  return {
    name,
    browser_download_url: `https://example.com/${name}`,
    size: 1,
    content_type: 'application/octet-stream',
  }
}

const ALL_ASSETS: GithubReleaseAsset[] = [
  asset('lobrecs-agent-0.4.12-mac-arm64.dmg'),
  asset('lobrecs-agent-0.4.12-mac-arm64.zip'),
  asset('lobrecs-agent-0.4.12-mac-arm64.dmg.blockmap'),
  asset('lobrecs-agent-0.4.12-mac-x64.dmg'),
  asset('lobrecs-agent-0.4.12-mac-x64.zip'),
  asset('lobrecs-agent-0.4.12-win-x64.exe'),
  asset('lobrecs-agent-0.4.12-win-x64.exe.blockmap'),
  asset('lobrecs-agent-0.4.12-linux-amd64.deb'),
  asset('lobrecs-agent-0.4.12-linux-x86_64.AppImage'),
  asset('latest-mac.yml'),
  asset('latest.yml'),
]

describe('selectReleaseAsset', () => {
  it('prefers the .dmg over the .zip on macOS arm64', () => {
    const picked = selectReleaseAsset(ALL_ASSETS, { platform: 'darwin', arch: 'arm64' })
    expect(picked?.name).toBe('lobrecs-agent-0.4.12-mac-arm64.dmg')
  })

  it('picks the x64 DMG on Intel Macs', () => {
    const picked = selectReleaseAsset(ALL_ASSETS, { platform: 'darwin', arch: 'x64' })
    expect(picked?.name).toBe('lobrecs-agent-0.4.12-mac-x64.dmg')
  })

  it('picks the NSIS installer on Windows', () => {
    const picked = selectReleaseAsset(ALL_ASSETS, { platform: 'win32', arch: 'x64' })
    expect(picked?.name).toBe('lobrecs-agent-0.4.12-win-x64.exe')
  })

  it('prefers a portable AppImage for Linux x64 hosts', () => {
    const picked = selectReleaseAsset(ALL_ASSETS, { platform: 'linux', arch: 'x64' })
    expect(picked?.name).toBe('lobrecs-agent-0.4.12-linux-x86_64.AppImage')
  })

  it('never returns a .blockmap or metadata file', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const picked = selectReleaseAsset(ALL_ASSETS, { platform, arch: 'x64' })
      expect(picked?.name).not.toMatch(/\.(blockmap|yml)$/)
    }
  })

  it('returns null when no asset matches the platform', () => {
    const macOnly = ALL_ASSETS.filter((a) => a.name.includes('mac-arm64'))
    const picked = selectReleaseAsset(macOnly, { platform: 'win32', arch: 'x64' })
    expect(picked).toBeNull()
  })
})
