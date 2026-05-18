import { useEffect, useState } from 'react'
import { Spinner } from '../../../components/ui'
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
 * Codex/Cursor/Claude-Code-style status row shown while a turn is in flight:
 * a small spinner + a rotating playful phrase + elapsed time. Replaces the
 * per-step "STEP ..." pill ticker, which leaked low-signal infra detail.
 * Once `running` is false, collapses to a static "Worked for Xs" label.
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
    const inner = (
      <span className="inline-flex items-center gap-2 text-xs text-muted">
        <span className="inline-flex h-3 w-3 items-center justify-center text-secondary">
          <Spinner size={12} />
        </span>
        <span className="text-secondary">{phrase}…</span>
        <span aria-hidden="true" className="opacity-50">·</span>
        <span aria-live="off">{duration}</span>
      </span>
    )

    if (onToggle) {
      return (
        <button
          type="button"
          onClick={onToggle}
          className="self-start transition-colors hover:opacity-80"
          aria-label={`${phrase} — ${duration}`}
        >
          {inner}
        </button>
      )
    }
    return <div className="self-start">{inner}</div>
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
