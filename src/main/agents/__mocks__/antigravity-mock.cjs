#!/usr/bin/env node
// Simple mock for Antigravity CLI.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function main() {
  const args = process.argv.slice(2)
  const mode = process.env.ANTIGRAVITY_MOCK_MODE
  const logFile = flagValue(args, '--log-file')

  console.log(JSON.stringify({
    type: 'init',
    argv: args
  }))

  console.error('antigravity warning')

  if (mode === 'transcript-only') {
    writeTranscript(logFile)
    console.log('Transcript final answer from Antigravity mock')
    return
  }

  if (mode === 'plain-only') {
    console.log('First Antigravity line')
    console.log('Second Antigravity line')
    return
  }

  console.log('Hello from Antigravity mock')

  console.log(JSON.stringify({
    type: 'tool_use',
    tool_name: 'shell',
    parameters: { command: 'rtk pwd' }
  }))

  console.log(JSON.stringify({
    type: 'tool_result',
    tool_name: 'shell',
    output: '/repo\n'
  }))

  console.log(JSON.stringify({
    type: 'result',
    stats: {
      models: [
        {
          name: 'gemini-2.5-flash',
          tokens: {
            input_tokens: 11,
            output_tokens: 10,
            total_tokens: 21
          }
        }
      ],
      cost: 0.0001
    }
  }))
}

function flagValue(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function writeTranscript(logFile) {
  if (!logFile) return

  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-mock-app-'))
  const conversationId = '11111111-2222-3333-4444-555555555555'
  const transcriptDir = path.join(
    appDataDir,
    'brain',
    conversationId,
    '.system_generated',
    'logs',
  )

  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  fs.mkdirSync(transcriptDir, { recursive: true })
  fs.writeFileSync(
    logFile,
    [
      `I0520 00:00:00 common.go:197] CLI app data directory: ${appDataDir}`,
      `I0520 00:00:00 printmode.go:130] Print mode: conversation=${conversationId}, sending message`,
    ].join('\n'),
  )

  const records = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-05-20T00:00:00Z',
      content: '<USER_REQUEST>Test</USER_REQUEST>',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-05-20T00:00:01Z',
      content: 'I will run pwd and create a note.',
      tool_calls: [
        {
          name: 'run_command',
          args: {
            CommandLine: '"rtk pwd"',
            Cwd: '"/repo"',
          },
        },
        {
          name: 'write_to_file',
          args: {
            TargetFile: '"/repo/note.md"',
            CodeContent: '"hello\\n"',
          },
        },
      ],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'RUN_COMMAND',
      status: 'DONE',
      created_at: '2026-05-20T00:00:02Z',
      content: 'Output:\n/repo\n',
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'CODE_ACTION',
      status: 'DONE',
      created_at: '2026-05-20T00:00:03Z',
      content: 'Created file file:///repo/note.md with requested content.',
    },
  ]

  fs.writeFileSync(
    path.join(transcriptDir, 'transcript.jsonl'),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
}

main()
