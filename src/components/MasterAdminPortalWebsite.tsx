import React, { useEffect, useMemo, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import {
  AccessRequestRecord,
  approveRequestAndCreateLicense,
  createDirectSoftwareLicense,
  CURRENT_SOFTWARE_VERSION,
  deleteSoftwareLicenseAdmin,
  deleteSoftwareReleaseAdmin,
  generateOnePcLicenseKey,
  getLocalMasterPcBypass,
  getOrGeneratePcHardwareId,
  getStoredAdminCredentials,
  MASTER_ADMIN_DEFAULT_EMAIL,
  MasterPcRecord,
  publishSoftwareUpdateRelease,
  rejectAccessRequestAdmin,
  removeMasterPcAuthorization,
  sanitizeIdentifier,
  setMasterPcAuthorization,
  SoftwareLicenseRecord,
  SoftwareReleaseRecord,
  subscribeAdminLicensingData,
  syncGithubRepoConfigToCloud,
  updateSoftwareLicenseAdmin,
  updateStoredAdminCredentials,
} from '../engine/softwareLicensingEngine';
import {
  downloadMasterEditionDesktopExe,
  downloadUserEditionDesktopExe,
  getConfiguredGithubRepo,
  getGithubMasterExeDownloadUrl,
  getGithubUserExeDownloadUrl,
  getUserEditionShareUrl,
} from '../engine/windowsDesktopEngine';
import {
  Bell,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  UserCheck,
  Users,
} from 'lucide-react';

interface MasterAdminPortalWebsiteProps {
  onSwitchToSoftware: () => void;
  onPreviewUserSoftware?: () => void;
  onMasterPcStatusChanged: (isMaster: boolean) => void;
}

const ADMIN_SESSION_STORAGE_KEY = 'eswa_master_admin_web_logged_in_v1';

export const MasterAdminPortalWebsite: React.FC<MasterAdminPortalWebsiteProps> = ({
  onSwitchToSoftware,
  onPreviewUserSoftware,
  onMasterPcStatusChanged,
}) => {
  const currentPc = useMemo(() => getOrGeneratePcHardwareId(), []);

  // Admin Login State (Email ID + Password, plus optional Google Auth for dhoniakash407@gmail.com)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Admin Portal Navigation
  const [activeTab, setActiveTab] = useState<
    'requests' | 'licenses' | 'updates' | 'master_pc'
  >('requests');

  // Real-time Firestore state
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [licenses, setLicenses] = useState<SoftwareLicenseRecord[]>([]);
  const [releases, setReleases] = useState<SoftwareReleaseRecord[]>([]);
  const [masterPcs, setMasterPcs] = useState<MasterPcRecord[]>([]);
  const [isThisPcMaster, setIsThisPcMaster] = useState<boolean>(() =>
    getLocalMasterPcBypass()
  );

  // Approval Form State per request
  const [approvingReqId, setApprovingReqId] = useState<string | null>(null);
  const [draftUserId, setDraftUserId] = useState<string>('');
  const [draftPassword, setDraftPassword] = useState<string>('');
  const [draftLicenseKey, setDraftLicenseKey] = useState<string>('');
  const [lockImmediatelyToApplicantPc, setLockImmediatelyToApplicantPc] =
    useState<boolean>(true);
  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);

  // Direct Create License Form
  const [newLicUserId, setNewLicUserId] = useState<string>('');
  const [newLicPassword, setNewLicPassword] = useState<string>('');
  const [newLicKey, setNewLicKey] = useState<string>('');
  const [newLicFullName, setNewLicFullName] = useState<string>('');
  const [newLicOrg, setNewLicOrg] = useState<string>('');
  const [newLicEmail, setNewLicEmail] = useState<string>('');
  const [newLicPhone, setNewLicPhone] = useState<string>('');
  const [newLicPcId, setNewLicPcId] = useState<string>('');

  // GitHub Repository Configuration for Dual Master & User .EXE Releases
  const [githubRepoSlug, setGithubRepoSlug] = useState<string>(() =>
    getConfiguredGithubRepo()
  );
  const [githubRepoInput, setGithubRepoInput] = useState<string>(() =>
    getConfiguredGithubRepo()
  );

  // Publish Software Update Form
  const [relVersion, setRelVersion] = useState<string>('1.1.0');
  const [relTitle, setRelTitle] = useState<string>(
    'AKASH TUNNEL MAPPER v1.1.0 — Official GitHub Update'
  );
  const [relNotes, setRelNotes] = useState<string>(
    '1. Latest software update pushed from Google AI Studio & GitHub.\n2. Download the updated Normal User Software (.EXE) using the link below.\n3. Automatic 1-PC license preservation (no need to re-enter credentials).'
  );
  const [relDownloadUrl, setRelDownloadUrl] = useState<string>(() =>
    getGithubUserExeDownloadUrl()
  );
  const [relTargetScope, setRelTargetScope] = useState<'ALL_PCS' | 'SPECIFIC_PCS'>(
    'ALL_PCS'
  );
  const [selectedTargetUsers, setSelectedTargetUsers] = useState<string[]>([]);
  const [customTargetPcInput, setCustomTargetPcInput] = useState<string>('');
  const [relIsMandatory, setRelIsMandatory] = useState<boolean>(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Admin Password Customization
  const [newAdminPassInput, setNewAdminPassInput] = useState<string>('');

  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = subscribeAdminLicensingData({
      onRequests: setRequests,
      onLicenses: setLicenses,
      onReleases: setReleases,
      onMasterPcs: (list) => {
        setMasterPcs(list);
        const match = list.find(
          (m) =>
            sanitizeIdentifier(m.pcHardwareId) ===
            sanitizeIdentifier(currentPc.pcHardwareId)
        );
        if (match) {
          setIsThisPcMaster(match.bypassLogin);
          onMasterPcStatusChanged(match.bypassLogin);
        }
      },
    });
    return () => unsub();
  }, [isAdminAuthenticated, currentPc.pcHardwareId, onMasterPcStatusChanged]);

  useEffect(() => {
    const syncRepoState = () => {
      const configured = getConfiguredGithubRepo();
      setGithubRepoSlug(configured);
      setGithubRepoInput((prev) => prev || configured);
      setRelDownloadUrl(getGithubUserExeDownloadUrl(configured));
    };
    window.addEventListener('eswa-github-repo-updated', syncRepoState);
    return () => window.removeEventListener('eswa-github-repo-updated', syncRepoState);
  }, []);

  const handleSaveGithubRepo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const saved = await syncGithubRepoConfigToCloud(githubRepoInput);
    setGithubRepoSlug(saved);
    setGithubRepoInput(saved);
    const userExeLink = getGithubUserExeDownloadUrl(saved);
    setRelDownloadUrl(userExeLink);
    showToast(
      saved
        ? `Saved GitHub Repository (${saved})! User Software .EXE Link is now: ${userExeLink}`
        : 'Cleared custom GitHub Repository slug.'
    );
  };

  const bumpPatchVersion = (ver: string): string => {
    const parts = ver
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10));
    if (parts.length >= 3 && !Number.isNaN(parts[2])) {
      return `${parts[0] || 1}.${parts[1] || 0}.${parts[2] + 1}`;
    }
    if (parts.length === 2 && !Number.isNaN(parts[1])) {
      return `${parts[0] || 1}.${parts[1] + 1}.0`;
    }
    return '1.1.0';
  };

  const handleOneClickPushGithubUpdateToUsers = async () => {
    const latestPublished = releases[0]?.version || CURRENT_SOFTWARE_VERSION;
    const nextVer =
      releases.some((r) => r.version === relVersion.trim())
        ? bumpPatchVersion(latestPublished)
        : relVersion.trim() || bumpPatchVersion(latestPublished);
    const userGithubExeUrl = getGithubUserExeDownloadUrl(githubRepoSlug);

    const rel = await publishSoftwareUpdateRelease({
      version: nextVer,
      title: `AKASH TUNNEL MAPPER v${nextVer} — Official GitHub Update`,
      releaseNotes:
        relNotes.trim() ||
        `New software update v${nextVer} pushed via GitHub Releases. Click Download to get the latest AKASH-TUNNEL-MAPPER-User-Setup.exe.`,
      downloadUrl: userGithubExeUrl,
      targetScope: 'ALL_PCS',
      targetIdentifierCsv: 'ALL',
      isMandatory: true,
    });

    const nextFormVer = bumpPatchVersion(nextVer);
    setRelVersion(nextFormVer);
    setRelTitle(`AKASH TUNNEL MAPPER v${nextFormVer} — Official GitHub Update`);
    setRelDownloadUrl(userGithubExeUrl);
    navigator.clipboard?.writeText(userGithubExeUrl).catch(() => {});
    showToast(
      `Pushed Update v${rel.version} to ALL Users! Users now get notification with GitHub User .EXE link (also copied to your clipboard).`
    );
  };

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'PENDING'),
    [requests]
  );

  const showToast = (msg: string) => {
    setStatusToast(msg);
    window.setTimeout(() => setStatusToast(null), 4000);
  };

  const handleAdminEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const stored = getStoredAdminCredentials();
    const enteredEmail = loginEmail.trim().toLowerCase();
    const enteredPass = loginPassword.trim();

    if (
      enteredEmail === stored.email.toLowerCase() &&
      enteredPass === stored.password
    ) {
      setIsAdminAuthenticated(true);
      try {
        sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true');
      } catch {
        // Ignore
      }
      return;
    }
    setLoginError(
      `Access Denied: Only the Master Admin (${stored.email}) with the valid Master Password can sign in to this website.`
    );
  };

  const handleGoogleAdminLogin = async () => {
    setLoginError(null);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      const email = (res.user.email || '').toLowerCase();
      if (email === MASTER_ADMIN_DEFAULT_EMAIL.toLowerCase()) {
        setIsAdminAuthenticated(true);
        try {
          sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true');
        } catch {
          // Ignore
        }
      } else {
        await signOut(auth);
        setLoginError(
          `Access Denied: ${email} is not the Master Owner (${MASTER_ADMIN_DEFAULT_EMAIL}).`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed';
      setLoginError(msg);
    }
  };

  const handleAdminLogout = async () => {
    setIsAdminAuthenticated(false);
    try {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      await signOut(auth);
    } catch {
      // Ignore
    }
  };

  const startApprovingRequest = (req: AccessRequestRecord) => {
    const baseName = req.fullName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const suggestedUser = `${baseName || 'geologist'}_${req.pcHardwareId
      .slice(-4)
      .toLowerCase()}`;
    const suggestedPass = `Eswa@${Math.floor(1000 + Math.random() * 9000)}`;
    const suggestedKey = generateOnePcLicenseKey(suggestedUser, req.pcHardwareId);

    setApprovingReqId(req.requestId);
    setDraftUserId(suggestedUser);
    setDraftPassword(suggestedPass);
    setDraftLicenseKey(suggestedKey);
    setLockImmediatelyToApplicantPc(true);
  };

  const handleConfirmApproveRequest = async (req: AccessRequestRecord) => {
    if (!draftUserId.trim() || !draftPassword.trim() || !draftLicenseKey.trim()) return;
    const lic = await approveRequestAndCreateLicense({
      request: req,
      userId: draftUserId,
      password: draftPassword,
      licenseKey: draftLicenseKey,
      lockToRequestedPcImmediately: lockImmediatelyToApplicantPc,
    });
    setApprovingReqId(null);
    const summaryText = `ESWA TUNNEL MAPPER — 1-PC LICENSE CREDENTIALS\nUser Name: ${lic.fullName}\nUser ID: ${lic.userId}\nPassword: ${lic.password}\n1-PC License Key: ${lic.licenseKey}\nLocked PC ID: ${lic.boundPcHardwareId || 'Locks on First Login'}`;
    navigator.clipboard?.writeText(summaryText).catch(() => {});
    setCopiedBanner(summaryText);
    showToast(
      `Approved ${req.fullName} & created 1-PC credentials (${lic.userId}). Copied to clipboard!`
    );
  };

  const handleCreateDirectLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLicUserId.trim() || !newLicPassword.trim()) return;
    const finalKey =
      newLicKey.trim() || generateOnePcLicenseKey(newLicUserId, newLicPcId);
    const lic = await createDirectSoftwareLicense({
      userId: newLicUserId,
      password: newLicPassword,
      licenseKey: finalKey,
      fullName: newLicFullName || newLicUserId,
      email: newLicEmail,
      phone: newLicPhone,
      organization: newLicOrg,
      boundPcHardwareId: newLicPcId,
    });
    setNewLicUserId('');
    setNewLicPassword('');
    setNewLicKey('');
    setNewLicFullName('');
    setNewLicOrg('');
    setNewLicEmail('');
    setNewLicPhone('');
    setNewLicPcId('');
    showToast(`Created 1-PC License for ${lic.userId} (${lic.licenseKey}).`);
  };

  const handleToggleThisPcMaster = async (enable: boolean) => {
    await setMasterPcAuthorization(
      currentPc.pcHardwareId,
      `Master Owner Workstation (${currentPc.pcName})`,
      enable
    );
    setIsThisPcMaster(enable);
    onMasterPcStatusChanged(enable);
    showToast(
      enable
        ? `This PC (${currentPc.pcHardwareId}) is now set as MASTER PC — No login required when opening the software!`
        : `Removed Master PC bypass from this PC.`
    );
  };

  const handlePublishUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relVersion.trim() || !relTitle.trim()) return;
    const combinedTargets = [
      ...selectedTargetUsers,
      ...customTargetPcInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ].join(', ');

    const rel = await publishSoftwareUpdateRelease({
      version: relVersion,
      title: relTitle,
      releaseNotes: relNotes,
      downloadUrl: relDownloadUrl,
      targetScope: relTargetScope,
      targetIdentifierCsv: relTargetScope === 'ALL_PCS' ? 'ALL' : combinedTargets,
      isMandatory: relIsMandatory,
    });
    showToast(
      `Published Update v${rel.version}! Notification pushed to ${
        rel.targetScope === 'ALL_PCS' ? 'All Licensed PCs' : combinedTargets || 'Selected PCs'
      }.`
    );
  };

  // ============================================================================
  // VIEW 1: MASTER ADMIN LOGIN GATE (ONLY MASTER OWNER CAN SIGN IN)
  // ============================================================================
  if (!isAdminAuthenticated) {
    const storedCreds = getStoredAdminCredentials();
    return (
      <div className="min-h-dvh w-full bg-slate-950 text-slate-100 flex flex-col justify-between p-6 overflow-y-auto">
        {/* Top Website Bar */}
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-600 flex items-center justify-center text-white font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                ESWA Control Center — Master Admin Website
              </h1>
              <p className="text-xs text-slate-400">
                1-PC Software Licensing, Access Approval &amp; Live Update Distribution Portal
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSwitchToSoftware}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
          >
            Back to Tunnel Software
          </button>
        </header>

        {/* Center Login Card */}
        <main className="max-w-md w-full mx-auto my-auto py-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1">
              <div className="text-xs font-mono text-cyan-400">
                RESTRICTED MASTER OWNER PORTAL
              </div>
              <h2 className="text-xl font-bold text-white">Master Admin Sign In</h2>
              <p className="text-xs text-slate-400">
                Sign in with your Master Email ID and Password to approve software downloads, issue 1-PC keys, configure Master PC bypass, and push software updates.
              </p>
            </div>

            {loginError && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700/70 text-xs text-rose-200">
                {loginError}
              </div>
            )}

            <form onSubmit={handleAdminEmailLogin} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Master Admin Email ID
                </span>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={storedCreds.email}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Master Admin Password
                </span>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter Master Password"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Login to Master Admin Website
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800" />
              <span className="shrink mx-3 text-[11px] text-slate-500">OR</span>
              <div className="flex-grow border-t border-slate-800" />
            </div>

            <button
              type="button"
              onClick={handleGoogleAdminLogin}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold text-xs transition-colors cursor-pointer"
            >
              Verify with Google Owner Account ({MASTER_ADMIN_DEFAULT_EMAIL})
            </button>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/90 text-[11px] font-mono text-slate-400 space-y-1">
              <div className="text-slate-300 font-semibold">
                Default Owner Credentials (changeable inside portal):
              </div>
              <div>Email: {storedCreds.email}</div>
              <div>Password: {storedCreds.password}</div>
            </div>
          </div>
        </main>

        <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 border-t border-slate-900 pt-4">
          ESWA License &amp; Update Management Website · This PC Hardware ID:{' '}
          <span className="font-mono text-slate-400">{currentPc.pcHardwareId}</span>
        </footer>
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: AUTHENTICATED MASTER ADMIN CONTROL WEBSITE
  // ============================================================================
  return (
    <div className="h-dvh w-full bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Top Website Header */}
      <header className="px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-600 flex items-center justify-center text-white">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white">
                ESWA Master Licensing &amp; Update Website
              </h1>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs font-mono text-emerald-400">
                Owner: {MASTER_ADMIN_DEFAULT_EMAIL}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Manage download access requests, 1-PC hardware-locked login credentials, Master PC bypass, and live software updates
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              downloadUserEditionDesktopExe();
              showToast(
                'Downloaded ESWA_Tunnel_Mapper_User_Software.exe! Share this file with your users.'
              );
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
            title="Download Normal User Software (.EXE) to share with users"
          >
            <Download className="w-4 h-4" />
            <span>Download Normal User Software (.EXE)</span>
          </button>

          {onPreviewUserSoftware && (
            <button
              type="button"
              onClick={onPreviewUserSoftware}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
              title="Preview the Normal User Software (Login & Request Access only)"
            >
              <Eye className="w-4 h-4" />
              <span>Preview User Software</span>
            </button>
          )}

          <button
            type="button"
            onClick={onSwitchToSoftware}
            className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Back to My Master Software
          </button>

          <button
            type="button"
            onClick={handleAdminLogout}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-200 border border-slate-700 text-xs font-medium cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Live Notification Banner when Pending Access Requests Exist */}
      {pendingRequests.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-950/80 border-b border-amber-700/60 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-amber-200 font-medium">
            <Bell className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>{pendingRequests.length} New Software Access Request(s)</strong> waiting for your approval! Review their submitted details below and generate their 1-PC User ID, Password &amp; Key.
            </span>
          </div>
          {activeTab !== 'requests' && (
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              Review Requests ({pendingRequests.length})
            </button>
          )}
        </div>
      )}

      {statusToast && (
        <div className="px-6 py-2 bg-emerald-950/90 border-b border-emerald-700 text-xs text-emerald-200 font-mono shrink-0">
          {statusToast}
        </div>
      )}

      {/* Navigation Bar */}
      <div className="px-6 pt-3 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2 overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'requests'
              ? 'border-cyan-500 text-cyan-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>
            01. Access Requests ({pendingRequests.length} Pending / {requests.length} Total)
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('licenses')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'licenses'
              ? 'border-cyan-500 text-cyan-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>02. 1-PC User Licenses &amp; Hardware Locks ({licenses.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('master_pc')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'master_pc'
              ? 'border-cyan-500 text-cyan-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Laptop className="w-4 h-4" />
          <span>03. My Master PC Option (No Login Gate)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('updates')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'updates'
              ? 'border-cyan-500 text-cyan-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>04. Push Software Updates ({releases.length})</span>
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Dual GitHub Executables (.EXE) & 1-Click Auto Update Broadcast Box */}
          <div className="p-5 rounded-xl bg-slate-900 border border-emerald-600/50 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1 max-w-2xl">
                <div className="text-xs font-mono text-emerald-400 font-bold">
                  GITHUB DUAL EXECUTABLE PIPELINE (1. MASTER SOFTWARE .EXE · 2. USER SOFTWARE .EXE)
                </div>
                <h3 className="text-sm font-bold text-white">
                  Every Push to GitHub Builds Two Windows Executables &amp; Gives Users the User Software Link
                </h3>
                <p className="text-xs text-slate-400">
                  Every time you update in Google AI Studio and push to GitHub, GitHub Actions automatically compiles two standalone executables: <strong>AKASH-TUNNEL-MAPPER-Master-Setup.exe</strong> (for you only) and <strong>AKASH-TUNNEL-MAPPER-User-Setup.exe</strong> (for your users). Click <strong>Push Update to All Users Now</strong> below whenever you push a new update so all users immediately get the notification and GitHub User Software download link.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleOneClickPushGithubUpdateToUsers}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer shadow-lg"
                  title="Broadcasts a new update notification to all users with the GitHub User Software .EXE link"
                >
                  <Send className="w-4 h-4" />
                  <span>Push Update &amp; Send Link to All Users Now</span>
                </button>
              </div>
            </div>

            {/* GitHub Repository Slug Configuration Row */}
            <form
              onSubmit={handleSaveGithubRepo}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-200">
                  Your GitHub Repository (for Automatic User Software .EXE Release Link):
                </div>
                <div className="text-[11px] text-slate-400">
                  Enter your GitHub repository (<span className="font-mono text-cyan-300">username/repository</span> or full GitHub URL) so users automatically get your GitHub Release <span className="font-mono text-emerald-400">AKASH-TUNNEL-MAPPER-User-Setup.exe</span> link.
                </div>
              </div>

              <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
                <input
                  type="text"
                  value={githubRepoInput}
                  onChange={(e) => setGithubRepoInput(e.target.value)}
                  placeholder="e.g. dhoniakash/akash-tunnel-mapper"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Save GitHub Link
                </button>
              </div>
            </form>

            {/* Two Executables Side-by-Side: 1. User Software (.EXE) & 2. Master Software (.EXE) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* EXECUTABLE 1: NORMAL USER SOFTWARE (.EXE) */}
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-700/50 space-y-3 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="text-[11px] font-mono text-emerald-400 font-bold">
                    EXECUTABLE #1 · FOR NORMAL USERS (SHARE &amp; AUTO-UPDATE LINK)
                  </div>
                  <div className="text-sm font-bold text-white font-mono">
                    AKASH-TUNNEL-MAPPER-User-Setup.exe
                  </div>
                  <p className="text-xs text-slate-400">
                    Only includes 1-PC One-Time Login and Request Access. Users receive this link automatically on every update.
                  </p>
                  <div className="pt-1 text-[11px] font-mono text-emerald-300 break-all">
                    User Link: {getGithubUserExeDownloadUrl(githubRepoSlug)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      downloadUserEditionDesktopExe();
                      showToast(
                        'Downloading AKASH-TUNNEL-MAPPER-User-Setup.exe — Share this with your users!'
                      );
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download User .EXE</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const url = getGithubUserExeDownloadUrl(githubRepoSlug);
                      navigator.clipboard?.writeText(url).catch(() => {});
                      showToast(`Copied User Software Link: ${url}`);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy User Software Link</span>
                  </button>
                </div>
              </div>

              {/* EXECUTABLE 2: MASTER SOFTWARE (.EXE) */}
              <div className="p-4 rounded-xl bg-slate-950 border border-cyan-700/50 space-y-3 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="text-[11px] font-mono text-cyan-400 font-bold">
                    EXECUTABLE #2 · MASTER SOFTWARE (ONLY FOR YOU / OWNER)
                  </div>
                  <div className="text-sm font-bold text-white font-mono">
                    AKASH-TUNNEL-MAPPER-Master-Setup.exe
                  </div>
                  <p className="text-xs text-slate-400">
                    Opens directly without login and shows the Master Admin Website button on first opening. Keep this executable for your PC only.
                  </p>
                  <div className="pt-1 text-[11px] font-mono text-cyan-300 break-all">
                    Master Link: {getGithubMasterExeDownloadUrl(githubRepoSlug)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      downloadMasterEditionDesktopExe();
                      showToast(
                        'Downloading AKASH-TUNNEL-MAPPER-Master-Setup.exe (Master Owner Edition)!'
                      );
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Master .EXE</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const url = getGithubMasterExeDownloadUrl(githubRepoSlug);
                      navigator.clipboard?.writeText(url).catch(() => {});
                      showToast(`Copied Master Software Link: ${url}`);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Master Link</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Copied Credentials Banner */}
          {copiedBanner && (
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-600/60 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-bold text-emerald-300">
                  Issued 1-PC Login Credentials (Ready to Send to User)
                </div>
                <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap">
                  {copiedBanner}
                </pre>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(copiedBanner).catch(() => {});
                    showToast('Copied credentials to clipboard!');
                  }}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Again
                </button>
                <button
                  type="button"
                  onClick={() => setCopiedBanner(null)}
                  className="px-2.5 py-1.5 rounded bg-slate-800 text-slate-300 text-xs cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* ====================================================================
              TAB 1: ACCESS REQUESTS SUBMITTED AFTER DOWNLOAD
              ==================================================================== */}
          {activeTab === 'requests' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Submitted Software Access Requests
                  </h2>
                  <p className="text-xs text-slate-400">
                    When someone downloads the software and submits their details, you get notified here. Approve to generate their 1-PC User ID, Password, and Hardware-Locked Key.
                  </p>
                </div>
              </div>

              {requests.length === 0 ? (
                <div className="p-10 rounded-xl bg-slate-900/80 border border-slate-800 text-center space-y-2">
                  <div className="text-sm font-semibold text-slate-300">
                    No Access Requests Submitted Yet
                  </div>
                  <div className="text-xs text-slate-500 max-w-md mx-auto">
                    When a user downloads the software and submits the registration form on their PC, their request and PC Hardware ID will appear here immediately.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((req) => {
                    const isApproving = approvingReqId === req.requestId;
                    return (
                      <div
                        key={req.requestId}
                        className={`p-5 rounded-xl border transition-colors ${
                          req.status === 'PENDING'
                            ? 'bg-slate-900 border-amber-500/50'
                            : req.status === 'APPROVED'
                            ? 'bg-slate-900/60 border-emerald-700/50'
                            : 'bg-slate-900/40 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-sm font-bold text-white">
                              <span>{req.fullName}</span>
                              <span className="text-slate-500">·</span>
                              <span className="text-cyan-400">{req.organization}</span>
                              <span className="text-slate-500">·</span>
                              <span
                                className={`text-xs font-mono ${
                                  req.status === 'PENDING'
                                    ? 'text-amber-400'
                                    : req.status === 'APPROVED'
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {req.status}
                              </span>
                            </div>

                            <div className="text-xs font-mono text-slate-300">
                              Email: {req.email} · Phone/WhatsApp: {req.phone} · Role:{' '}
                              {req.roleTitle}
                            </div>

                            <div className="text-xs font-mono text-slate-400">
                              Applicant PC Hardware ID:{' '}
                              <span className="text-amber-300 font-semibold">
                                {req.pcHardwareId}
                              </span>{' '}
                              ({req.pcName}) · Submitted:{' '}
                              {new Date(req.createdAtIso).toLocaleString()}
                            </div>

                            {req.purposeNotes && (
                              <div className="text-xs text-slate-300 pt-1">
                                Notes: &ldquo;{req.purposeNotes}&rdquo;
                              </div>
                            )}

                            {req.status === 'APPROVED' && req.assignedUserId && (
                              <div className="pt-1 text-xs font-mono text-emerald-300">
                                Issued User ID: <strong>{req.assignedUserId}</strong> · 1-PC
                                Key: <strong>{req.assignedLicenseKey}</strong>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {req.status === 'PENDING' && !isApproving && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startApprovingRequest(req)}
                                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                                >
                                  <UserCheck className="w-4 h-4" />
                                  Create User ID, Password &amp; 1-PC Key
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectAccessRequestAdmin(req.requestId)}
                                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 text-xs font-medium cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Inline Approval & Credential Generator Drawer */}
                        {isApproving && (
                          <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                            <div className="text-xs font-semibold text-cyan-300">
                              Generate 1-PC Login Credentials for {req.fullName} (Locked to PC:{' '}
                              {req.pcHardwareId})
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <label className="space-y-1">
                                <span className="text-[11px] text-slate-400">
                                  Assign User ID
                                </span>
                                <input
                                  type="text"
                                  value={draftUserId}
                                  onChange={(e) => setDraftUserId(e.target.value)}
                                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-[11px] text-slate-400">
                                  Assign Password
                                </span>
                                <input
                                  type="text"
                                  value={draftPassword}
                                  onChange={(e) => setDraftPassword(e.target.value)}
                                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-[11px] text-slate-400">
                                  1-PC License Key
                                </span>
                                <input
                                  type="text"
                                  value={draftLicenseKey}
                                  onChange={(e) => setDraftLicenseKey(e.target.value)}
                                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-emerald-300"
                                />
                              </label>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={lockImmediatelyToApplicantPc}
                                  onChange={(e) =>
                                    setLockImmediatelyToApplicantPc(e.target.checked)
                                  }
                                  className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                                />
                                <span>
                                  Lock immediately to applicant&apos;s PC Hardware ID (
                                  <span className="font-mono text-amber-300">
                                    {req.pcHardwareId}
                                  </span>
                                  ) — usable ONLY on that single PC
                                </span>
                              </label>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmApproveRequest(req)}
                                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Approve &amp; Issue 1-PC Credentials
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setApprovingReqId(null)}
                                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              TAB 2: ACTIVE 1-PC LICENSES & HARDWARE LOCK MANAGER
              ==================================================================== */}
          {activeTab === 'licenses' && (
            <div className="space-y-6">
              {/* Direct Create License Card */}
              <form
                onSubmit={handleCreateDirectLicense}
                className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Plus className="w-4 h-4 text-cyan-400" />
                      Create New User ID, Password &amp; 1-PC License Key Directly
                    </h3>
                    <p className="text-xs text-slate-400">
                      Leave &ldquo;Bind PC Hardware ID&rdquo; blank to automatically lock to the first PC where the user logs in, or paste their PC ID to pre-lock it.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">User ID *</span>
                    <input
                      type="text"
                      required
                      value={newLicUserId}
                      onChange={(e) => {
                        setNewLicUserId(e.target.value);
                        if (!newLicKey) {
                          setNewLicKey(
                            generateOnePcLicenseKey(e.target.value, newLicPcId)
                          );
                        }
                      }}
                      placeholder="e.g. site_eng_01"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Password *</span>
                    <input
                      type="text"
                      required
                      value={newLicPassword}
                      onChange={(e) => setNewLicPassword(e.target.value)}
                      placeholder="e.g. Tunnel@2026"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">1-PC License Key</span>
                    <input
                      type="text"
                      value={newLicKey}
                      onChange={(e) => setNewLicKey(e.target.value)}
                      placeholder="Auto-generated if blank"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-emerald-300"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">
                      Full Name / Engineer
                    </span>
                    <input
                      type="text"
                      value={newLicFullName}
                      onChange={(e) => setNewLicFullName(e.target.value)}
                      placeholder="Engineer Name"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">
                      Organization / Project
                    </span>
                    <input
                      type="text"
                      value={newLicOrg}
                      onChange={(e) => setNewLicOrg(e.target.value)}
                      placeholder="Company Name"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Email</span>
                    <input
                      type="text"
                      value={newLicEmail}
                      onChange={(e) => setNewLicEmail(e.target.value)}
                      placeholder="user@company.com"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">
                      Bind PC Hardware ID (Optional)
                    </span>
                    <input
                      type="text"
                      value={newLicPcId}
                      onChange={(e) => setNewLicPcId(e.target.value)}
                      placeholder="Locks on 1st login if blank"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-2 px-4 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs cursor-pointer"
                    >
                      + Issue 1-PC License
                    </button>
                  </div>
                </div>
              </form>

              {/* Issued Licenses Table */}
              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Issued 1-PC Hardware-Locked Licenses ({licenses.length})
                  </h3>
                </div>

                {licenses.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    No licenses issued yet. Approve a request or create a license above.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2.5 px-3">User ID &amp; Name</th>
                          <th className="py-2.5 px-3">Password</th>
                          <th className="py-2.5 px-3">1-PC License Key</th>
                          <th className="py-2.5 px-3">Locked PC Hardware ID</th>
                          <th className="py-2.5 px-3">Version</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {licenses.map((lic) => (
                          <tr key={lic.userId} className="hover:bg-slate-950/60">
                            <td className="py-3 px-3">
                              <div className="font-bold text-white">{lic.userId}</div>
                              <div className="text-[11px] text-slate-400">
                                {lic.fullName} · {lic.organization}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-cyan-300">{lic.password}</td>
                            <td className="py-3 px-3 text-emerald-300 font-semibold">
                              {lic.licenseKey}
                            </td>
                            <td className="py-3 px-3">
                              {lic.boundPcHardwareId ? (
                                <div>
                                  <div className="text-amber-300 font-semibold flex items-center gap-1">
                                    <Lock className="w-3 h-3" />
                                    {lic.boundPcHardwareId}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    {lic.boundPcName}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-500">
                                  Awaiting 1st PC Login
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-slate-300">
                              v{lic.installedVersion || '1.0.0'}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={
                                  lic.status === 'ACTIVE'
                                    ? 'text-emerald-400 font-bold'
                                    : 'text-rose-400 font-bold'
                                }
                              >
                                {lic.status}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const text = `User ID: ${lic.userId}\nPassword: ${lic.password}\n1-PC Key: ${lic.licenseKey}`;
                                    navigator.clipboard?.writeText(text).catch(() => {});
                                    showToast(`Copied credentials for ${lic.userId}`);
                                  }}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] cursor-pointer"
                                  title="Copy Login Credentials"
                                >
                                  Copy
                                </button>
                                {lic.boundPcHardwareId && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updateSoftwareLicenseAdmin(lic.userId, {
                                        boundPcHardwareId: '',
                                        boundPcName: '',
                                      });
                                      showToast(
                                        `Reset 1-PC Hardware Lock for ${lic.userId}. Next login will lock to their new PC.`
                                      );
                                    }}
                                    className="px-2 py-1 rounded bg-amber-950/80 hover:bg-amber-900 text-amber-300 text-[11px] flex items-center gap-1 cursor-pointer"
                                    title="Unbind PC Hardware ID so user can log in on a replacement PC"
                                  >
                                    <Unlock className="w-3 h-3" />
                                    Reset PC
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSoftwareLicenseAdmin(lic.userId, {
                                      status:
                                        lic.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
                                >
                                  {lic.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteSoftwareLicenseAdmin(lic.userId)}
                                  className="p-1 rounded bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-white cursor-pointer"
                                  title="Delete License"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====================================================================
              TAB 3: MY MASTER PC OPTION (BYPASS LOGIN ON OWNER'S PC)
              ==================================================================== */}
          {activeTab === 'master_pc' && (
            <div className="space-y-6">
              <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-cyan-400">
                      MASTER WORKSTATION PRIVILEGE
                    </div>
                    <h2 className="text-lg font-bold text-white">
                      Master Option for Your PC (No Login Required)
                    </h2>
                    <p className="text-xs text-slate-400 max-w-2xl">
                      Enable the Master Option on your PC below so that whenever you open ESWA Tunnel Mapper on this computer, it automatically bypasses the login &amp; license screen and opens the full software directly.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleThisPcMaster(!isThisPcMaster)}
                    className={`px-5 py-3 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                      isThisPcMaster
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isThisPcMaster
                        ? 'Master Option Active on This PC (Click to Disable)'
                        : 'Enable Master Option on This PC (No Login Needed)'}
                    </span>
                  </button>
                </div>

                <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs space-y-1.5">
                  <div>
                    This PC Hardware ID:{' '}
                    <span className="text-cyan-300 font-bold">
                      {currentPc.pcHardwareId}
                    </span>
                  </div>
                  <div>Workstation Profile: {currentPc.pcName}</div>
                  <div>
                    Current Software Login Bypass Status:{' '}
                    <span
                      className={
                        isThisPcMaster
                          ? 'text-emerald-400 font-bold'
                          : 'text-amber-400 font-bold'
                      }
                    >
                      {isThisPcMaster
                        ? 'MASTER PC ENABLED — Opens Software Directly Without Login'
                        : 'Standard Client Mode (Requires 1-PC User ID & Key)'}
                    </span>
                  </div>
                </div>

                {/* Registered Master PCs List */}
                {masterPcs.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold text-slate-300">
                      Authorized Master PCs ({masterPcs.length})
                    </div>
                    <div className="space-y-2">
                      {masterPcs.map((mpc) => (
                        <div
                          key={mpc.pcHardwareId}
                          className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono"
                        >
                          <div>
                            <span className="font-bold text-emerald-300">
                              {mpc.pcHardwareId}
                            </span>{' '}
                            · <span className="text-slate-300">{mpc.label}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeMasterPcAuthorization(mpc.pcHardwareId)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white text-[11px] cursor-pointer"
                          >
                            Remove Master Status
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Admin Website Password Update */}
              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-white">
                  Update Master Admin Website Password
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="password"
                    value={newAdminPassInput}
                    onChange={(e) => setNewAdminPassInput(e.target.value)}
                    placeholder="Enter new Master Admin Password"
                    className="px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white w-72"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newAdminPassInput.trim().length < 4) return;
                      updateStoredAdminCredentials(
                        MASTER_ADMIN_DEFAULT_EMAIL,
                        newAdminPassInput
                      );
                      setNewAdminPassInput('');
                      showToast('Updated Master Admin Website password!');
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 cursor-pointer"
                  >
                    Save New Admin Password
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ====================================================================
              TAB 4: PUBLISH SOFTWARE UPDATE & NOTIFY TARGET PCS
              ==================================================================== */}
          {activeTab === 'updates' && (
            <div className="space-y-6">
              <form
                onSubmit={handlePublishUpdate}
                className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4"
              >
                <div className="border-b border-slate-800 pb-3">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Send className="w-4 h-4 text-cyan-400" />
                    Publish Software Update &amp; Notify Required PCs
                  </h2>
                  <p className="text-xs text-slate-400">
                    When you publish a new software update here, the selected PCs immediately receive an update notification inside the software with a 1-click download button.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">New Version Number *</span>
                    <input
                      type="text"
                      required
                      value={relVersion}
                      onChange={(e) => setRelVersion(e.target.value)}
                      placeholder="e.g. 1.1.0"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                    />
                  </label>

                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs text-slate-300">Update Headline *</span>
                    <input
                      type="text"
                      required
                      value={relTitle}
                      onChange={(e) => setRelTitle(e.target.value)}
                      placeholder="e.g. ESWA Tunnel Mapper v1.1.0 Update"
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">
                    What&apos;s New / Release Notes *
                  </span>
                  <textarea
                    rows={3}
                    required
                    value={relNotes}
                    onChange={(e) => setRelNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">
                      Target PCs to Notify
                    </span>
                    <select
                      value={relTargetScope}
                      onChange={(e) =>
                        setRelTargetScope(e.target.value as 'ALL_PCS' | 'SPECIFIC_PCS')
                      }
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    >
                      <option value="ALL_PCS">
                        Notify All Licensed PCs (Broadcast Update)
                      </option>
                      <option value="SPECIFIC_PCS">
                        Select Specific Required PCs / Users Only
                      </option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">
                      GitHub User Software Update Link Sent to Users *
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={relDownloadUrl}
                        onChange={(e) => setRelDownloadUrl(e.target.value)}
                        placeholder={getGithubUserExeDownloadUrl(githubRepoSlug)}
                        className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-cyan-300"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRelDownloadUrl(getGithubUserExeDownloadUrl(githubRepoSlug))
                        }
                        className="px-2.5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold shrink-0 cursor-pointer"
                        title="Use GitHub User Software .EXE Link"
                      >
                        GitHub User .EXE Link
                      </button>
                    </div>
                  </label>
                </div>

                {relTargetScope === 'SPECIFIC_PCS' && (
                  <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="text-xs font-semibold text-amber-300">
                      Choose Required PCs / Licensed Users to Receive This Update:
                    </div>
                    {licenses.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {licenses.map((lic) => {
                          const checked = selectedTargetUsers.includes(lic.userId);
                          return (
                            <label
                              key={lic.userId}
                              className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800 text-xs cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedTargetUsers((prev) => [
                                      ...prev,
                                      lic.userId,
                                    ]);
                                  } else {
                                    setSelectedTargetUsers((prev) =>
                                      prev.filter((u) => u !== lic.userId)
                                    );
                                  }
                                }}
                                className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                              />
                              <span className="truncate font-mono">
                                {lic.userId} ({lic.boundPcHardwareId || 'Unbound'})
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <input
                      type="text"
                      value={customTargetPcInput}
                      onChange={(e) => setCustomTargetPcInput(e.target.value)}
                      placeholder="Or enter additional User IDs / PC Hardware IDs separated by commas..."
                      className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs font-mono text-white"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={relIsMandatory}
                      onChange={(e) => setRelIsMandatory(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-rose-500"
                    />
                    <span>
                      Mark as Mandatory Update (opens full-screen update prompt on target PCs)
                    </span>
                  </label>

                  <button
                    type="submit"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    Publish Update &amp; Notify Target PCs
                  </button>
                </div>
              </form>

              {/* Published Update Releases History */}
              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-emerald-400" />
                  Published Software Releases ({releases.length})
                </h3>
                {releases.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No software updates published yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {releases.map((rel) => (
                      <div
                        key={rel.releaseId}
                        className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex items-start justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-bold text-white">
                            <span className="text-emerald-400 font-mono">
                              v{rel.version}
                            </span>
                            <span>·</span>
                            <span>{rel.title}</span>
                            {rel.isMandatory && (
                              <span className="text-rose-400 font-mono">
                                · MANDATORY
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 whitespace-pre-line">
                            {rel.releaseNotes}
                          </div>
                          <div className="text-[11px] font-mono text-emerald-400 break-all">
                            Update Link:{' '}
                            {rel.downloadUrl === 'BUILTIN_WINDOWS_EXE'
                              ? `${getUserEditionShareUrl()}&update=v${rel.version}`
                              : rel.downloadUrl}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            Target:{' '}
                            <span className="text-cyan-300">
                              {rel.targetScope === 'ALL_PCS'
                                ? 'All Licensed PCs'
                                : rel.targetIdentifierCsv}
                            </span>{' '}
                            · Published: {new Date(rel.publishedAtIso).toLocaleString()}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => deleteSoftwareReleaseAdmin(rel.releaseId)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-white cursor-pointer"
                          title="Remove Release Notification"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
