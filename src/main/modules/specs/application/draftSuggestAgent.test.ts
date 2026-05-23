import { describe, expect, it } from 'vitest'
import { parseSuggestionResponse } from './draftSuggestAgent'

describe('parseSuggestionResponse', () => {
  it('correctly parses a clean JSON response', () => {
    const json = JSON.stringify({
      constraints: 'Must use React 19',
      requirements: ['Req 1', 'Req 2'],
      acceptanceCriteria: ['Crit 1'],
      targetFiles: ['src/App.tsx'],
    })

    const parsed = parseSuggestionResponse(json)
    expect(parsed.constraints).toBe('Must use React 19')
    expect(parsed.requirements).toEqual(['Req 1', 'Req 2'])
    expect(parsed.acceptanceCriteria).toEqual(['Crit 1'])
    expect(parsed.targetFiles).toEqual(['src/App.tsx'])
  })

  it('strips markdown fence code blocks if returned', () => {
    const raw = `
\`\`\`json
{
  "constraints": "Strict typing",
  "requirements": ["Req A"],
  "acceptanceCriteria": ["Crit A"],
  "targetFiles": ["src/main.ts"]
}
\`\`\`
`
    const parsed = parseSuggestionResponse(raw)
    expect(parsed.constraints).toBe('Strict typing')
    expect(parsed.requirements).toEqual(['Req A'])
    expect(parsed.acceptanceCriteria).toEqual(['Crit A'])
    expect(parsed.targetFiles).toEqual(['src/main.ts'])
  })

  it('handles missing fields gracefully by defaulting to empty structures', () => {
    const raw = '{}'
    const parsed = parseSuggestionResponse(raw)
    expect(parsed.constraints).toBe('')
    expect(parsed.requirements).toEqual([])
    expect(parsed.acceptanceCriteria).toEqual([])
    expect(parsed.targetFiles).toEqual([])
  })

  it('throws an error on invalid JSON', () => {
    expect(() => parseSuggestionResponse('invalid json')).toThrow(
      'Failed to parse suggestion response as valid JSON.',
    )
  })
})
