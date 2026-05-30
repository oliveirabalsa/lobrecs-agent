import { useEffect, useState } from 'react'
import type { Project } from '../../../../shared/types'
import { Button, Modal } from '../../../components/ui'

interface ProjectContextDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (project: Project) => void
}

export function ProjectContextDialog({
  project,
  open,
  onOpenChange,
  onSaved,
}: ProjectContextDialogProps) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setDraft(project?.context ?? '')
    setError(null)
  }, [open, project?.context])

  async function save() {
    if (!project || saving) return

    setSaving(true)
    setError(null)
    try {
      const updated = await window.agentforge.projects.update(project.id, {
        context: draft.trim() || null,
      })
      onSaved(updated)
      onOpenChange(false)
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save context')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Project context"
      description="Project context sent to agents"
      maxWidth={620}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[220px] w-full resize-y rounded-card border border-hairline bg-card-raised px-3 py-2 text-sm leading-6 text-primary outline-none placeholder:text-muted focus:border-accent-primary/60"
          placeholder="Project instructions, coding standards, constraints..."
          aria-label="Project context"
        />

        {error ? (
          <div
            role="alert"
            className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del"
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
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
