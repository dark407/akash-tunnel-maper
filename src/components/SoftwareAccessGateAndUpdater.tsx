import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessRequestRecord,
  acknowledgeClientUpdateInstalled,
  ActivatedClientSession,
  getAccessRequestById,
  getInstalledSoftwareVersion,
  getOrGeneratePcHardwareId,
  SoftwareReleaseRecord,
  submitSoftwareAccessRequest,
  subscribeAdminLicensingData,
  subscribeClientSoftwareUpdates,
  verifyAndActivateOnePcLogin,
} from '../engine/softwareLicensingEngine';
import {
  downloadUserEditionDesktopExe,
  getConfiguredGithubRepo,
  getGithubUserExeDownloadUrl,
  getUserEditionShareUrl,
} from '../engine/windowsDesktopEngine';
import { EswaTunnelLogo } from './EswaBrandIdentity';
import {
  Bell,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  KeyRound,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';

interface SoftwareAccessGateProps {
  onAuthorizedSession: (session: ActivatedClientSession) => void;
  isOwnerPreview?: boolean;
  onExitOwnerPreview?: () => void;
}

/**
 * Normal User Software Access Gate:
 * - Only Login (1-Time 1-PC Login) and Request Access (Submit Details) are available.
 * - Once the user logs in 1 time on their PC, it permanently unlocks that PC and never asks for login again.
 */
export const SoftwareAccessGate: React.FC<SoftwareAccessGateProps> = ({
  onAuthorizedSession,
  isOwnerPreview = false,
  onExitOwnerPreview,
}) => {
  const pcInfo = useMemo(() => getOrGeneratePcHardwareId(), []);
  const [gateMode, setGateMode] = useState<'login' | 'request_access'>('login');

  // Login Form State
  const [userId, setUserId] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [licenseKey, setLicenseKey] = useState<string>('');
  const [loginBusy, setLoginBusy] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Request Access Form State (After Download)
  const [fullName, setFullName] = useState<string>('');
  const [organization, setOrganization] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [roleTitle, setRoleTitle] = useState<string>('Tunnel Geologist / Engineer');
  const [purposeNotes, setPurposeNotes] = useState<string>('');
  const [submittingReq, setSubmittingReq] = useState<boolean>(false);
  const [submittedRequest, setSubmittedRequest] = useState<AccessRequestRecord | null>(
    null
  );
  const [checkingStatus, setCheckingStatus] = useState<boolean>(false);

  // Restore last submitted request ID if user previously submitted from this PC
  useEffect(() => {
    try {
      const lastReqId = localStorage.getItem('eswa_last_submitted_request_id');
      if (lastReqId) {
        getAccessRequestById(lastReqId)
          .then((rec) => {
            if (rec) setSubmittedRequest(rec);
          })
          .catch(() => {});
      }
    } catch {
      // Ignore
    }
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await verifyAndActivateOnePcLogin({
        userId,
        password,
        licenseKey,
      });
      if (!res.ok || !res.session) {
        setLoginError(res.message);
      } else {
        onAuthorizedSession(res.session);
      }
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Login verification failed.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !phone.trim() || !organization.trim()) {
      return;
    }
    setSubmittingReq(true);
    try {
      const rec = await submitSoftwareAccessRequest({
        fullName,
        email,
        phone,
        organization,
        roleTitle,
        purposeNotes,
      });
      setSubmittedRequest(rec);
    } finally {
      setSubmittingReq(false);
    }
  };

  const handleRefreshRequestStatus = async () => {
    if (!submittedRequest) return;
    setCheckingStatus(true);
    try {
      const fresh = await getAccessRequestById(submittedRequest.requestId);
      if (fresh) {
        setSubmittedRequest(fresh);
        if (fresh.status === 'APPROVED' && fresh.assignedUserId) {
          setUserId(fresh.assignedUserId);
          setLicenseKey(fresh.assignedLicenseKey);
        }
      }
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#070A0F] text-slate-100 flex flex-col justify-between p-6 overflow-y-auto">
      {/* Owner Preview Strip (only visible when Master Owner clicks "Preview User Software") */}
      {isOwnerPreview && onExitOwnerPreview && (
        <div className="max-w-5xl w-full mx-auto mb-3 px-4 py-2 rounded-xl bg-cyan-950/90 border border-cyan-500/60 flex items-center justify-between gap-3 text-xs">
          <span className="text-cyan-200 font-medium">
            Previewing <strong>Normal User Software Edition</strong> (Only Login &amp; Request Access are shown to normal users)
          </span>
          <button
            type="button"
            onClick={onExitOwnerPreview}
            className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer shrink-0"
          >
            Back to My Master Software
          </button>
        </div>
      )}

      {/* Top Bar: Software Branding */}
      <header className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/90 pb-4">
        <div className="flex items-center gap-3">
          <EswaTunnelLogo size="sm" />
          <div>
            <div className="font-display font-bold text-base tracking-wide text-white">
              ESWA TUNNEL MAPPER &amp; ESWACAD
            </div>
          </div>
        </div>
      </header>

      {/* Main Gate Card */}
      <main className="max-w-xl w-full mx-auto my-auto py-6">
        <div className="bg-[#0F141C] border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
          {/* Mode Switcher Tabs: ONLY Login and Request Access for Normal Users */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setGateMode('login')}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                gateMode === 'login'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>1. One-Time PC Login</span>
            </button>
            <button
              type="button"
              onClick={() => setGateMode('request_access')}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                gateMode === 'request_access'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>2. Request Access</span>
            </button>
          </div>

          {gateMode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {loginError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700/70 text-xs text-rose-200">
                  {loginError}
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-300">User ID</span>
                <input
                  type="text"
                  required
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="Enter your assigned User ID"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-300">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your assigned Password"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-300">
                  1-PC Hardware License Key
                </span>
                <input
                  type="text"
                  required
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="ESWA-1PC-XXXX-XXXX-XXXX"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono text-emerald-300 focus:border-cyan-500 focus:outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {loginBusy
                    ? 'Activating 1-PC License...'
                    : 'One-Time Login & Unlock on This PC'}
                </span>
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setGateMode('request_access')}
                  className="text-xs text-cyan-400 hover:underline cursor-pointer"
                >
                  New user? Click here to submit your details &amp; request login credentials
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">
                  Request Software Access
                </h2>
                <p className="text-xs text-slate-400">
                  Fill in your required details below and submit. The administrator will receive an instant notification and issue your 1-PC User ID, Password, and Key.
                </p>
              </div>

              {submittedRequest && (
                <div className="p-4 rounded-xl bg-slate-950 border border-emerald-600/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Request Submitted (#{submittedRequest.requestId.slice(0, 12)})
                    </span>
                    <button
                      type="button"
                      onClick={handleRefreshRequestStatus}
                      disabled={checkingStatus}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-cyan-300 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${checkingStatus ? 'animate-spin' : ''}`}
                      />
                      Check Status
                    </button>
                  </div>

                  <div className="text-xs font-mono text-slate-300">
                    Status:{' '}
                    <strong
                      className={
                        submittedRequest.status === 'APPROVED'
                          ? 'text-emerald-400'
                          : submittedRequest.status === 'REJECTED'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }
                    >
                      {submittedRequest.status}
                    </strong>{' '}
                    · Registered PC: {submittedRequest.pcHardwareId}
                  </div>

                  {submittedRequest.status === 'APPROVED' &&
                    submittedRequest.assignedUserId && (
                      <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-600/50 text-xs font-mono space-y-1">
                        <div className="text-emerald-300 font-bold">
                          Your Request is Approved!
                        </div>
                        <div>Assigned User ID: {submittedRequest.assignedUserId}</div>
                        <div>
                          Assigned 1-PC Key: {submittedRequest.assignedLicenseKey}
                        </div>
                        <div className="text-[11px] text-slate-300">
                          Enter these along with the password provided by the Admin in Tab 1 to unlock this PC permanently.
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUserId(submittedRequest.assignedUserId);
                            setLicenseKey(submittedRequest.assignedLicenseKey);
                            setGateMode('login');
                          }}
                          className="mt-1 px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold text-xs cursor-pointer"
                        >
                          Go to Login With My Approved ID &amp; Key
                        </button>
                      </div>
                    )}
                </div>
              )}

              <form onSubmit={handleSubmitRequest} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">Full Name *</span>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your Full Name"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">
                      Organization / Company *
                    </span>
                    <input
                      type="text"
                      required
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Company or Project Name"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">Email Address *</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-300">
                      Phone / WhatsApp Number *
                    </span>
                    <input
                      type="text"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 ..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Role / Designation</span>
                  <input
                    type="text"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">
                    Project Details / Purpose Notes
                  </span>
                  <textarea
                    rows={2}
                    value={purposeNotes}
                    onChange={(e) => setPurposeNotes(e.target.value)}
                    placeholder="Tunnel project site or workstation details..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submittingReq}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {submittingReq
                      ? 'Submitting Request...'
                      : 'Submit Details for Login Credentials'}
                  </span>
                </button>
              </form>
            </div>
          )}
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-900 pt-4">
        <span>ESWA Tunnel Mapper · 1-PC One-Time Login System</span>
        <span className="font-mono">Workstation ID: {pcInfo.pcHardwareId}</span>
      </footer>
    </div>
  );
};

interface SoftwareLiveUpdateNotifierProps {
  isMasterSoftware: boolean;
  isOwnerPreview?: boolean;
  activeSession: ActivatedClientSession | null;
  onOpenAdminPortal: () => void;
  onPreviewUserSoftware?: () => void;
  onExitOwnerPreview?: () => void;
}

/**
 * Top Workstation Status & Notification Strip:
 * - In MASTER SOFTWARE (for Owner):
 *   - No login required.
 *   - Shows live notifications when a new user submits an access request.
 *   - Provides 1-click "Download User Software (.EXE)" and "Master Admin Website" buttons.
 * - In NORMAL USER SOFTWARE (after 1-time login):
 *   - Permanently logged in on that 1 PC (no repeated login or sign-out prompt).
 *   - Receives live update notifications with the Update Link & 1-click Update installer.
 */
export const SoftwareLiveUpdateNotifier: React.FC<SoftwareLiveUpdateNotifierProps> = ({
  isMasterSoftware,
  isOwnerPreview = false,
  activeSession,
  onOpenAdminPortal,
  onPreviewUserSoftware,
  onExitOwnerPreview,
}) => {
  const [availableRelease, setAvailableRelease] =
    useState<SoftwareReleaseRecord | null>(null);
  const [dismissedReleaseId, setDismissedReleaseId] = useState<string | null>(null);
  const [installedVer, setInstalledVer] = useState<string>(() =>
    getInstalledSoftwareVersion()
  );
  const [copiedUpdateLink, setCopiedUpdateLink] = useState<boolean>(false);

  // Master Software only: live watch for new User Access Requests so Owner gets instant notification
  const [pendingRequests, setPendingRequests] = useState<AccessRequestRecord[]>([]);

  useEffect(() => {
    const unsub = subscribeClientSoftwareUpdates((rel) => {
      setAvailableRelease(rel);
    });
    return () => unsub();
  }, [installedVer]);

  // Also automatically check GitHub Releases ("latest") if a GitHub repository is configured
  useEffect(() => {
    if (isMasterSoftware) return;
    let cancelled = false;
    const checkGithubLatestRelease = async () => {
      const repo = getConfiguredGithubRepo();
      if (!repo) return;
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/releases/tags/latest`,
          { headers: { Accept: 'application/vnd.github+json' } }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          id?: number;
          published_at?: string;
          body?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        if (!data || !data.published_at || cancelled) return;
        const userAsset = (data.assets || []).find((a) =>
          (a.name || '').toLowerCase().includes('user')
        );
        const userDownloadUrl =
          userAsset?.browser_download_url || getGithubUserExeDownloadUrl(repo);
        const releaseStamp = `gh-${String(data.id || data.published_at).slice(0, 16)}`;
        const currentInstalled = getInstalledSoftwareVersion();
        if (currentInstalled === releaseStamp) return;

        setAvailableRelease((prev) => {
          if (prev) return prev; // Prefer explicit Master Admin pushed release if active
          return {
            releaseId: `github_auto_${releaseStamp}`,
            portalScope: 'ESWA_GLOBAL',
            version: releaseStamp,
            title: 'AKASH TUNNEL MAPPER — New GitHub User Software Update',
            releaseNotes:
              data.body ||
              'A new update of the User Software (.EXE) has been pushed to GitHub. Click the link or Download button below to get the latest version.',
            downloadUrl: userDownloadUrl,
            targetScope: 'ALL_PCS',
            targetIdentifierCsv: 'ALL',
            isMandatory: false,
            status: 'PUBLISHED',
            publishedAtIso: data.published_at || new Date().toISOString(),
            adminAuthSig: 'GITHUB_AUTO',
          };
        });
      } catch {
        // Ignore network errors
      }
    };

    checkGithubLatestRelease();
    const timer = window.setInterval(checkGithubLatestRelease, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isMasterSoftware, installedVer]);

  useEffect(() => {
    if (!isMasterSoftware) return;
    const unsub = subscribeAdminLicensingData({
      onRequests: (all) => {
        setPendingRequests(all.filter((r) => r.status === 'PENDING'));
      },
      onLicenses: () => {},
      onReleases: () => {},
      onMasterPcs: () => {},
    });
    return () => unsub();
  }, [isMasterSoftware]);

  const getUpdateLinkForRelease = (rel: SoftwareReleaseRecord): string => {
    if (
      !rel.downloadUrl ||
      rel.downloadUrl === 'BUILTIN_WINDOWS_EXE' ||
      rel.downloadUrl === 'USER_SOFTWARE_EXE' ||
      rel.downloadUrl === 'GITHUB_USER_EXE'
    ) {
      return getGithubUserExeDownloadUrl();
    }
    return rel.downloadUrl;
  };

  const handleDownloadAndApplyUpdate = async (rel: SoftwareReleaseRecord) => {
    const resolvedLink = getUpdateLinkForRelease(rel);
    if (
      resolvedLink.includes('github.com/') &&
      resolvedLink.toLowerCase().endsWith('.exe')
    ) {
      const link = document.createElement('a');
      link.href = resolvedLink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = 'AKASH-TUNNEL-MAPPER-User-Setup.exe';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (
      !rel.downloadUrl ||
      rel.downloadUrl === 'BUILTIN_WINDOWS_EXE' ||
      rel.downloadUrl === 'USER_SOFTWARE_EXE' ||
      rel.downloadUrl.toLowerCase().endsWith('.exe')
    ) {
      downloadUserEditionDesktopExe(`AKASH-TUNNEL-MAPPER-User-Setup-v${rel.version}.exe`);
    } else {
      const link = document.createElement('a');
      link.href = resolvedLink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = `AKASH-TUNNEL-MAPPER-User-Setup-v${rel.version}.exe`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    await acknowledgeClientUpdateInstalled(rel.version);
    setInstalledVer(rel.version);
    setAvailableRelease(null);
  };

  const showUpdatePrompt =
    !isMasterSoftware &&
    availableRelease &&
    availableRelease.version !== installedVer &&
    (availableRelease.isMandatory ||
      dismissedReleaseId !== availableRelease.releaseId);

  return (
    <>
      {/* Live Software Update Notification Modal for Users (with Update Link + 1-Click Download) */}
      {showUpdatePrompt && availableRelease && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="max-w-md w-full bg-slate-900 border border-cyan-500/60 rounded-2xl p-5 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-600 flex items-center justify-center text-white shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[11px] font-mono text-cyan-400">
                    NEW SOFTWARE UPDATE AVAILABLE
                  </div>
                  <h3 className="text-base font-bold text-white">
                    {availableRelease.title} (v{availableRelease.version})
                  </h3>
                </div>
              </div>

              {!availableRelease.isMandatory && (
                <button
                  type="button"
                  onClick={() => setDismissedReleaseId(availableRelease.releaseId)}
                  className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 whitespace-pre-line leading-relaxed">
              {availableRelease.releaseNotes}
            </div>

            {/* Direct Update Link Box */}
            <div className="p-3 rounded-xl bg-slate-950 border border-cyan-800/60 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>GitHub User Software Update Link:</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const link = getUpdateLinkForRelease(availableRelease);
                    navigator.clipboard?.writeText(link).catch(() => {});
                    setCopiedUpdateLink(true);
                    window.setTimeout(() => setCopiedUpdateLink(false), 2500);
                  }}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedUpdateLink ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>
              <a
                href={getUpdateLinkForRelease(availableRelease)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (
                    !availableRelease.downloadUrl ||
                    availableRelease.downloadUrl === 'BUILTIN_WINDOWS_EXE' ||
                    availableRelease.downloadUrl === 'USER_SOFTWARE_EXE'
                  ) {
                    e.preventDefault();
                    handleDownloadAndApplyUpdate(availableRelease);
                  }
                }}
                className="block text-xs font-mono text-emerald-400 hover:underline break-all"
              >
                {getUpdateLinkForRelease(availableRelease)}
              </a>
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Installed Version: v{installedVer} → New Update:{' '}
              <span className="text-emerald-400 font-bold">
                v{availableRelease.version}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {!availableRelease.isMandatory && (
                <button
                  type="button"
                  onClick={() => setDismissedReleaseId(availableRelease.releaseId)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Later
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDownloadAndApplyUpdate(availableRelease)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download &amp; Update Now (v{availableRelease.version})</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
