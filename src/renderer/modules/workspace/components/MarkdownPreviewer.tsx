import { useCallback, useState, type ReactNode } from 'react'
import { Modal, Spinner } from '../../../components/ui'
import { MarkdownContent, type MarkdownLinkRequest } from './MarkdownContent'

export interface MarkdownPreviewDocument {
  title: string
  content: string
  sourceLabel?: string
  suggestedFileName?: string
}

export type MarkdownPreviewState =
  | { kind: 'loading'; title: string }
  | { kind: 'ready'; document: MarkdownPreviewDocument }
  | { kind: 'error'; title: string; message: string }

export interface MarkdownPreviewerProps {
  state: MarkdownPreviewState | null
  onOpenChange: (open: boolean) => void
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
}

export function MarkdownPreviewer({
  state,
  onOpenChange,
  onOpenMarkdown,
}: MarkdownPreviewerProps) {
  const [copied, setCopied] = useState(false)
  const ready = state?.kind === 'ready' ? state.document : null
  const title = previewTitle(state)

  const copyMarkdown = useCallback(() => {
    if (!ready) return
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(ready.content)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }, [ready])

  const downloadMarkdown = useCallback(() => {
    if (!ready || typeof document === 'undefined') return

    const blob = new Blob([ready.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ready.suggestedFileName ?? toMarkdownFileName(ready.title)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [ready])

  return (
    <Modal
      open={state !== null}
      onOpenChange={onOpenChange}
      title={title}
      visualTitle={false}
      maxWidth={920}
    >
      <section className="flex max-h-[82vh] min-h-[420px] flex-col overflow-hidden">
        <header className="flex min-w-0 shrink-0 items-start gap-3 border-b border-hairline pb-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-hairline bg-card-raised text-accent-primary">
            {iconDocument}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold leading-6 text-primary">
              {title}
            </h2>
            {ready?.sourceLabel ? (
              <div className="truncate font-mono text-[11px] text-muted">
                {ready.sourceLabel}
              </div>
            ) : null}
          </div>
          {ready ? (
            <div className="flex shrink-0 items-center gap-1">
              <IconButton label={copied ? 'Copied' : 'Copy'} onClick={copyMarkdown}>
                {iconCopy}
              </IconButton>
              <IconButton label="Download" onClick={downloadMarkdown}>
                {iconDownload}
              </IconButton>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
          {state?.kind === 'loading' ? (
            <div className="flex h-full min-h-72 items-center justify-center gap-2 text-sm text-secondary">
              <Spinner size={16} />
              <span>Loading preview</span>
            </div>
          ) : state?.kind === 'error' ? (
            <div className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2.5 text-sm leading-6 text-accent-del">
              {state.message}
            </div>
          ) : ready ? (
            <MarkdownContent
              text={ready.content}
              onOpenMarkdown={onOpenMarkdown}
              className="mx-auto max-w-[760px]"
            />
          ) : null}
        </div>
      </section>
    </Modal>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-white/5 hover:text-primary"
    >
      {children}
    </button>
  )
}

function toMarkdownFileName(title: string): string {
  const safe = title
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  if (!safe) return 'markdown-preview.md'
  return /\.(md|mdx|markdown)$/i.test(safe) ? safe : `${safe}.md`
}

function previewTitle(state: MarkdownPreviewState | null): string {
  if (!state) return 'Markdown preview'
  if (state.kind === 'ready') return state.document.title
  return state.title
}

const iconDocument = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M4 2.5h5l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
    <path d="M9 2.5V5a1 1 0 0 0 1 1h2" />
    <path d="M5 8h6M5 10.5h5M5 12.5h3" strokeLinecap="round" />
  </svg>
)

const iconCopy = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" />
  </svg>
)

const iconDownload = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M8 2.5v7" strokeLinecap="round" />
    <path d="m5.2 7.4 2.8 2.8 2.8-2.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.2 11.5v1A1.5 1.5 0 0 0 4.7 14h6.6a1.5 1.5 0 0 0 1.5-1.5v-1" strokeLinecap="round" />
  </svg>
)
