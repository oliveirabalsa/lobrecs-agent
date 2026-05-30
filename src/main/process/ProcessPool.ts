import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { buildProcessEnvironment } from './environment'

export interface ManagedProcess {
  pid: number
  sessionId: string
  process: ChildProcess
  startedAt: number
}

export interface SpawnOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  stdin?: 'pipe' | 'ignore'
}

export class ProcessPool extends EventEmitter {
  private readonly processes = new Map<string, ManagedProcess>()
  private readonly forceKillTimers = new Map<string, NodeJS.Timeout>()

  spawn(sessionId: string, command: string, args: string[], options: SpawnOptions): ChildProcess {
    if (this.processes.has(sessionId)) {
      throw new Error(`Process already exists for session ${sessionId}`)
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: buildProcessEnvironment(options.env),
      detached: process.platform !== 'win32',
      stdio: [options.stdin ?? 'pipe', 'pipe', 'pipe'],
    })

    const cleanup = (): void => {
      this.clearForceKillTimer(sessionId)
      this.processes.delete(sessionId)
    }

    child.once('error', (error) => {
      cleanup()
      this.emit('process-error', { sessionId, error })
    })

    if (!child.pid) {
      throw new Error(`Failed to spawn ${command}`)
    }

    const managed = {
      pid: child.pid,
      sessionId,
      process: child,
      startedAt: Date.now(),
    }

    this.processes.set(sessionId, managed)

    child.once('exit', (code, signal) => {
      cleanup()
      this.emit('process-exit', { sessionId, code, signal })
    })

    return child
  }

  get(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId)
  }

  kill(sessionId: string): void {
    const managed = this.processes.get(sessionId)
    if (!managed) return

    this.clearForceKillTimer(sessionId)
    killManagedProcess(managed, 'SIGTERM')

    const timer = setTimeout(() => {
      if (this.processes.has(sessionId)) {
        killManagedProcess(managed, 'SIGKILL')
      }
    }, 3000)

    timer.unref?.()
    this.forceKillTimers.set(sessionId, timer)
  }

  killAll(): void {
    for (const sessionId of [...this.processes.keys()]) {
      this.kill(sessionId)
    }
  }

  list(): ManagedProcess[] {
    return [...this.processes.values()]
  }

  private clearForceKillTimer(sessionId: string): void {
    const timer = this.forceKillTimers.get(sessionId)
    if (!timer) return

    clearTimeout(timer)
    this.forceKillTimers.delete(sessionId)
  }
}

function killManagedProcess(managed: ManagedProcess, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    killWindowsProcessTree(managed, signal)
    return
  }

  try {
    process.kill(-managed.pid, signal)
  } catch (error) {
    if (isNoSuchProcessError(error)) return

    managed.process.kill(signal)
  }
}

function killWindowsProcessTree(managed: ManagedProcess, signal: NodeJS.Signals): void {
  const taskkill = spawn(
    'taskkill',
    ['/pid', String(managed.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])],
    { windowsHide: true },
  )

  taskkill.once('error', () => {
    managed.process.kill(signal)
  })
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}

export const processPool = new ProcessPool()
