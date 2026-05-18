#!/usr/bin/env node

function emitOutput() {
  if (process.env.OPENCODE_MOCK_STEP_FINISH === '1') {
    console.log(
      JSON.stringify({
        type: 'step_finish',
        part: {
          type: 'step-finish',
          reason: 'tool-calls',
          tokens: { total: 10, input: 6, output: 4, cache: { read: 1, write: 0 } },
          cost: 0.0001,
        },
      }),
    )
  }

  console.log(
    JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'Hello from OpenCode mock' },
      argv: process.argv.slice(2),
    }),
  )
  console.log(
    JSON.stringify({
      type: 'step_finish',
      part: {
        type: 'step-finish',
        reason: 'stop',
        tokens: { total: 14, input: 8, output: 6, cache: { read: 2, write: 0 } },
        cost: 0.0002,
      },
    }),
  )
  console.error('opencode warning')
}

if (process.env.OPENCODE_MOCK_IMMEDIATE === '1') {
  emitOutput()
} else {
  setTimeout(emitOutput, 25)
}
