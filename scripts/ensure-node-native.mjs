import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Test-time counterpart of ensure-electron-native.mjs.
//
// `npm run dev` rebuilds better-sqlite3/node-pty for Electron's ABI, but
// vitest runs under plain Node. After any dev session the compiled addons
// are the wrong NODE_MODULE_VERSION for the test runner, so `npm test`
// fails on `require()` before a single test executes. This probe runs as
// `pretest`, under the same Node that vitest will use, and rebuilds the
// addons only when they don't load.
//
// Unlike the Electron guard this keeps no stamp file: that guard probes by
// spawning an Electron process (expensive, worth caching), while this probe
// is an in-process require plus an in-memory database — fast enough to run
// every time, and a stale stamp would only risk skipping a needed rebuild.

const root = process.cwd()
const require = createRequire(import.meta.url)

if (nativeModulesLoadInNode()) {
  process.exit(0)
}

console.log(
  `Rebuilding native modules for Node ${process.version} (ABI ${process.versions.modules})...`,
)

const result = spawnSync('npm', ['rebuild', 'better-sqlite3', 'node-pty'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(result.status ?? 1)

function nativeModulesLoadInNode() {
  try {
    // better-sqlite3 binds its addon lazily inside the Database constructor,
    // so constructing one is what actually exercises the ABI check.
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    require('node-pty')
    return true
  } catch {
    return false
  }
}
