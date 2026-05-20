import { ipcMain } from 'electron'
import { feedbackStore } from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'

export function registerFeedbackHandlers(context: MainIpcContext): void {
  ipcMain.handle(
    'feedback:save',
    async (
      _event,
      sessionId: string,
      outcome: 'success' | 'failure' | 'partial',
      note?: string,
    ) => {
      const feedback = feedbackStore.save(sessionId, outcome, note)
      await context.projectMemoryService.learnFromFeedback(sessionId, outcome, note)
      return feedback
    },
  )
}
