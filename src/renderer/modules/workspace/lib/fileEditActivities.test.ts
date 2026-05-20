import { describe, expect, it } from 'vitest'
import type { AgentActivity } from '../../../../shared/types'
import {
  countEditedLines,
  fileChangesFromEditToolCall,
  isEditToolName,
  transformFileEditActivities,
} from './fileEditActivities'

type ToolCall = Extract<AgentActivity, { kind: 'tool-call' }>

describe('isEditToolName', () => {
  it('recognizes file-editing tools across adapters, case-insensitively', () => {
    for (const name of ['Edit', 'Write', 'MultiEdit', 'apply_patch', 'write_file']) {
      expect(isEditToolName(name)).toBe(true)
    }
  })

  it('rejects non-editing tools', () => {
    for (const name of ['Read', 'bash', 'Grep', 'AskUserQuestion']) {
      expect(isEditToolName(name)).toBe(false)
    }
  })
})

describe('countEditedLines', () => {
  it('counts the lines on each side, ignoring a trailing newline', () => {
    expect(countEditedLines('old\nline', 'new line')).toEqual({
      additions: 1,
      deletions: 2,
    })
    expect(countEditedLines('', 'a\nb\nc\n')).toEqual({ additions: 3, deletions: 0 })
  })

  it('trims shared leading/trailing anchor lines so only real changes count', () => {
    // One line changed inside a block whose first/last lines are unchanged.
    expect(
      countEditedLines('import a\nconst x = 1\nexport x', 'import a\nconst x = 2\nexport x'),
    ).toEqual({ additions: 1, deletions: 1 })

    // Pure insertion between two shared anchors.
    expect(countEditedLines('start\nend', 'start\nmiddle\nend')).toEqual({
      additions: 1,
      deletions: 0,
    })

    // Identical text is a no-op.
    expect(countEditedLines('same\ntext', 'same\ntext')).toEqual({
      additions: 0,
      deletions: 0,
    })
  })
})

describe('fileChangesFromEditToolCall', () => {
  it('converts a Claude Edit call into a modified file-change', () => {
    const call: ToolCall = {
      kind: 'tool-call',
      name: 'Edit',
      status: 'running',
      input: { file_path: 'src/a.ts', old_string: 'old\nline', new_string: 'new line' },
    }

    expect(fileChangesFromEditToolCall(call)).toEqual([
      {
        kind: 'file-change',
        filePath: 'src/a.ts',
        changeType: 'modified',
        additions: 1,
        deletions: 2,
        status: 'applied',
      },
    ])
  })

  it('treats a Write of fresh content as an added file', () => {
    const call: ToolCall = {
      kind: 'tool-call',
      name: 'Write',
      status: 'running',
      input: { file_path: 'src/new.ts', content: 'a\nb\nc' },
    }

    expect(fileChangesFromEditToolCall(call)).toEqual([
      {
        kind: 'file-change',
        filePath: 'src/new.ts',
        changeType: 'added',
        additions: 3,
        deletions: 0,
        status: 'applied',
      },
    ])
  })

  it('sums every edit in a MultiEdit batch', () => {
    const call: ToolCall = {
      kind: 'tool-call',
      name: 'MultiEdit',
      status: 'running',
      input: {
        file_path: 'src/x.ts',
        edits: [
          { old_string: 'a', new_string: 'b\nc' },
          { old_string: 'd\ne', new_string: 'f' },
        ],
      },
    }

    expect(fileChangesFromEditToolCall(call)).toEqual([
      {
        kind: 'file-change',
        filePath: 'src/x.ts',
        changeType: 'modified',
        additions: 3,
        deletions: 3,
        status: 'applied',
      },
    ])
  })

  it('parses a Codex apply_patch block into per-file changes', () => {
    const call: ToolCall = {
      kind: 'tool-call',
      name: 'apply_patch',
      status: 'done',
      input: [
        '*** Begin Patch',
        '*** Update File: src/a.ts',
        '@@',
        '-old line',
        '+new line',
        '+another line',
        '*** End Patch',
      ].join('\n'),
    }

    expect(fileChangesFromEditToolCall(call)).toEqual([
      {
        kind: 'file-change',
        filePath: 'src/a.ts',
        changeType: 'modified',
        additions: 2,
        deletions: 1,
        status: 'applied',
      },
    ])
  })

  it('leaves non-edit tools and failed edits alone', () => {
    expect(
      fileChangesFromEditToolCall({
        kind: 'tool-call',
        name: 'Read',
        status: 'running',
        input: { file_path: 'src/a.ts' },
      }),
    ).toBeNull()

    expect(
      fileChangesFromEditToolCall({
        kind: 'tool-call',
        name: 'Edit',
        status: 'error',
        input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' },
      }),
    ).toBeNull()
  })
})

describe('transformFileEditActivities', () => {
  it('rewrites edit calls to file-changes and drops their success results', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'tool-call',
        name: 'Edit',
        status: 'running',
        input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
      },
      { kind: 'tool-result', name: 'Edit', status: 'done', output: 'File updated' },
      { kind: 'message', role: 'assistant', text: 'done' },
    ]

    const result = transformFileEditActivities(activities, [10, 20, 30])

    expect(result.activities.map((activity) => activity.kind)).toEqual([
      'file-change',
      'message',
    ])
    // The dropped tool-result's timestamp (20) is removed too.
    expect(result.times).toEqual([10, 30])
  })

  it('keeps failed edit results and unrelated commands visible', () => {
    const activities: AgentActivity[] = [
      { kind: 'tool-call', name: 'bash', status: 'done' },
      { kind: 'tool-result', name: 'bash', status: 'done', output: 'ok' },
      { kind: 'tool-result', name: 'Edit', status: 'error', output: 'old_string not found' },
    ]

    const result = transformFileEditActivities(activities)

    expect(result.activities).toEqual(activities)
    expect(result.times).toBeUndefined()
  })
})
