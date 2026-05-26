import { describe, expect, it, vi } from 'vitest'
import { executeGitTuiAction } from './useGitTuiData'

describe('executeGitTuiAction', () => {
  it('creates a branch through the git bridge when a branch name is provided', async () => {
    const createBranch = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    const result = await executeGitTuiAction(
      'project-1',
      { type: 'create-branch', branchName: '  feat/native-branch  ' },
      { createBranch } as never,
    )

    expect(createBranch).toHaveBeenCalledWith('project-1', 'feat/native-branch')
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('blocks branch creation before IPC when the branch name is empty', async () => {
    const createBranch = vi.fn()

    const result = await executeGitTuiAction(
      'project-1',
      { type: 'create-branch', branchName: '   ' },
      { createBranch } as never,
    )

    expect(createBranch).not.toHaveBeenCalled()
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Branch name is required.',
    })
  })
})
