import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type {
  CliEditorTerminalExitEvent,
  CliEditorTerminalSession,
} from '../../../../shared/types'
import {
  CLI_EDITOR_TERMINAL_OPTIONS,
  CLI_EDITOR_TERMINAL_THEME,
} from './cliEditorTerminalAppearance'
import {
  applyCliEditorCursorState,
  createCliEditorCursorTracker,
  DEFAULT_CLI_EDITOR_CURSOR_STATE,
  type CliEditorCursorState,
  writeTerminalWithCursorState,
} from './cliEditorCursorState'
import { CliEditorCursorBadge } from './CliEditorCursorBadge'

export interface TerminalTab {
  id: string
  label: string
  editorId: string
  editorName: string
  repoPath: string
}

interface BottomTerminalPanelProps {
  initialTab: TerminalTab
  visible: boolean
  fullscreen: boolean
  height: number
  onHeightChange: (height: number) => void
  onFullscreenChange: (fullscreen: boolean) => void
  onClosePanel: () => void
  onEmpty: () => void
  onNewTerminal: () => void
  addTabRef: MutableRefObject<((tab: TerminalTab) => void) | null>
}

export function BottomTerminalPanel({
  initialTab,
  visible,
  fullscreen,
  height,
  onHeightChange,
  onFullscreenChange,
  onClosePanel,
  onEmpty,
  onNewTerminal,
  addTabRef,
}: BottomTerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([initialTab])
  const [activeTabId, setActiveTabId] = useState(initialTab.id)
  const [cursorStates, setCursorStates] = useState<Record<string, CliEditorCursorState>>({
    [initialTab.id]: DEFAULT_CLI_EDITOR_CURSOR_STATE,
  })
  const emptiedRef = useRef(false)

  const addTab = useCallback((tab: TerminalTab) => {
    setTabs((prev) => [...prev, tab])
    setCursorStates((prev) => ({
      ...prev,
      [tab.id]: DEFAULT_CLI_EDITOR_CURSOR_STATE,
    }))
    setActiveTabId(tab.id)
  }, [])

  // Keep the parent ref in sync so WorkspaceView can add tabs from the top bar.
  useEffect(() => {
    addTabRef.current = addTab
    return () => {
      addTabRef.current = null
    }
  }, [addTab, addTabRef])

  const closeTab = useCallback(
    (tabId: string) => {
      setCursorStates((prev) => {
        const { [tabId]: _closed, ...next } = prev
        return next
      })
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId)
        if (next.length === 0) {
          setActiveTabId('')
          return next
        }
        setActiveTabId((active) => {
          if (active !== tabId) return active
          const idx = prev.findIndex((t) => t.id === tabId)
          return next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? ''
        })
        return next
      })
    },
    [],
  )

  const handleCursorStateChange = useCallback(
    (tabId: string, nextState: CliEditorCursorState) => {
      setCursorStates((prev) => {
        const current = prev[tabId]
        if (current && sameCursorDisplayState(current, nextState)) return prev

        return {
          ...prev,
          [tabId]: nextState,
        }
      })
    },
    [],
  )

  useEffect(() => {
    if (tabs.length > 0) {
      emptiedRef.current = false
      return
    }
    if (emptiedRef.current) return
    emptiedRef.current = true
    onEmpty()
  }, [tabs.length, onEmpty])

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const effectiveVisible = visible && mounted

  const panelClassName = fullscreen
    ? 'absolute inset-0 z-40 flex min-h-0 flex-col bg-zinc-950'
    : 'relative flex min-h-0 shrink-0 flex-col bg-zinc-950'

  return (
    <div
      className={panelClassName}
      style={
        fullscreen
          ? undefined
          : {
              height: effectiveVisible ? height : 0,
              overflow: 'hidden',
              opacity: effectiveVisible ? 1 : 0,
              pointerEvents: effectiveVisible ? 'auto' : 'none',
              transition: 'height 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease',
            }
      }
    >
      {fullscreen ? null : <ResizeHandle onResize={onHeightChange} currentHeight={height} />}

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2">
        {tabs.map((tab) => (
          <TerminalTabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onActivate={() => setActiveTabId(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}

        <button
          type="button"
          onClick={onNewTerminal}
          title="New terminal"
          className="ml-1 flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
        >
          <PlusIcon />
        </button>

        <div className="flex-1" />

        {activeTabId ? (
          <CliEditorCursorBadge
            cursorState={cursorStates[activeTabId] ?? DEFAULT_CLI_EDITOR_CURSOR_STATE}
          />
        ) : null}

        <button
          type="button"
          onClick={() => onFullscreenChange(!fullscreen)}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-label={fullscreen ? 'Exit terminal full screen' : 'Full screen terminal'}
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
        >
          {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>

        <button
          type="button"
          onClick={onClosePanel}
          title="Hide terminal panel"
          aria-label="Hide terminal panel"
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.id}
            tab={tab}
            visible={tab.id === activeTabId}
            panelVisible={visible}
            panelFullscreen={fullscreen}
            onCursorStateChange={handleCursorStateChange}
          />
        ))}
      </div>
    </div>
  )
}

export function createTerminalTab(
  editorId: string,
  editorName: string,
  repoPath: string,
  index: number,
): TerminalTab {
  return {
    id: createTerminalSessionId(),
    label: index > 1 ? `${editorName} ${index}` : editorName,
    editorId,
    editorName,
    repoPath,
  }
}

// ─── Resize Handle ───────────────────────────────────────────────────────────

function ResizeHandle({
  onResize,
  currentHeight,
}: {
  onResize: (height: number) => void
  currentHeight: number
}) {
  const startY = useRef(0)
  const startHeight = useRef(0)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      startY.current = event.clientY
      startHeight.current = currentHeight

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = startY.current - moveEvent.clientY
        onResize(Math.max(100, Math.min(window.innerHeight * 0.75, startHeight.current + delta)))
      }

      const handleUp = () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [currentHeight, onResize],
  )

  return (
    <div
      onPointerDown={onPointerDown}
      className="group h-1 w-full shrink-0 cursor-row-resize bg-zinc-800 transition-colors hover:bg-accent-primary/40 active:bg-accent-primary/60"
    />
  )
}

// ─── Tab Button ──────────────────────────────────────────────────────────────

function TerminalTabButton({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: TerminalTab
  active: boolean
  onActivate: () => void
  onClose: () => void
}) {
  return (
    <div
      className={`group flex h-7 max-w-[160px] cursor-pointer items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors ${
        active ? 'bg-zinc-700 text-primary' : 'text-muted hover:bg-zinc-800 hover:text-secondary'
      }`}
      onClick={onActivate}
    >
      <TerminalIcon />
      <span className="min-w-0 truncate">{tab.label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
        title="Close terminal"
      >
        <CloseIcon size={9} />
      </button>
    </div>
  )
}

// ─── Terminal Instance ────────────────────────────────────────────────────────

function TerminalInstance({
  tab,
  visible,
  panelVisible,
  panelFullscreen,
  onCursorStateChange,
}: {
  tab: TerminalTab
  visible: boolean
  panelVisible: boolean
  panelFullscreen: boolean
  onCursorStateChange: (tabId: string, cursorState: CliEditorCursorState) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const exitedRef = useRef(false)
  const visibleRef = useRef(visible)
  const panelVisibleRef = useRef(panelVisible)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAndResizeRef = useRef<(() => void) | null>(null)
  const [session, setSession] = useState<CliEditorTerminalSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exitEvent, setExitEvent] = useState<CliEditorTerminalExitEvent | null>(null)

  useEffect(() => {
    visibleRef.current = visible
    panelVisibleRef.current = panelVisible
    if (!visible || !panelVisible) return
    fitAndResizeRef.current?.()
    window.requestAnimationFrame(() => terminalRef.current?.focus())
  }, [panelFullscreen, panelVisible, visible])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const sessionId = tab.id
    const cursorTracker = createCliEditorCursorTracker()

    const term = new Terminal({
      ...CLI_EDITOR_TERMINAL_OPTIONS,
      theme: { ...CLI_EDITOR_TERMINAL_THEME },
    })
    terminalRef.current = term

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    applyCliEditorCursorState(term, cursorTracker.state)
    try {
      fitAddon.fit()
    } catch {
      /* layout not settled yet */
    }

    const fitAndResize = () => {
      if (disposed) return
      if (!visibleRef.current || !panelVisibleRef.current) return
      window.requestAnimationFrame(() => {
        if (disposed) return
        if (!visibleRef.current || !panelVisibleRef.current) return
        try {
          fitAddon.fit()
          void window.agentforge.system.resizeCliEditorTerminal({
            sessionId,
            cols: term.cols,
            rows: term.rows,
          })
        } catch {
          /* container between layout states */
        }
      })
    }
    fitAndResizeRef.current = fitAndResize

    const dataDisposable = term.onData((data) => {
      void window.agentforge.system.writeCliEditorTerminal({ sessionId, data })
    })

    const offData = window.agentforge.system.onCliEditorTerminalData((event) => {
      if (event.sessionId !== sessionId) return
      writeTerminalWithCursorState(term, cursorTracker, event.data, (nextState) => {
        onCursorStateChange(tab.id, nextState)
      })
    })

    const offExit = window.agentforge.system.onCliEditorTerminalExit((event) => {
      if (event.sessionId !== sessionId) return
      exitedRef.current = true
      setExitEvent(event)
      term.write(`\r\n[${tab.editorName} exited with code ${event.exitCode}]\r\n`)
    })

    const resizeObserver = new ResizeObserver(fitAndResize)
    resizeObserver.observe(container)
    const handlePointerFocus = () => {
      window.requestAnimationFrame(() => term.focus())
    }
    container.addEventListener('mousedown', handlePointerFocus)
    fitAndResize()

    term.write(`Starting ${tab.editorName} in ${tab.repoPath}\r\n`)
    void window.agentforge.system
      .startCliEditorTerminal({
        sessionId,
        editorId: tab.editorId,
        repoPath: tab.repoPath,
        cols: term.cols,
        rows: term.rows,
      })
      .then((started) => {
        if (disposed) {
          void window.agentforge.system.stopCliEditorTerminal(started.sessionId)
          return
        }
        setSession(started)
        window.requestAnimationFrame(() => term.focus())
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : 'Failed to start terminal'
        setError(message)
        term.write(`\r\n${message}\r\n`)
      })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      dataDisposable.dispose()
      offData()
      offExit()
      container.removeEventListener('mousedown', handlePointerFocus)
      term.dispose()
      if (terminalRef.current === term) {
        terminalRef.current = null
      }
      fitAndResizeRef.current = null
      if (!exitedRef.current) {
        void window.agentforge.system.stopCliEditorTerminal(sessionId)
      }
    }
    // tab.id is stable (UUID created once); the other tab fields don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCursorStateChange, tab.id])

  void session
  void error
  void exitEvent

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-zinc-950 p-2"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sameCursorDisplayState(
  left: CliEditorCursorState,
  right: CliEditorCursorState,
): boolean {
  return left.mode === right.mode && left.shape === right.shape && left.blink === right.blink
}

function createTerminalSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CloseIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5.5 2.5h-3v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 2.5 6 6" strokeLinecap="round" />
      <path d="M10.5 2.5h3v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 2.5 10 6" strokeLinecap="round" />
      <path d="M5.5 13.5h-3v-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 13.5 6 10" strokeLinecap="round" />
      <path d="M10.5 13.5h3v-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 13.5 10 10" strokeLinecap="round" />
    </svg>
  )
}

function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2.5v3.5H2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 6 6 2.5" strokeLinecap="round" />
      <path d="M10 2.5v3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6 10 2.5" strokeLinecap="round" />
      <path d="M6 13.5V10H2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 10 6 13.5" strokeLinecap="round" />
      <path d="M10 13.5V10h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 10 10 13.5" strokeLinecap="round" />
    </svg>
  )
}
