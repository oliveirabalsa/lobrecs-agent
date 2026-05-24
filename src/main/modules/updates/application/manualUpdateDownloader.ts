import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net, shell } from 'electron'
import type { GithubReleaseAsset } from '../domain/githubRelease'

export interface DownloadProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type DownloadProgressListener = (progress: DownloadProgress) => void

export interface DownloadResult {
  filePath: string
}

const PROGRESS_INTERVAL_MS = 250

export class ManualUpdateDownloader {
  constructor(
    private readonly downloadDir: string = join(
      app.getPath('userData'),
      'pending-updates',
    ),
  ) {}

  async download(
    asset: GithubReleaseAsset,
    onProgress: DownloadProgressListener,
  ): Promise<DownloadResult> {
    await mkdir(this.downloadDir, { recursive: true })
    const filePath = join(this.downloadDir, asset.name)

    if (await this.alreadyDownloaded(filePath, asset.size)) {
      onProgress({
        percent: 100,
        transferred: asset.size,
        total: asset.size,
        bytesPerSecond: 0,
      })
      return { filePath }
    }

    await this.streamToDisk(asset, filePath, onProgress)
    return { filePath }
  }

  async openInstaller(filePath: string): Promise<void> {
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  }

  async clear(): Promise<void> {
    await rm(this.downloadDir, { recursive: true, force: true })
  }

  private async alreadyDownloaded(filePath: string, expectedSize: number): Promise<boolean> {
    try {
      const stats = await stat(filePath)
      return stats.isFile() && stats.size === expectedSize
    } catch {
      return false
    }
  }

  private async streamToDisk(
    asset: GithubReleaseAsset,
    filePath: string,
    onProgress: DownloadProgressListener,
  ): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })

    const response = await net.fetch(asset.browser_download_url, {
      method: 'GET',
      headers: { 'User-Agent': 'lobrecs-agent-updater' },
      redirect: 'follow',
    })

    if (!response.ok || !response.body) {
      throw new Error(`Asset download failed (${response.status})`)
    }

    const total = Number(response.headers.get('content-length')) || asset.size
    let transferred = 0
    const startedAt = Date.now()
    let lastEmit = 0

    const trackedSource = new Readable({
      read() {},
    })

    const reader = response.body.getReader()
    const pump = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            trackedSource.push(null)
            return
          }
          transferred += value.byteLength
          trackedSource.push(Buffer.from(value))

          const now = Date.now()
          if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now
            const elapsed = Math.max(1, now - startedAt) / 1000
            onProgress({
              percent: total > 0 ? (transferred / total) * 100 : 0,
              transferred,
              total,
              bytesPerSecond: transferred / elapsed,
            })
          }
        }
      } catch (error) {
        trackedSource.destroy(error as Error)
      }
    }

    const writer = createWriteStream(filePath)
    const pumpPromise = pump()
    await pipeline(trackedSource, writer)
    await pumpPromise

    onProgress({
      percent: 100,
      transferred,
      total: total || transferred,
      bytesPerSecond: 0,
    })
  }
}
