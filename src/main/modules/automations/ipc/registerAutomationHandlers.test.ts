import { describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import type { MainIpcContext } from '../../shared/ipcContext'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  service: {
    configure: vi.fn(),
    list: vi.fn(),
    createAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    deleteAutomation: vi.fn(),
    runNow: vi.fn(),
    listRuns: vi.fn(),
    acknowledgeRun: vi.fn(),
    reviewRun: vi.fn(),
    retryRun: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
  },
}))

vi.mock('../application/automationSchedulerService', () => ({
  automationSchedulerService: mocks.service,
}))

describe('registerAutomationHandlers', () => {
  it('registers triage run IPC handlers against the scheduler service', async () => {
    const { registerAutomationHandlers } = await import('./registerAutomationHandlers')
    const context = { marker: true } as unknown as MainIpcContext

    registerAutomationHandlers(context)

    expect(mocks.service.configure).toHaveBeenCalledWith(context)
    expect(ipcMain.handle).toHaveBeenCalledWith('automations:list-runs', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('automations:acknowledge-run', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('automations:review-run', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('automations:retry-run', expect.any(Function))
  })
})
