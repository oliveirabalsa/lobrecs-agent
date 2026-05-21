import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '../../../shared/contracts/projects'
import type {
  ProjectKnowledgeEntry,
  ProjectKnowledgeKind,
} from '../../../shared/contracts/memory'
import { Button, Card, Modal, Pill, Spinner } from '../ui'

type MemoryManagerProps = {
  project: Pick<Project, 'id' | 'name'> | null
}

const KIND_OPTIONS: Array<{
  label: string
  value: ProjectKnowledgeKind | 'all'
}> = [
  { label: 'All Categories', value: 'all' },
  { label: 'Architecture', value: 'architecture' },
  { label: 'Workflow', value: 'workflow' },
  { label: 'Preference', value: 'preference' },
  { label: 'Failure', value: 'failure' },
  { label: 'General', value: 'general' },
]

function getKindPillTone(
  kind: ProjectKnowledgeKind,
): 'neutral' | 'success' | 'warn' | 'danger' | 'info' {
  switch (kind) {
    case 'architecture':
      return 'info'
    case 'workflow':
      return 'success'
    case 'preference':
      return 'warn'
    case 'failure':
      return 'danger'
    default:
      return 'neutral'
  }
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function MemoryManager({ project }: MemoryManagerProps) {
  const [entries, setEntries] = useState<ProjectKnowledgeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search & Filter State
  const [searchText, setSearchText] = useState('')
  const [selectedKind, setSelectedKind] = useState<ProjectKnowledgeKind | 'all'>('all')

  // Modal / Form State
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ProjectKnowledgeEntry | null>(null)
  const [formKind, setFormKind] = useState<ProjectKnowledgeKind>('general')
  const [formSummary, setFormSummary] = useState('')
  const [formDetails, setFormDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Deletion state
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    if (!project) {
      setEntries([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.agentforge.memory.list(project.id)
      setEntries(result ?? [])
    } catch (err) {
      setEntries([])
      setError(err instanceof Error ? err.message : 'Unable to load project memory.')
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    setSearchText('')
    setSelectedKind('all')
    void loadEntries()
  }, [loadEntries])

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesKind = selectedKind === 'all' || entry.kind === selectedKind
      const query = searchText.toLowerCase().trim()
      const matchesSearch =
        !query ||
        entry.summary.toLowerCase().includes(query) ||
        (entry.details && entry.details.toLowerCase().includes(query))
      return matchesKind && matchesSearch
    })
  }, [entries, selectedKind, searchText])

  const handleCreateOpen = () => {
    setEditingEntry(null)
    setFormKind('general')
    setFormSummary('')
    setFormDetails('')
    setSaveError(null)
    setModalOpen(true)
  }

  const handleEditOpen = (entry: ProjectKnowledgeEntry) => {
    setEditingEntry(entry)
    setFormKind(entry.kind)
    setFormSummary(entry.summary)
    setFormDetails(entry.details ?? '')
    setSaveError(null)
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project || !formSummary.trim()) return

    setSaving(true)
    setSaveError(null)

    try {
      if (editingEntry) {
        // Delete original first to support clean renaming/kind updates
        await window.agentforge.memory.delete({
          projectId: project.id,
          entryId: editingEntry.id,
        })
      }

      await window.agentforge.memory.save({
        projectId: project.id,
        kind: formKind,
        summary: formSummary.trim(),
        details: formDetails.trim() || undefined,
        source: 'manual',
      })

      setModalOpen(false)
      await loadEntries()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save entry.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entryId: string) => {
    if (!project) return
    try {
      await window.agentforge.memory.delete({
        projectId: project.id,
        entryId,
      })
      setDeletingId(null)
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete entry.')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-canvas">
      {/* Header section */}
      <div className="flex flex-col gap-1.5 border-b border-hairline px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-5 w-5 text-accent-primary" />
            <h1 className="text-base font-semibold text-primary">Project Memory</h1>
            <span className="rounded-full bg-card-raised border border-hairline px-2 py-0.5 text-[10px] font-medium text-secondary">
              {entries.length} {entries.length === 1 ? 'rule' : 'rules'}
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={handleCreateOpen}
          >
            Add Rule
          </Button>
        </div>
        <p className="text-xs text-muted max-w-3xl leading-relaxed">
          Stored locally in <code className="font-mono text-[11px] text-secondary">.lobrecs/memory.json</code> inside the target repository.
          These guidelines and constraints are automatically injected into the agent context on every session to enforce architectural standards, coding styles, and project preferences.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 border-b border-hairline bg-sidebar/20 px-6 py-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted">
            <SearchIcon className="h-3.5 w-3.5" />
          </span>
          <input
            type="text"
            placeholder="Search memory rules..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full h-8 rounded-card border border-hairline bg-card px-3 pl-9 text-xs text-primary placeholder-muted outline-none transition-all focus:border-accent-primary/60"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute inset-y-0 right-3 flex items-center text-[10px] text-muted hover:text-secondary"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelectedKind(opt.value)}
              className={`h-6 rounded-pill px-2.5 text-[11px] font-medium transition-all ${
                selectedKind === opt.value
                  ? 'bg-accent-primary/15 border border-accent-primary/30 text-accent-primary shadow-sm shadow-accent-primary/5'
                  : 'bg-card border border-hairline text-secondary hover:bg-card-raised hover:text-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <Spinner size={16} />
            <span className="text-xs text-muted">Loading project memory...</span>
          </div>
        ) : error ? (
          <div className="rounded-md border border-accent-del/20 bg-accent-del/5 p-4 text-center max-w-md mx-auto mt-8">
            <p className="text-xs text-accent-del font-medium mb-3">{error}</p>
            <Button variant="ghost" size="sm" className="text-accent-del" onClick={loadEntries}>
              Retry Loading
            </Button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline p-6 text-center max-w-lg mx-auto mt-6">
            <div className="rounded-full bg-card px-3 py-3 border border-hairline text-muted">
              <BrainIcon className="h-7 w-7 opacity-40" />
            </div>
            <div>
              <p className="text-sm font-medium text-secondary">
                {searchText || selectedKind !== 'all' ? 'No matching rules found' : 'No memory rules configured'}
              </p>
              <p className="mt-1 text-xs text-muted max-w-sm mx-auto leading-relaxed">
                {searchText || selectedKind !== 'all'
                  ? 'Try adjusting your search criteria or changing the active category filter.'
                  : 'Create custom rules manually, or let agents auto-learn rules from your session feedback notes.'}
              </p>
            </div>
            {!(searchText || selectedKind !== 'all') && (
              <Button variant="chip" size="sm" onClick={handleCreateOpen}>
                Add First Rule
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="group relative flex flex-col justify-between rounded-card border border-hairline bg-card p-4 transition-all duration-150 hover:bg-card-raised hover:border-hairline-strong shadow-elevated"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={getKindPillTone(entry.kind)} className="capitalize">
                        {entry.kind}
                      </Pill>
                      <span className="text-[10px] text-muted capitalize bg-card-raised/40 px-1.5 py-0.5 rounded-pill border border-hairline/30">
                        {entry.source === 'user-feedback' ? 'learned' : entry.source}
                      </span>
                    </div>

                    {/* Actions on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={() => handleEditOpen(entry)}
                        className="p-1 rounded text-muted hover:text-primary hover:bg-white/5 transition-colors"
                        title="Edit rule"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingId(entry.id)}
                        className="p-1 rounded text-muted hover:text-accent-del hover:bg-accent-del/10 transition-colors"
                        title="Delete rule"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <h3 className="text-xs font-semibold text-primary mb-2 line-clamp-2 leading-relaxed">
                    {entry.summary}
                  </h3>

                  {entry.details && (
                    <p className="text-[11px] text-secondary leading-relaxed whitespace-pre-wrap font-mono bg-black/20 p-2 rounded border border-hairline/40 max-h-36 overflow-y-auto mb-2">
                      {entry.details}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-hairline/30 text-[10px] text-muted">
                  <span>Updated {formatDate(entry.updatedAt)}</span>
                  {entry.sourceSessionId && (
                    <span
                      className="text-[10px] truncate max-w-[120px]"
                      title={`Session: ${entry.sourceSessionId}`}
                    >
                      Ref: {entry.sourceSessionId.slice(0, 8)}
                    </span>
                  )}
                </div>

                {/* Inline Delete Confirmation */}
                {deletingId === entry.id && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-card bg-card/95 backdrop-blur-sm p-4 text-center animate-in fade-in duration-[120ms] z-10">
                    <p className="text-xs font-semibold text-primary mb-3">Delete this rule?</p>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="bg-accent-del text-white hover:bg-accent-del/85 active:bg-accent-del/75 shadow-md shadow-accent-del/15"
                        onClick={() => handleDelete(entry.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingEntry ? 'Edit Memory Rule' : 'Add Memory Rule'}
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4 mt-2">
          {saveError && (
            <div className="rounded border border-accent-del/20 bg-accent-del/5 p-2.5 text-xs text-accent-del">
              {saveError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-secondary uppercase tracking-wider">
              Category
            </label>
            <select
              value={formKind}
              onChange={(e) => setFormKind(e.target.value as ProjectKnowledgeKind)}
              className="h-8 rounded border border-hairline bg-card-raised px-2 text-xs text-primary outline-none focus:border-accent-primary/60"
            >
              <option value="architecture">Architecture</option>
              <option value="workflow">Workflow</option>
              <option value="preference">Preference</option>
              <option value="failure">Failure</option>
              <option value="general">General</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-semibold text-secondary uppercase tracking-wider">
                Summary
              </label>
              <span className="text-[10px] text-muted">{formSummary.length}/240</span>
            </div>
            <input
              type="text"
              required
              maxLength={240}
              value={formSummary}
              onChange={(e) => setFormSummary(e.target.value)}
              placeholder="Keep privileged filesystem access in the main process."
              className="h-8 rounded border border-hairline bg-card-raised px-2.5 text-xs text-primary placeholder-muted outline-none focus:border-accent-primary/60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-semibold text-secondary uppercase tracking-wider">
                Details (Optional)
              </label>
              <span className="text-[10px] text-muted">{formDetails.length}/1000</span>
            </div>
            <textarea
              maxLength={1000}
              rows={4}
              value={formDetails}
              onChange={(e) => setFormDetails(e.target.value)}
              placeholder="Renderer modules must communicate via window.agentforge interfaces."
              className="rounded border border-hairline bg-card-raised p-2 text-xs text-primary placeholder-muted outline-none focus:border-accent-primary/60 resize-none font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-hairline">
            <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={saving}>
              Save Rule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function BrainIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z" />
    </svg>
  )
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function PencilIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
