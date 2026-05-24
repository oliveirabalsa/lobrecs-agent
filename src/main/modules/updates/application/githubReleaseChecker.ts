import { app, net } from 'electron'
import {
  type GithubRelease,
  type GithubReleaseAsset,
  LOBRECS_AGENT_REPO,
  latestReleaseApiUrl,
  type ReleaseRepo,
} from '../domain/githubRelease'
import { isNewerVersion, normalizeVersion } from '../domain/compareVersions'
import {
  type AssetSelectionContext,
  selectReleaseAsset,
} from '../domain/selectReleaseAsset'

export interface CheckOutcome {
  hasUpdate: boolean
  latestVersion: string
  publishedAt?: string
  releaseNotes?: string
  releaseUrl: string
  asset?: GithubReleaseAsset
}

export interface GithubReleaseFetcher {
  fetch(url: string): Promise<GithubRelease>
}

export class HttpsGithubReleaseFetcher implements GithubReleaseFetcher {
  async fetch(url: string): Promise<GithubRelease> {
    const response = await net.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lobrecs-agent-updater',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub release lookup failed (${response.status})`)
    }

    return (await response.json()) as GithubRelease
  }
}

export class GithubReleaseChecker {
  constructor(
    private readonly repo: ReleaseRepo = LOBRECS_AGENT_REPO,
    private readonly fetcher: GithubReleaseFetcher = new HttpsGithubReleaseFetcher(),
    private readonly currentVersion: string = app.getVersion(),
    private readonly assetContext: AssetSelectionContext = {
      platform: process.platform,
      arch: process.arch,
    },
  ) {}

  async checkLatest(): Promise<CheckOutcome> {
    const release = await this.fetcher.fetch(latestReleaseApiUrl(this.repo))
    const latestVersion = normalizeVersion(release.tag_name)
    const hasUpdate = isNewerVersion(latestVersion, this.currentVersion)
    const asset = hasUpdate
      ? (selectReleaseAsset(release.assets, this.assetContext) ?? undefined)
      : undefined

    return {
      hasUpdate,
      latestVersion,
      publishedAt: release.published_at ?? undefined,
      releaseNotes: release.body ?? undefined,
      releaseUrl: release.html_url,
      asset,
    }
  }
}
