import { once } from 'node:events'
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
