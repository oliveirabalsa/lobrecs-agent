import { ipcMain } from 'electron'
import { feedbackStore } from '../../../store'

export function registerFeedbackHandlers(): void {
  ipcMain.handle(
    'feedback:save',
    async (
      _event,
      sessionId: string,
      outcome: 'success' | 'failure' | 'partial',
      note?: string,
    ) => feedbackStore.save(sessionId, outcome, note),
  )
}
