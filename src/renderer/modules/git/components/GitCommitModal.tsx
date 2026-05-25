import { useCallback, useRef, useState } from 'react'

interface GitCommitModalProps {
  open: boolean
  onClose: () => void
  onCommit: (message: string) => void
  onGenerateAI?: () => Promise<string | null>
}

export function GitCommitModal({ open, onClose, onCommit, onGenerateAI }: GitCommitModalProps) {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed) return
    onCommit(trimmed)
    setMessage('')
    onClose()
  }, [message, onCommit, onClose])

  const handleGenerate = useCallback(async () => {
    if (!onGenerateAI || generating) return
    setGenerating(true)
    try {
      const generated = await onGenerateAI()
      if (generated) setMessage(generated)
    } finally {
      setGenerating(false)
      textareaRef.current?.focus()
    }
  }, [onGenerateAI, generating])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="w-full max-w-xl border border-hairline bg-canvas shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-hairline px-3 py-2 font-mono text-[12px]">
          <span className="text-primary">commit</span>
          <div className="flex items-center gap-3 text-muted">
            {onGenerateAI ? (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400 hover:bg-purple-500/20 disabled:opacity-50"
              >
                {generating ? 'generating...' : '✦ AI generate'}
              </button>
            ) : null}
            <span>ctrl+enter to submit</span>
          </div>
        </header>
        <div className="p-3">
          <textarea
            ref={textareaRef}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="commit message... (or click AI generate)"
            rows={4}
            className="w-full resize-none border border-hairline bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-primary outline-none placeholder:text-muted focus:border-accent-primary/50"
          />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-hairline px-3 py-1 font-mono text-[11px] text-muted hover:border-white/20 hover:text-primary"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!message.trim()}
            className="border border-accent-primary/40 bg-accent-primary/10 px-3 py-1 font-mono text-[11px] text-accent-primary hover:bg-accent-primary/20 disabled:opacity-40 disabled:hover:bg-accent-primary/10"
          >
            commit
          </button>
        </footer>
      </div>
    </div>
  )
}
