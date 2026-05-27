import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DiffProposal } from '../../../../shared/types'
import {
  multitaskPlanOutcomeFromSessionStatus,
  renderStreamItem,
} from './activityRenderers'
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
}

describe('renderStreamItem diff actions', () => {
  it('renders edited files without an inline review callback', () => {
    const node = renderStreamItem(fileChange, 'change', {
      sessionId: 'session-1',
      running: false,
      diffProposals: [],
    })

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([])
  })

  it('keeps matching proposals on the edited-files card for row-level diffs', () => {
    const node = renderStreamItem(fileChange, 'change', {
      sessionId: 'session-1',
      running: false,
      diffProposals: [proposal],
    })

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([proposal])
  })

  it('matches relative file-change paths to absolute diff proposal paths', () => {
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
      },
    )

    const props = elementProps<EditedFilesCardElementProps>(node)

    expect(props.proposals).toEqual([htmlProposal])
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

  it('renders MCP calls with the MCP artifact instead of the generic tool pill', () => {
    const item = {
      kind: 'mcp-calls-group',
      id: 'turn-0-mcp-1',
      items: [
        {
          kind: 'tool-call',
          name: 'mcp__github__list_pull_requests',
          input: { repo: 'lobrecs-agent' },
          status: 'running',
        },
      ],
    } satisfies Extract<StreamItem, { kind: 'mcp-calls-group' }>

    const node = renderStreamItem(item, 'mcp', {
      sessionId: 'session-1',
      running: true,
    })
    const props = elementProps<{ items: typeof item.items; running?: boolean }>(node)

    expect(props.items).toBe(item.items)
    expect(props.running).toBe(true)
  })

  it('passes project and thread context into plan-review multitask controls', () => {
    const onSessionStarted = vi.fn()
    const item = {
      kind: 'plan-review',
      reviewId: 'review-1',
      agentId: 'codex',
      model: 'gpt-5.3-codex',
    } satisfies Extract<StreamItem, { kind: 'plan-review' }>

    const node = renderStreamItem(item, 'plan-review', {
      projectId: 'project-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      running: false,
      planReviewPlanText: 'Plan text',
      onSessionStarted,
    })
    const props = elementProps<{
      projectId: string
      threadId?: string
      sessionId: string
      planText?: string
      onMultitaskSessionStarted?: unknown
    }>(node)

    expect(props.projectId).toBe('project-1')
    expect(props.threadId).toBe('thread-1')
    expect(props.sessionId).toBe('session-1')
    expect(props.planText).toBe('Plan text')
    expect(props.onMultitaskSessionStarted).toBe(onSessionStarted)
  })

  it('renders replayed completed multitask plans as resolved artifacts', () => {
    const onDecisionSettled = vi.fn()
    const item = {
      kind: 'multitask-plan',
      planId: 'plan-1',
      originalPrompt: 'Build in parallel',
      totalEstimatedCostUsd: 0.02,
      decomposedBy: { agentId: 'codex', model: 'gpt-5.5' },
      tasks: [
        {
          id: 'task-1',
          title: 'API',
          description: 'Implement API',
          tier: 'frontier',
          agentId: 'codex',
          model: 'gpt-5.5',
        },
      ],
    } satisfies Extract<StreamItem, { kind: 'multitask-plan' }>

    const node = renderStreamItem(item, 'multitask', {
      sessionId: 'session-1',
      running: false,
      sessionStatus: 'done',
      onMultitaskDecisionSettled: onDecisionSettled,
    })
    const props = elementProps<{
      resolvedOutcome?: string | null
      onDecisionSettled?: unknown
    }>(node)

    expect(props.resolvedOutcome).toBe('approved')
    expect(props.onDecisionSettled).toBe(onDecisionSettled)
  })

  it('derives durable multitask plan outcomes from terminal session status', () => {
    expect(multitaskPlanOutcomeFromSessionStatus('done')).toBe('approved')
    expect(multitaskPlanOutcomeFromSessionStatus('cancelled')).toBe('rejected')
    expect(multitaskPlanOutcomeFromSessionStatus('error')).toBe('failed')
    expect(multitaskPlanOutcomeFromSessionStatus('running')).toBeNull()
  })
})
