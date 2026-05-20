#!/usr/bin/env node
// Simple mock for Antigravity CLI.

function main() {
  const args = process.argv.slice(2)
  const mode = process.env.ANTIGRAVITY_MOCK_MODE

  console.log(JSON.stringify({
    type: 'init',
    argv: args
  }))

  console.error('antigravity warning')

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

main()
