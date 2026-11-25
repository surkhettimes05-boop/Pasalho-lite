// Electron sandboxed preload scripts require CommonJS for the restricted electron API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pasalho', Object.freeze({
  status: () => ipcRenderer.invoke('pos:status'),
  configure: (url) => ipcRenderer.invoke('pos:configure', url),
  openLogin: () => ipcRenderer.invoke('pos:login'),
  candidates: () => ipcRenderer.invoke('pos:candidates'),
  provision: (input) => ipcRenderer.invoke('pos:provision', input),
  unlock: (passphrase) => ipcRenderer.invoke('pos:unlock', passphrase),
  lock: () => ipcRenderer.invoke('pos:lock'),
  finalize: (input) => ipcRenderer.invoke('pos:finalize', input),
  sync: (includeReview = false) => ipcRenderer.invoke('pos:sync', includeReview),
  renew: (input) => ipcRenderer.invoke('pos:renew', input),
  print: (id) => ipcRenderer.invoke('pos:print', id),
  backup: (passphrase) => ipcRenderer.invoke('pos:backup', passphrase),
  restore: (passphrase) => ipcRenderer.invoke('pos:restore', passphrase),
}));
