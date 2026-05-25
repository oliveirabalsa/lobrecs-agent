import type {
  GitBranchEntry,
  GitBranchState,
  GitCommitEntry,
  GitFileEntry,
  GitRemoteEntry,
  GitStashEntry,
  GitWorkspaceFileStatus,
} from '../../../../shared/contracts/git'

const STATUS_LABELS: Record<string, GitWorkspaceFileStatus> = {
  ' ': 'unchanged',
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'conflicted',
  '?': 'untracked',
  '!': 'unchanged',
}

export interface ParsedStatus {
  branch: GitBranchState
  files: GitFileEntry[]
}

export function parseStatusPorcelain(stdout: string): ParsedStatus {
  const branch: GitBranchState = {
    detached: false,
    ahead: 0,
    behind: 0,
  }
  const files: GitFileEntry[] = []

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine) continue

    if (rawLine.startsWith('## ')) {
      Object.assign(branch, parseStatusBranchLine(rawLine.slice(3)))
      continue
    }

    const indexCode = rawLine[0] ?? ' '
    const workingTreeCode = rawLine[1] ?? ' '
    const rawPath = rawLine.slice(3)
    const { path, previousPath } = parseStatusPath(rawPath)
    const conflict = isConflictStatus(indexCode, workingTreeCode)
    const stagedStatus = conflict ? 'conflicted' : normalizeStatusCode(indexCode)
    const unstagedStatus = conflict ? 'conflicted' : normalizeStatusCode(workingTreeCode)
    const untracked = indexCode === '?' && workingTreeCode === '?'

    files.push({
      id: path,
      path,
      previousPath,
      status: untracked
        ? 'untracked'
        : stagedStatus !== 'unchanged'
          ? stagedStatus
          : unstagedStatus,
      staged: !untracked && stagedStatus !== 'unchanged',
      stagedStatus: untracked ? 'unchanged' : stagedStatus,
      unstagedStatus: untracked ? 'untracked' : unstagedStatus,
      stage: untracked ? 'untracked' : stagedStatus !== 'unchanged' ? 'staged' : 'unstaged',
      conflict,
    })
  }

  return { branch, files }
}

export function parseBranchList(stdout: string): GitBranchEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream, headSha, lastCommitDate, lastCommitSubject, track] =
        line.split('\t')
      const counts = parseAheadBehind(track ?? '')

      return {
        name: name ?? '',
        current: head === '*',
        upstream: upstream || undefined,
        headSha: headSha || undefined,
        lastCommitDate: lastCommitDate || undefined,
        lastCommitSubject: lastCommitSubject || undefined,
        ahead: counts.ahead,
        behind: counts.behind,
      }
    })
    .filter((branch) => branch.name.length > 0)
}

export function parseCommitGraph(stdout: string): GitCommitEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const shaStart = line.search(/[a-f0-9]{40}\t/)
      const payload = shaStart >= 0 ? line.slice(shaStart) : line
      const graph = shaStart >= 0 ? line.slice(0, shaStart).trimEnd() : ''
      const [sha, shortSha, subject, author, date, refs] = payload.split('\t')

      return {
        sha: sha ?? '',
        hash: sha ?? '',
        shortSha: shortSha ?? '',
        shortHash: shortSha ?? '',
        subject: subject ?? '',
        summary: subject ?? '',
        author: author ?? '',
        date: date ?? '',
        refs: splitRefs(refs ?? ''),
        graph,
      }
    })
    .filter((commit) => commit.sha.length > 0)
}

export function parseStashList(stdout: string): GitStashEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [ref, sha, relativeDate, message] = line.split('\t')
      return {
        ref: ref ?? '',
        id: ref ?? '',
        index: parseStashIndex(ref ?? ''),
        sha: sha ?? '',
        relativeDate: relativeDate ?? '',
        date: relativeDate ?? '',
        message: message ?? '',
      }
    })
    .filter((entry) => entry.ref.length > 0)
}

export function parseRemotes(stdout: string): GitRemoteEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?<name>\S+)\s+(?<url>\S+)\s+\((?<direction>fetch|push)\)$/.exec(line)
      if (!match?.groups) return null

      return {
        name: match.groups.name,
        url: match.groups.url,
        direction: match.groups.direction as 'fetch' | 'push',
      }
    })
    .filter((remote): remote is GitRemoteEntry => remote !== null)
}

function parseStatusBranchLine(line: string): GitBranchState {
  if (line.startsWith('HEAD ')) {
    return {
      detached: true,
      headSha: parseDetachedHead(line),
      ahead: 0,
      behind: 0,
    }
  }

  const [branchPart, trackingPart = ''] = line.split('...')
  const upstreamMatch = /^(?<upstream>[^\s]+)(?:\s+\[(?<track>.+)\])?$/.exec(trackingPart)
  const counts = parseAheadBehind(upstreamMatch?.groups?.track ?? '')

  return {
    currentBranch: branchPart.trim(),
    upstreamBranch: upstreamMatch?.groups?.upstream,
    detached: false,
    ahead: counts.ahead,
    behind: counts.behind,
  }
}

function parseDetachedHead(line: string): string | undefined {
  const match = /^HEAD \(no branch\)(?:\s+\[(?<sha>[a-f0-9]+)\])?/.exec(line)
  return match?.groups?.sha
}

function parseStatusPath(rawPath: string): { path: string; previousPath?: string } {
  const renameSeparator = ' -> '
  const separatorIndex = rawPath.indexOf(renameSeparator)
  if (separatorIndex === -1) return { path: unquotePath(rawPath) }

  return {
    previousPath: unquotePath(rawPath.slice(0, separatorIndex)),
    path: unquotePath(rawPath.slice(separatorIndex + renameSeparator.length)),
  }
}

function normalizeStatusCode(code: string): GitWorkspaceFileStatus {
  return STATUS_LABELS[code] ?? 'modified'
}

function isConflictStatus(indexCode: string, workingTreeCode: string): boolean {
  return (
    indexCode === 'U' ||
    workingTreeCode === 'U' ||
    (indexCode === 'A' && workingTreeCode === 'A') ||
    (indexCode === 'D' && workingTreeCode === 'D')
  )
}

function parseAheadBehind(text: string): { ahead: number; behind: number } {
  return {
    ahead: parseTrackCount(text, 'ahead'),
    behind: parseTrackCount(text, 'behind'),
  }
}

function parseTrackCount(text: string, key: 'ahead' | 'behind'): number {
  const match = new RegExp(`${key} (\\d+)`).exec(text)
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0
}

function splitRefs(refs: string): string[] {
  return refs
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)
}

function parseStashIndex(ref: string): number {
  const match = /^stash@\{(\d+)\}$/.exec(ref)
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0
}

function unquotePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed

  try {
    return JSON.parse(trimmed) as string
  } catch {
    return trimmed.slice(1, -1)
  }
}
