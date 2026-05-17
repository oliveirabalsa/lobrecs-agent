#!/usr/bin/env node

setTimeout(() => {
  console.log(
    JSON.stringify({
      type: 'approval_request',
      action: 'run-command',
      argv: process.argv.slice(2),
    }),
  )
  console.log('plain codex output')
  console.error('codex warning')
  console.log(JSON.stringify({ type: 'turn_complete', usage: { input_tokens: 2, output_tokens: 3 } }))
}, 25)
