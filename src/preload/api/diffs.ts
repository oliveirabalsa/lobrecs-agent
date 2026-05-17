import type { IpcInvoker } from './ipc'

export interface DiffApi {
  apply(filePath: string, content: string, expectedContent?: string): Promise<void>
  reject(): Promise<void>
}

export function createDiffApi(ipcRenderer: IpcInvoker): DiffApi {
  return {
    apply: (filePath, content, expectedContent) =>
      expectedContent === undefined
        ? ipcRenderer.invoke('diff:apply', filePath, content)
        : ipcRenderer.invoke('diff:apply', filePath, content, expectedContent),
    reject: () => ipcRenderer.invoke('diff:reject'),
  }
}
