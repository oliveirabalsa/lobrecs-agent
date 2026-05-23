import { useEffect, useMemo, useState, type FormEvent, type SVGProps } from 'react'
import type { Project } from '../../../../shared/types'
import { Button, Modal } from '../../../components/ui'

interface BranchManagerDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onBranchChanged?: () => void
}

export function BranchManagerDialog({
  project,
  open,
  onOpenChange,
  onBranchChanged,
}: BranchManagerDialogProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !project) return
    loadBranchData()
  }, [open, project])

  async function loadBranchData() {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const [list, current] = await Promise.all([
        window.agentforge.git.listBranches(project.id),
        window.agentforge.git.getCurrentBranch(project.id),
      ])
      setBranches(list)
      setCurrentBranch(current.trim())
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load branches')
    } finally {
      setLoading(false)
    }
  }

  async function handleCheckout(branch: string) {
    if (!project || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await window.agentforge.git.checkoutBranch(project.id, branch)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Checkout failed')
      }
      onBranchChanged?.()
      onOpenChange(false)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to checkout branch')
    } finally {
      setActionPending(false)
    }
  }

  async function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newBranchName.trim()
    if (!project || !name || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await window.agentforge.git.createBranch(project.id, name)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Branch creation failed')
      }
      setNewBranchName('')
      onBranchChanged?.()
      onOpenChange(false)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to create branch')
    } finally {
      setActionPending(false)
    }
  }

  const filteredBranches = useMemo(() => {
    return branches.filter((branch) =>
      branch.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [branches, searchQuery])

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Git Branches"
      description="Manage and switch repository branches"
      maxWidth={520}
    >
      <div className="flex min-h-0 flex-col gap-4">
        <form
          onSubmit={handleCreateBranch}
          className="flex items-end gap-2 border-b border-hairline pb-4"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs font-semibold text-secondary">
              Create New Branch
            </label>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="branch-name"
              disabled={actionPending}
              className="h-8 rounded-card border border-hairline bg-card-raised px-3 text-xs text-primary outline-none focus:border-white/20 w-full"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={actionPending || !newBranchName.trim()}
          >
            Create
          </Button>
        </form>

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search branches..."
            className="h-8 rounded-card border border-hairline bg-card-raised pl-8 pr-3 text-xs text-primary outline-none focus:border-white/20 w-full"
          />
          <SearchIcon className="absolute left-2.5 top-2.5 h-3 w-3 text-muted" />
        </div>

        {error && (
          <div className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            {error}
          </div>
        )}

        <div className="flex max-h-[240px] flex-col overflow-y-auto rounded-card border border-hairline divide-y divide-hairline">
          {loading ? (
            <div className="p-4 text-center text-xs text-muted">Loading branches...</div>
          ) : filteredBranches.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted">No branches found</div>
          ) : (
            filteredBranches.map((branch) => {
              const isActive = branch === currentBranch
              return (
                <div
                  key={branch}
                  className={`flex items-center justify-between px-3 py-2 text-xs ${
                    isActive ? 'bg-white/5 font-medium' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <BranchIcon className={`h-3.5 w-3.5 ${isActive ? 'text-accent-primary' : 'text-muted'}`} />
                    <span className={isActive ? 'text-primary' : 'text-secondary'}>
                      {branch}
                    </span>
                    {isActive && (
                      <span className="text-[9px] bg-accent-primary/20 text-accent-primary px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
                        Current
                      </span>
                    )}
                  </div>
                  {!isActive && (
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => void handleCheckout(branch)}
                      className="px-2 py-1 text-[10px] font-medium text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
                    >
                      Checkout
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={actionPending}
          >
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}

function BranchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}
