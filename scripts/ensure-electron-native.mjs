import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import electronBinary from 'electron'
import electronPackage from 'electron/package.json' with { type: 'json' }

const root = process.cwd()
const stampDir = path.join(root, 'node_modules', '.cache', 'lobrecs-agent')
const stampPath = path.join(stampDir, `electron-native-${electronPackage.version}.stamp`)
const nativeModules = [
  path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  path.join(root, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
]

if (existsSync(stampPath) && nativeModules.every(existsSync) && nativeModulesLoadInElectron()) {
  process.exit(0)
}

console.log(`Rebuilding Electron native modules for Electron ${electronPackage.version}...`)

const result = spawnSync(
  'npx',
  ['electron-rebuild', '-f', '-w', 'better-sqlite3', '-w', 'node-pty'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

await mkdir(stampDir, { recursive: true })
await writeFile(stampPath, `${new Date().toISOString()}\n`, 'utf-8')

function nativeModulesLoadInElectron() {
  const result = spawnSync(
    electronBinary,
    ['-e', "require('better-sqlite3'); require('node-pty')"],
    {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: 'ignore',
    },
  )

  return result.status === 0
}
