import type { DiffProposal } from '../../../../shared/types'

export function removeProposal(proposals: DiffProposal[], filePath: string): DiffProposal[] {
  return proposals.filter((proposal) => proposal.filePath !== filePath)
}
