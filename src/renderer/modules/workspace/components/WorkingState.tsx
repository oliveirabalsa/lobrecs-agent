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
      className="motion-fade-up-in relative flex items-center gap-3 self-stretch overflow-hidden px-3.5 py-3"
    >
      <AgentGlyph />
      <div className="flex min-w-0 flex-1 items-baseline gap-2 font-mono">
        <span className="truncate text-[13px] font-medium tracking-tight text-accent-loader">
          {phrase}
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block text-accent-loader/80"
            style={{ animation: 'loader-caret 1.05s steps(1, end) infinite' }}
          >
            ▍
          </span>
        </span>
        <span aria-hidden="true" className="text-muted opacity-50">·</span>
        <span className="text-[11px] tabular-nums text-muted">{duration}</span>
      </div>
    </div>
  )
}

/**
 * Claude Code-style mark — a six-pointed asterisk in monospace red that
 * slowly rotates and pulses. Replaces the previous orbiting-dots glyph
 * with a single, denser symbol that reads as a terminal cursor more than
 * a spinner.
 */
function AgentGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center font-mono text-[26px] leading-none text-accent-loader"
      style={{
        animation: 'loader-asterisk 1.6s ease-in-out infinite',
        textShadow: '0 0 12px var(--color-accent-loader-glow)',
      }}
    >
      ✻
    </span>
  )
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
