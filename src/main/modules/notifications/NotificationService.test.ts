import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../settings/domain/defaultSettings'

const notificationState = vi.hoisted(() => ({
  isSupported: true,
  instances: [] as Array<{ show: ReturnType<typeof vi.fn>; emitter: EventEmitter; options: unknown }>,
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')

  class MockNotification extends EventEmitter {
    show = vi.fn()
    constructor(public readonly options: unknown) {
      super()
      notificationState.instances.push({ show: this.show, emitter: this, options })
    }
    static isSupported(): boolean {
      return notificationState.isSupported
    }
  }

  return { Notification: MockNotification }
})

import { NotificationService, type NotificationDispatch } from './NotificationService'

function cloneSettings(): AppSettings {
  return structuredClone(DEFAULT_APP_SETTINGS)
}

function makeWindow(focused: boolean) {
  return {
    isFocused: vi.fn().mockReturnValue(focused),
    isMinimized: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
}

function makeDispatch(overrides: Partial<NotificationDispatch> = {}): NotificationDispatch {
  return {
    type: 'swarm.completed',
    title: 'Swarm complete',
    body: '3 agents finished',
    click: { type: 'swarm.completed', projectId: 'proj-1', threadId: 'thread-1' },
    ...overrides,
  }
}

beforeEach(() => {
  notificationState.isSupported = true
  notificationState.instances = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('NotificationService.dispatch', () => {
  it('skips dispatch when Notification.isSupported() is false', () => {
    notificationState.isSupported = false
    const service = new NotificationService({
      getSettings: () => cloneSettings(),
      getMainWindow: () => makeWindow(false) as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(makeDispatch())

    expect(notificationState.instances).toHaveLength(0)
  })

  it('skips dispatch when master toggle is off', () => {
    const settings = cloneSettings()
    settings.general.enableDesktopNotifications = false
    const service = new NotificationService({
      getSettings: () => settings,
      getMainWindow: () => makeWindow(false) as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(makeDispatch())

    expect(notificationState.instances).toHaveLength(0)
  })

  it('skips a specific event when its per-event toggle is off', () => {
    const settings = cloneSettings()
    settings.general.notificationEvents.swarmCompleted = false
    const service = new NotificationService({
      getSettings: () => settings,
      getMainWindow: () => makeWindow(false) as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(makeDispatch({ type: 'swarm.completed' }))

    expect(notificationState.instances).toHaveLength(0)
  })

  it('skips dispatch when window is focused and onlyWhenUnfocused is true', () => {
    const settings = cloneSettings()
    settings.general.onlyWhenUnfocused = true
    const service = new NotificationService({
      getSettings: () => settings,
      getMainWindow: () => makeWindow(true) as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(makeDispatch())

    expect(notificationState.instances).toHaveLength(0)
  })

  it('fires a notification with correct title and body on the happy path', () => {
    const service = new NotificationService({
      getSettings: () => cloneSettings(),
      getMainWindow: () => makeWindow(false) as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(
      makeDispatch({
        type: 'diff.ready',
        title: 'Diff ready',
        body: '5 files changed',
        click: { type: 'diff.ready', projectId: 'proj-1', sessionId: 'sess-9' },
      }),
    )

    expect(notificationState.instances).toHaveLength(1)
    const created = notificationState.instances[0]
    expect(created.options).toMatchObject({ title: 'Diff ready', body: '5 files changed' })
    expect(created.show).toHaveBeenCalledTimes(1)
  })

  it('focuses the main window and forwards the click payload on click', () => {
    const window = makeWindow(false)
    const sendToRenderer = vi.fn()
    const service = new NotificationService({
      getSettings: () => cloneSettings(),
      getMainWindow: () => window as never,
      sendToRenderer,
    })

    const dispatch = makeDispatch({
      type: 'session.error',
      title: 'Session error',
      body: 'Adapter crashed',
      click: {
        type: 'session.error',
        projectId: 'proj-2',
        threadId: 'thread-2',
        sessionId: 'sess-7',
      },
    })
    service.dispatch(dispatch)

    notificationState.instances[0].emitter.emit('click')

    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(sendToRenderer).toHaveBeenCalledWith('notification:click', dispatch.click)
  })

  it('restores a minimized window before focusing', () => {
    const window = makeWindow(false)
    window.isMinimized.mockReturnValue(true)
    const service = new NotificationService({
      getSettings: () => cloneSettings(),
      getMainWindow: () => window as never,
      sendToRenderer: vi.fn(),
    })

    service.dispatch(makeDispatch())
    notificationState.instances[0].emitter.emit('click')

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
