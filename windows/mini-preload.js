const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  init: () => ipcRenderer.invoke('mini:init'),
  onState: (cb) => ipcRenderer.on('mini:state', (_e, s) => cb(s)),
  onLyrics: (cb) => ipcRenderer.on('mini:lyrics', (_e, d) => cb(d)),
  onPalette: (cb) => ipcRenderer.on('mini:palette', (_e, c) => cb(c)),
  onCover: (cb) => ipcRenderer.on('mini:cover', (_e, h) => cb(h)),
  cmd: (name) => ipcRenderer.invoke('mini:cmd', name),
  expand: () => ipcRenderer.send('mini:expand'),
  dragStart: () => ipcRenderer.send('mini:dragStart'),
  dragEnd: () => ipcRenderer.send('mini:dragEnd'),
});
