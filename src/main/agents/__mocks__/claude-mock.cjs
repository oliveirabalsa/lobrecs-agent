#!/usr/bin/env node

setTimeout(() => {
  if (process.env.CLAUDE_MOCK_RESULT_MODE === 'error') {
    console.log(JSON.stringify({ type: 'result', subtype: 'error', result: 'model failed' }))
    return
  }

  if (process.env.CLAUDE_MOCK_DUPLICATE_TEXT === '1') {
    const text = 'Duplicated Claude response'
    console.log(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        },
      }),
    )
    console.log(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
      }),
    )
    console.log(JSON.stringify({ type: 'result', subtype: 'success', result: text }))
    return
  }

  if (process.env.CLAUDE_MOCK_USER_QUESTION === '1') {
    console.log(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_question',
              name: 'request_user_input',
              input: {
                question: 'Which files should I focus?',
                options: [{ label: 'Renderer only' }],
              },
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
              tool_use_id: 'toolu_question',
              content: 'Answer questions?',
            },
          ],
        },
      }),
    )
    console.log(JSON.stringify({ type: 'result', subtype: 'success' }))
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
  if (process.env.CLAUDE_MOCK_PLUGIN_WORKER_NOISE === '1') {
    console.error(
      '1277 | || (${R} === "string" && ${E} && ${E} == +${E})\n' +
        'ENOENT: no such file or directory, lstat \'/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401\' path: "/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401", syscall: "lstat", errno: -2, code: "ENOENT" at cue (/Users/example/.claude/plugins/cache/thedotmack/claude-mem/10.6.2/scripts/worker-service.cjs:1281:35133)\n' +
        'Bun v1.3.6 (macOS arm64)',
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
