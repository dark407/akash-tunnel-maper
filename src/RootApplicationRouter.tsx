import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import App from './App';
import { MasterAdminPortalWebsite } from './components/MasterAdminPortalWebsite';
import {
  SoftwareAccessGate,
  SoftwareLiveUpdateNotifier,
} from './components/SoftwareAccessGateAndUpdater';
import {
  ActivatedClientSession,
  getLocalActivatedSession,
  getOrGeneratePcHardwareId,
  sanitizeIdentifier,
  saveLocalActivatedSession,
  setLocalMasterPcBypass,
  SoftwareLicenseRecord,
} from './engine/softwareLicensingEngine';
import { db } from './firebase';

export const RootApplicationRouter: React.FC = () => {
  // Detect whether this instance was launched from the Normal User Software file (?edition=user)
  const [isUserEdition, setIsUserEdition] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('edition')?.toLowerCase() === 'user') {
        return true;
      }
    }
    return false;
  });

  // Track if the Master Owner is temporarily previewing the User Software inside the same window
  const [isOwnerPreviewingUserEdition, setIsOwnerPreviewingUserEdition] =
    useState<boolean>(false);

  // Check if URL explicitly points to the standalone Master Admin Website (/admin or ?portal=admin)
  const [viewMode, setViewMode] = useState<'software' | 'admin_website'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const search = window.location.search.toLowerCase();
      if (path.startsWith('/admin') || search.includes('portal=admin')) {
        return 'admin_website';
      }
    }
    return 'software';
  });

  // 1-Time Login Session for Normal User Software (saved permanently on their 1 PC)
  const [activeSession, setActiveSession] =
    useState<ActivatedClientSession | null>(() => getLocalActivatedSession());

  useEffect(() => {
    // If running in Master Software mode (default for Master Owner), ensure Master PC status is active
    if (!isUserEdition) {
      setLocalMasterPcBypass(true);
      return;
    }

    // In User Software mode: if the user has already logged in ONCE on this PC, keep them logged in permanently
    let mounted = true;
    const verifyUserOneTimeSession = async () => {
      const localSession = getLocalActivatedSession();
      if (!localSession) return;

      try {
        const { pcHardwareId } = getOrGeneratePcHardwareId();
        const cleanUserId = sanitizeIdentifier(localSession.userId);
        const snap = await Promise.race([
          getDoc(doc(db, 'software_licenses', cleanUserId)),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        if (!mounted || !snap || !snap.exists()) return;

        const lic = snap.data() as SoftwareLicenseRecord;
        // Only revoke if Admin explicitly SUSPENDED/REVOKED or bound to a different PC
        if (
          lic.status !== 'ACTIVE' ||
          (lic.boundPcHardwareId &&
            lic.boundPcHardwareId !== '' &&
            lic.boundPcHardwareId !== pcHardwareId)
        ) {
          saveLocalActivatedSession(null);
          setActiveSession(null);
        }
      } catch {
        // Keep 1-time activated session active on this PC when offline
      }
    };
    verifyUserOneTimeSession();
    return () => {
      mounted = false;
    };
  }, [isUserEdition]);

  const handleOpenAdminWebsite = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('portal', 'admin');
      window.history.pushState({}, '', url.toString());
    } catch {
      // Ignore
    }
    setViewMode('admin_website');
  };

  const handleSwitchToSoftware = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('portal');
      if (url.pathname.toLowerCase().startsWith('/admin')) {
        url.pathname = '/';
      }
      window.history.pushState({}, '', url.toString());
    } catch {
      // Ignore
    }
    setViewMode('software');
  };

  const handleStartPreviewUserEdition = () => {
    setIsOwnerPreviewingUserEdition(true);
    setIsUserEdition(true);
    setViewMode('software');
  };

  const handleExitPreviewUserEdition = () => {
    setIsOwnerPreviewingUserEdition(false);
    setIsUserEdition(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('edition');
      window.history.pushState({}, '', url.toString());
    } catch {
      // Ignore
    }
  };

  // 1. Standalone Master Admin Licensing & Update Control Website (Only for Master Owner)
  if (viewMode === 'admin_website' && (!isUserEdition || isOwnerPreviewingUserEdition)) {
    return (
      <MasterAdminPortalWebsite
        onSwitchToSoftware={handleSwitchToSoftware}
        onPreviewUserSoftware={handleStartPreviewUserEdition}
        onMasterPcStatusChanged={() => {}}
      />
    );
  }

  // 2. Normal User Software Gate:
  //    - Shown ONLY in User Software edition (?edition=user) before their 1-time login on this PC.
  //    - Once logged in 1 time on this PC (activeSession != null), it NEVER asks to log in again!
  if (isUserEdition && !activeSession) {
    return (
      <SoftwareAccessGate
        onAuthorizedSession={(session) => setActiveSession(session)}
        isOwnerPreview={isOwnerPreviewingUserEdition}
        onExitOwnerPreview={handleExitPreviewUserEdition}
      />
    );
  }

  // 3. Unlocked Software Workstation:
  //    - Master Software (default for Owner: opens immediately with no login, shows new user request notifications + Admin Website link)
  //    - OR Activated User Software (after 1-time login: shows live software update notifications with update link, no Admin Website link)
  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden">
      <SoftwareLiveUpdateNotifier
        isMasterSoftware={!isUserEdition}
        isOwnerPreview={isOwnerPreviewingUserEdition}
        activeSession={activeSession}
        onOpenAdminPortal={handleOpenAdminWebsite}
        onPreviewUserSoftware={handleStartPreviewUserEdition}
        onExitOwnerPreview={handleExitPreviewUserEdition}
      />
      <div className="flex-1 min-h-0 w-full relative overflow-hidden">
        <App
          isMasterSoftware={!isUserEdition}
          onOpenAdminPortal={handleOpenAdminWebsite}
        />
      </div>
    </div>
  );
};
