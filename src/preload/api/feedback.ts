import type { FeedbackOutcome } from '../../shared/contracts/feedback'
import type { IpcInvoker } from './ipc'

export interface FeedbackApi {
  save(sessionId: string, outcome: FeedbackOutcome, note?: string): Promise<void>
}

export function createFeedbackApi(ipcRenderer: IpcInvoker): FeedbackApi {
  return {
    save: (sessionId, outcome, note) =>
      ipcRenderer.invoke('feedback:save', sessionId, outcome, note),
  }
}
