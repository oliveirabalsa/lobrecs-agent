#!/usr/bin/env node

const emitOutput = () => {
  console.error('Reading additional input from stdin...')
  console.error(
    '2026-05-17T21:43:46.783471Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("Failed to parse server response"))',
  )
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }))
  console.log(JSON.stringify({ type: 'turn.started' }))
  console.log(JSON.stringify({ type: 'item.started', item: { type: 'reasoning' } }))
  console.log(
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"rtk pwd"}',
      },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'message',
        content: [{ type: 'output_text', text: 'Codex-style assistant message' }],
      },
    }),
  )
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
}

const delay = Number(process.env.CODEX_MOCK_DELAY_MS ?? 0)

if (delay > 0) {
  setTimeout(emitOutput, delay)
} else {
  emitOutput()
}
