import { describe, expect, it } from 'vitest'
import type { AppUpdateState } from '../../../../shared/types'
import { createAppUpdateViewModel } from './updateCopy'

const baseState: AppUpdateState = {
  currentVersion: '0.1.1',
  phase: 'idle',
  canCheck: true,
  canDownload: false,
  canInstall: false,
}

describe('createAppUpdateViewModel', () => {
  it('prompts for download when an update is available', () => {
    const viewModel = createAppUpdateViewModel({
      ...baseState,
      phase: 'available',
      canDownload: true,
      update: { version: '0.1.2' },
    })

    expect(viewModel).toMatchObject({
      title: 'Version 0.1.2 is available',
      primaryAction: 'download',
      primaryLabel: 'Download',
      tone: 'warning',
    })
  })

  it('prompts for restart only after the update is downloaded', () => {
    const viewModel = createAppUpdateViewModel({
      ...baseState,
      phase: 'downloaded',
      canInstall: true,
      update: { version: '0.1.2' },
    })

    expect(viewModel).toMatchObject({
      title: 'Version 0.1.2 is ready',
      primaryAction: 'install',
      primaryLabel: 'Restart to update',
      tone: 'success',
    })
  })

  it('shows packaged-build guidance when updates are disabled', () => {
    const viewModel = createAppUpdateViewModel({
      ...baseState,
      phase: 'disabled',
      canCheck: false,
      message: 'Updates are available from packaged builds only.',
    })

    expect(viewModel).toMatchObject({
      title: 'Updates unavailable in this build',
      detail: 'Updates are available from packaged builds only.',
      tone: 'warning',
    })
    expect(viewModel.primaryAction).toBeUndefined()
  })

  it('shows a manual update action when macOS rejects the update signature', () => {
    const viewModel = createAppUpdateViewModel({
      ...baseState,
      phase: 'error',
      canManualDownload: true,
      message: 'macOS rejected the downloaded update signature.',
      error: 'code failed to satisfy specified code requirement(s)',
    })

    expect(viewModel).toMatchObject({
      title: 'Manual update required',
      detail: 'macOS rejected the downloaded update signature.',
      tone: 'warning',
    })
    expect(viewModel.primaryAction).toBeUndefined()
  })
})
