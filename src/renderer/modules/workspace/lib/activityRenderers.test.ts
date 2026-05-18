import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DiffProposal } from '../../../../shared/types'
import { renderStreamItem } from './activityRenderers'
import type { StreamItem } from './groupTurns'

function elementProps<T>(node: ReactNode): T {
  if (!isValidElement(node)) {
    throw new Error('Expected a React element')
  }
  return node.props as T
}

const fileChange = {
  kind: 'file-change',
  filePath: 'src/example.ts',
  changeType: 'modified',
  additions: 2,
  deletions: 1,
  status: 'pending',
} satisfies Extract<StreamItem, { kind: 'file-change' }>

const proposal: DiffProposal = {
  filePath: fileChange.filePath,
  originalContent: 'old',
  proposedContent: 'new',
  additions: fileChange.additions,
  deletions: fileChange.deletions,
}

interface EditedFilesCardElementProps {
  proposals: DiffProposal[]
  onReview?: (filePath?: string) => void
}

describe('renderStreamItem diff actions', () => {
  it('does not wire review or diff decision callbacks before a live proposal exists', () => {
    const node = renderStreamItem(fileChange, 'change', {
      sessionId: 'session-1',
      running: false,
      diffProposals: [],
      onReviewFile: vi.fn(),
    })

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([])
    expect(props.onReview).toBeUndefined()
  })

  it('wires only review callbacks when a matching proposal exists', () => {
    const onReview = vi.fn()

    const node = renderStreamItem(fileChange, 'change', {
      sessionId: 'session-1',
      running: false,
      diffProposals: [proposal],
      onReviewFile: onReview,
    })

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([proposal])
    expect(props.onReview).toBe(onReview)
  })
})
