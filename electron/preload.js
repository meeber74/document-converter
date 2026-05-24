const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  convert:  (filename, arrayBuffer) => ipcRenderer.invoke('convert', filename, arrayBuffer),
  saveFile: (filename, content)     => ipcRenderer.invoke('save-file', filename, content)
});
