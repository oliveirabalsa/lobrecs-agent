import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectEditors, invalidateEditorCache } from './detectEditors'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'

// detectEditors is macOS-only (uses mdfind and /Applications paths)
const itOnMac = process.platform === 'darwin' ? it : it.skip

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}))

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}))

vi.mock('node:child_process', () => {
  const mockExec = vi.fn() as any
  mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExecFileAsync
  return {
    execFile: mockExec,
  }
})


describe('detectEditors', () => {
  beforeEach(() => {
    invalidateEditorCache()
    vi.clearAllMocks()
    
    // Default mock behavior for access to return error (not exists)
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
  })

  afterEach(() => {
    invalidateEditorCache()
  })

  itOnMac('detects standard virtual editors always', async () => {
    // Mock mdfind to return empty
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

    const editors = await detectEditors()
    
    // Virtual editors should be present
    const defaultApp = editors.find((e) => e.id === 'default-app')
    const openInFolder = editors.find((e) => e.id === 'open-in-folder')
    
    expect(defaultApp).toBeDefined()
    expect(defaultApp?.name).toBe('Default app')
    expect(defaultApp?.kind).toBe('gui')
    
    expect(openInFolder).toBeDefined()
    expect(openInFolder?.name).toBe('Open in folder')
    expect(openInFolder?.kind).toBe('gui')
  })

  itOnMac('detects GUI editors via mdfind', async () => {
    // Mock mdfind to return two apps: Cursor Personal and Xcode
    mockExecFileAsync.mockImplementation(async (file: string) => {
      if (file === '/usr/bin/mdfind') {
        return { stdout: '/Applications/Cursor Personal.app\n/Applications/Xcode.app', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const editors = await detectEditors()
    
    const cursor = editors.find((e) => e.id === 'cursor')
    const xcode = editors.find((e) => e.id === 'xcode')

    expect(cursor).toBeDefined()
    expect(cursor?.name).toBe('Cursor Personal')
    expect(cursor?.target).toBe('/Applications/Cursor Personal.app')

    expect(xcode).toBeDefined()
    expect(xcode?.name).toBe('Xcode')
    expect(xcode?.target).toBe('/Applications/Xcode.app')
  })

  itOnMac('handles multiple instances of the same editor name and assigns unique IDs', async () => {
    mockExecFileAsync.mockImplementation(async (file: string) => {
      if (file === '/usr/bin/mdfind') {
        return { stdout: '/Applications/Cursor Personal.app\n/Applications/Cursor SpaceInch.app', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const editors = await detectEditors()
    const cursor1 = editors.find((e) => e.id === 'cursor')
    const cursor2 = editors.find((e) => e.id === 'cursor-spaceinch')

    expect(cursor1).toBeDefined()
    expect(cursor1?.name).toBe('Cursor Personal')
    
    expect(cursor2).toBeDefined()
    expect(cursor2?.name).toBe('Cursor SpaceInch')
  })

  itOnMac('uses fallback path checking if mdfind fails or is empty', async () => {
    // Mock mdfind to fail
    mockExecFileAsync.mockImplementation(async (file: string) => {
      if (file === '/usr/bin/mdfind') {
        throw new Error('mdfind error')
      }
      return { stdout: '', stderr: '' }
    })

    // Mock access to succeed for /Applications/Zed.app
    vi.mocked(access).mockImplementation((async (filePath: string) => {
      if (filePath === '/Applications/Zed.app') {
        return undefined
      }
      throw new Error('ENOENT')
    }) as any)

    const editors = await detectEditors()
    const zed = editors.find((e) => e.id === 'zed')

    expect(zed).toBeDefined()
    expect(zed?.name).toBe('Zed')
    expect(zed?.target).toBe('/Applications/Zed.app')
  })
})
