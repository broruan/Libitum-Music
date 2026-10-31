import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, DesktopAPI } from '../shared/types'
const api: DesktopAPI = {
  invoke: (command, args) => ipcRenderer.invoke('music:invoke', command, args),
  onEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload)
    ipcRenderer.on('music:event', handler)
    return () => ipcRenderer.removeListener('music:event', handler)
  }
}
contextBridge.exposeInMainWorld('music', api)
