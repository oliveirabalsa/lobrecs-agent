import type { AgentActivity, TodoItem } from '../../../../../shared/types'

export type TodoListActivity = Extract<AgentActivity, { kind: 'todo-list' }>

export interface TodoCardProps {
  activity: TodoListActivity
}

export function TodoCard({ activity }: TodoCardProps) {
  const { items } = activity
  const total = items.length
  const doneCount = items.filter((item) => item.completed).length

  if (total === 0) return null

  return (
    <section className="flex flex-col gap-0.5">
      <header className="flex items-center gap-2">
        <span className="inline-flex shrink-0 text-muted" aria-hidden="true">
          {iconChecklist}
        </span>
        <span className="text-xs font-medium text-secondary">
          To-dos
        </span>
        <span className="text-[11px] tabular-nums text-muted">
          {doneCount}/{total}
        </span>
      </header>

      <ul className="flex flex-col">
        {items.map((item) => (
          <TodoRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

function TodoRow({ item }: { item: TodoItem }) {
  return (
    <li className="flex items-start gap-2 py-0.5 pl-5">
      <span
        className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
          item.completed
            ? 'border-accent-add bg-accent-add/20 text-accent-add'
            : 'border-hairline text-transparent'
        }`}
        aria-hidden="true"
      >
        {item.completed ? iconCheck : null}
      </span>
      <span
        className={`text-[12px] leading-5 ${
          item.completed ? 'text-muted line-through' : 'text-secondary'
        }`}
      >
        {item.text}
      </span>
    </li>
  )
}

const iconChecklist = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2.5 4.5 4 6l3-3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 4.5h5" strokeLinecap="round" />
    <path d="M2.5 10.5 4 12l3-3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 10.5h5" strokeLinecap="round" />
  </svg>
)

const iconCheck = (
  <svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1.5 4 3.25 5.75 6.5 2.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
