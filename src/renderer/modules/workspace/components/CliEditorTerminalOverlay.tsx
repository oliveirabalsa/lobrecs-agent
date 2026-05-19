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
  const [session, setSession] = useState<CliEditorTerminalSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exitEvent, setExitEvent] = useState<CliEditorTerminalExitEvent | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const sessionId = sessionIdRef.current
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

    const offData = window.agentforge.system.onCliEditorTerminalData((event) => {
      if (event.sessionId !== sessionId) return
      term.write(event.data)
    })
    const offExit = window.agentforge.system.onCliEditorTerminalExit((event) => {
      if (event.sessionId !== sessionId) return
      exitedRef.current = true
      setExitEvent(event)
      term.write(`\r\n[${editorName} exited with code ${event.exitCode}]\r\n`)
    })

    const resizeObserver = new ResizeObserver(fitAndResize)
    resizeObserver.observe(container)
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
    <div className="absolute inset-0 z-40 flex min-w-0 flex-col bg-zinc-950 text-primary">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs font-medium text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <BackIcon />
          <span>Back</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-primary">
            {session?.command ?? (editorId === 'shell' ? editorName : `${editorName} .`)}
          </div>
          <div className="truncate text-[10px] text-muted">{repoPath}</div>
        </div>

        <div
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${
            error
              ? 'bg-accent-del/10 text-accent-del'
              : exitEvent
                ? 'bg-white/5 text-muted'
                : 'bg-accent-add/10 text-accent-add'
          }`}
        >
          {statusLabel}
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-zinc-950 p-2" />
    </div>
  )
}

function createTerminalSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId) return randomId

  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function BackIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  )
}
