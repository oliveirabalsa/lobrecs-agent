import { describe, expect, it } from 'vitest'
import type { DiffProposal } from '../../../../shared/types'
import { removeProposal } from './diffProposals'

describe('removeProposal', () => {
  it('removes only the proposal matching the file path', () => {
    const proposals: DiffProposal[] = [
      createProposal('/tmp/a.ts'),
      createProposal('/tmp/b.ts'),
    ]

    expect(removeProposal(proposals, '/tmp/a.ts')).toEqual([proposals[1]])
  })
})

function createProposal(filePath: string): DiffProposal {
  return {
    filePath,
    originalContent: 'before',
    proposedContent: 'after',
  }
}
