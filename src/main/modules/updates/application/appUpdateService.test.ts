import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GithubReleaseAsset } from '../domain/githubRelease'

const quit = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    getPath: () => '/tmp',
    isPackaged: true,
    quit,
  },
  BrowserWindow: {
    getAllWindows: () => [] as Array<{ webContents: { send: () => void } }>,
  },
  shell: {
    openExternal: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
}))

import { AppUpdateService } from './appUpdateService'

afterEach(() => {
  vi.clearAllMocks()
})

function makeAsset(): GithubReleaseAsset {
  return {
    name: 'lobrecs-agent-1.2.3-mac-arm64.dmg',
    browser_download_url: 'https://example.com/lobrecs-agent.dmg',
    size: 1,
    content_type: 'application/octet-stream',
  }
}

describe('AppUpdateService', () => {
  it('quits the app after opening the downloaded installer', async () => {
    const downloader = {
      download: vi.fn(),
      openInstaller: vi.fn(),
      clear: vi.fn(),
    }
    const checker = {
      checkLatest: vi.fn().mockResolvedValue({
        hasUpdate: true,
        latestVersion: '1.2.3',
        publishedAt: '2026-05-24T00:00:00.000Z',
        releaseNotes: 'Release notes',
        asset: makeAsset(),
        releaseUrl: 'https://example.com/releases/tag/v1.2.3',
      }),
    }
    downloader.download.mockImplementation(async () => ({ filePath: '/tmp/lobrecs-agent.dmg' }))

    const service = new AppUpdateService(checker as never, downloader as never, true)

    await service.checkForUpdates()
    await service.downloadUpdate()
    await service.installDownloadedUpdate()

    expect(downloader.openInstaller).toHaveBeenCalledWith('/tmp/lobrecs-agent.dmg')
    expect(downloader.clear).not.toHaveBeenCalled()
    expect(quit).toHaveBeenCalledTimes(1)
    expect(downloader.openInstaller.mock.invocationCallOrder[0]).toBeLessThan(
      quit.mock.invocationCallOrder[0],
    )
  })

  it('clears stale downloaded installers on startup cleanup', async () => {
    const downloader = {
      download: vi.fn(),
      openInstaller: vi.fn(),
      clear: vi.fn(),
    }
    const checker = {
      checkLatest: vi.fn(),
    }

    const service = new AppUpdateService(checker as never, downloader as never, true)

    await service.clearStaleDownloadedUpdates()

    expect(downloader.clear).toHaveBeenCalledTimes(1)
  })
})
