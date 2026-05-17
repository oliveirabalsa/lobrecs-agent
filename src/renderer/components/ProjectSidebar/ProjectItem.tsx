import type { MouseEvent } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  project: Project
  selected: boolean
  activeSessionCount: number
  onSelect: (project: Project) => void
  onContextMenu: (event: MouseEvent, project: Project) => void
}

function truncateName(name: string) {
  return name.length > 20 ? `${name.slice(0, 19)}...` : name
}

export function ProjectItem({
  project,
  selected,
  activeSessionCount,
  onSelect,
  onContextMenu,
}: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(project)}
      onContextMenu={(event) => onContextMenu(event, project)}
      className={`group mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
        selected ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-200 hover:bg-zinc-800'
      }`}
      title={`${project.name}\n${project.repoPath}`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border ${
          selected ? 'border-zinc-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-900'
        }`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-zinc-400">
          <path
            d="M2.5 5.5c0-1.1.9-2 2-2h3.2l1.7 1.8h6.1c1.1 0 2 .9 2 2v7.2c0 1.1-.9 2-2 2h-11c-1.1 0-2-.9-2-2v-9z"
            fill="currentColor"
          />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{truncateName(project.name)}</span>
          {activeSessionCount > 0 ? (
            <span className="ml-auto rounded-full border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-200">
              {activeSessionCount} live
            </span>
          ) : null}
        </span>
        <span className="mt-1 block overflow-hidden text-xs leading-4 text-zinc-400 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
          {project.repoPath}
        </span>
      </span>
    </button>
  )
}
