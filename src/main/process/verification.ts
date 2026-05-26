import { spawn } from 'node:child_process'
import { buildProcessEnvironment } from './environment'

export interface VerificationCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface VerificationCommandOptions {
  timeoutMs: number
  maxOutputBytes: number
}

export function runVerificationCommand(
  command: string,
  cwd: string,
  options: VerificationCommandOptions,
): Promise<VerificationCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('zsh', ['-lc', command], {
      cwd,
      env: buildProcessEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      settled = true
      child.kill('SIGTERM')
      resolve({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\nVerification timed out after ${options.timeoutMs / 1_000}s.`,
      })
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString(), options.maxOutputBytes)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString(), options.maxOutputBytes)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ exitCode: 1, stdout, stderr: error.message })
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      })
    })
  })
}

export function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, 'utf-8') <= maxBytes) return output

  return `${Buffer.from(output, 'utf-8').subarray(0, maxBytes).toString('utf-8')}\n[output truncated]`
}

export function hasRequiredCommandPrefix(command: string, prefix: string): boolean {
  const trimmedCommand = command.trim()
  const trimmedPrefix = prefix.trim()
  if (!trimmedPrefix) return true

  return trimmedCommand === trimmedPrefix || trimmedCommand.startsWith(`${trimmedPrefix} `)
}
