import { ipcMain } from 'electron'
import { applyDiffContent } from '../application/applyDiff'

export function registerDiffHandlers(): void {
  ipcMain.handle(
    'diff:apply',
    async (_event, filePath: string, content: string, expectedContent?: string) =>
      applyDiffContent(filePath, content, expectedContent),
  )
  ipcMain.handle('diff:reject', async () => undefined)
}
