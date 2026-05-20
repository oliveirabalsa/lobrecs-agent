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
      return 'shrink-0 whitespace-nowrap rounded border border-accent-primary/30 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary'
    case 'replace':
      return 'shrink-0 whitespace-nowrap rounded border border-accent-del/30 bg-accent-del/10 px-2 py-0.5 text-[10px] font-medium text-accent-del'
    case 'normal':
    default:
      return 'shrink-0 whitespace-nowrap rounded border border-accent-warn/30 bg-accent-warn/10 px-2 py-0.5 text-[10px] font-medium text-accent-warn'
  }
}
