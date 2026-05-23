import { describe, expect, it } from 'vitest'
import {
  parsePlanModeQuestionAnswer,
  stripQuestionAnswerTrailingId,
} from './planModeQuestionAnswer'

describe('parsePlanModeQuestionAnswer', () => {
  it('parses a single question-answer pair', () => {
    const input = `Answers to your questions:

Q: Which areas should I focus?
A: Backend services

Original prompt id: user-question:abc123`
    expect(parsePlanModeQuestionAnswer(input)).toEqual({
      questions: [{ question: 'Which areas should I focus?', answer: 'Backend services' }],
    })
  })

  it('parses multiple question-answer pairs', () => {
    const input = `Answers to your questions:

Q: Which area?
A: Frontend

Q: Which terminal?
A: alacritty

Original prompt id: user-question:xyz789`
    expect(parsePlanModeQuestionAnswer(input)).toEqual({
      questions: [
        { question: 'Which area?', answer: 'Frontend' },
        { question: 'Which terminal?', answer: 'alacritty' },
      ],
    })
  })

  it('handles multiline answers', () => {
    const input = `Answers to your questions:

Q: What approach?
A: Option A:
- First step
- Second step

Original prompt id: user-question:multi`
    expect(parsePlanModeQuestionAnswer(input)).toEqual({
      questions: [
        {
          question: 'What approach?',
          answer: 'Option A:\n- First step\n- Second step',
        },
      ],
    })
  })

  it('handles free-text answers without option prefix', () => {
    const input = `Answers to your questions:

Q: Additional context?
A: Please also check the documentation

Original prompt id: user-question:free`
    expect(parsePlanModeQuestionAnswer(input)).toEqual({
      questions: [
        {
          question: 'Additional context?',
          answer: 'Please also check the documentation',
        },
      ],
    })
  })

  it('handles answer with multiple selected labels', () => {
    const input = `Answers to your questions:

Q: Select options?
A: Option one
- Alpha
- Beta
Original prompt id: user-question:multi-select`
    expect(parsePlanModeQuestionAnswer(input)?.questions[0].answer).toBe(
      'Option one\n- Alpha\n- Beta',
    )
  })

  it('returns null for non-plan-mode content', () => {
    expect(parsePlanModeQuestionAnswer('Hello world')).toBeNull()
    expect(parsePlanModeQuestionAnswer('')).toBeNull()
    expect(parsePlanModeQuestionAnswer('Q: What? A: This')).toBeNull()
  })

  it('returns null when missing Q: prefix', () => {
    const input = `Answers to your questions:

Just a regular message

Original prompt id: user-question:abc`
    expect(parsePlanModeQuestionAnswer(input)).toBeNull()
  })
})

describe('stripQuestionAnswerTrailingId', () => {
  it('removes the trailing prompt id line', () => {
    const input = `Answers to your questions:

Q: Which area?
A: Frontend

Original prompt id: user-question:abc123`

    const stripped = stripQuestionAnswerTrailingId(input)
    expect(stripped).not.toContain('Original prompt id')
    expect(stripped).toContain('Answers to your questions')
    expect(stripped).toContain('Q: Which area?')
    expect(stripped).toContain('A: Frontend')
  })

  it('preserves input when no trailing id exists', () => {
    const input = `Q: Which area?
A: Frontend`

    expect(stripQuestionAnswerTrailingId(input)).toBe(input)
  })
})