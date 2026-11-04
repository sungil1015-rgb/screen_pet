const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const fn = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
}

contextBridge.exposeInMainWorld('maru', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setSprite: (payload) => ipcRenderer.invoke('sprite:set', payload),
  clearSprite: () => ipcRenderer.invoke('sprite:clear'),
  setPetEnabled: (enabled) => ipcRenderer.invoke('pet:enabled', !!enabled),
  placePet: (payload) => ipcRenderer.invoke('pet:place', payload),
  quit: () => ipcRenderer.invoke('app:quit'),
  petReady: () => ipcRenderer.send('pet:ready'),
  onPetEnabled: (cb) => listen('pet:enabled-changed', cb),
  onPose: (cb) => listen('pet:pose', cb),
  onPetConfig: (cb) => listen('pet:config', cb),
  onStudioVisibility: (cb) => listen('studio:visible', cb),
  onDisplays: (cb) => listen('displays:changed', cb)
});
