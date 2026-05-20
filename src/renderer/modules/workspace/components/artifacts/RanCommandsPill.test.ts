import { describe, expect, it } from 'vitest'
import type { RanCommandItem } from './RanCommandsPill'
import { deriveRanCommandRows, deriveRanCommandsState } from './RanCommandsPill'
import { deriveCommandsGroupDisplayState } from './CommandsGroup'

describe('deriveRanCommandsState', () => {
  it('does not keep a resolved tool lifecycle spinning while the session is still running', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'running' },
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'done' },
      { kind: 'tool-result', name: 'shell', output: 'ok', status: 'done' },
    ]

    expect(deriveRanCommandsState(items, true)).toMatchObject({
      active: false,
      failed: false,
      count: 1,
    })
  })

  it('keeps the group active when the latest command has not resolved', () => {
    const items: RanCommandItem[] = [
      { kind: 'command', command: 'rtk npm test', status: 'running' },
    ]

    expect(deriveRanCommandsState(items, true).active).toBe(true)
  })

  it('does not show an unresolved command as active after the session finishes', () => {
    const items: RanCommandItem[] = [
      { kind: 'command', command: 'rtk npm test', status: 'running' },
    ]

    expect(deriveRanCommandsState(items, false)).toMatchObject({
      active: false,
      count: 1,
    })
  })

  it('marks failed command groups without treating them as active after completion', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'shell', status: 'running' },
      { kind: 'tool-result', name: 'shell', output: 'failed', status: 'error' },
    ]

    expect(deriveRanCommandsState(items, true)).toMatchObject({
      active: false,
      failed: true,
    })
  })
})

describe('deriveRanCommandRows', () => {
  it('merges a tool call and result into one compact row', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'running' },
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'done' },
      { kind: 'tool-result', name: 'shell', output: 'tests passed', status: 'done' },
    ]

    expect(deriveRanCommandRows(items)).toEqual([
      expect.objectContaining({
        label: 'call',
        title: 'shell rtk npm test',
        status: 'done',
        output: 'tests passed',
      }),
    ])
  })

  it('keeps distinct shell calls separate when their inputs differ', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'running' },
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'done' },
      { kind: 'tool-call', name: 'shell', input: 'rtk npm run build', status: 'running' },
    ]

    expect(deriveRanCommandRows(items).map((row) => row.title)).toEqual([
      'shell rtk npm test',
      'shell rtk npm run build',
    ])
  })

  it('renders two separate rows when the same tool is called twice with identical input', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'running' },
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'done' },
      { kind: 'tool-result', name: 'read', output: 'content 1', status: 'done' },
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'running' },
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'done' },
      { kind: 'tool-result', name: 'read', output: 'content 2', status: 'done' },
    ]

    const rows = deriveRanCommandRows(items)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ output: 'content 1', status: 'done' })
    expect(rows[1]).toMatchObject({ output: 'content 2', status: 'done' })
  })

  it('ignores a late tool-call done event that arrives after the row is already resolved', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'running' },
      { kind: 'tool-result', name: 'read', output: 'content', status: 'done' },
      { kind: 'tool-call', name: 'read', input: 'file.ts', status: 'done' },
    ]

    const rows = deriveRanCommandRows(items)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ output: 'content', status: 'done' })
  })

  it('does not produce an orphan result row when a matching call row exists', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'glob', input: '**/*.ts', status: 'running' },
      { kind: 'tool-result', name: 'glob', output: 'src/index.ts', status: 'done' },
    ]

    const rows = deriveRanCommandRows(items)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('call')
    expect(rows[0].output).toBe('src/index.ts')
  })
})

describe('deriveCommandsGroupDisplayState', () => {
  it('uses resolved tool lifecycles for the tools label instead of raw event count', () => {
    const items: RanCommandItem[] = [
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'running' },
      { kind: 'tool-call', name: 'shell', input: 'rtk npm test', status: 'done' },
      { kind: 'tool-result', name: 'shell', output: 'ok', status: 'done' },
    ]

    expect(deriveCommandsGroupDisplayState('other', items, true)).toMatchObject({
      count: 1,
      hasRunning: false,
      hasErrors: false,
      label: 'Tools (1)',
    })
  })
})
