const { contextBridge, ipcRenderer } = require('electron');

// Synchronously load persisted %APPDATA%\AKASH TUNNEL MAPPER\user-data\persistent-store.json
let initialPersistedStore = {};
try {
  initialPersistedStore = ipcRenderer.sendSync('akash:storage-load-all-sync') || {};
} catch {
  initialPersistedStore = {};
}

contextBridge.exposeInMainWorld('akashDesktop', {
  isElectron: true,
  platform: process.platform,
  initialPersistedStore,
  setStorageItem: (key, value) =>
    ipcRenderer.invoke('akash:storage-set-item', { key, value }),
  removeStorageItem: (key) =>
    ipcRenderer.invoke('akash:storage-remove-item', { key }),
  loadProjectsFromDiskSync: () => {
    try {
      return ipcRenderer.sendSync('akash:projects-load-all-sync') || [];
    } catch {
      return [];
    }
  },
  saveProjectToDisk: (record) =>
    ipcRenderer.invoke('akash:project-save-file', record),
  deleteProjectFromDisk: (id) =>
    ipcRenderer.invoke('akash:project-delete-file', { id }),
  loadGeometriesFromDiskSync: () => {
    try {
      return ipcRenderer.sendSync('akash:geometries-load-sync') || [];
    } catch {
      return [];
    }
  },
  saveGeometriesToDisk: (geometries) =>
    ipcRenderer.invoke('akash:geometries-save', geometries),
  openProjectsFolder: () => ipcRenderer.invoke('akash:open-projects-folder'),
  getUserDataInfo: () => ipcRenderer.invoke('akash:get-user-data-info'),
  openFileDialog: (options) => ipcRenderer.invoke('akash:dialog-open-file', options),
  saveFileDialog: (options) => ipcRenderer.invoke('akash:dialog-save-file', options),
  selectFolderDialog: (options) => ipcRenderer.invoke('akash:dialog-select-folder', options),
  parseCad: (payload) => ipcRenderer.invoke('akash:parse-cad', payload),
  traceJoints: (payload) => ipcRenderer.invoke('akash:ai-trace-joints', payload),
});
