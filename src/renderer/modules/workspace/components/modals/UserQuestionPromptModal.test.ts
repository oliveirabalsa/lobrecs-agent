import { describe, expect, it } from 'vitest'
import type { UserQuestionActivity } from '../artifacts'
import { formatUserQuestionPromptAnswers } from './UserQuestionPromptModal'

describe('formatUserQuestionPromptAnswers', () => {
  it('formats selected options into a follow-up prompt', () => {
    const prompt: UserQuestionActivity = {
      kind: 'user-question',
      promptId: 'user-question:call-1',
      title: 'Agent questions',
      questions: [
        {
          id: 'question-1',
          header: 'Scope',
          question: 'Which areas should I focus?',
          multiSelect: true,
          options: [
            { id: 'option-1', label: 'Sidebar entrances' },
            { id: 'option-2', label: 'Message stream' },
          ],
        },
      ],
    }

    expect(
      formatUserQuestionPromptAnswers(prompt, [
        {
          questionId: 'question-1',
          header: 'Scope',
          question: 'Which areas should I focus?',
          selectedOptionIds: ['option-1', 'option-2'],
          selectedLabels: ['Sidebar entrances', 'Message stream'],
        },
      ]),
    ).toBe(
      [
        'Answers to your questions:',
        '',
        'Scope:',
        'Q: Which areas should I focus?',
        'A:',
        '- Sidebar entrances',
        '- Message stream',
        '',
        'Original prompt id: user-question:call-1',
      ].join('\n'),
    )
  })
})
