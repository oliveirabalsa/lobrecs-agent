import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessPool } from './ProcessPool'

describe('ProcessPool', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns and tracks a process until it exits', async () => {
    const pool = new ProcessPool()
    const child = pool.spawn('test-session', process.execPath, ['-e', 'console.log("hello")'], {
      cwd: process.cwd(),
    })

    expect(pool.get('test-session')).toBeDefined()

    const [code] = await once(child, 'exit')

    expect(code).toBe(0)
    expect(pool.get('test-session')).toBeUndefined()
  })

  it('killAll terminates all tracked processes', async () => {
    const pool = new ProcessPool()
    const childA = pool.spawn('s1', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
    })
    const childB = pool.spawn('s2', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
    })

    expect(pool.list()).toHaveLength(2)

    const exits = Promise.all([once(childA, 'exit'), once(childB, 'exit')])
    pool.killAll()

    await withTimeout(exits)
    expect(pool.list()).toHaveLength(0)
  })

  it('forces a process to exit when SIGTERM is ignored', async () => {
    vi.useFakeTimers()

    const pool = new ProcessPool()
    const child = pool.spawn(
      'stubborn-session',
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
      { cwd: process.cwd() },
    )
    const exit = once(child, 'exit')

    await once(child.stdout!, 'data')
    pool.kill('stubborn-session')
    await vi.advanceTimersByTimeAsync(3000)
    vi.useRealTimers()

    const [, signal] = (await withTimeout(exit)) as [number | null, NodeJS.Signals | null]

    expect(signal).toBe('SIGKILL')
    expect(pool.get('stubborn-session')).toBeUndefined()
  })

  it('terminates child processes spawned by the tracked process', async () => {
    if (process.platform === 'win32') return

    const pool = new ProcessPool()
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-process-tree-'))
    const pidFile = path.join(tempDir, 'grandchild.pid')
    const parent = pool.spawn(
      'tree-session',
      process.execPath,
      [
        '-e',
        [
          'const { spawn } = require("node:child_process");',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
          'setInterval(() => {}, 1000);',
        ].join(''),
      ],
      { cwd: process.cwd() },
    )

    try {
      await waitForFile(pidFile)
      const grandchildPid = Number(await readFile(pidFile, 'utf8'))
      expect(isProcessAlive(grandchildPid)).toBe(true)

      const exit = once(parent, 'exit')
      pool.kill('tree-session')
      await withTimeout(exit)
      await waitFor(() => !isProcessAlive(grandchildPid))

      expect(isProcessAlive(grandchildPid)).toBe(false)
    } finally {
      pool.killAll()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for child process')), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function waitForFile(filePath: string): Promise<void> {
  await waitFor(async () => {
    try {
      await readFile(filePath, 'utf8')
      return true
    } catch {
      return false
    }
  })
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for condition')
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
