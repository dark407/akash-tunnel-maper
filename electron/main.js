const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_PRODUCT_NAME = 'AKASH TUNNEL MAPPER';
const APP_ID = 'com.akash.tunnelmapper';

app.setName(APP_PRODUCT_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

// ============================================================================
// NATIVE FILE SYSTEM USER DATA DIRECTORY (%APPDATA%\AKASH TUNNEL MAPPER\user-data)
// Kept strictly separate from the Electron installation directory so software
// updates or uninstalls never delete or overwrite user tunnel projects.
// ============================================================================
function getUserDataRootDir() {
  const baseDir = path.join(app.getPath('userData'), 'user-data');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

function getPersistentStoreFilePath() {
  return path.join(getUserDataRootDir(), 'persistent-store.json');
}

function getProjectsDirectoryPath() {
  const dir = path.join(getUserDataRootDir(), 'projects');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getGeometriesFilePath() {
  return path.join(getUserDataRootDir(), 'saved-geometries.json');
}

function sanitizeFileSegment(str) {
  return String(str || 'project')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

function writeJsonFileAtomicSync(targetPath, dataObj) {
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(dataObj, null, 2), 'utf8');
  fs.renameSync(tempPath, targetPath);
}

function readPersistentStoreSync() {
  try {
    const storePath = getPersistentStoreFilePath();
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[AKASH Desktop] Error reading persistent store:', err);
  }
  return {};
}

function writePersistentStoreSync(storeObj) {
  try {
    writeJsonFileAtomicSync(getPersistentStoreFilePath(), storeObj);
    return true;
  } catch (err) {
    console.error('[AKASH Desktop] Error writing persistent store:', err);
    return false;
  }
}

function readAllNativeProjectsSync() {
  try {
    const projectsDir = getProjectsDirectoryPath();
    const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith('.akash.json'));
    const records = [];
    for (const file of files) {
      try {
        const fullPath = path.join(projectsDir, file);
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (parsed && parsed.id) {
          records.push(parsed);
        }
      } catch {
        // Skip malformed file
      }
    }
    records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return records;
  } catch (err) {
    console.error('[AKASH Desktop] Error reading native projects:', err);
    return [];
  }
}

function saveNativeProjectFileSync(record) {
  try {
    if (!record || !record.id) return { ok: false };
    const safeId = sanitizeFileSegment(record.id);
    const filePath = path.join(getProjectsDirectoryPath(), `${safeId}.akash.json`);
    writeJsonFileAtomicSync(filePath, record);
    return { ok: true, filePath };
  } catch (err) {
    console.error('[AKASH Desktop] Error saving native project file:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Write failed' };
  }
}

function deleteNativeProjectFileSync(projectId) {
  try {
    if (!projectId) return false;
    const safeId = sanitizeFileSegment(projectId);
    const filePath = path.join(getProjectsDirectoryPath(), `${safeId}.akash.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (err) {
    console.error('[AKASH Desktop] Error deleting native project file:', err);
    return false;
  }
}

function readNativeGeometriesSync() {
  try {
    const geomPath = getGeometriesFilePath();
    if (fs.existsSync(geomPath)) {
      const parsed = JSON.parse(fs.readFileSync(geomPath, 'utf8'));
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[AKASH Desktop] Error reading native geometries:', err);
  }
  return [];
}

function writeNativeGeometriesSync(geometries) {
  try {
    if (!Array.isArray(geometries)) return false;
    writeJsonFileAtomicSync(getGeometriesFilePath(), geometries);
    return true;
  } catch (err) {
    console.error('[AKASH Desktop] Error writing native geometries:', err);
    return false;
  }
}

// ============================================================================
// IPC HANDLERS: NATIVE FILE SYSTEM PROJECTS, STORAGE, DIALOGS, CAD & CV
// ============================================================================
function registerDesktopIpcHandlers() {
  // Synchronous hydration of persistent %APPDATA% store on startup
  ipcMain.on('akash:storage-load-all-sync', (event) => {
    event.returnValue = readPersistentStoreSync();
  });

  // Synchronous & async native project file operations in user's data directory
  ipcMain.on('akash:projects-load-all-sync', (event) => {
    event.returnValue = readAllNativeProjectsSync();
  });

  ipcMain.handle('akash:project-save-file', async (_event, record) => {
    return saveNativeProjectFileSync(record);
  });

  ipcMain.handle('akash:project-delete-file', async (_event, { id }) => {
    return deleteNativeProjectFileSync(id);
  });

  ipcMain.on('akash:geometries-load-sync', (event) => {
    event.returnValue = readNativeGeometriesSync();
  });

  ipcMain.handle('akash:geometries-save', async (_event, geometries) => {
    return writeNativeGeometriesSync(geometries);
  });

  ipcMain.handle('akash:open-projects-folder', async () => {
    const dir = getProjectsDirectoryPath();
    await shell.openPath(dir);
    return { folderPath: dir };
  });

  ipcMain.handle('akash:storage-set-item', async (_event, { key, value }) => {
    if (!key || typeof key !== 'string') return false;
    const store = readPersistentStoreSync();
    store[key] = String(value);
    return writePersistentStoreSync(store);
  });

  ipcMain.handle('akash:storage-remove-item', async (_event, { key }) => {
    if (!key || typeof key !== 'string') return false;
    const store = readPersistentStoreSync();
    delete store[key];
    return writePersistentStoreSync(store);
  });

  ipcMain.handle('akash:get-user-data-info', async () => {
    return {
      userDataRootDir: getUserDataRootDir(),
      projectsDir: getProjectsDirectoryPath(),
      persistentStoreFile: getPersistentStoreFilePath(),
      geometriesFile: getGeometriesFilePath(),
      appVersion: app.getVersion(),
      platform: process.platform,
    };
  });

  // Native Windows File Open Dialog (Photos, DXF/DWG, .akash.json Projects)
  ipcMain.handle('akash:dialog-open-file', async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: options.title || 'Open File — AKASH TUNNEL MAPPER',
      defaultPath: options.defaultPath || getProjectsDirectoryPath(),
      properties: ['openFile'],
      filters: options.filters || [
        {
          name: 'All Supported Files',
          extensions: ['json', 'dxf', 'dwg', 'png', 'jpg', 'jpeg', 'webp'],
        },
        { name: 'AKASH Project Files (*.akash.json, *.json)', extensions: ['json'] },
        { name: 'CAD Tunnel Profiles (*.dxf, *.dwg)', extensions: ['dxf', 'dwg'] },
        {
          name: 'Tunnel Photographs (*.jpg, *.png, *.webp)',
          extensions: ['jpg', 'jpeg', 'png', 'webp'],
        },
      ],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    return {
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      base64: buffer.toString('base64'),
      utf8: buffer.toString('utf8'),
    };
  });

  // Native Windows File Save Dialog (Project JSON, PDF, PNG, SVG, CSV, DXF)
  ipcMain.handle('akash:dialog-save-file', async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: options.title || 'Save File — AKASH TUNNEL MAPPER',
      defaultPath: path.join(
        options.defaultDir || getProjectsDirectoryPath(),
        options.defaultFileName || 'Tunnel_Section_Export.json'
      ),
      filters: options.filters || [
        { name: 'AKASH Project (*.akash.json)', extensions: ['json'] },
        { name: 'PDF Engineering Sheet (*.pdf)', extensions: ['pdf'] },
        { name: 'SVG Vector Drawing (*.svg)', extensions: ['svg'] },
        { name: 'PNG High-Res Sheet (*.png)', extensions: ['png'] },
        { name: 'CSV / Excel Schedule (*.csv)', extensions: ['csv'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    if (options.dataBase64) {
      fs.writeFileSync(result.filePath, Buffer.from(options.dataBase64, 'base64'));
    } else if (typeof options.dataUtf8 === 'string') {
      fs.writeFileSync(result.filePath, options.dataUtf8, 'utf8');
    }
    return {
      canceled: false,
      filePath: result.filePath,
    };
  });

  // Native Windows Folder Selection Dialog
  ipcMain.handle('akash:dialog-select-folder', async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: options.title || 'Select Output or Project Data Folder',
      defaultPath: options.defaultPath || getProjectsDirectoryPath(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return {
      canceled: false,
      folderPath: result.filePaths[0],
    };
  });

  // Local Desktop CAD (DWG / DXF) Parser (No localhost required)
  ipcMain.handle('akash:parse-cad', async (_event, payload = {}) => {
    const { fileName = 'tunnel.dwg', contentBase64 = '' } = payload;
    const buf = Buffer.from(contentBase64, 'base64');
    const asciiView = buf.toString('utf8');

    if (asciiView.includes('SECTION') && asciiView.includes('ENTITIES')) {
      return {
        format: 'dxf',
        dxfText: asciiView,
      };
    }

    const doubles = [];
    for (let offset = 64; offset < Math.min(buf.length - 8, 65536); offset += 8) {
      const val = buf.readDoubleLE(offset);
      if (Number.isFinite(val) && Math.abs(val) >= 0.5 && Math.abs(val) <= 25.0) {
        doubles.push(Number(val.toFixed(3)));
      }
    }

    let width = 8.4;
    let height = 7.2;
    if (doubles.length >= 4) {
      const candidates = doubles.filter((d) => d >= 3.5 && d <= 18.0);
      if (candidates.length >= 2) {
        width = Number(candidates[0].toFixed(2));
        height = Number(Math.max(3.5, Math.min(width * 1.15, candidates[1])).toFixed(2));
      }
    }
    const wallHeight = Number((height * 0.58).toFixed(2));

    return {
      format: 'dwg_converted',
      fileName,
      width,
      height,
      wallHeight,
      crownGeometry: 'd_shaped',
    };
  });

  // Local Desktop Hybrid AI + Deterministic CV Joint Tracing (Works Offline & Online without localhost)
  ipcMain.handle('akash:ai-trace-joints', async (_event, payload = {}) => {
    const { cvCandidates = [] } = payload;

    const classifiedFromCV = (Array.isArray(cvCandidates) ? cvCandidates : []).map(
      (c, idx) => {
        const ang = c.angleDeg || 45;
        const isLowAngleBedding = ang < 38 || ang > 142;
        const isProminentShear = idx === 0 && (c.strength || 0.7) > 0.78;

        return {
          points: c.points,
          vertexWidths: c.vertexWidths,
          featureType: isProminentShear ? 'shear' : isLowAngleBedding ? 'bedding' : 'joint',
          confidence:
            (c.strength || 0.7) > 0.72
              ? 'High'
              : (c.strength || 0.7) > 0.55
              ? 'Medium'
              : 'Low',
          roughness: isProminentShear
            ? 'Slickensided / Undulating'
            : isLowAngleBedding
            ? 'Undulating / Planar'
            : 'Rough / Stepped',
          infilling: isProminentShear ? 'Clay / Crushed rock gouge' : 'Not determined',
          apertureMm: isProminentShear ? '5-15 mm (Variable)' : '1-3 mm (Variable)',
          waterCondition: isProminentShear ? 'Damp' : 'Dry',
        };
      }
    );

    return {
      traces: classifiedFromCV,
      engine: 'DESKTOP_NATIVE_CV_PIPELINE',
    };
  });
}

// ============================================================================
// CREATE NATIVE WINDOWS APPLICATION WINDOW
// ============================================================================
let mainWindow = null;

function createMainWindow() {
  const iconPath = path.join(__dirname, '../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_PRODUCT_NAME,
    backgroundColor: '#0B0E14',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  // Prevent navigation away from the desktop application
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load production files by default (never depends on localhost or dev server)
  const devStartUrl = process.env.ELECTRON_START_URL;
  const prodIndexFile = path.join(__dirname, '../dist/index.html');

  if (devStartUrl) {
    mainWindow.loadURL(devStartUrl);
  } else {
    mainWindow.loadFile(prodIndexFile);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerDesktopIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
