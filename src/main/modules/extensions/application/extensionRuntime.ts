import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type {
  ExecutableExtensionManifest,
  ExtensionHookKind,
  ExtensionInstallScope,
  InstalledExtensionRecord,
} from '../../../../shared/types'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_STDIO_BYTES = 64_000

export interface ExtensionRuntimeRepository {
  list(): InstalledExtensionRecord[]
}

export interface ExtensionHookEnvelope<TInput> {
  hook: ExtensionHookKind
  input: TInput
}

export interface ExtensionHookExecution<TResult = unknown> {
  installationId: string
  extensionId: string
  result: TResult
  stderr: string
}

export interface ExtensionHookSelection {
  hook: ExtensionHookKind
  requiredCapabilities: readonly string[]
  projectPath?: string
  scope?: ExtensionInstallScope
}

export class ExtensionRuntime {
  constructor(private readonly repository: ExtensionRuntimeRepository) {}

  async runHook<TInput, TResult = unknown>(
    selection: ExtensionHookSelection,
    input: TInput,
  ): Promise<Array<ExtensionHookExecution<TResult>>> {
    const records = this.selectExecutableRecords(selection)
    const executions: Array<ExtensionHookExecution<TResult>> = []

    for (const record of records) {
      const executable = record.executable
      if (!executable) continue

      const response = await executeJsonRpc<TResult>(
        executable.manifest,
        {
          hook: selection.hook,
          input,
        },
        record.projectPath,
      )
      executions.push({
        installationId: record.id,
        extensionId: record.extensionId,
        result: response.result,
        stderr: response.stderr,
      })
    }

    return executions
  }

  selectExecutableRecords(selection: ExtensionHookSelection): InstalledExtensionRecord[] {
    return this.repository.list().filter((record) => {
      const executable = record.executable
      if (!executable) return false
      if (!executable.trusted || !executable.enabled) return false
      if (!executable.manifest.hooks.includes(selection.hook)) return false
      if (!hasCapabilities(executable.manifest.capabilities, selection.requiredCapabilities)) {
        return false
      }
      if (!scopeMatches(executable.manifest.scope, record.scope, selection.scope)) return false
      if (
        record.scope === 'project' &&
        selection.projectPath &&
        record.projectPath !== selection.projectPath
      ) {
        return false
      }
      return true
    })
  }

  async doctor(record: InstalledExtensionRecord): Promise<{
    status: 'passed' | 'failed'
    message: string
    stderr?: string
  }> {
    if (!record.executable) {
      throw new Error('Extension installation does not include executable hooks.')
    }

    try {
      const result = await executeJsonRpc(
        record.executable.manifest,
        {
          hook: 'quality-gate-observation',
          input: { kind: 'doctor', installationId: record.id },
        },
        record.projectPath,
      )
      return {
        status: 'passed',
        message: doctorMessage(result.result),
        ...(result.stderr ? { stderr: result.stderr } : {}),
      }
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Extension doctor failed.',
      }
    }
  }
}

async function executeJsonRpc<TResult>(
  manifest: ExecutableExtensionManifest,
  params: ExtensionHookEnvelope<unknown>,
  cwd?: string,
): Promise<{ result: TResult; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(manifest, cwd)
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Extension hook timed out after ${timeoutMs(manifest)}ms.`))
    }, timeoutMs(manifest))

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk.toString('utf8'))
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Extension hook exited with code ${code ?? 'unknown'}: ${stderr}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as {
          result?: TResult
          error?: { message?: string }
        }
        if (parsed.error) {
          reject(new Error(parsed.error.message ?? 'Extension hook returned an error.'))
          return
        }
        resolve({ result: parsed.result as TResult, stderr })
      } catch {
        reject(new Error('Extension hook returned invalid JSON-RPC output.'))
      }
    })

    child.stdin?.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: `hook-${Date.now()}`,
        method: 'extensionHook',
        params,
      }),
    )
  })
}

function spawnProcess(
  manifest: ExecutableExtensionManifest,
  cwd?: string,
): ChildProcessWithoutNullStreams {
  const options: SpawnOptionsWithoutStdio = {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  }
  if (manifest.runtime === 'node') {
    return spawn(process.execPath, [manifest.command, ...(manifest.args ?? [])], {
      ...options,
    })
  }
  if (manifest.runtime === 'shell') {
    return spawn('/bin/sh', ['-lc', [manifest.command, ...(manifest.args ?? [])].join(' ')], {
      ...options,
    })
  }
  return spawn(manifest.command, manifest.args ?? [], options)
}

function timeoutMs(manifest: ExecutableExtensionManifest): number {
  if (!manifest.timeoutMs || !Number.isFinite(manifest.timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.max(100, Math.min(60_000, Math.floor(manifest.timeoutMs)))
}

function boundedAppend(current: string, next: string): string {
  const combined = current + next
  if (combined.length <= MAX_STDIO_BYTES) return combined
  return combined.slice(combined.length - MAX_STDIO_BYTES)
}

function hasCapabilities(available: readonly string[], required: readonly string[]): boolean {
  const availableSet = new Set(available)
  return required.every((capability) => availableSet.has(capability))
}

function scopeMatches(
  manifestScope: ExecutableExtensionManifest['scope'],
  installScope: ExtensionInstallScope,
  requestedScope: ExtensionInstallScope | undefined,
): boolean {
  if (requestedScope && installScope !== requestedScope && installScope !== 'global') return false
  return manifestScope === 'both' || manifestScope === installScope
}

function doctorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') return 'Extension hook responded.'
  const message = (result as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message : 'Extension hook responded.'
}
