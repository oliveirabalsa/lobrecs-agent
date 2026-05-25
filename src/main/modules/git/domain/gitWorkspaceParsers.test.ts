import { describe, expect, it } from 'vitest'
import {
  parseBranchList,
  parseCommitGraph,
  parseRemotes,
  parseStashList,
  parseStatusPorcelain,
} from './gitWorkspaceParsers'

describe('gitWorkspaceParsers', () => {
  it('parses porcelain branch metadata and file states', () => {
    const parsed = parseStatusPorcelain(
      [
        '## feature/native-git...origin/feature/native-git [ahead 2, behind 1]',
        ' M src/unstaged.ts',
        'M  src/staged.ts',
        'R  src/old.ts -> src/new.ts',
        '?? src/new-file.ts',
        'UU src/conflict.ts',
      ].join('\n'),
    )

    expect(parsed.branch).toMatchObject({
      currentBranch: 'feature/native-git',
      upstreamBranch: 'origin/feature/native-git',
      detached: false,
      ahead: 2,
      behind: 1,
    })
    expect(parsed.files).toEqual([
      {
        id: 'src/unstaged.ts',
        path: 'src/unstaged.ts',
        status: 'modified',
        staged: false,
        stagedStatus: 'unchanged',
        unstagedStatus: 'modified',
        stage: 'unstaged',
        conflict: false,
      },
      {
        id: 'src/staged.ts',
        path: 'src/staged.ts',
        status: 'modified',
        staged: true,
        stagedStatus: 'modified',
        unstagedStatus: 'unchanged',
        stage: 'staged',
        conflict: false,
      },
      {
        id: 'src/new.ts',
        path: 'src/new.ts',
        previousPath: 'src/old.ts',
        status: 'renamed',
        staged: true,
        stagedStatus: 'renamed',
        unstagedStatus: 'unchanged',
        stage: 'staged',
        conflict: false,
      },
      {
        id: 'src/new-file.ts',
        path: 'src/new-file.ts',
        status: 'untracked',
        staged: false,
        stagedStatus: 'unchanged',
        unstagedStatus: 'untracked',
        stage: 'untracked',
        conflict: false,
      },
      {
        id: 'src/conflict.ts',
        path: 'src/conflict.ts',
        status: 'conflicted',
        staged: true,
        stagedStatus: 'conflicted',
        unstagedStatus: 'conflicted',
        stage: 'staged',
        conflict: true,
      },
    ])
  })

  it('parses branch list rows with upstream tracking counts', () => {
    const branches = parseBranchList(
      [
        '*\tmain\torigin/main\tabc123\t2026-05-24 10:00:00 +0000\tinit\t[ahead 1]',
        ' \tfeature/git\torigin/feature/git\tdef456\t2026-05-24 11:00:00 +0000\tgit ui\t[behind 2]',
      ].join('\n'),
    )

    expect(branches).toEqual([
      {
        name: 'main',
        current: true,
        upstream: 'origin/main',
        headSha: 'abc123',
        lastCommitDate: '2026-05-24 10:00:00 +0000',
        lastCommitSubject: 'init',
        ahead: 1,
        behind: 0,
      },
      {
        name: 'feature/git',
        current: false,
        upstream: 'origin/feature/git',
        headSha: 'def456',
        lastCommitDate: '2026-05-24 11:00:00 +0000',
        lastCommitSubject: 'git ui',
        ahead: 0,
        behind: 2,
      },
    ])
  })

  it('parses graph commits, stash entries, and remotes', () => {
    expect(
      parseCommitGraph(
        '* 0123456789abcdef0123456789abcdef01234567\t0123456\tfeat: git\tAda\t2026-05-24T10:00:00Z\tHEAD -> main, origin/main',
      ),
    ).toEqual([
      {
        sha: '0123456789abcdef0123456789abcdef01234567',
        hash: '0123456789abcdef0123456789abcdef01234567',
        shortSha: '0123456',
        shortHash: '0123456',
        subject: 'feat: git',
        summary: 'feat: git',
        author: 'Ada',
        date: '2026-05-24T10:00:00Z',
        refs: ['HEAD -> main', 'origin/main'],
        graph: '*',
      },
    ])

    expect(parseStashList('stash@{0}\tabc123\t2 minutes ago\tWIP on main: init')).toEqual([
      {
        ref: 'stash@{0}',
        id: 'stash@{0}',
        index: 0,
        sha: 'abc123',
        relativeDate: '2 minutes ago',
        date: '2 minutes ago',
        message: 'WIP on main: init',
      },
    ])

    expect(
      parseRemotes('origin\tgit@github.com:owner/repo.git (fetch)\norigin\tgit@github.com:owner/repo.git (push)'),
    ).toEqual([
      {
        name: 'origin',
        url: 'git@github.com:owner/repo.git',
        direction: 'fetch',
      },
      {
        name: 'origin',
        url: 'git@github.com:owner/repo.git',
        direction: 'push',
      },
    ])
  })
})
