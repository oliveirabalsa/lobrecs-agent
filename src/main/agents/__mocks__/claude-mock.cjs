#!/usr/bin/env node

setTimeout(() => {
  if (process.env.CLAUDE_MOCK_RESULT_MODE === 'error') {
    console.log(JSON.stringify({ type: 'result', subtype: 'error', result: 'model failed' }))
    return
  }

  console.log(JSON.stringify({ type: 'system', output: 'hook noise' }))
  console.log(
    JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'hidden thinking' },
      },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello from Claude stream' },
      },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello from Claude mock' }] },
      argv: process.argv.slice(2),
      envPrompt: process.env.CLAUDE_PROMPT,
    }),
  )
  console.log('raw claude line')
  console.error(
    JSON.stringify({
      warning: 'claude warning',
      argv: process.argv.slice(2),
      envPrompt: process.env.CLAUDE_PROMPT,
    }),
  )
  console.log(JSON.stringify({ type: 'result', subtype: 'success', cost_usd: 0.001 }))
}, 25)
