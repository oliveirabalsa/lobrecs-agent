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
  console.log(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_mock',
            name: 'Read',
            input: { file_path: 'package.json' },
          },
        ],
      },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_mock',
            content: 'mock file output',
          },
        ],
      },
    }),
  )
  console.log('raw claude line')
  if (process.env.CLAUDE_MOCK_SESSION_END_NOISE === '1') {
    console.error(
      'SessionEnd hook [matcher: claude-code session-complete] failed: error: The current working directory was deleted, cannot run hook.',
    )
    console.error(
      'SessionEnd hook [matcher: claude-code session-complete] failed: error: The current working directory was deleted, cannot run hook.',
    )
  }
  console.error(
    JSON.stringify({
      warning: 'claude warning',
      argv: process.argv.slice(2),
      envPrompt: process.env.CLAUDE_PROMPT,
    }),
  )
  console.log(JSON.stringify({ type: 'result', subtype: 'success', cost_usd: 0.001 }))
}, 25)
