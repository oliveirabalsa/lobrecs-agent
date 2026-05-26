import { useEffect, useRef, useState, useMemo } from 'react'
import { Pill } from '../../../components/ui'

interface BranchDropdownProps {
  projectId: string
  currentBranch: string
  onBranchChanged?: () => void
  onBranchesClick?: () => void
}

export function BranchDropdown({
  projectId,
  currentBranch,
  onBranchChanged,
  onBranchesClick,
}: BranchDropdownProps) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSearchQuery('')
    window.agentforge.git
      .listBranches(projectId)
      .then((list) => {
        setBranches(list)
      })
      .catch((err) => {
        console.error('[BranchDropdown] list failed', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, projectId])

  const filteredBranches = useMemo(() => {
    return branches.filter((branch) =>
      branch.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [branches, searchQuery])

  async function handleCheckout(branch: string) {
    if (branch === currentBranch) {
      setOpen(false)
      return
    }
    setActionPending(true)
    try {
      const result = await window.agentforge.git.checkoutBranch(projectId, branch)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Checkout failed')
      }
      onBranchChanged?.()
      setOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to checkout branch'
      window.alert(msg)
    } finally {
      setActionPending(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Pill
        tone="info"
        leadingIcon={<BranchIcon />}
        trailingIcon={<ChevronDownIcon />}
        onClick={() => setOpen(!open)}
        className="max-w-[150px] sm:inline-flex lg:max-w-[220px]"
      >
        {currentBranch}
      </Pill>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-60 overflow-hidden rounded-card border border-hairline bg-card-raised/95 py-1 shadow-xl shadow-black/40 backdrop-blur-md"
        >
          <div className="px-2 py-1.5 border-b border-hairline">
            <input
              type="text"
              placeholder="Search branches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 rounded border border-hairline bg-canvas px-2 text-xs text-primary placeholder-muted focus:border-accent-primary/60 outline-none"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted">Loading branches...</div>
            ) : filteredBranches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">No branches found</div>
            ) : (
              filteredBranches.map((branch) => {
                const isCurrent = branch === currentBranch
                return (
                  <button
                    key={branch}
                    type="button"
                    role="menuitem"
                    disabled={actionPending}
                    onClick={() => handleCheckout(branch)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed ${
                      isCurrent ? 'text-accent-primary bg-accent-primary/5' : 'text-primary'
                    }`}
                  >
                    <span className="truncate mr-2 text-left">{branch}</span>
                    {isCurrent ? <CheckIcon /> : null}
                  </button>
                )
              })
            )}
          </div>

          {onBranchesClick ? (
            <>
              <div className="h-px bg-hairline" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onBranchesClick()
                }}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-secondary hover:bg-white/5 transition-colors"
              >
                <BranchIcon />
                <span>Manage branches...</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function BranchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
