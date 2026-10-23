import { contextBridge, ipcRenderer } from 'electron';
import type { HarborAPI, SessionEvent } from '../shared';
const api: HarborAPI = {
  listHosts: () => ipcRenderer.invoke('hosts:list'),
  saveHost: input => ipcRenderer.invoke('hosts:save', input),
  deleteHost: id => ipcRenderer.invoke('hosts:delete', id),
  listKnownHosts: () => ipcRenderer.invoke('trust:list'),
  forgetKnownHost: (address, port) => ipcRenderer.invoke('trust:forget', address, port),
  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  unlockVault: () => ipcRenderer.invoke('vault:unlock'),
  listIdentities: () => ipcRenderer.invoke('identities:list'),
  saveIdentity: input => ipcRenderer.invoke('identities:save', input),
  deleteIdentity: id => ipcRenderer.invoke('identities:delete', id),
  importPrivateKey: () => ipcRenderer.invoke('identities:import'),
  listRemote: (id, path) => ipcRenderer.invoke('sftp:list', id, path),
  upload: (id, directory) => ipcRenderer.invoke('sftp:upload', id, directory),
  download: (id, path) => ipcRenderer.invoke('sftp:download', id, path),
  cancelTransfer: (id, transfer) => ipcRenderer.invoke('sftp:cancel', id, transfer),
  listForwards: id => ipcRenderer.invoke('forward:list', id),
  startForward: (id, input) => ipcRenderer.invoke('forward:start', id, input),
  stopForward: (id, forward) => ipcRenderer.invoke('forward:stop', id, forward),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: input => ipcRenderer.invoke('workspace:save', input),
  connect: request => ipcRenderer.invoke('session:connect', request),
  trust: (id, accept) => ipcRenderer.invoke('session:trust', id, accept),
  answerInteractive: (id, requestId, answers) => ipcRenderer.invoke('session:answer', id, requestId, answers),
  disconnect: id => ipcRenderer.invoke('session:disconnect', id),
  sendInput: (id, data) => ipcRenderer.send('session:input', id, data),
  resize: (id, columns, rows) => ipcRenderer.send('session:resize', id, columns, rows),
  acknowledge: id => ipcRenderer.send('session:ack', id),
  onSession: callback => {
    const listener = (_event: Electron.IpcRendererEvent, data: SessionEvent) => callback(data);
    ipcRenderer.on('session:event', listener);
    return () => ipcRenderer.removeListener('session:event', listener);
  }
};
contextBridge.exposeInMainWorld('harbor', api);
