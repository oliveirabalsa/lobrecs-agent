import { describe, expect, it } from 'vitest'
import type { StreamItem } from '../lib/groupTurns'
import { shouldPinMessageStream, splitFinalAssistant } from './MessageStream'

describe('shouldPinMessageStream', () => {
  it('forces pinning while a run is active even if the user was not sticky', () => {
    expect(
      shouldPinMessageStream({ loading: false, running: true, sticky: false }),
    ).toBe(true)
  })

  it('keeps historical views respectful of the current sticky state', () => {
    expect(
      shouldPinMessageStream({ loading: false, running: false, sticky: false }),
    ).toBe(false)
    expect(
      shouldPinMessageStream({ loading: false, running: false, sticky: true }),
    ).toBe(true)
  })
})

describe('splitFinalAssistant', () => {
  it('keeps assistant output in the renderable stream while a turn is running', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'partial answer' },
      { kind: 'tool-call', name: 'bash', status: 'running' },
      { kind: 'message', role: 'assistant', text: 'still streaming' },
    ]

    const result = splitFinalAssistant(items, { separateFinalAssistant: false })

    expect(result.finalAssistantText).toBeUndefined()
    expect(result.renderable).toEqual(items)
  })

  it('moves the final assistant message after completed-turn artifacts', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'final answer' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      {
        kind: 'file-change',
        filePath: 'src/example.ts',
        changeType: 'modified',
        status: 'pending',
      },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('final answer')
    expect(result.renderable).toEqual([])
    expect(result.trailingCodeChanges.map((item) => item.kind)).toEqual(['file-change'])
  })

  it('keeps code changes after the final answer and before completion metrics', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'summary' },
      {
        kind: 'file-change',
        filePath: 'src/example.ts',
        changeType: 'modified',
        status: 'pending',
      },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('summary')
    expect(result.renderable).toEqual([])
    expect(result.trailingCodeChanges).toHaveLength(1)
  })
})
