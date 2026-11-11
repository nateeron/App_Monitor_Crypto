const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  getState: () => ipcRenderer.invoke('get-state'),
  updateSettings: (partial) => ipcRenderer.invoke('update-settings', partial),
  fetchKlines: (params) => ipcRenderer.invoke('fetch-klines', params),
  setChartSize: (size) => ipcRenderer.invoke('set-chart-size', size),
  setIndependent: (value) => ipcRenderer.invoke('set-independent', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  redock: () => ipcRenderer.invoke('redock'),
  getPanels: () => ipcRenderer.invoke('get-panels'),
  setWindowOpen: (symbol, open) => ipcRenderer.invoke('set-window-open', symbol, open),
  dockDragStart: () => ipcRenderer.send('dock-drag-start'),
  dockDragMove: (screenY) => ipcRenderer.send('dock-drag-move', screenY),
  dockDragEnd: () => ipcRenderer.send('dock-drag-end'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
  onPanels: (callback) => {
    const listener = (_event, panels) => callback(panels);
    ipcRenderer.on('panels', listener);
    return () => ipcRenderer.removeListener('panels', listener);
  },
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});
