import { spawn } from 'node:child_process'
import type { GitCommandResult } from '../../../../shared/types'

export function runGit(
  args: string[],
  cwd: string,
  input?: string,
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message })
    })
    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })

    if (input !== undefined) {
      child.stdin?.end(input)
      return
    }

    child.stdin?.end()
  })
}

export async function runGitOrThrow(
  args: string[],
  cwd: string,
  input?: string,
): Promise<GitCommandResult> {
  const result = await runGit(args, cwd, input)
  if (result.exitCode === 0) return result

  throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`)
}
