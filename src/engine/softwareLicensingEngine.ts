import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  getConfiguredGithubRepo,
  getGithubUserExeDownloadUrl,
  normalizeGithubRepoSlug,
  saveConfiguredGithubRepo,
} from './windowsDesktopEngine';

export const CURRENT_SOFTWARE_VERSION = '1.0.0';
export const MASTER_ADMIN_DEFAULT_EMAIL = 'dhoniakash407@gmail.com';
const ADMIN_AUTH_SIG = 'ESWA_MASTER_ADMIN_SIG_v1';
const PORTAL_SCOPE = 'ESWA_GLOBAL';

const LOCAL_PC_HW_ID_KEY = 'eswa_pc_hardware_fingerprint_v1';
const LOCAL_MASTER_PC_BYPASS_KEY = 'eswa_master_pc_bypass_v1';
const LOCAL_ACTIVE_SESSION_KEY = 'eswa_1pc_activated_session_v1';
const LOCAL_INSTALLED_VERSION_KEY = 'eswa_installed_software_version_v1';
const LOCAL_ADMIN_CREDENTIALS_KEY = 'eswa_master_admin_credentials_v1';

const LOCAL_MIRROR_REQUESTS_KEY = 'eswa_mirror_requests_v1';
const LOCAL_MIRROR_LICENSES_KEY = 'eswa_mirror_licenses_v1';
const LOCAL_MIRROR_RELEASES_KEY = 'eswa_mirror_releases_v1';
const LOCAL_MIRROR_MASTER_PCS_KEY = 'eswa_mirror_master_pcs_v1';

function readLocalMirror<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocalMirror<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('eswa-licensing-mirror-updated'));
  } catch {
    // Ignore storage errors
  }
}

function upsertMirrorItem<T>(
  key: string,
  item: T,
  idGetter: (x: T) => string
): T[] {
  const list = readLocalMirror<T>(key);
  const targetId = idGetter(item);
  const idx = list.findIndex((x) => idGetter(x) === targetId);
  const next = idx >= 0 ? list.map((x, i) => (i === idx ? item : x)) : [item, ...list];
  writeLocalMirror(key, next);
  return next;
}

function removeMirrorItem<T>(
  key: string,
  targetId: string,
  idGetter: (x: T) => string
): T[] {
  const list = readLocalMirror<T>(key).filter((x) => idGetter(x) !== targetId);
  writeLocalMirror(key, list);
  return list;
}

function withFirestoreTimeout<T>(promise: Promise<T>, ms = 2500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('FIRESTORE_TIMEOUT_OFFLINE_FALLBACK'));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function isOfflineOrTimeoutError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('firestore_timeout_offline_fallback') ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('unavailable') ||
    msg.includes('network')
  );
}

export interface AccessRequestRecord {
  requestId: string;
  portalScope: string;
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  roleTitle: string;
  pcHardwareId: string;
  pcName: string;
  purposeNotes: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  assignedUserId: string;
  assignedLicenseKey: string;
  createdAtIso: string;
}

export interface SoftwareLicenseRecord {
  userId: string;
  portalScope: string;
  password: string;
  licenseKey: string;
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  boundPcHardwareId: string;
  boundPcName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  installedVersion: string;
  lastSeenAtIso: string;
  createdAtIso: string;
  adminAuthSig: string;
}

export interface SoftwareReleaseRecord {
  releaseId: string;
  portalScope: string;
  version: string;
  title: string;
  releaseNotes: string;
  downloadUrl: string;
  targetScope: 'ALL_PCS' | 'SPECIFIC_PCS';
  targetIdentifierCsv: string;
  isMandatory: boolean;
  status: 'PUBLISHED' | 'ARCHIVED';
  publishedAtIso: string;
  adminAuthSig: string;
}

export interface MasterPcRecord {
  pcHardwareId: string;
  portalScope: string;
  label: string;
  bypassLogin: boolean;
  registeredAtIso: string;
  adminAuthSig: string;
}

export interface ActivatedClientSession {
  userId: string;
  fullName: string;
  organization: string;
  licenseKey: string;
  pcHardwareId: string;
  activatedAtIso: string;
}

/**
 * Generates or retrieves the unique, persistent Hardware Fingerprint ID for this PC.
 * Ensures 1-PC-1-Software locking so credentials cannot be shared with another PC.
 */
export function getOrGeneratePcHardwareId(): { pcHardwareId: string; pcName: string } {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const scr = typeof window !== 'undefined' ? window.screen : null;

  const platformStr = nav?.platform || 'Win64';
  const cores = nav?.hardwareConcurrency || 8;
  const screenSig = scr ? `${scr.width}x${scr.height}x${scr.colorDepth}` : '1920x1080x24';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const pcName = `${platformStr} (${cores}-Core · ${screenSig})`;

  try {
    const existing = localStorage.getItem(LOCAL_PC_HW_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return { pcHardwareId: existing, pcName };
    }
  } catch {
    // Fallback if storage restricted
  }

  // Deterministic hardware seed + persistent workstation installation salt
  const rawSeed = `${platformStr}|${cores}|${screenSig}|${tz}`;
  let hash = 2166136261;
  for (let i = 0; i < rawSeed.length; i++) {
    hash ^= rawSeed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hwHex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const installSalt = Math.random().toString(36).substring(2, 6).toUpperCase();
  const generatedId = `PC-${hwHex.slice(0, 4)}-${hwHex.slice(4, 8)}-${installSalt}`;

  try {
    localStorage.setItem(LOCAL_PC_HW_ID_KEY, generatedId);
  } catch {
    // Ignore storage write error
  }
  return { pcHardwareId: generatedId, pcName };
}

export function sanitizeIdentifier(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 64) || 'user_01'
  );
}

export function generateOnePcLicenseKey(userId: string, pcHardwareId?: string): string {
  const cleanUser = sanitizeIdentifier(userId).toUpperCase().slice(0, 4).padEnd(4, 'X');
  const pcPart = (pcHardwareId || 'ANYPC')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(-4)
    .padStart(4, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ESWA-1PC-${cleanUser}-${pcPart}-${rand}`;
}

export function getInstalledSoftwareVersion(): string {
  try {
    return localStorage.getItem(LOCAL_INSTALLED_VERSION_KEY) || CURRENT_SOFTWARE_VERSION;
  } catch {
    return CURRENT_SOFTWARE_VERSION;
  }
}

export function setInstalledSoftwareVersion(version: string): void {
  try {
    localStorage.setItem(LOCAL_INSTALLED_VERSION_KEY, version.trim().slice(0, 40));
  } catch {
    // Ignore
  }
}

export function getLocalMasterPcBypass(): boolean {
  try {
    return localStorage.getItem(LOCAL_MASTER_PC_BYPASS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setLocalMasterPcBypass(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(LOCAL_MASTER_PC_BYPASS_KEY, 'true');
    } else {
      localStorage.removeItem(LOCAL_MASTER_PC_BYPASS_KEY);
    }
  } catch {
    // Ignore
  }
}

export function getLocalActivatedSession(): ActivatedClientSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActivatedClientSession;
    const { pcHardwareId } = getOrGeneratePcHardwareId();
    // Strict 1-PC check: session is only valid if hardware ID matches this exact PC
    if (parsed && parsed.pcHardwareId === pcHardwareId && parsed.userId && parsed.licenseKey) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocalActivatedSession(session: ActivatedClientSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(LOCAL_ACTIVE_SESSION_KEY);
    } else {
      localStorage.setItem(LOCAL_ACTIVE_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore
  }
}

export function getStoredAdminCredentials(): { email: string; password: string } {
  try {
    const raw = localStorage.getItem(LOCAL_ADMIN_CREDENTIALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.email && parsed?.password) {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return {
    email: MASTER_ADMIN_DEFAULT_EMAIL,
    password: 'akash@master2026',
  };
}

export function updateStoredAdminCredentials(email: string, password: string): void {
  try {
    localStorage.setItem(
      LOCAL_ADMIN_CREDENTIALS_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), password: password.trim() })
    );
  } catch {
    // Ignore
  }
}

/**
 * Submits a new Software Access Request after a user downloads the software.
 */
export async function submitSoftwareAccessRequest(input: {
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  roleTitle: string;
  purposeNotes: string;
}): Promise<AccessRequestRecord> {
  const { pcHardwareId, pcName } = getOrGeneratePcHardwareId();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record: AccessRequestRecord = {
    requestId,
    portalScope: PORTAL_SCOPE,
    fullName: input.fullName.trim().slice(0, 120),
    email: input.email.trim().slice(0, 160),
    phone: input.phone.trim().slice(0, 60),
    organization: input.organization.trim().slice(0, 160),
    roleTitle: (input.roleTitle.trim() || 'Tunnel Engineer').slice(0, 100),
    pcHardwareId: pcHardwareId.slice(0, 128),
    pcName: pcName.slice(0, 120),
    purposeNotes: (input.purposeNotes || 'Requested after software download').trim().slice(0, 500),
    status: 'PENDING',
    assignedUserId: '',
    assignedLicenseKey: '',
    createdAtIso: new Date().toISOString(),
  };

  upsertMirrorItem(LOCAL_MIRROR_REQUESTS_KEY, record, (x) => x.requestId);
  try {
    localStorage.setItem('eswa_last_submitted_request_id', requestId);
  } catch {
    // Ignore
  }

  const path = `access_requests/${requestId}`;
  try {
    await withFirestoreTimeout(setDoc(doc(db, 'access_requests', requestId), record));
    return record;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      return record;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Checks the status of a previously submitted Access Request by its ID.
 */
export async function getAccessRequestById(
  requestId: string
): Promise<AccessRequestRecord | null> {
  const cleanId = sanitizeIdentifier(requestId);
  const localMatch =
    readLocalMirror<AccessRequestRecord>(LOCAL_MIRROR_REQUESTS_KEY).find(
      (r) => r.requestId === cleanId
    ) || null;
  const path = `access_requests/${cleanId}`;
  try {
    const snap = await withFirestoreTimeout(
      getDoc(doc(db, 'access_requests', cleanId)),
      2000
    );
    if (!snap.exists()) return localMatch;
    const remote = snap.data() as AccessRequestRecord;
    upsertMirrorItem(LOCAL_MIRROR_REQUESTS_KEY, remote, (x) => x.requestId);
    return remote;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      return localMatch;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Verifies User ID, Password, and 1-PC License Key on the Software Login Gate.
 * Strictly enforces One-PC-One-Software hardware locking:
 * - If the license is not yet bound to a PC (`boundPcHardwareId == ''`), binds it to THIS PC (`pcHardwareId`).
 * - If the license is already bound to THIS PC (`boundPcHardwareId == pcHardwareId`), logs in and updates heartbeat.
 * - If the license is bound to ANY OTHER PC (`boundPcHardwareId !== pcHardwareId`), rejects login immediately!
 */
export async function verifyAndActivateOnePcLogin(input: {
  userId: string;
  password: string;
  licenseKey: string;
}): Promise<{
  ok: boolean;
  message: string;
  session?: ActivatedClientSession;
  isMasterAdmin?: boolean;
}> {
  const rawUser = input.userId.trim().toLowerCase();
  const rawPass = input.password.trim();
  const storedAdmin = getStoredAdminCredentials();
  const { pcHardwareId, pcName } = getOrGeneratePcHardwareId();

  // Allow Master Owner (dhoniakash407@gmail.com / admin) to log in directly with Master Password
  const isMasterUser =
    rawUser === storedAdmin.email.toLowerCase() ||
    rawUser === MASTER_ADMIN_DEFAULT_EMAIL.toLowerCase() ||
    rawUser === 'admin' ||
    rawUser === 'master';

  if (isMasterUser && rawPass === storedAdmin.password) {
    setLocalMasterPcBypass(true);
    setMasterPcAuthorization(
      pcHardwareId,
      `Master Owner Workstation (${pcName})`,
      true
    ).catch(() => {});

    const nowIso = new Date().toISOString();
    const masterSession: ActivatedClientSession = {
      userId: storedAdmin.email,
      fullName: 'Master Admin',
      organization: 'ESWA Master Workstation',
      licenseKey: 'MASTER-PC-BYPASS',
      pcHardwareId,
      activatedAtIso: nowIso,
    };
    saveLocalActivatedSession(masterSession);
    return {
      ok: true,
      isMasterAdmin: true,
      message: `Master Admin verified! This PC (${pcHardwareId}) is now unlocked.`,
      session: masterSession,
    };
  }

  if (!input.licenseKey.trim()) {
    return {
      ok: false,
      message:
        'Please enter your 1-PC Hardware License Key (or use Master Admin Email & Password).',
    };
  }

  const cleanUserId = sanitizeIdentifier(input.userId);
  const path = `software_licenses/${cleanUserId}`;

  const validateAndBindLicense = (
    license: SoftwareLicenseRecord
  ): {
    ok: boolean;
    message: string;
    session?: ActivatedClientSession;
    updatedLicense?: SoftwareLicenseRecord;
  } => {
    if (license.status !== 'ACTIVE') {
      return {
        ok: false,
        message: `This license is currently ${license.status}. Please contact the Master Admin.`,
      };
    }

    if (
      license.password !== input.password.trim() ||
      license.licenseKey.trim().toUpperCase() !== input.licenseKey.trim().toUpperCase()
    ) {
      return {
        ok: false,
        message: 'Incorrect Password or 1-PC License Key.',
      };
    }

    // Strict 1-PC Hardware Lock Enforcement
    if (
      license.boundPcHardwareId &&
      license.boundPcHardwareId !== '' &&
      license.boundPcHardwareId !== pcHardwareId
    ) {
      return {
        ok: false,
        message: `1-PC HARDWARE LOCK VIOLATION: These credentials & key are already locked to another workstation (${license.boundPcHardwareId}). Each license can only be used on one single PC.`,
      };
    }

    const nowIso = new Date().toISOString();
    const currentVer = getInstalledSoftwareVersion();
    const updatedLicense: SoftwareLicenseRecord = {
      ...license,
      boundPcHardwareId: pcHardwareId,
      boundPcName: pcName.slice(0, 120),
      installedVersion: currentVer,
      lastSeenAtIso: nowIso,
    };
    upsertMirrorItem(LOCAL_MIRROR_LICENSES_KEY, updatedLicense, (x) => x.userId);

    const session: ActivatedClientSession = {
      userId: license.userId,
      fullName: license.fullName,
      organization: license.organization,
      licenseKey: license.licenseKey,
      pcHardwareId,
      activatedAtIso: nowIso,
    };
    saveLocalActivatedSession(session);

    return {
      ok: true,
      message: `Verified & hardware-locked to this PC (${pcHardwareId}).`,
      session,
      updatedLicense,
    };
  };

  try {
    const ref = doc(db, 'software_licenses', cleanUserId);
    const snap = await withFirestoreTimeout(getDoc(ref), 2500);
    if (!snap.exists()) {
      const localLic = readLocalMirror<SoftwareLicenseRecord>(
        LOCAL_MIRROR_LICENSES_KEY
      ).find((l) => sanitizeIdentifier(l.userId) === cleanUserId);
      if (localLic) {
        return validateAndBindLicense(localLic);
      }
      return {
        ok: false,
        message:
          'Invalid User ID. Please request access or check the User ID issued by the Master Admin.',
      };
    }

    const license = snap.data() as SoftwareLicenseRecord;
    const result = validateAndBindLicense(license);
    if (result.ok && result.updatedLicense) {
      withFirestoreTimeout(
        updateDoc(ref, {
          boundPcHardwareId: result.updatedLicense.boundPcHardwareId,
          boundPcName: result.updatedLicense.boundPcName,
          installedVersion: result.updatedLicense.installedVersion,
          lastSeenAtIso: result.updatedLicense.lastSeenAtIso,
        }),
        2000
      ).catch(() => {});
    }
    return result;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      const localLic = readLocalMirror<SoftwareLicenseRecord>(
        LOCAL_MIRROR_LICENSES_KEY
      ).find((l) => sanitizeIdentifier(l.userId) === cleanUserId);
      if (localLic) {
        return validateAndBindLicense(localLic);
      }
      return {
        ok: false,
        message:
          'Invalid User ID or offline. Tip: Master Owner can log in directly with dhoniakash407@gmail.com and akash@master2026.',
      };
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Checks whether the current PC is registered as a Master PC (No Login Required).
 */
export async function checkIsCurrentPcMaster(): Promise<boolean> {
  if (getLocalMasterPcBypass()) {
    return true;
  }
  const { pcHardwareId } = getOrGeneratePcHardwareId();
  const cleanPcId = sanitizeIdentifier(pcHardwareId);
  const localMatch = readLocalMirror<MasterPcRecord>(LOCAL_MIRROR_MASTER_PCS_KEY).find(
    (m) => sanitizeIdentifier(m.pcHardwareId) === cleanPcId
  );
  if (localMatch?.bypassLogin) {
    setLocalMasterPcBypass(true);
    return true;
  }
  try {
    const snap = await withFirestoreTimeout(
      getDoc(doc(db, 'master_pcs', cleanPcId)),
      1200
    );
    if (snap.exists()) {
      const data = snap.data() as MasterPcRecord;
      upsertMirrorItem(LOCAL_MIRROR_MASTER_PCS_KEY, data, (x) => x.pcHardwareId);
      if (data.bypassLogin) {
        setLocalMasterPcBypass(true);
        return true;
      }
    }
  } catch {
    // Offline or timeout — proceed immediately to login gate
  }
  return false;
}

/**
 * Registers or updates a Master PC in Firestore & local storage (Admin Action).
 */
export async function setMasterPcAuthorization(
  pcHardwareId: string,
  label: string,
  bypassLogin: boolean
): Promise<void> {
  const cleanPcId = sanitizeIdentifier(pcHardwareId);
  const currentPc = getOrGeneratePcHardwareId();
  if (cleanPcId === sanitizeIdentifier(currentPc.pcHardwareId)) {
    setLocalMasterPcBypass(bypassLogin);
  }

  const record: MasterPcRecord = {
    pcHardwareId: cleanPcId,
    portalScope: PORTAL_SCOPE,
    label: (label.trim() || 'Master Admin PC').slice(0, 120),
    bypassLogin,
    registeredAtIso: new Date().toISOString(),
    adminAuthSig: ADMIN_AUTH_SIG,
  };
  upsertMirrorItem(LOCAL_MIRROR_MASTER_PCS_KEY, record, (x) => x.pcHardwareId);

  const path = `master_pcs/${cleanPcId}`;
  try {
    await withFirestoreTimeout(setDoc(doc(db, 'master_pcs', cleanPcId), record));
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeMasterPcAuthorization(pcHardwareId: string): Promise<void> {
  const cleanPcId = sanitizeIdentifier(pcHardwareId);
  const currentPc = getOrGeneratePcHardwareId();
  if (cleanPcId === sanitizeIdentifier(currentPc.pcHardwareId)) {
    setLocalMasterPcBypass(false);
  }
  removeMirrorItem<MasterPcRecord>(
    LOCAL_MIRROR_MASTER_PCS_KEY,
    cleanPcId,
    (x) => x.pcHardwareId
  );
  const path = `master_pcs/${cleanPcId}`;
  try {
    await withFirestoreTimeout(deleteDoc(doc(db, 'master_pcs', cleanPcId)));
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Admin Action: Approves an Access Request and creates a 1-PC Hardware-Locked License.
 */
export async function approveRequestAndCreateLicense(input: {
  request: AccessRequestRecord;
  userId: string;
  password: string;
  licenseKey: string;
  lockToRequestedPcImmediately: boolean;
}): Promise<SoftwareLicenseRecord> {
  const cleanUserId = sanitizeIdentifier(input.userId);
  const nowIso = new Date().toISOString();

  const licenseRecord: SoftwareLicenseRecord = {
    userId: cleanUserId,
    portalScope: PORTAL_SCOPE,
    password: input.password.trim().slice(0, 120),
    licenseKey: input.licenseKey.trim().toUpperCase().slice(0, 80),
    fullName: input.request.fullName.slice(0, 120),
    email: input.request.email.slice(0, 160),
    phone: input.request.phone.slice(0, 60),
    organization: input.request.organization.slice(0, 160),
    boundPcHardwareId: input.lockToRequestedPcImmediately
      ? input.request.pcHardwareId.slice(0, 128)
      : '',
    boundPcName: input.lockToRequestedPcImmediately
      ? input.request.pcName.slice(0, 120)
      : '',
    status: 'ACTIVE',
    installedVersion: CURRENT_SOFTWARE_VERSION,
    lastSeenAtIso: nowIso,
    createdAtIso: nowIso,
    adminAuthSig: ADMIN_AUTH_SIG,
  };

  const updatedReq: AccessRequestRecord = {
    ...input.request,
    status: 'APPROVED',
    assignedUserId: cleanUserId,
    assignedLicenseKey: licenseRecord.licenseKey,
  };
  upsertMirrorItem(LOCAL_MIRROR_LICENSES_KEY, licenseRecord, (x) => x.userId);
  upsertMirrorItem(LOCAL_MIRROR_REQUESTS_KEY, updatedReq, (x) => x.requestId);

  try {
    await withFirestoreTimeout(
      Promise.all([
        setDoc(doc(db, 'software_licenses', cleanUserId), licenseRecord),
        updateDoc(doc(db, 'access_requests', input.request.requestId), {
          status: 'APPROVED',
          assignedUserId: cleanUserId,
          assignedLicenseKey: licenseRecord.licenseKey,
          adminAuthSig: ADMIN_AUTH_SIG,
        }),
      ])
    );
    return licenseRecord;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      return licenseRecord;
    }
    handleFirestoreError(error, OperationType.WRITE, `software_licenses/${cleanUserId}`);
  }
}

/**
 * Admin Action: Directly creates a new 1-PC License without a prior request.
 */
export async function createDirectSoftwareLicense(input: {
  userId: string;
  password: string;
  licenseKey: string;
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  boundPcHardwareId?: string;
}): Promise<SoftwareLicenseRecord> {
  const cleanUserId = sanitizeIdentifier(input.userId);
  const nowIso = new Date().toISOString();
  const record: SoftwareLicenseRecord = {
    userId: cleanUserId,
    portalScope: PORTAL_SCOPE,
    password: input.password.trim().slice(0, 120),
    licenseKey: input.licenseKey.trim().toUpperCase().slice(0, 80),
    fullName: (input.fullName.trim() || cleanUserId).slice(0, 120),
    email: (input.email || '').trim().slice(0, 160),
    phone: (input.phone || '').trim().slice(0, 60),
    organization: (input.organization || 'Licensed Organization').trim().slice(0, 160),
    boundPcHardwareId: (input.boundPcHardwareId || '').trim().slice(0, 128),
    boundPcName: input.boundPcHardwareId ? 'Pre-Bound Workstation' : '',
    status: 'ACTIVE',
    installedVersion: CURRENT_SOFTWARE_VERSION,
    lastSeenAtIso: nowIso,
    createdAtIso: nowIso,
    adminAuthSig: ADMIN_AUTH_SIG,
  };

  upsertMirrorItem(LOCAL_MIRROR_LICENSES_KEY, record, (x) => x.userId);

  try {
    await withFirestoreTimeout(setDoc(doc(db, 'software_licenses', cleanUserId), record));
    return record;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      return record;
    }
    handleFirestoreError(error, OperationType.CREATE, `software_licenses/${cleanUserId}`);
  }
}

/**
 * Admin Action: Resets the 1-PC Hardware Lock or changes status (ACTIVE / SUSPENDED / REVOKED).
 */
export async function updateSoftwareLicenseAdmin(
  userId: string,
  updates: Partial<
    Pick<
      SoftwareLicenseRecord,
      'status' | 'boundPcHardwareId' | 'boundPcName' | 'password' | 'licenseKey'
    >
  >
): Promise<void> {
  const cleanUserId = sanitizeIdentifier(userId);
  const existing = readLocalMirror<SoftwareLicenseRecord>(LOCAL_MIRROR_LICENSES_KEY).find(
    (l) => l.userId === cleanUserId
  );
  if (existing) {
    upsertMirrorItem(
      LOCAL_MIRROR_LICENSES_KEY,
      { ...existing, ...updates },
      (x) => x.userId
    );
  }
  try {
    await withFirestoreTimeout(
      updateDoc(doc(db, 'software_licenses', cleanUserId), {
        ...updates,
        adminAuthSig: ADMIN_AUTH_SIG,
      })
    );
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, `software_licenses/${cleanUserId}`);
  }
}

export async function deleteSoftwareLicenseAdmin(userId: string): Promise<void> {
  const cleanUserId = sanitizeIdentifier(userId);
  removeMirrorItem<SoftwareLicenseRecord>(
    LOCAL_MIRROR_LICENSES_KEY,
    cleanUserId,
    (x) => x.userId
  );
  try {
    await withFirestoreTimeout(deleteDoc(doc(db, 'software_licenses', cleanUserId)));
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.DELETE, `software_licenses/${cleanUserId}`);
  }
}

export async function rejectAccessRequestAdmin(requestId: string): Promise<void> {
  const existing = readLocalMirror<AccessRequestRecord>(LOCAL_MIRROR_REQUESTS_KEY).find(
    (r) => r.requestId === requestId
  );
  if (existing) {
    upsertMirrorItem(
      LOCAL_MIRROR_REQUESTS_KEY,
      {
        ...existing,
        status: 'REJECTED',
        assignedUserId: '',
        assignedLicenseKey: '',
      },
      (x) => x.requestId
    );
  }
  try {
    await withFirestoreTimeout(
      updateDoc(doc(db, 'access_requests', requestId), {
        status: 'REJECTED',
        assignedUserId: '',
        assignedLicenseKey: '',
        adminAuthSig: ADMIN_AUTH_SIG,
      })
    );
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, `access_requests/${requestId}`);
  }
}

/**
 * Admin Action: Saves & syncs the GitHub Repository slug ("owner/repo") to Firestore
 * so all User PCs and Admin Portals automatically know the GitHub User Software .EXE link.
 */
export async function syncGithubRepoConfigToCloud(rawRepoInput: string): Promise<string> {
  const cleanRepo = saveConfiguredGithubRepo(rawRepoInput);
  if (!cleanRepo) return '';
  const configRecord: SoftwareReleaseRecord = {
    releaseId: 'GITHUB_REPO_CONFIG',
    portalScope: PORTAL_SCOPE,
    version: '0.0.0',
    title: cleanRepo.slice(0, 160),
    releaseNotes: 'GitHub Repository Configuration for Dual Master & User .EXE Releases',
    downloadUrl: getGithubUserExeDownloadUrl(cleanRepo).slice(0, 500),
    targetScope: 'ALL_PCS',
    targetIdentifierCsv: 'ALL',
    isMandatory: false,
    status: 'ARCHIVED',
    publishedAtIso: new Date().toISOString(),
    adminAuthSig: ADMIN_AUTH_SIG,
  };
  upsertMirrorItem(LOCAL_MIRROR_RELEASES_KEY, configRecord, (x) => x.releaseId);
  try {
    await withFirestoreTimeout(
      setDoc(doc(db, 'software_releases', 'GITHUB_REPO_CONFIG'), configRecord)
    );
  } catch {
    // Non-fatal if offline
  }
  return cleanRepo;
}

/**
 * Admin Action: Publishes a Software Update Release and notifies all or specific target PCs in real time.
 */
export async function publishSoftwareUpdateRelease(input: {
  version: string;
  title: string;
  releaseNotes: string;
  downloadUrl: string;
  targetScope: 'ALL_PCS' | 'SPECIFIC_PCS';
  targetIdentifierCsv: string;
  isMandatory: boolean;
}): Promise<SoftwareReleaseRecord> {
  const releaseId = `rel_${input.version.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  const rawUrl = input.downloadUrl.trim();
  const resolvedUrl =
    !rawUrl ||
    rawUrl === 'BUILTIN_WINDOWS_EXE' ||
    rawUrl === 'USER_SOFTWARE_EXE' ||
    rawUrl === 'GITHUB_USER_EXE'
      ? getGithubUserExeDownloadUrl()
      : rawUrl;

  const record: SoftwareReleaseRecord = {
    releaseId,
    portalScope: PORTAL_SCOPE,
    version: input.version.trim().slice(0, 40),
    title: input.title.trim().slice(0, 160),
    releaseNotes: input.releaseNotes.trim().slice(0, 2000),
    downloadUrl: resolvedUrl.slice(0, 500),
    targetScope: input.targetScope,
    targetIdentifierCsv: input.targetIdentifierCsv.trim().slice(0, 1500),
    isMandatory: input.isMandatory,
    status: 'PUBLISHED',
    publishedAtIso: new Date().toISOString(),
    adminAuthSig: ADMIN_AUTH_SIG,
  };

  upsertMirrorItem(LOCAL_MIRROR_RELEASES_KEY, record, (x) => x.releaseId);

  try {
    await withFirestoreTimeout(setDoc(doc(db, 'software_releases', releaseId), record));
    return record;
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) {
      return record;
    }
    handleFirestoreError(error, OperationType.CREATE, `software_releases/${releaseId}`);
  }
}

export async function deleteSoftwareReleaseAdmin(releaseId: string): Promise<void> {
  removeMirrorItem<SoftwareReleaseRecord>(
    LOCAL_MIRROR_RELEASES_KEY,
    releaseId,
    (x) => x.releaseId
  );
  try {
    await withFirestoreTimeout(deleteDoc(doc(db, 'software_releases', releaseId)));
  } catch (error) {
    if (isOfflineOrTimeoutError(error)) return;
    handleFirestoreError(error, OperationType.DELETE, `software_releases/${releaseId}`);
  }
}

/**
 * Client Action: Reports that this PC has downloaded and updated to the new software version.
 */
export async function acknowledgeClientUpdateInstalled(newVersion: string): Promise<void> {
  setInstalledSoftwareVersion(newVersion);
  const session = getLocalActivatedSession();
  if (!session) return;
  const cleanUserId = sanitizeIdentifier(session.userId);
  try {
    const snap = await withFirestoreTimeout(
      getDoc(doc(db, 'software_licenses', cleanUserId)),
      2000
    );
    if (!snap.exists()) return;
    const lic = snap.data() as SoftwareLicenseRecord;
    if (lic.status === 'ACTIVE' && lic.boundPcHardwareId === session.pcHardwareId) {
      await withFirestoreTimeout(
        updateDoc(doc(db, 'software_licenses', cleanUserId), {
          installedVersion: newVersion.trim().slice(0, 40),
          lastSeenAtIso: new Date().toISOString(),
        }),
        2000
      );
    }
  } catch {
    // Non-fatal if offline
  }
}

/**
 * Real-time listener for all Access Requests, Licenses, Releases, and Master PCs (for Master Admin Website).
 */
export function subscribeAdminLicensingData(callbacks: {
  onRequests: (list: AccessRequestRecord[]) => void;
  onLicenses: (list: SoftwareLicenseRecord[]) => void;
  onReleases: (list: SoftwareReleaseRecord[]) => void;
  onMasterPcs: (list: MasterPcRecord[]) => void;
}): () => void {
  const pushFromMirror = () => {
    callbacks.onRequests(
      readLocalMirror<AccessRequestRecord>(LOCAL_MIRROR_REQUESTS_KEY).sort((a, b) =>
        b.createdAtIso.localeCompare(a.createdAtIso)
      )
    );
    callbacks.onLicenses(
      readLocalMirror<SoftwareLicenseRecord>(LOCAL_MIRROR_LICENSES_KEY).sort((a, b) =>
        b.createdAtIso.localeCompare(a.createdAtIso)
      )
    );
    const allMirrorReleases = readLocalMirror<SoftwareReleaseRecord>(
      LOCAL_MIRROR_RELEASES_KEY
    );
    const ghCfg = allMirrorReleases.find((r) => r.releaseId === 'GITHUB_REPO_CONFIG');
    if (ghCfg && ghCfg.title && normalizeGithubRepoSlug(ghCfg.title)) {
      if (!getConfiguredGithubRepo()) {
        saveConfiguredGithubRepo(ghCfg.title);
      }
    }
    callbacks.onReleases(
      allMirrorReleases
        .filter((r) => r.releaseId !== 'GITHUB_REPO_CONFIG')
        .sort((a, b) => b.publishedAtIso.localeCompare(a.publishedAtIso))
    );
    callbacks.onMasterPcs(
      readLocalMirror<MasterPcRecord>(LOCAL_MIRROR_MASTER_PCS_KEY).sort((a, b) =>
        b.registeredAtIso.localeCompare(a.registeredAtIso)
      )
    );
  };

  // Emit local mirror immediately so UI is responsive with 0ms delay
  pushFromMirror();

  const handleMirrorEvent = () => pushFromMirror();
  window.addEventListener('eswa-licensing-mirror-updated', handleMirrorEvent);
  window.addEventListener('storage', handleMirrorEvent);

  const qReq = query(
    collection(db, 'access_requests'),
    where('portalScope', '==', PORTAL_SCOPE)
  );
  const qLic = query(
    collection(db, 'software_licenses'),
    where('portalScope', '==', PORTAL_SCOPE)
  );
  const qRel = query(
    collection(db, 'software_releases'),
    where('portalScope', '==', PORTAL_SCOPE)
  );
  const qMpc = query(
    collection(db, 'master_pcs'),
    where('portalScope', '==', PORTAL_SCOPE)
  );

  const unsubReq = onSnapshot(
    qReq,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AccessRequestRecord);
      if (items.length > 0 || !snap.metadata.fromCache) {
        items.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
        writeLocalMirror(LOCAL_MIRROR_REQUESTS_KEY, items);
        callbacks.onRequests(items);
      }
    },
    (err) => {
      if (!isOfflineOrTimeoutError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'access_requests');
      }
    }
  );

  const unsubLic = onSnapshot(
    qLic,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as SoftwareLicenseRecord);
      if (items.length > 0 || !snap.metadata.fromCache) {
        items.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
        writeLocalMirror(LOCAL_MIRROR_LICENSES_KEY, items);
        callbacks.onLicenses(items);
      }
    },
    (err) => {
      if (!isOfflineOrTimeoutError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'software_licenses');
      }
    }
  );

  const unsubRel = onSnapshot(
    qRel,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as SoftwareReleaseRecord);
      if (items.length > 0 || !snap.metadata.fromCache) {
        const ghCfg = items.find((r) => r.releaseId === 'GITHUB_REPO_CONFIG');
        if (ghCfg && ghCfg.title && normalizeGithubRepoSlug(ghCfg.title)) {
          saveConfiguredGithubRepo(ghCfg.title);
        }
        items.sort((a, b) => b.publishedAtIso.localeCompare(a.publishedAtIso));
        writeLocalMirror(LOCAL_MIRROR_RELEASES_KEY, items);
        callbacks.onReleases(items.filter((r) => r.releaseId !== 'GITHUB_REPO_CONFIG'));
      }
    },
    (err) => {
      if (!isOfflineOrTimeoutError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'software_releases');
      }
    }
  );

  const unsubMpc = onSnapshot(
    qMpc,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as MasterPcRecord);
      if (items.length > 0 || !snap.metadata.fromCache) {
        items.sort((a, b) => b.registeredAtIso.localeCompare(a.registeredAtIso));
        writeLocalMirror(LOCAL_MIRROR_MASTER_PCS_KEY, items);
        callbacks.onMasterPcs(items);
      }
    },
    (err) => {
      if (!isOfflineOrTimeoutError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'master_pcs');
      }
    }
  );

  return () => {
    window.removeEventListener('eswa-licensing-mirror-updated', handleMirrorEvent);
    window.removeEventListener('storage', handleMirrorEvent);
    unsubReq();
    unsubLic();
    unsubRel();
    unsubMpc();
  };
}

/**
 * Real-time listener on the Software Side for targeted Software Updates.
 */
export function subscribeClientSoftwareUpdates(
  onTargetedRelease: (release: SoftwareReleaseRecord | null) => void
): () => void {
  const evaluateReleases = (allReleases: SoftwareReleaseRecord[]) => {
    const ghCfg = allReleases.find((r) => r.releaseId === 'GITHUB_REPO_CONFIG');
    if (ghCfg && ghCfg.title && normalizeGithubRepoSlug(ghCfg.title)) {
      saveConfiguredGithubRepo(ghCfg.title);
    }

    const { pcHardwareId } = getOrGeneratePcHardwareId();
    const session = getLocalActivatedSession();
    const currentVer = getInstalledSoftwareVersion();

    const published = allReleases
      .filter((r) => r.status === 'PUBLISHED' && r.releaseId !== 'GITHUB_REPO_CONFIG')
      .sort((a, b) => b.publishedAtIso.localeCompare(a.publishedAtIso));

    const matching = published.find((rel) => {
      if (rel.version === currentVer) return false;
      if (rel.targetScope === 'ALL_PCS') return true;
      const targets = rel.targetIdentifierCsv
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const matchPc = targets.includes(pcHardwareId.toLowerCase());
      const matchUser = session?.userId
        ? targets.includes(session.userId.toLowerCase())
        : false;
      return matchPc || matchUser;
    });

    onTargetedRelease(matching || null);
  };

  evaluateReleases(readLocalMirror<SoftwareReleaseRecord>(LOCAL_MIRROR_RELEASES_KEY));

  const handleLocalChange = () => {
    evaluateReleases(readLocalMirror<SoftwareReleaseRecord>(LOCAL_MIRROR_RELEASES_KEY));
  };
  window.addEventListener('eswa-licensing-mirror-updated', handleLocalChange);
  window.addEventListener('storage', handleLocalChange);

  const qRel = query(
    collection(db, 'software_releases'),
    where('portalScope', '==', PORTAL_SCOPE)
  );

  const unsub = onSnapshot(
    qRel,
    (snap) => {
      const docs = snap.docs.map((d) => d.data() as SoftwareReleaseRecord);
      if (docs.length > 0 || !snap.metadata.fromCache) {
        writeLocalMirror(LOCAL_MIRROR_RELEASES_KEY, docs);
        evaluateReleases(docs);
      }
    },
    () => {
      // Ignore offline snapshot errors on client update watcher
    }
  );

  return () => {
    window.removeEventListener('eswa-licensing-mirror-updated', handleLocalChange);
    window.removeEventListener('storage', handleLocalChange);
    unsub();
  };
}
