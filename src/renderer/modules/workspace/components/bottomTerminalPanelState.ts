export type BottomTerminalOpenAction =
  | 'create-initial-tab'
  | 'show-existing-panel'
  | 'add-tab'

interface ResolveBottomTerminalOpenActionInput {
  hasPanel: boolean
  panelOpen: boolean
  canAddTab: boolean
}

export function resolveBottomTerminalOpenAction({
  hasPanel,
  panelOpen,
  canAddTab,
}: ResolveBottomTerminalOpenActionInput): BottomTerminalOpenAction {
  if (!hasPanel) return 'create-initial-tab'
  if (!panelOpen) return 'show-existing-panel'
  if (canAddTab) return 'add-tab'
  return 'show-existing-panel'
}
