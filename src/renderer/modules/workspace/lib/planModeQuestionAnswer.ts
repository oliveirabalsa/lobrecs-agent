/**
 * Plan-mode question-answer detection.
 *
 * When the user answers questions from a plan-mode session, the answers are formatted
 * as raw text that renders poorly in the chat stream:
 *
 * ```
 * Answers to your questions:
 *
 * Q: <question text>
 * A: <answer text>
 *
 * Original prompt id: <opaque id>
 * ```
 *
 * This helper recognizes that shape so the renderer can swap in a formatted
 * component. It mirrors the structure of `swarmMessage.ts`: strictly
 * detecting only the expected artifact, returning `null` for anything else.
 */

export interface PlanModeQuestionAnswerView {
  questions: {
    question: string
    answer: string
  }[]
}

const QA_BLOCK_START = /^Answers to your questions:\s*/i
const TRAILING_ID_LINE = /^Original prompt id:\s*/
const QUESTION_PREFIX = /^Q:\s*/
const ANSWER_PREFIX = /^A:\s*/

/**
 * Detects the plan-mode question-answer format and parses it into a structured view.
 * Returns `null` for anything that doesn't match the expected pattern,
 * allowing the caller to fall back to plain markdown rendering.
 */
export function parsePlanModeQuestionAnswer(text: string): PlanModeQuestionAnswerView | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const lines = trimmed.split('\n')
  if (lines.length < 2) return null

  if (!QA_BLOCK_START.test(lines[0])) return null

  const questions: PlanModeQuestionAnswerView['questions'] = []
  let currentQuestion = ''
  let currentAnswer = ''
  let foundAnyQnA = false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const qMatch = line.match(QUESTION_PREFIX)
    const aMatch = line.match(ANSWER_PREFIX)

    if (qMatch) {
      if (currentQuestion && currentAnswer) {
        questions.push({ question: currentQuestion.trim(), answer: currentAnswer.trim() })
        foundAnyQnA = true
      }
      currentQuestion = line.slice(qMatch[0].length)
      currentAnswer = ''
      continue
    }

    if (aMatch) {
      currentAnswer = line.slice(aMatch[0].length)
      continue
    }

    if (TRAILING_ID_LINE.test(line)) {
      if (currentQuestion && currentAnswer) {
        questions.push({ question: currentQuestion.trim(), answer: currentAnswer.trim() })
        foundAnyQnA = true
      }
      break
    }

    if (currentQuestion && !currentAnswer) {
      currentQuestion += '\n' + line
    } else if (currentAnswer) {
      currentAnswer += '\n' + line
    }
  }

  if (!foundAnyQnA && currentQuestion && currentAnswer) {
    questions.push({ question: currentQuestion.trim(), answer: currentAnswer.trim() })
  }

  if (questions.length === 0) return null

  return { questions }
}

/**
 * Strips the trailing `Original prompt id:` line from question-answer text
 * while preserving the Q&A content.
 */
export function stripQuestionAnswerTrailingId(text: string): string {
  const lines = text.trim().split('\n')
  let lastNonEmptyIndex = lines.length - 1

  while (lastNonEmptyIndex >= 0 && !lines[lastNonEmptyIndex].trim()) {
    lastNonEmptyIndex--
  }

  if (lastNonEmptyIndex >= 0 && TRAILING_ID_LINE.test(lines[lastNonEmptyIndex])) {
    return lines.slice(0, lastNonEmptyIndex).join('\n').trim()
  }

  return text.trim()
}