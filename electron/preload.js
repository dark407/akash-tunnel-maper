const { contextBridge, ipcRenderer } = require('electron');

// Synchronously load persisted %APPDATA%\AKASH TUNNEL MAPPER\user-data\persistent-store.json
let initialPersistedStore = {};
try {
  initialPersistedStore = ipcRenderer.sendSync('akash:storage-load-all-sync') || {};
} catch {
  initialPersistedStore = {};
}

const desktopApi = {
  isElectron: true,
  platform: process.platform,
  initialPersistedStore,
  setStorageItem: (key, value) =>
    ipcRenderer.invoke('akash:storage-set-item', { key, value }),
  removeStorageItem: (key) =>
    ipcRenderer.invoke('akash:storage-remove-item', { key }),
  clearStorage: () =>
    ipcRenderer.invoke('akash:storage-clear'),
  syncStorageBatch: (entries) =>
    ipcRenderer.invoke('akash:storage-sync-batch', { entries }),
  syncStorageBatchSync: (entries) => {
    try {
      return Boolean(ipcRenderer.sendSync('akash:storage-sync-batch-sync', { entries }));
    } catch {
      return false;
    }
  },
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
  readUserDataFile: (relativePath) =>
    ipcRenderer.invoke('akash:fs-read-user-file', { relativePath }),
  writeUserDataFile: (relativePath, contentUtf8) =>
    ipcRenderer.invoke('akash:fs-write-user-file', { relativePath, contentUtf8 }),
  listUserDataFiles: (subDir = '') =>
    ipcRenderer.invoke('akash:fs-list-user-files', { subDir }),
  deleteUserDataFile: (relativePath) =>
    ipcRenderer.invoke('akash:fs-delete-user-file', { relativePath }),
  openFileDialog: (options) => ipcRenderer.invoke('akash:dialog-open-file', options),
  saveFileDialog: (options) => ipcRenderer.invoke('akash:dialog-save-file', options),
  selectFolderDialog: (options) => ipcRenderer.invoke('akash:dialog-select-folder', options),
  parseCad: (payload) => ipcRenderer.invoke('akash:parse-cad', payload),
  traceJoints: (payload) => ipcRenderer.invoke('akash:ai-trace-joints', payload),
  loadAILearningMemorySync: () => {
    try {
      return ipcRenderer.sendSync('akash:learning-load-sync') || null;
    } catch {
      return null;
    }
  },
  saveAILearningMemoryToDisk: (memoryObj) =>
    ipcRenderer.invoke('akash:learning-save', memoryObj),
  printToPdf: (options) => ipcRenderer.invoke('akash:print-to-pdf', options),
};

contextBridge.exposeInMainWorld('akashDesktop', desktopApi);
contextBridge.exposeInMainWorld('eswaDesktop', desktopApi);
