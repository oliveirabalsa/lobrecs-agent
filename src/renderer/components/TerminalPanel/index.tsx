import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type {
  ApprovalRequest,
  DiffProposal,
  SessionStatus,
} from '../../../shared/types'
import { ApprovalBanner } from '../ApprovalBanner'
import { DiffViewer } from '../DiffViewer'
import {
  createTerminalEventHandler,
  isLiveDiffPayload,
  type TerminalEventCallbacks,
} from './events'

interface Props {
  sessionId: string | null
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  onDiffProposals: (proposals: DiffProposal[]) => void
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void | Promise<void>
  onRejectApproval: () => void | Promise<void>
}

export function TerminalPanel({
  sessionId,
  diffProposals,
  approvalRequest,
  onDiffProposals,
  onApprovalRequest,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const seenEventsRef = useRef<Set<string>>(new Set())
  const callbacksRef = useRef<TerminalEventCallbacks>({
    onDiffProposals,
    onApprovalRequest,
    onStatusChange,
  })

  useEffect(() => {
    callbacksRef.current = {
      onDiffProposals,
      onApprovalRequest,
      onStatusChange,
    }
  })

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#18181b',
        foreground: '#f4f4f5',
        cursor: '#a1a1aa',
        black: '#18181b',
        blue: '#60a5fa',
        cyan: '#22d3ee',
        green: '#34d399',
        red: '#f87171',
        yellow: '#fbbf24',
        magenta: '#c084fc',
        white: '#f4f4f5',
      },
      fontFamily: 'JetBrainsMono Nerd Font, JetBrains Mono NF, JetBrains Mono, MesloLGS NF, Hack Nerd Font, FiraCode Nerd Font, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: false,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitAddonRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => fitAddon.fit())
    })
    resizeObserver.observe(containerRef.current)

    term.write('Select a project and run a task to stream agent output.\r\n')

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.reset()
    seenEventsRef.current = new Set()
    callbacksRef.current.onDiffProposals([])
    callbacksRef.current.onApprovalRequest(null)

    if (!sessionId) {
      term.write('No active session.\r\n')
      return
    }

    term.write(`Session ${sessionId} started.\r\n`)

    const handleEvent = createTerminalEventHandler(
      term,
      {
        onDiffProposals: (proposals) => callbacksRef.current.onDiffProposals(proposals),
        onApprovalRequest: (request) => callbacksRef.current.onApprovalRequest(request),
        onStatusChange: (status) => callbacksRef.current.onStatusChange(status),
      },
      seenEventsRef.current,
    )

    let cancelled = false
    const unsubscribe = window.agentforge.on(`session:${sessionId}`, handleEvent)
    void window.agentforge.sessions
      .listEvents(sessionId)
      .then((events) => {
        if (cancelled) return
        events
          .filter((event) => !(event.type === 'diff' && isLiveDiffPayload(event.payload)))
          .forEach(handleEvent)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId])

  useEffect(() => {
    window.requestAnimationFrame(() => fitAddonRef.current?.fit())
  }, [diffProposals.length, approvalRequest])

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-950 p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <div
          ref={containerRef}
          className={`min-h-[240px] flex-1 overflow-hidden bg-zinc-900 p-2 ${
            diffProposals.length > 0 ? 'basis-[48%]' : ''
          }`}
        />

        {diffProposals.length > 0 ? (
          <div className="h-[46%] min-h-[280px]">
            <DiffViewer proposals={diffProposals} />
          </div>
        ) : approvalRequest && sessionId ? (
          <ApprovalBanner
            request={approvalRequest}
            sessionId={sessionId}
            onApprove={onApproveApproval}
            onReject={onRejectApproval}
          />
        ) : null}
      </div>
    </section>
  )
}
