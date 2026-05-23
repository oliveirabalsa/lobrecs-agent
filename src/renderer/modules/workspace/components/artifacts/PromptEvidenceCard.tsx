import type { PromptEvidenceRecord } from '../../../../../shared/types'

export interface PromptEvidenceCardProps {
  evidence: PromptEvidenceRecord | null
}

export function PromptEvidenceCard({ evidence }: PromptEvidenceCardProps) {
  if (!evidence) return null

  return (
    <article className="rounded-card border border-hairline bg-card">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-primary">Prompt evidence</div>
            <div className="mt-0.5 text-xs text-muted">
              Context captured before the CLI session started.
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[11px] text-secondary">
            {evidence.redacted ? (
              <span className="rounded border border-accent-warn/40 bg-accent-warn/10 px-2 py-0.5 text-accent-warn">
                redacted
              </span>
            ) : null}
            <span className="rounded border border-hairline bg-card-raised px-2 py-0.5">
              {formatBytes(evidence.contextBytes)}
            </span>
          </div>
        </summary>
        <div className="border-t border-hairline px-4 py-3">
          <EvidenceBlock title="Resolved context" value={evidence.resolvedContext} />
          <EvidenceBlock title="Final adapter context" value={evidence.adapterContext} />
        </div>
      </details>
    </article>
  )
}

function EvidenceBlock({ title, value }: { title: string; value?: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[11px] font-medium uppercase text-muted">{title}</div>
      {value?.trim() ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-card border border-hairline bg-card-raised px-3 py-2 text-[11px] leading-5 text-secondary">
          {value}
        </pre>
      ) : (
        <div className="rounded-card border border-hairline bg-card-raised px-3 py-2 text-xs text-muted">
          No context was injected.
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 102.4) / 10} KB`
}

