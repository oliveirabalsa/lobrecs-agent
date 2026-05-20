import { describe, expect, it } from 'vitest'
import { parseReviewerVerdict } from './reviewVerdict'

describe('parseReviewerVerdict', () => {
  it('reads APPROVED from the final line', () => {
    const result = parseReviewerVerdict('Looks great.\nVERDICT: APPROVED')
    expect(result).toEqual({ verdict: 'approved', feedback: 'Looks great.', fallback: false })
  })

  it('reads REJECTED and pulls a FEEDBACK block', () => {
    const text = [
      'Some preamble.',
      'FEEDBACK: Missing error handling on read.',
      'VERDICT: REJECTED',
    ].join('\n')

    const result = parseReviewerVerdict(text)
    expect(result.verdict).toBe('rejected')
    expect(result.feedback).toBe('Missing error handling on read.')
    expect(result.fallback).toBe(false)
  })

  it('matches the last verdict line when the prompt is restated mid-output', () => {
    const text = [
      'You asked me to emit VERDICT: APPROVED or VERDICT: REJECTED.',
      'I reviewed the diff.',
      'VERDICT: REJECTED',
    ].join('\n')

    expect(parseReviewerVerdict(text).verdict).toBe('rejected')
  })

  it('is case insensitive', () => {
    expect(parseReviewerVerdict('verdict: approved').verdict).toBe('approved')
  })

  it('falls back to rejected when no marker is present', () => {
    const result = parseReviewerVerdict('Looks fine to me, ship it.')
    expect(result).toEqual({
      verdict: 'rejected',
      feedback: 'Looks fine to me, ship it.',
      fallback: true,
    })
  })

  it('falls back to rejected on empty input', () => {
    expect(parseReviewerVerdict('')).toEqual({ verdict: 'rejected', fallback: true })
    expect(parseReviewerVerdict(undefined)).toEqual({ verdict: 'rejected', fallback: true })
  })
})
