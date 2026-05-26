#!/usr/bin/env node

function emitOutput() {
  const argv = process.argv.slice(2)

  if (process.env.CURSOR_MOCK_MODE === 'plain') {
    console.log('plain cursor output')
    console.error('cursor warning')
    return
  }

  if (process.env.CURSOR_MOCK_MODE === 'error') {
    console.log(JSON.stringify({ type: 'error', message: 'Cursor mock error', argv }))
    console.error('cursor failed')
    return
  }

  console.log(
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: process.cwd(),
      model: argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : 'auto',
      argv,
    }),
  )
  console.log(
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Cursor mock' }],
      },
    }),
  )
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hello from Cursor mock',
      usage: { input_tokens: 12, output_tokens: 7 },
    }),
  )
  console.error('cursor warning')
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log('cursor-agent 1.0.0')
} else if (process.argv.includes('status')) {
  if (process.env.CURSOR_MOCK_STATUS_WITHOUT_EMAIL === '1') {
    console.log('Logged in')
    return
  }

  console.log('Logged in')
  console.log('Account: leo@example.com')
  console.log('Endpoint: https://api.cursor.com')
} else if (process.argv.includes('about')) {
  console.log('About Cursor CLI')
  console.log('CLI Version         2026.05.24-dda726e')
  console.log('Subscription Tier   Free')
  console.log('User Email          leo@example.com')
} else if (process.argv.includes('models')) {
  console.log('Available models')
  console.log('')
  console.log('auto - Auto')
  console.log('composer-2-fast - Composer 2 Fast')
  console.log('gpt-5.3-codex - Codex 5.3')
  console.log('claude-opus-4-7-thinking-high - Opus 4.7 1M High Thinking')
  console.log('')
  console.log('Tip: use --model <id> (or /model <id> in interactive mode) to switch.')
} else if (process.env.CURSOR_MOCK_SLOW === '1') {
  setTimeout(emitOutput, 5000)
} else {
  setTimeout(emitOutput, 25)
}
