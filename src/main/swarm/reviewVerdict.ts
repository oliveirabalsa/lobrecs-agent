export type ReviewVerdict = 'approved' | 'rejected'

export interface ParsedReviewVerdict {
  verdict: ReviewVerdict
  feedback?: string
  /** True when the verdict line was missing and the review must be retried. */
  fallback: boolean
}

const VERDICT_LINE = /^\s*VERDICT\s*:\s*(APPROVED|REJECTED)\b.*$/im

export function parseReviewerVerdict(text: string | undefined): ParsedReviewVerdict {
  const body = text?.trim()
  if (!body) return { verdict: 'rejected', fallback: true }

  const matches = [...body.matchAll(new RegExp(VERDICT_LINE, 'gim'))]
  const last = matches.at(-1)

  if (!last) return { verdict: 'rejected', feedback: body, fallback: true }

  const verdict: ReviewVerdict = last[1].toUpperCase() === 'APPROVED' ? 'approved' : 'rejected'
  const feedback = extractFeedback(body, last.index ?? 0)

  return { verdict, feedback, fallback: false }
}

function extractFeedback(body: string, verdictIndex: number): string | undefined {
  const before = body.slice(0, verdictIndex).trim()
  const tagged = before.match(/FEEDBACK\s*:\s*([\s\S]+)$/i)
  const text = tagged ? tagged[1].trim() : before
  return text.length > 0 ? text : undefined
}

export const VERDICT_INSTRUCTION = [
  'Review the implementer\'s work above.',
  'On the final line of your response, emit exactly one of:',
  '  VERDICT: APPROVED   — implementer\'s work is acceptable, stop the loop',
  '  VERDICT: REJECTED   — implementer must revise',
  'If REJECTED, precede the verdict with a `FEEDBACK:` block listing specific changes the implementer must make.',
].join('\n')
