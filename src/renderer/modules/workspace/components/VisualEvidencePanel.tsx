import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RunAuditRecord } from '../../../../shared/types'
import { deriveVisualEvidenceRows } from './artifacts'
import { emitRunAuditUpdated } from '../lib/runAuditEvents'

interface VisualEvidencePanelProps {
  sessionId: string | null
}

const VIEWPORT_PRESETS = [
  { id: 'desktop', label: 'Desktop', width: 1280, height: 720 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
]

export function VisualEvidencePanel({ sessionId }: VisualEvidencePanelProps) {
  const [records, setRecords] = useState<RunAuditRecord[]>([])
  const [url, setUrl] = useState('http://localhost:5173/')
  const [viewportPreset, setViewportPreset] = useState(VIEWPORT_PRESETS[0].id)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const evidenceRows = useMemo(() => deriveVisualEvidenceRows(records).reverse(), [records])
  const selectedViewport =
    VIEWPORT_PRESETS.find((preset) => preset.id === viewportPreset) ?? VIEWPORT_PRESETS[0]

  const loadRecords = useCallback(async () => {
    if (!sessionId) {
      setRecords([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const nextRecords = await window.agentforge.runs.listSessionAuditRecords(sessionId)
      setRecords(nextRecords)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Failed to load visual evidence.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const handleCapture = useCallback(async () => {
    if (!sessionId || capturing) return
    setCapturing(true)
    setError(null)
    try {
      await window.agentforge.runs.captureVisualEvidence(sessionId, {
        url,
        viewport: {
          width: selectedViewport.width,
          height: selectedViewport.height,
          deviceScaleFactor: 1,
        },
        replayNotes: notes.trim() || undefined,
      })
      emitRunAuditUpdated(sessionId)
      await loadRecords()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Failed to capture visual evidence.')
    } finally {
      setCapturing(false)
    }
  }, [capturing, loadRecords, notes, selectedViewport, sessionId, url])

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-hairline p-3">
        <div className="space-y-3 rounded-card border border-hairline bg-card/70 p-3">
          <label className="block text-[11px] font-medium text-secondary">
            Local URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={!sessionId || capturing}
              placeholder="http://localhost:5173/"
              className="mt-1 h-8 w-full rounded-card border border-hairline bg-canvas px-2 font-mono text-[11px] text-primary outline-none focus:border-accent-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            {VIEWPORT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={!sessionId || capturing}
                onClick={() => setViewportPreset(preset.id)}
                className={`rounded-card border px-2 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  viewportPreset === preset.id
                    ? 'border-accent-primary/50 bg-accent-primary/10 text-primary'
                    : 'border-hairline bg-canvas/60 text-muted hover:bg-white/5 hover:text-secondary'
                }`}
              >
                <span className="block font-medium">{preset.label}</span>
                <span className="text-[10px] tabular-nums text-muted">
                  {preset.width}x{preset.height}
                </span>
              </button>
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={!sessionId || capturing}
            placeholder="Replay notes"
            rows={3}
            className="w-full resize-none rounded-card border border-hairline bg-canvas px-2 py-2 text-[11px] text-primary outline-none focus:border-accent-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <button
            type="button"
            disabled={!sessionId || capturing || url.trim().length === 0}
            onClick={() => void handleCapture()}
            className="flex h-8 w-full items-center justify-center rounded-card bg-accent-primary px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {capturing ? 'Capturing...' : 'Capture evidence'}
          </button>
          {error ? (
            <div className="rounded-card border border-accent-del/30 bg-accent-del/5 px-2 py-1.5 text-[11px] text-accent-del">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!sessionId ? (
          <EmptyEvidenceState message="Open a session to capture evidence." />
        ) : loading ? (
          <EmptyEvidenceState message="Loading evidence..." />
        ) : evidenceRows.length === 0 ? (
          <EmptyEvidenceState message="No browser evidence captured yet." />
        ) : (
          <div className="grid gap-3">
            {evidenceRows.map((row) => (
              <article
                key={row.id}
                className="overflow-hidden rounded-card border border-hairline bg-card/70"
              >
                <div className="aspect-video border-b border-hairline bg-canvas">
                  {row.screenshotDataUrl ? (
                    <img
                      src={row.screenshotDataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-muted">
                      No screenshot
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-3 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-pill border px-1.5 py-0.5 text-[10px] font-medium ${
                        row.status === 'captured'
                          ? 'border-accent-add/25 bg-accent-add/5 text-accent-add'
                          : 'border-accent-del/30 bg-accent-del/5 text-accent-del'
                      }`}
                    >
                      {row.status === 'captured' ? 'Captured' : 'Failed'}
                    </span>
                    <span className="min-w-0 truncate font-medium text-secondary">
                      {row.title ?? row.finalUrl ?? row.url}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted" title={row.finalUrl ?? row.url}>
                    {row.finalUrl ?? row.url}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-muted">
                    <Metric label="Viewport" value={row.viewport} />
                    <Metric label="Console" value={String(row.consoleErrorCount)} />
                    <Metric label="Network" value={String(row.networkFailureCount)} />
                  </div>
                  {row.replayNotes ? (
                    <p className="rounded border border-hairline bg-canvas/50 px-2 py-1.5 text-[10px] text-muted">
                      {row.replayNotes}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function EmptyEvidenceState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted">
      {message}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-hairline bg-canvas/50 px-2 py-1.5">
      <div className="uppercase text-muted/70">{label}</div>
      <div className="mt-0.5 truncate font-mono text-secondary">{value}</div>
    </div>
  )
}
