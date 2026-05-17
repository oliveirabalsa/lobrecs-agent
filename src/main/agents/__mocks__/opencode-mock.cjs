#!/usr/bin/env node

setTimeout(() => {
  console.log(JSON.stringify({ text: 'Hello from OpenCode mock', argv: process.argv.slice(2) }))
  console.error('opencode warning')
}, 25)
