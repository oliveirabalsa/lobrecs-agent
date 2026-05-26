import { describe, expect, it } from 'vitest'
import { buildDecomposerPrompt, parseDecomposerOutput } from './decomposerPrompt'

describe('buildDecomposerPrompt', () => {
  it('returns a non-empty system prompt', () => {
    const prompt = buildDecomposerPrompt()
    expect(prompt).toContain('task decomposer')
    expect(prompt).toContain('JSON array')
    expect(prompt).toContain('complexity')
  })

  it('includes the configured maximum task count when provided', () => {
    const prompt = buildDecomposerPrompt(8)
    expect(prompt).toContain('Return at most 8 subtasks')
    expect(prompt).toContain('allows at most')
  })
})

describe('parseDecomposerOutput', () => {
  it('parses a valid JSON array', () => {
    const output = JSON.stringify([
      {
        title: 'Add auth module',
        description: 'Create the authentication middleware with JWT validation',
        complexity: 'high',
      },
      {
        title: 'Update tests',
        description: 'Add unit tests for the new auth middleware',
        complexity: 'medium',
        dependsOn: ['Add auth module'],
      },
    ])

    const tasks = parseDecomposerOutput(output)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].title).toBe('Add auth module')
    expect(tasks[0].complexity).toBe('high')
    expect(tasks[0].dependsOn).toBeUndefined()
    expect(tasks[1].dependsOn).toEqual(['Add auth module'])
  })

  it('extracts JSON from markdown fences', () => {
    const output = `Here are the tasks:
\`\`\`json
[{"title": "Fix bug", "description": "Fix the null check", "complexity": "low"}]
\`\`\`
That should do it.`

    const tasks = parseDecomposerOutput(output)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Fix bug')
    expect(tasks[0].complexity).toBe('low')
  })

  it('extracts JSON from raw brackets in mixed output', () => {
    const output = `I'll break this down:
[{"title": "Task A", "description": "Do A", "complexity": "medium"}]
Done.`

    const tasks = parseDecomposerOutput(output)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Task A')
  })

  it('normalizes complexity to lowercase', () => {
    const output = JSON.stringify([
      { title: 'Task', description: 'Do it', complexity: 'HIGH' },
    ])

    const tasks = parseDecomposerOutput(output)
    expect(tasks[0].complexity).toBe('high')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseDecomposerOutput('not json at all')).toThrow(
      'Decomposer output must be valid JSON',
    )
  })

  it('throws on non-array JSON', () => {
    expect(() => parseDecomposerOutput('{"key": "value"}')).toThrow(
      'Decomposer output must be a JSON array',
    )
  })

  it('throws on empty array', () => {
    expect(() => parseDecomposerOutput('[]')).toThrow(
      'Decomposer output must contain at least one task',
    )
  })

  it('throws on missing title', () => {
    const output = JSON.stringify([
      { description: 'No title here', complexity: 'low' },
    ])
    expect(() => parseDecomposerOutput(output)).toThrow('missing a title')
  })

  it('throws on missing description', () => {
    const output = JSON.stringify([
      { title: 'Has title', complexity: 'low' },
    ])
    expect(() => parseDecomposerOutput(output)).toThrow('missing a description')
  })

  it('throws on invalid complexity', () => {
    const output = JSON.stringify([
      { title: 'Task', description: 'Do it', complexity: 'extreme' },
    ])
    expect(() => parseDecomposerOutput(output)).toThrow('invalid complexity')
  })

  it('strips non-string dependsOn entries', () => {
    const output = JSON.stringify([
      {
        title: 'Task',
        description: 'Do it',
        complexity: 'low',
        dependsOn: ['Valid', 123, '', null],
      },
    ])

    const tasks = parseDecomposerOutput(output)
    expect(tasks[0].dependsOn).toEqual(['Valid'])
  })
})
