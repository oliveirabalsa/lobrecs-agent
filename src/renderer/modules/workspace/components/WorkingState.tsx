import { useEffect, useState } from 'react'
import { WORKING_PHRASES } from '../lib/workingPhrases'

export interface WorkingStateProps {
  /** Epoch millis when this turn started. */
  startedAt: number
  /** True while the underlying session is actively running. */
  running: boolean
  /** Optional explicit duration to display once `running` is false. */
  totalMs?: number
  /** Called when the user clicks the label (collapse/expand toggle). */
  onToggle?: () => void
}

const PHRASE_ROTATION_MS = 3_000

function pickRandomPhrase(exclude?: string): string {
  if (WORKING_PHRASES.length === 0) return 'Working'
  if (WORKING_PHRASES.length === 1) return WORKING_PHRASES[0]
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = WORKING_PHRASES[Math.floor(Math.random() * WORKING_PHRASES.length)]
    if (candidate !== exclude) return candidate
  }
  return WORKING_PHRASES[0]
}

/**
 * Status row shown while a turn is in flight. Live runs render a larger
 * "agent harness" indicator with a scanning sweep, orbiting glyphs and the
 * rotating phrase + elapsed time. Once the run completes it collapses to a
 * single "Worked for Xs" label so historical turns stay compact.
 */
export function WorkingState({ startedAt, running, totalMs, onToggle }: WorkingStateProps) {
  const [now, setNow] = useState(() => Date.now())
  const [phrase, setPhrase] = useState(() => pickRandomPhrase())

  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(tick)
  }, [running])

  useEffect(() => {
    if (!running) return
    const rotate = window.setInterval(() => {
      setPhrase((prev) => pickRandomPhrase(prev))
    }, PHRASE_ROTATION_MS)
    return () => window.clearInterval(rotate)
  }, [running])

  const elapsedMs = running
    ? Math.max(0, now - startedAt)
    : (totalMs ?? Math.max(0, now - startedAt))
  const duration = formatDuration(elapsedMs)

  if (running) {
    return <AgentRunIndicator phrase={phrase} duration={duration} />
  }

  const label = `Worked for ${duration}`
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="self-start text-xs text-muted transition-colors hover:text-secondary"
      >
        {label}
      </button>
    )
  }
  return <div className="text-xs text-muted">{label}</div>
}

interface AgentRunIndicatorProps {
  phrase: string
  duration: string
}

function AgentRunIndicator({ phrase, duration }: AgentRunIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${phrase} for ${duration}`}
      className="motion-fade-up-in relative flex items-center gap-3 self-stretch overflow-hidden rounded-card border border-hairline bg-card-raised px-3.5 py-3"
    >
      <AgentGlyph />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-primary">{phrase}</span>
          <span aria-hidden="true" className="text-muted opacity-50">·</span>
          <span className="font-mono text-[11px] tabular-nums text-muted">{duration}</span>
        </div>
        <ScanBar />
      </div>
    </div>
  )
}

/**
 * Square SVG mark — three concentric arcs with orbiting dots. Reads as a
 * "harness" rather than a loading spinner: each ring is a different layer
 * (planning, tool use, response) softly pulsing.
 */
function AgentGlyph() {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-9 w-9 shrink-0 items-center justify-center"
    >
      <span
        className="absolute inset-0 rounded-full border border-accent-primary/30"
        style={{ animation: 'loader-pulse 1.8s ease-in-out infinite' }}
      />
      <span
        className="absolute inset-[5px] rounded-full border border-accent-primary/45"
        style={{ animation: 'loader-pulse 1.8s ease-in-out infinite', animationDelay: '180ms' }}
      />
      <div
        className="absolute inset-0"
        style={{ animation: 'loader-orbit 2.4s linear infinite' }}
      >
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent-primary shadow-[0_0_6px_rgba(59,130,246,0.65)]" />
      </div>
      <div
        className="absolute inset-[5px]"
        style={{ animation: 'loader-orbit 3.2s linear infinite reverse' }}
      >
        <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-add/80" />
      </div>
      <span
        className="relative h-1.5 w-1.5 rounded-full bg-primary"
        style={{ animation: 'loader-glyph 1.4s ease-in-out infinite' }}
      />
    </div>
  )
}

/** Track + travelling highlight — evokes a tool running on the local box. */
function ScanBar() {
  return (
    <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-hairline">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent-primary/80 to-transparent"
        style={{ animation: 'loader-scan 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite' }}
      />
    </div>
  )
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
