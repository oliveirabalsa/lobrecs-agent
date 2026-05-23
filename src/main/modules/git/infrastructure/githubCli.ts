import type { CreatePullRequestInput } from '../../../../shared/contracts/git'
import { resolveExecutable } from '../../../process/environment'

export function resolveGhCommand(): string {
  return process.env.GH_COMMAND?.trim() || resolveExecutable('gh') || 'gh'
}

export function buildGhPrCreateArgs(
  input: Omit<CreatePullRequestInput, 'projectId'>,
): string[] {
  return [
    'pr',
    'create',
    '--title',
    input.title,
    '--body',
    input.body,
    '--base',
    input.baseBranch,
    '--head',
    input.headBranch,
  ]
}
