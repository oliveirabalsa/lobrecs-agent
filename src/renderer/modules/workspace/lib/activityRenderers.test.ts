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

  it('matches relative file-change paths to absolute diff proposal paths', () => {
    const onReview = vi.fn()
    const htmlProposal: DiffProposal = {
      filePath: '/Users/leo/project/index.html',
      originalContent: '<h1>Old</h1>\n',
      proposedContent: '<h1>New</h1>\n',
      additions: 1,
      deletions: 1,
    }

    const node = renderStreamItem(
      {
        kind: 'file-change',
        filePath: '/repo/index.html',
        changeType: 'modified',
        status: 'applied',
      },
      'change',
      {
        sessionId: 'session-1',
        running: false,
        diffProposals: [htmlProposal],
        onReviewFile: onReview,
      },
    )

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([htmlProposal])
    expect(props.onReview).toBe(onReview)
  })

  it('renders agent question prompts as answerable cards', () => {
    const onAnswer = vi.fn()
    const prompt = {
      kind: 'user-question',
      promptId: 'user-question:1',
      title: 'Agent questions',
      questions: [
        {
          id: 'question-1',
          header: 'Scope',
          question: 'Which area?',
          multiSelect: false,
          options: [{ id: 'option-1', label: 'Sidebar' }],
        },
      ],
    } satisfies Extract<StreamItem, { kind: 'user-question' }>

    const node = renderStreamItem(prompt, 'question', {
      sessionId: 'session-1',
      running: false,
      pendingUserQuestionPromptId: prompt.promptId,
      onAnswerUserQuestion: onAnswer,
    })

    const props = elementProps<{ prompt: typeof prompt; active?: boolean; onAnswer?: unknown }>(node)

    expect(props.prompt).toBe(prompt)
    expect(props.active).toBe(true)
    expect(props.onAnswer).toBe(onAnswer)
  })

  it('renders raw AskUserQuestion tool calls as answerable cards', () => {
    const onAnswer = vi.fn()
    const item = {
      kind: 'tool-call',
      name: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: 'Which terminal?',
            options: [{ label: 'Bottom pane' }],
          },
        ],
      },
      status: 'running',
    } satisfies Extract<StreamItem, { kind: 'tool-call' }>

    const node = renderStreamItem(item, 'question-tool', {
      sessionId: 'session-1',
      running: false,
      onAnswerUserQuestion: onAnswer,
    })
    const props = elementProps<{
      prompt: Extract<StreamItem, { kind: 'user-question' }>
      onAnswer?: unknown
    }>(node)

    expect(props.prompt).toMatchObject({
      kind: 'user-question',
      questions: [expect.objectContaining({ question: 'Which terminal?' })],
    })
    expect(props.onAnswer).toBe(onAnswer)
  })
})
