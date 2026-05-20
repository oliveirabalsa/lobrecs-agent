import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { AGENT_LABELS, SUPPORTED_AGENT_IDS } from '../../../shared/types'
import type { ModelTier, Project, SupportedAgentId } from '../../../shared/types'

type ProjectAgentId = SupportedAgentId

interface DraftProject {
  name: string
  repoPath: string
  agentId: ProjectAgentId
  modelTier: ModelTier
}

interface Props {
  open: boolean
  draft: DraftProject | null
  creating: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onCreate: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => void
}

const AGENTS: ProjectAgentId[] = [...SUPPORTED_AGENT_IDS]
const TIERS: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']

export function NewProjectModal({
  open,
  draft,
  creating,
  error,
  onOpenChange,
  onCreate,
}: Props) {
  const [form, setForm] = useState<DraftProject | null>(draft)

  useEffect(() => {
    setForm(draft)
  }, [draft])

  function submit() {
    if (!form || !form.name.trim()) return
    onCreate({
      name: form.name.trim(),
      repoPath: form.repoPath,
      agentId: form.agentId,
      modelTier: form.modelTier,
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
          <div className="border-b border-zinc-800 px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-zinc-100">New project</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-zinc-500">
              Configure the repository defaults before adding it to the workspace.
            </Dialog.Description>
          </div>

          <div className="space-y-3 p-4">
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Project name</span>
              <input
                value={form?.name ?? ''}
                onChange={(event) =>
                  setForm((current) => (current ? { ...current, name: event.target.value } : current))
                }
                className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-blue-500"
                autoFocus
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Repository path</span>
              <input
                value={form?.repoPath ?? ''}
                readOnly
                className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-zinc-400">Default agent</span>
                <select
                  value={form?.agentId ?? 'claude-code'}
                  onChange={(event) =>
                    setForm((current) =>
                      current
                        ? { ...current, agentId: event.target.value as ProjectAgentId }
                        : current,
                    )
                  }
                  className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
                >
                  {AGENTS.map((agentId) => (
                    <option key={agentId} value={agentId}>
                      {AGENT_LABELS[agentId]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-zinc-400">Model tier</span>
                <select
                  value={form?.modelTier ?? 'balanced'}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, modelTier: event.target.value as ModelTier } : current,
                    )
                  }
                  className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
                >
                  {TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error ? (
              <div className="rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={!form?.name.trim() || creating}
              onClick={submit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              {creating ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
