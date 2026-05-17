import { contextBridge, ipcRenderer } from 'electron'
import { createAgentForgeApi } from './api'

contextBridge.exposeInMainWorld('agentforge', createAgentForgeApi(ipcRenderer))
