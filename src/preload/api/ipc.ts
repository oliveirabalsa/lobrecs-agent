import type { IpcRenderer } from 'electron'

export type IpcInvoker = Pick<IpcRenderer, 'invoke'>
export type IpcSubscriber = Pick<IpcRenderer, 'on' | 'removeListener'>
