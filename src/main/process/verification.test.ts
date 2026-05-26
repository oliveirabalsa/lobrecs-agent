import { describe, expect, it } from 'vitest'
import { runVerificationCommand } from './verification'
import { getUserShell } from './environment'

const shell = getUserShell()
const shellName = shell.split('/').pop() ?? 'shell'

describe('runVerificationCommand', () => {
  it('returns exitCode 0 for a successful command', async () => {
    const result = await runVerificationCommand('echo "hello"', '/tmp', {
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello')
  })

  it('captures stderr from a failing command', async () => {
    const result = await runVerificationCommand(
      `${shellName} -c "echo error >&2 && exit 1"`,
      '/tmp',
      { timeoutMs: 5000, maxOutputBytes: 1024 },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error')
  })

  it('times out and returns exitCode 124', async () => {
    const result = await runVerificationCommand('sleep 10', '/tmp', {
      timeoutMs: 100,
      maxOutputBytes: 1024,
    })

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timed out')
  })

  it('truncates output that exceeds maxOutputBytes', async () => {
    const largeOutput = 'x'.repeat(200)
    const result = await runVerificationCommand(
      `echo "${largeOutput}"`,
      '/tmp',
      { timeoutMs: 5000, maxOutputBytes: 100 },
    )

    expect(result.stdout).toContain('[output truncated]')
    expect(Buffer.byteLength(result.stdout, 'utf-8')).toBeLessThanOrEqual(150)
  })

  it('uses shell variable expansion', async () => {
    const result = await runVerificationCommand(
      'X=hello && echo $X',
      '/tmp',
      { timeoutMs: 5000, maxOutputBytes: 1024 },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
  })
})