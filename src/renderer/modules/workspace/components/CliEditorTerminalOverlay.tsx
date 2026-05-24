import { useEffect, useRef, useState } from 'react'
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
import { closeCliEditorOverlay } from './cliEditorOverlayEscape'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

interface CliEditorTerminalOverlayProps {
  editorId: string
  editorName: string
  repoPath: string
  onClose: () => void
}

export function CliEditorTerminalOverlay({
  editorId,
  editorName,
  repoPath,
  onClose,
}: CliEditorTerminalOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef(createTerminalSessionId())
  const exitedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const [session, setSession] = useState<CliEditorTerminalSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exitEvent, setExitEvent] = useState<CliEditorTerminalExitEvent | null>(null)
  const [cursorState, setCursorState] = useState<CliEditorCursorState>(
    DEFAULT_CLI_EDITOR_CURSOR_STATE,
  )

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!exitEvent) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const isVim = editorId === 'vim' || editorId === 'nvim'
      closeCliEditorOverlay(event, () => onCloseRef.current(), isVim)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exitEvent, editorId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const sessionId = sessionIdRef.current
    const cursorTracker = createCliEditorCursorTracker()
    const term = new Terminal({
      ...CLI_EDITOR_TERMINAL_OPTIONS,
      theme: { ...CLI_EDITOR_TERMINAL_THEME },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    try {
      fitAddon.fit()
    } catch {
      // The first ResizeObserver pass will retry after layout settles.
    }

    const fitAndResize = () => {
      if (disposed) return
      window.requestAnimationFrame(() => {
        if (disposed) return
        try {
          fitAddon.fit()
          void window.agentforge.system.resizeCliEditorTerminal({
            sessionId,
            cols: term.cols,
            rows: term.rows,
          })
        } catch {
          // xterm can throw if the container is between layout states.
        }
      })
    }

    const dataDisposable = term.onData((data) => {
      void window.agentforge.system.writeCliEditorTerminal({ sessionId, data })
    })

    term.attachCustomKeyEventHandler((event) => {
      const isVim = editorId === 'vim' || editorId === 'nvim'
      if (event.key === 'Escape') {
        const closed = closeCliEditorOverlay(event, () => onCloseRef.current(), isVim)
        if (closed) return false
      }
      return true
    })

    applyCliEditorCursorState(term, cursorTracker.state)

    const offData = window.agentforge.system.onCliEditorTerminalData((event) => {
      if (event.sessionId !== sessionId) return
      writeTerminalWithCursorState(term, cursorTracker, event.data, (nextState) => {
        setCursorState((current) =>
          current.mode === nextState.mode && current.shape === nextState.shape ? current : nextState,
        )
      })
    })
    const offExit = window.agentforge.system.onCliEditorTerminalExit((event) => {
      if (event.sessionId !== sessionId) return
      exitedRef.current = true
      setExitEvent(event)
      term.write(`\r\n[${editorName} exited with code ${event.exitCode}]\r\n`)
    })

    const resizeObserver = new ResizeObserver(fitAndResize)
    resizeObserver.observe(container)
    const handlePointerFocus = () => {
      window.requestAnimationFrame(() => term.focus())
    }
    container.addEventListener('mousedown', handlePointerFocus)
    fitAndResize()

    term.write(`Starting ${editorName} in ${repoPath}\r\n`)
    void window.agentforge.system
      .startCliEditorTerminal({
        sessionId,
        editorId,
        repoPath,
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

      if (!exitedRef.current) {
        void window.agentforge.system.stopCliEditorTerminal(sessionId)
      }
    }
  }, [editorId, editorName, repoPath])

  const statusLabel = error
    ? 'Failed'
    : exitEvent
      ? `Exited ${exitEvent.exitCode}`
      : session
        ? 'Running'
        : 'Starting'

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-6 sm:p-8">
      <div className="relative w-full h-full bg-card rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-hairline bg-card-raised/50 px-5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-primary">
              {editorId === 'lazygit' ? 'LazyGit' : editorName}
            </span>
            <span className="text-xs text-muted truncate max-w-xs md:max-w-md">
              {repoPath}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CliEditorCursorBadge cursorState={cursorState} />
            <div
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase ${
                error
                  ? 'bg-accent-del/10 text-accent-del'
                  : exitEvent
                    ? 'bg-white/5 text-muted'
                    : 'bg-accent-add/10 text-accent-add'
              }`}
            >
              {statusLabel}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-secondary hover:text-primary hover:bg-white/5 transition-colors border border-hairline hover:border-white/15"
            >
              <span>Close</span>
              <kbd className="text-[10px] opacity-60">
                {editorId === 'vim' || editorId === 'nvim' ? (isMac ? '⌘Esc' : 'Cmd+Esc') : 'Esc'}
              </kbd>
            </button>
          </div>
        </div>
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-canvas p-4" />
      </div>
    </div>
  )
}

function createTerminalSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId) return randomId

  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
