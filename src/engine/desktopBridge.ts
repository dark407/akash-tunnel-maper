/**
 * Desktop Storage & IPC Bridge for AKASH TUNNEL MAPPER (Electron Windows Desktop Runtime)
 *
 * When running inside the Electron Windows Desktop Application:
 * 1. Hydrates `window.localStorage` from `%APPDATA%\AKASH TUNNEL MAPPER\user-data\persistent-store.json`
 *    before React mounts so all projects, geometries, control points, joints, lithology, and settings
 *    persist across application restarts, Windows reboots, and software updates.
 * 2. Mirrors all `localStorage.setItem` and `localStorage.removeItem` writes directly to `%APPDATA%`.
 * 3. Provides direct native file system access in `%APPDATA%\AKASH TUNNEL MAPPER\user-data\projects\`
 *    for saving and loading `.akash.json` project files without browser storage quota limits.
 * 4. Routes `/api/geometry/parse-cad` and `/api/ai/trace-joints` directly through Electron IPC when
 *    running from production files (`file://`) so the desktop application never depends on `localhost`.
 */

import { SavedDesignGeometryRecord, SavedProjectRecord } from '../types/tunnel';

export interface AkashDesktopAPI {
  isElectron: boolean;
  platform: string;
  initialPersistedStore: Record<string, string>;
  setStorageItem: (key: string, value: string) => Promise<boolean>;
  removeStorageItem: (key: string) => Promise<boolean>;
  clearStorage?: () => Promise<boolean>;
  syncStorageBatch?: (entries: Record<string, string>) => Promise<boolean>;
  syncStorageBatchSync?: (entries: Record<string, string>) => boolean;
  loadProjectsFromDiskSync: () => SavedProjectRecord[];
  saveProjectToDisk: (record: SavedProjectRecord) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  deleteProjectFromDisk: (id: string) => Promise<boolean>;
  loadGeometriesFromDiskSync: () => SavedDesignGeometryRecord[];
  saveGeometriesToDisk: (geometries: SavedDesignGeometryRecord[]) => Promise<boolean>;
  openProjectsFolder: () => Promise<{ folderPath: string }>;
  getUserDataInfo: () => Promise<{
    userDataRootDir: string;
    projectsDir: string;
    persistentStoreFile: string;
    geometriesFile: string;
    appVersion: string;
    platform: string;
  }>;
  readUserDataFile?: (
    relativePath: string
  ) => Promise<{ ok: boolean; filePath?: string; contentUtf8?: string; error?: string }>;
  writeUserDataFile?: (
    relativePath: string,
    contentUtf8: string
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  listUserDataFiles?: (
    subDir?: string
  ) => Promise<{
    ok: boolean;
    directory?: string;
    files: Array<{ name: string; isDirectory: boolean }>;
    error?: string;
  }>;
  deleteUserDataFile?: (relativePath: string) => Promise<{ ok: boolean; error?: string }>;
  openFileDialog: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  saveFileDialog: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  selectFolderDialog: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  parseCad: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  traceJoints: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  loadAILearningMemorySync?: () => Record<string, unknown> | null;
  saveAILearningMemoryToDisk?: (memoryObj: unknown) => Promise<boolean>;
  printToPdf?: (options?: Record<string, unknown>) => Promise<{ canceled: boolean; filePath?: string }>;
}

declare global {
  interface Window {
    akashDesktop?: AkashDesktopAPI;
    eswaDesktop?: AkashDesktopAPI;
  }
}

export function initializeDesktopRuntimeBridge(): void {
  if (typeof window === 'undefined' || !window.akashDesktop?.isElectron) {
    return;
  }

  const desktop = window.akashDesktop;

  // 1. Hydrate localStorage from persistent %APPDATA% disk store on startup
  try {
    const persisted = desktop.initialPersistedStore || {};
    for (const [k, v] of Object.entries(persisted)) {
      if (typeof v === 'string') {
        window.localStorage.setItem(k, v);
      }
    }
  } catch {
    // Ignore storage errors
  }

  // 2. Mirror all future localStorage writes to %APPDATA%\AKASH TUNNEL MAPPER\user-data\persistent-store.json
  try {
    const origSetItem = Storage.prototype.setItem;
    const origRemoveItem = Storage.prototype.removeItem;
    const origClear = Storage.prototype.clear;

    Storage.prototype.setItem = function (key: string, value: string) {
      origSetItem.call(this, key, value);
      if (this === window.localStorage) {
        desktop.setStorageItem(key, String(value)).catch(() => {});
      }
    };

    Storage.prototype.removeItem = function (key: string) {
      origRemoveItem.call(this, key);
      if (this === window.localStorage) {
        desktop.removeStorageItem(key).catch(() => {});
      }
    };

    Storage.prototype.clear = function () {
      origClear.call(this);
      if (this === window.localStorage && desktop.clearStorage) {
        desktop.clearStorage().catch(() => {});
      }
    };

    const collectLocalStorageSnapshot = (): Record<string, string> => {
      const snapshot: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          const val = window.localStorage.getItem(key);
          if (typeof val === 'string') {
            snapshot[key] = val;
          }
        }
      }
      return snapshot;
    };

    window.addEventListener('beforeunload', () => {
      try {
        const snapshot = collectLocalStorageSnapshot();
        if (desktop.syncStorageBatchSync) {
          desktop.syncStorageBatchSync(snapshot);
        } else if (desktop.syncStorageBatch) {
          desktop.syncStorageBatch(snapshot).catch(() => {});
        }
      } catch {
        // Ignore unload flush errors
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && desktop.syncStorageBatch) {
        try {
          desktop.syncStorageBatch(collectLocalStorageSnapshot()).catch(() => {});
        } catch {
          // Ignore visibility flush errors
        }
      }
    });
  } catch {
    // Ignore prototype patch errors
  }

  // 3. Route /api/* calls through Electron IPC when running without a local web server
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (urlStr.endsWith('/api/geometry/parse-cad')) {
      try {
        const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};
        const result = await desktop.parseCad(bodyObj);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : 'CAD IPC error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (urlStr.endsWith('/api/ai/trace-joints')) {
      try {
        const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};
        const result = await desktop.traceJoints(bodyObj);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : 'AI Trace IPC error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return origFetch(input, init);
  };
}
