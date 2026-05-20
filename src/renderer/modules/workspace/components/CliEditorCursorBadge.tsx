import type { CliEditorCursorState } from './cliEditorCursorState'

interface CliEditorCursorBadgeProps {
  cursorState: CliEditorCursorState
}

export function CliEditorCursorBadge({ cursorState }: CliEditorCursorBadgeProps) {
  return (
    <div className={cursorBadgeClass(cursorState)}>
      {cursorState.label} cursor
    </div>
  )
}

function cursorBadgeClass(cursorState: CliEditorCursorState): string {
  switch (cursorState.mode) {
    case 'insert':
      return 'shrink-0 whitespace-nowrap rounded border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-200'
    case 'replace':
      return 'shrink-0 whitespace-nowrap rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-200'
    case 'normal':
    default:
      return 'shrink-0 whitespace-nowrap rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200'
  }
}
