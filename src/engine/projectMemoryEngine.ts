import {
  PlaneSurfaceConfig,
  Point2D,
  SavedDesignGeometryRecord,
  SavedProjectRecord,
  SectionToSectionVolumeRow,
  TunnelGeometry,
} from '../types/tunnel';
import { createTunnelGeometry } from './geometryEngine';

const SAVED_GEOMETRIES_STORAGE_KEY = 'akash_tunnel_saved_geometries_v1';
const PROJECT_MEMORY_STORAGE_KEY = 'akash_tunnel_project_memory_v1';

/**
 * Extracts numeric chainage / RD in meters from strings like:
 * - "RD 1423.50m" -> 1423.5
 * - "CH 1+423.50" -> 1423.5
 * - "RD 1420.00m - 1423.50m" -> 1423.5
 */
export function parseNumericChainageMeters(
  faceChainage: string,
  chainageRange?: string
): number | null {
  const target = (faceChainage || chainageRange || '').trim();
  if (!target) return null;

  // Check station format e.g. "1+423.50"
  const stationMatch = target.match(/(\d+)\s*\+\s*(\d+(?:\.\d+)?)/);
  if (stationMatch) {
    const km = parseFloat(stationMatch[1]);
    const m = parseFloat(stationMatch[2]);
    if (!Number.isNaN(km) && !Number.isNaN(m)) {
      return Number((km * 1000 + m).toFixed(2));
    }
  }

  // Otherwise extract all numbers and take the last one (e.g., face RD in "1420.00 - 1423.50")
  const numMatches = target.match(/\d+(?:\.\d+)?/g);
  if (numMatches && numMatches.length > 0) {
    const val = parseFloat(numMatches[numMatches.length - 1]);
    if (!Number.isNaN(val)) return Number(val.toFixed(2));
  }
  return null;
}

/**
 * Creates a rectangular Plane-Surface Geometry in meters:
 * x in [-width/2, +width/2], y in [0, height]
 */
export function createPlaneSurfaceGeometry(config: PlaneSurfaceConfig): TunnelGeometry {
  const w = Math.max(1.0, Number(config.widthMeters.toFixed(2)));
  const h = Math.max(1.0, Number(config.heightMeters.toFixed(2)));
  const halfW = w / 2;

  const pts: Point2D[] = [
    { x: -halfW, y: 0 },
    { x: -halfW, y: h },
    { x: halfW, y: h },
    { x: halfW, y: 0 },
  ];

  return {
    width: w,
    height: h,
    wallHeight: h,
    crownGeometry: 'custom_cad',
    crownRadius: w,
    units: 'm',
    source: 'manual',
    cadFileName: `Plane Surface (${config.planeName})`,
    crossSectionPoints: pts,
    crownArcLength: w,
    isPlaneSurface: true,
    planeSurfaceConfig: { ...config, enabled: true },
  };
}

export function createDefaultPlaneSurfaceConfig(): PlaneSurfaceConfig {
  return {
    enabled: false,
    planeName: 'Portal Cut Wall / Rock Bench B-1',
    widthMeters: 10.0,
    heightMeters: 6.0,
    planeStrikeDeg: 160,
    planeDipDirectionDeg: 250,
    planeDipDeg: 85,
    elevationMeters: 1240.0,
    location: 'Main Portal Bench Slope',
  };
}

export function loadSavedDesignGeometries(): SavedDesignGeometryRecord[] {
  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    try {
      const diskGeoms = window.akashDesktop.loadGeometriesFromDiskSync();
      if (Array.isArray(diskGeoms) && diskGeoms.length > 0) {
        return diskGeoms;
      }
    } catch {
      // Fallback to localStorage
    }
  }

  try {
    const raw = localStorage.getItem(SAVED_GEOMETRIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }

  return [];
}

export function saveDesignGeometryToLibrary(
  record: Omit<SavedDesignGeometryRecord, 'id' | 'savedAt'> & { id?: string }
): SavedDesignGeometryRecord[] {
  const existing = loadSavedDesignGeometries();
  const newItem: SavedDesignGeometryRecord = {
    id: record.id || `geom-${Date.now()}`,
    name: record.name,
    tunnelName: record.tunnelName,
    location: record.location,
    chainage: record.chainage,
    savedAt: new Date().toISOString(),
    geometry: record.geometry,
  };
  const next = [newItem, ...existing.filter((g) => g.id !== newItem.id)].slice(0, 30);
  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    window.akashDesktop.saveGeometriesToDisk(next).catch(() => {});
  }
  try {
    localStorage.setItem(SAVED_GEOMETRIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors
  }
  return next;
}

export function deleteSavedDesignGeometry(id: string): SavedDesignGeometryRecord[] {
  const next = loadSavedDesignGeometries().filter((g) => g.id !== id);
  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    window.akashDesktop.saveGeometriesToDisk(next).catch(() => {});
  }
  try {
    localStorage.setItem(SAVED_GEOMETRIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore errors
  }
  return next;
}

export function loadSavedProjectsFromMemory(): SavedProjectRecord[] {
  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    try {
      const diskProjects = window.akashDesktop.loadProjectsFromDiskSync();
      if (Array.isArray(diskProjects) && diskProjects.length > 0) {
        return diskProjects;
      }
    } catch {
      // Fallback to localStorage
    }
  }

  try {
    const raw = localStorage.getItem(PROJECT_MEMORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return [];
}

/**
 * Saves or updates a complete Project Record in Project File Memory.
 * If an existing record matches the exact same (Tunnel + Location + Chainage + Date) or ID,
 * it updates that record cleanly or creates a new entry.
 */
export function saveProjectRecordToMemory(
  record: SavedProjectRecord,
  overwriteMatchingKey = true
): { records: SavedProjectRecord[]; savedRecord: SavedProjectRecord; storageWarning?: string } {
  const existing = loadSavedProjectsFromMemory();
  const normKey = (r: {
    tunnelName: string;
    location: string;
    faceChainage: string;
    chainage: string;
    date: string;
  }) =>
    `${(r.tunnelName || '').trim().toLowerCase()}|${(r.location || '').trim().toLowerCase()}|${(
      r.faceChainage ||
      r.chainage ||
      ''
    )
      .trim()
      .toLowerCase()}|${(r.date || '').trim()}`;

  const targetKey = normKey(record);
  const replacedIds: string[] = [];
  const filtered = existing.filter((item) => {
    if (item.id === record.id) return false;
    if (overwriteMatchingKey && normKey(item) === targetKey) {
      replacedIds.push(item.id);
      return false;
    }
    return true;
  });

  const next = [record, ...filtered].slice(0, 50);

  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    for (const oldId of replacedIds) {
      window.akashDesktop.deleteProjectFromDisk(oldId).catch(() => {});
    }
    window.akashDesktop.saveProjectToDisk(record).catch(() => {});
  }

  try {
    localStorage.setItem(PROJECT_MEMORY_STORAGE_KEY, JSON.stringify(next));
    return { records: next, savedRecord: record };
  } catch {
    // If browser localStorage is full due to base64 supporting photos, strip supporting photos & retry so main photo + vectors are always preserved
    try {
      const compactNext = next.map((proj, idx) => {
        if (idx === 0) return proj;
        const compactPhotos = { ...proj.photos };
        (['face', 'crown', 'leftWall', 'rightWall'] as const).forEach((s) => {
          compactPhotos[s] = {
            ...compactPhotos[s],
            supportingPhotos: [],
            warpedImage: null,
          };
        });
        return { ...proj, photos: compactPhotos };
      });
      localStorage.setItem(PROJECT_MEMORY_STORAGE_KEY, JSON.stringify(compactNext));
      return {
        records: next,
        savedRecord: record,
      };
    } catch {
      return {
        records: next,
        savedRecord: record,
        storageWarning:
          typeof window !== 'undefined' && window.akashDesktop?.isElectron
            ? undefined
            : 'Saved in active session memory (use Export .akash.json for large high-res photo archives).',
      };
    }
  }
}

export function deleteProjectRecordFromMemory(id: string): SavedProjectRecord[] {
  const next = loadSavedProjectsFromMemory().filter((r) => r.id !== id);
  if (typeof window !== 'undefined' && window.akashDesktop?.isElectron) {
    window.akashDesktop.deleteProjectFromDisk(id).catch(() => {});
  }
  try {
    localStorage.setItem(PROJECT_MEMORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore errors
  }
  return next;
}

/**
 * Searches saved Project Records by Tunnel Name, Location, Chainage/RD, and Date.
 */
export function filterSavedProjects(
  records: SavedProjectRecord[],
  filters: {
    tunnelQuery?: string;
    locationQuery?: string;
    chainageQuery?: string;
    dateQuery?: string;
  }
): SavedProjectRecord[] {
  const tq = (filters.tunnelQuery || '').trim().toLowerCase();
  const lq = (filters.locationQuery || '').trim().toLowerCase();
  const cq = (filters.chainageQuery || '').trim().toLowerCase();
  const dq = (filters.dateQuery || '').trim().toLowerCase();

  return records.filter((rec) => {
    if (tq && !(rec.tunnelName || '').toLowerCase().includes(tq)) return false;
    if (lq && !(rec.location || '').toLowerCase().includes(lq)) return false;
    if (
      cq &&
      !(rec.faceChainage || '').toLowerCase().includes(cq) &&
      !(rec.chainage || '').toLowerCase().includes(cq)
    ) {
      return false;
    }
    if (dq && !(rec.date || '').toLowerCase().includes(dq)) return false;
    return true;
  });
}

/**
 * Section 4 & 5: Multi-Section Chainage-to-Chainage Engineering Volume Calculation.
 * Uses both the Average End Area method and the Prismoidal method between consecutive
 * surveyed cross-sections along the same tunnel.
 */
export function computeSectionToSectionVolumes(
  records: SavedProjectRecord[],
  tunnelNameFilter?: string
): SectionToSectionVolumeRow[] {
  const validSections = records
    .filter((r) => {
      if (
        tunnelNameFilter &&
        r.tunnelName.trim().toLowerCase() !== tunnelNameFilter.trim().toLowerCase()
      ) {
        return false;
      }
      return typeof r.numericChainageMeters === 'number' && !Number.isNaN(r.numericChainageMeters);
    })
    .slice()
    .sort((a, b) => (a.numericChainageMeters || 0) - (b.numericChainageMeters || 0));

  const rows: SectionToSectionVolumeRow[] = [];
  for (let i = 0; i < validSections.length - 1; i++) {
    const s1 = validSections[i];
    const s2 = validSections[i + 1];
    const rd1 = s1.numericChainageMeters!;
    const rd2 = s2.numericChainageMeters!;
    const dL = Number(Math.abs(rd2 - rd1).toFixed(2));
    if (dL <= 0.01) continue;

    const desA1 = s1.quantitySummary.designAreaSqM;
    const desA2 = s2.quantitySummary.designAreaSqM;
    const survA1 = s1.quantitySummary.surveyedAreaSqM || desA1;
    const survA2 = s2.quantitySummary.surveyedAreaSqM || desA2;

    const obA1 = s1.quantitySummary.overbreakAreaSqM;
    const obA2 = s2.quantitySummary.overbreakAreaSqM;
    const ucA1 = s1.quantitySummary.undercutAreaSqM;
    const ucA2 = s2.quantitySummary.undercutAreaSqM;

    const avgEndArea = (a1: number, a2: number) => Number((((a1 + a2) / 2) * dL).toFixed(2));
    const prismoidal = (a1: number, a2: number) =>
      Number(((dL / 6) * (a1 + 4 * Math.sqrt(Math.max(0, a1 * a2)) + a2)).toFixed(2));

    const dVol = avgEndArea(desA1, desA2);
    const sVol = avgEndArea(survA1, survA2);
    const obAvg = avgEndArea(obA1, obA2);
    const obPrism = prismoidal(obA1, obA2);
    const ucAvg = avgEndArea(ucA1, ucA2);
    const ucPrism = prismoidal(ucA1, ucA2);

    rows.push({
      id: `vol-${s1.id}-${s2.id}`,
      fromSectionId: s1.id,
      toSectionId: s2.id,
      fromChainageLabel: s1.faceChainage || s1.chainage,
      toChainageLabel: s2.faceChainage || s2.chainage,
      fromRdMeters: rd1,
      toRdMeters: rd2,
      intervalLengthMeters: dL,
      designVolumeM3: dVol,
      designVolumeCubicMeters: dVol,
      surveyedVolumeM3: sVol,
      surveyedVolumeCubicMeters: sVol,
      overbreakVolumeAvgEndAreaM3: obAvg,
      overbreakVolumeAvgEndAreaCubicMeters: obAvg,
      overbreakVolumePrismoidalM3: obPrism,
      overbreakVolumePrismoidalCubicMeters: obPrism,
      undercutVolumeAvgEndAreaM3: ucAvg,
      undercutVolumeAvgEndAreaCubicMeters: ucAvg,
      undercutVolumePrismoidalM3: ucPrism,
      undercutVolumePrismoidalCubicMeters: ucPrism,
      primaryOverbreakReason:
        s2.surveyProfile?.overallOverbreakReason ||
        s1.surveyProfile?.overallOverbreakReason ||
        'Geological wedge / discontinuity Controlled Overbreak',
    });
  }

  return rows;
}
