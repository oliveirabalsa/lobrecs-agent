export interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  content_type: string
}

export interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string | null
  draft: boolean
  prerelease: boolean
  html_url: string
  assets: GithubReleaseAsset[]
}

export interface ReleaseRepo {
  owner: string
  repo: string
}

export const LOBRECS_AGENT_REPO: ReleaseRepo = {
  owner: 'oliveirabalsa',
  repo: 'lobrecs-agent',
}

export function releasesPageUrl(repo: ReleaseRepo = LOBRECS_AGENT_REPO): string {
  return `https://github.com/${repo.owner}/${repo.repo}/releases/latest`
}

export function latestReleaseApiUrl(repo: ReleaseRepo = LOBRECS_AGENT_REPO): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`
}
