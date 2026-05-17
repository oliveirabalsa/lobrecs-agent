import { dialog, ipcMain, shell } from 'electron'
import { listAgentModelCatalogs } from '../../agents/application/listAgentModelCatalogs'
import { isSupportedAgentId } from '../../agents/domain/isSupportedAgentId'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { AgentId } from '../../../../shared/types'

export function registerSystemHandlers(context: MainIpcContext): void {
  ipcMain.handle('system:open-editor', async (_event, filePath: string) => {
    await shell.openPath(filePath)
  })
  ipcMain.handle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:check-agent', async (_event, agentId: AgentId) => {
    if (!isSupportedAgentId(agentId)) return false
    return context.adapters.get(agentId)?.isInstalled() ?? false
  })
  ipcMain.handle('system:list-agent-models', async () => listAgentModelCatalogs(context))
}
