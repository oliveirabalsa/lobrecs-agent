#!/usr/bin/env node

function emitOutput() {
  console.log(
    JSON.stringify({
      type: 'init',
      argv: process.argv.slice(2),
    }),
  )
  console.log(
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'Hello from Gemini mock',
    }),
  )
  console.log(
    JSON.stringify({
      type: 'tool_use',
      tool_name: 'shell',
      parameters: { command: 'rtk pwd' },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'tool_result',
      tool_name: 'shell',
      output: '/repo\n',
    }),
  )
  console.log(
    JSON.stringify({
      type: 'error',
      message: 'gemini warning',
    }),
  )
  console.log(
    JSON.stringify({
      type: 'result',
      stats: {
        models: [
          {
            name: 'gemini-2.5-flash',
            tokens: {
              prompt: 11,
              candidates: 7,
              thoughts: 3,
              total: 21,
            },
          },
        ],
      },
    }),
  )
}

setTimeout(emitOutput, 25)
