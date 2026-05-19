import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../../../shared/types'
import { Button, Modal } from '../../../components/ui'

interface CommitAndPushDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Status = 'idle' | 'running' | 'success' | 'error'

export function CommitAndPushDialog({ project, open, onOpenChange }: CommitAndPushDialogProps) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<string>('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setStatus('idle')
    setError(null)
    setStep('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  async function run() {
    if (!project || !message.trim() || status === 'running') return
    setStatus('running')
    setError(null)

    try {
      setStep('Staging all changes…')
      const stageResult = await window.agentforge.git.stage({ projectId: project.id, paths: [] })
      if (stageResult.exitCode !== 0) throw new Error(stageResult.stderr || 'Stage failed')

      setStep('Committing…')
      const commitResult = await window.agentforge.git.commit({
        projectId: project.id,
        message: message.trim(),
      })
      if (commitResult.exitCode !== 0) throw new Error(commitResult.stderr || 'Commit failed')

      setStep('Pushing…')
      const pushResult = await window.agentforge.git.push(project.id)
      if (pushResult.exitCode !== 0) throw new Error(pushResult.stderr || 'Push failed')

      setStatus('success')
      setStep('Done!')
      setMessage('')
      setTimeout(() => {
        onOpenChange(false)
        setStatus('idle')
        setStep('')
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const busy = status === 'running' || status === 'success'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Commit & Push"
      description="Stage all changes, commit, and push to remote"
      maxWidth={480}
    >
      <div className="flex flex-col gap-3">
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run()
          }}
          className="min-h-[80px] w-full resize-y rounded-card border border-hairline bg-card-raised px-3 py-2 text-sm leading-6 text-primary outline-none placeholder:text-muted focus:border-white/20"
          placeholder="Commit message… (⌘↵ to submit)"
          aria-label="Commit message"
          disabled={busy}
        />

        {step ? (
          <p className="text-xs text-muted">{step}</p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="whitespace-pre-wrap rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={status === 'running'}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void run()}
            disabled={!message.trim() || busy}
          >
            {status === 'running' ? step : status === 'success' ? 'Done!' : 'Commit & Push'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
