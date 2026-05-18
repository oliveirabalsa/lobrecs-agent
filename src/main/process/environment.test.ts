import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProcessEnvironment, buildExecutableSearchPath } from './environment'

describe('process environment', () => {
  it('adds the current Node runtime directory to packaged child process PATH', () => {
    const searchPath = buildExecutableSearchPath('/usr/bin')
    const entries = searchPath.split(path.delimiter)

    expect(entries).toContain('/usr/bin')
    expect(entries).toContain(path.dirname(process.execPath))
  })

  it('preserves overrides while hydrating executable lookup paths', () => {
    const env = buildProcessEnvironment({ PATH: '/bin', CUSTOM_ENV: '1' })

    expect(env.CUSTOM_ENV).toBe('1')
    expect(env.PATH?.split(path.delimiter)).toContain(path.dirname(process.execPath))
  })
})
