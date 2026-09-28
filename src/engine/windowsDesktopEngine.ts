import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * React hook for native Windows 10/11 (Edge/Chrome) & PWA Desktop installation.
 */
export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

/**
 * React hook for tracking online/offline field connectivity status.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Generates a valid, native Windows PE32 GUI executable (Akash_Tunnel_Mapper_PC.exe).
 * When launched on Windows 10/11 (x86 or x64), it invokes ShellExecuteA from shell32.dll
 * to open Akash Tunnel Joint Tracer in a dedicated maximized native Windows application window
 * (msedge.exe --app=<URL> --start-maximized) with automatic default-browser fallback.
 */
export function buildWindowsDesktopExeBinary(appUrl: string): Uint8Array {
  const cleanUrl = (appUrl || 'http://localhost:3000').trim().slice(0, 220);
  const edgeArgs = `--app=${cleanUrl} --start-maximized`;

  // Total file size: 0x600 (1536 bytes):
  // 0x000..0x1FF: DOS + PE32 Headers (512 bytes)
  // 0x200..0x5FF: .text section (1024 bytes, mapped to RVA 0x1000, VA 0x00401000)
  const buf = new Uint8Array(0x600);
  const view = new DataView(buf.buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      buf[offset + i] = str.charCodeAt(i) & 0xff;
    }
    buf[offset + str.length] = 0;
  };

  // 1. IMAGE_DOS_HEADER (0x00..0x3F)
  view.setUint16(0x00, 0x5a4d, true); // 'MZ'
  view.setUint32(0x3c, 0x00000080, true); // e_lfanew -> 0x80

  // 2. PE Signature & IMAGE_FILE_HEADER (0x80..0x97)
  view.setUint32(0x80, 0x00004550, true); // 'PE\0\0'
  view.setUint16(0x84, 0x014c, true); // Machine: IMAGE_FILE_MACHINE_I386 (runs on all x86 & x64 Windows)
  view.setUint16(0x86, 1, true); // NumberOfSections: 1
  view.setUint32(0x88, 0x66f00000, true); // TimeDateStamp
  view.setUint32(0x8c, 0, true); // PointerToSymbolTable
  view.setUint32(0x90, 0, true); // NumberOfSymbols
  view.setUint16(0x94, 0x00e0, true); // SizeOfOptionalHeader (224 bytes)
  view.setUint16(0x96, 0x010f, true); // Characteristics: EXECUTABLE_IMAGE | 32BIT_MACHINE | RELOCS_STRIPPED

  // 3. IMAGE_OPTIONAL_HEADER32 (0x98..0x177)
  const opt = 0x98;
  view.setUint16(opt + 0x00, 0x010b, true); // Magic: PE32
  buf[opt + 0x02] = 14; // MajorLinkerVersion
  buf[opt + 0x03] = 0; // MinorLinkerVersion
  view.setUint32(opt + 0x04, 0x00000400, true); // SizeOfCode
  view.setUint32(opt + 0x08, 0x00000000, true); // SizeOfInitializedData
  view.setUint32(opt + 0x0c, 0x00000000, true); // SizeOfUninitializedData
  view.setUint32(opt + 0x10, 0x00001000, true); // AddressOfEntryPoint (RVA 0x1000)
  view.setUint32(opt + 0x14, 0x00001000, true); // BaseOfCode
  view.setUint32(opt + 0x18, 0x00001000, true); // BaseOfData
  view.setUint32(opt + 0x1c, 0x00400000, true); // ImageBase (0x00400000)
  view.setUint32(opt + 0x20, 0x00001000, true); // SectionAlignment
  view.setUint32(opt + 0x24, 0x00000200, true); // FileAlignment
  view.setUint16(opt + 0x28, 6, true); // MajorOperatingSystemVersion (Windows Vista/7/10/11)
  view.setUint16(opt + 0x2a, 0, true); // MinorOperatingSystemVersion
  view.setUint16(opt + 0x2c, 1, true); // MajorImageVersion
  view.setUint16(opt + 0x2e, 0, true); // MinorImageVersion
  view.setUint16(opt + 0x30, 6, true); // MajorSubsystemVersion
  view.setUint16(opt + 0x32, 0, true); // MinorSubsystemVersion
  view.setUint32(opt + 0x34, 0, true); // Win32VersionValue
  view.setUint32(opt + 0x38, 0x00002000, true); // SizeOfImage (0x2000)
  view.setUint32(opt + 0x3c, 0x00000200, true); // SizeOfHeaders (0x200)
  view.setUint32(opt + 0x40, 0, true); // CheckSum
  view.setUint16(opt + 0x44, 2, true); // Subsystem: IMAGE_SUBSYSTEM_WINDOWS_GUI (2)
  view.setUint16(opt + 0x46, 0, true); // DllCharacteristics
  view.setUint32(opt + 0x48, 0x00100000, true); // SizeOfStackReserve
  view.setUint32(opt + 0x4c, 0x00001000, true); // SizeOfStackCommit
  view.setUint32(opt + 0x50, 0x00100000, true); // SizeOfHeapReserve
  view.setUint32(opt + 0x54, 0x00001000, true); // SizeOfHeapCommit
  view.setUint32(opt + 0x58, 0, true); // LoaderFlags
  view.setUint32(opt + 0x5c, 16, true); // NumberOfRvaAndSizes

  // Data Directories start at opt + 0x60 = 0xF8
  // Directory 1: Import Directory (offset 0xF8 + 8 = 0x100)
  view.setUint32(0x100, 0x00001100, true); // Import Table RVA = 0x1100
  view.setUint32(0x104, 60, true); // Import Table Size = 60 bytes (3 descriptors)

  // Directory 12: IAT (offset 0xF8 + 96 = 0x158)
  view.setUint32(0x158, 0x00001160, true); // IAT RVA = 0x1160
  view.setUint32(0x15c, 16, true); // IAT Size = 16 bytes

  // 4. IMAGE_SECTION_HEADER (.text at 0x178..0x19F)
  writeAscii(0x178, '.text');
  view.setUint32(0x180, 0x00000400, true); // VirtualSize
  view.setUint32(0x184, 0x00001000, true); // VirtualAddress (RVA 0x1000)
  view.setUint32(0x188, 0x00000400, true); // SizeOfRawData (1024 bytes)
  view.setUint32(0x18c, 0x00000200, true); // PointerToRawData (File offset 0x200)
  view.setUint32(0x19c, 0xe0000020, true); // Characteristics: CODE | EXECUTE | READ | WRITE

  // 5. Machine Code at File Offset 0x200 (RVA 0x1000, VA 0x00401000)
  const code = [
    // ShellExecuteA(NULL, "open", "msedge.exe", "--app=<URL> --start-maximized", NULL, SW_SHOWNORMAL)
    0x6a, 0x01,                         // push 1 (SW_SHOWNORMAL)
    0x6a, 0x00,                         // push 0 (lpDirectory = NULL)
    0x68, 0xe0, 0x12, 0x40, 0x00,       // push 0x004012E0 (lpParameters = edgeArgs)
    0x68, 0xd0, 0x11, 0x40, 0x00,       // push 0x004011D0 (lpFile = "msedge.exe")
    0x68, 0xc8, 0x11, 0x40, 0x00,       // push 0x004011C8 (lpOperation = "open")
    0x6a, 0x00,                         // push 0 (hwnd = NULL)
    0xff, 0x15, 0x60, 0x11, 0x40, 0x00, // call dword ptr [0x00401160] (ShellExecuteA)
    0x83, 0xf8, 0x20,                   // cmp eax, 32
    0x7f, 0x18,                         // jg +24 bytes (to ExitProcess)
    // Fallback: ShellExecuteA(NULL, "open", "<URL>", NULL, NULL, SW_SHOWNORMAL)
    0x6a, 0x01,                         // push 1
    0x6a, 0x00,                         // push 0
    0x6a, 0x00,                         // push 0
    0x68, 0xe0, 0x11, 0x40, 0x00,       // push 0x004011E0 (lpFile = cleanUrl)
    0x68, 0xc8, 0x11, 0x40, 0x00,       // push 0x004011C8 (lpOperation = "open")
    0x6a, 0x00,                         // push 0
    0xff, 0x15, 0x60, 0x11, 0x40, 0x00, // call dword ptr [0x00401160] (ShellExecuteA)
    // ExitProcess(0)
    0x6a, 0x00,                         // push 0
    0xff, 0x15, 0x68, 0x11, 0x40, 0x00, // call dword ptr [0x00401168] (ExitProcess)
    0xc3,                               // ret
  ];
  for (let i = 0; i < code.length; i++) {
    buf[0x200 + i] = code[i];
  }

  // 6. Import Directory Table at File Offset 0x300 (RVA 0x1100)
  // Descriptor 0: shell32.dll
  view.setUint32(0x300, 0x00001140, true); // OriginalFirstThunk
  view.setUint32(0x304, 0, true); // TimeDateStamp
  view.setUint32(0x308, 0, true); // ForwarderChain
  view.setUint32(0x30c, 0x00001180, true); // Name RVA ("shell32.dll")
  view.setUint32(0x310, 0x00001160, true); // FirstThunk RVA (IAT)

  // Descriptor 1: kernel32.dll
  view.setUint32(0x314, 0x00001148, true); // OriginalFirstThunk
  view.setUint32(0x318, 0, true); // TimeDateStamp
  view.setUint32(0x31c, 0, true); // ForwarderChain
  view.setUint32(0x320, 0x00001190, true); // Name RVA ("kernel32.dll")
  view.setUint32(0x324, 0x00001168, true); // FirstThunk RVA (IAT)

  // OriginalFirstThunk (ILT) at File Offset 0x340 (RVA 0x1140)
  view.setUint32(0x340, 0x000011a0, true); // Hint/Name RVA for ShellExecuteA
  view.setUint32(0x344, 0, true);
  view.setUint32(0x348, 0x000011b4, true); // Hint/Name RVA for ExitProcess
  view.setUint32(0x34c, 0, true);

  // FirstThunk (IAT) at File Offset 0x360 (RVA 0x1160)
  view.setUint32(0x360, 0x000011a0, true); // ShellExecuteA
  view.setUint32(0x364, 0, true);
  view.setUint32(0x368, 0x000011b4, true); // ExitProcess
  view.setUint32(0x36c, 0, true);

  // DLL & Function Names at File Offset 0x380 (RVA 0x1180)
  writeAscii(0x380, 'shell32.dll');
  writeAscii(0x390, 'kernel32.dll');
  // 0x3A0 (RVA 0x11A0): Hint (0) + "ShellExecuteA"
  view.setUint16(0x3a0, 0, true);
  writeAscii(0x3a2, 'ShellExecuteA');
  // 0x3B4 (RVA 0x11B4): Hint (0) + "ExitProcess"
  view.setUint16(0x3b4, 0, true);
  writeAscii(0x3b6, 'ExitProcess');

  // Argument Strings
  writeAscii(0x3c8, 'open');        // RVA 0x11C8 -> VA 0x004011C8
  writeAscii(0x3d0, 'msedge.exe');  // RVA 0x11D0 -> VA 0x004011D0
  writeAscii(0x3e0, cleanUrl);      // RVA 0x11E0 -> VA 0x004011E0
  writeAscii(0x4e0, edgeArgs);      // RVA 0x12E0 -> VA 0x004012E0

  return buf;
}

/**
 * Triggers browser download of the native Windows PC .exe launcher.
 */
export function downloadWindowsDesktopExe(appUrl?: string) {
  const targetUrl = appUrl || window.location.origin;
  const exeBytes = buildWindowsDesktopExeBinary(targetUrl);
  const blob = new Blob([exeBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.microsoft.portable-executable',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Akash_Tunnel_Mapper_PC.exe';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a one-click Windows 10/11 Desktop Shortcut & App Mode Setup Installer (.bat)
 */
export function downloadWindowsInstallerBatchScript(appUrl?: string) {
  const targetUrl = appUrl || window.location.origin;
  const batLines = [
    '@echo off',
    'title Akash Tunnel Joint Tracer - Windows PC Desktop Setup',
    'color 0B',
    'echo ============================================================================',
    'echo   AKASH TUNNEL JOINT TRACER - WINDOWS PC DESKTOP INSTALLER',
    'echo   Underground Geological Mapping, Overbreak/Undercut ^& 3D Orientation Suite',
    'echo ============================================================================',
    'echo.',
    `set "APP_URL=${targetUrl}"`,
    'set "SHORTCUT_NAME=Akash Tunnel Joint Tracer"',
    'echo [1/3] Creating Windows Desktop Shortcut...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath(\'Desktop\') + \'\\Akash Tunnel Joint Tracer.lnk\'); $s.TargetPath = \'msedge.exe\'; $s.Arguments = \'--app=%APP_URL% --start-maximized\'; $s.Description = \'Akash Tunnel Joint Tracer PC Engineering Suite\'; $s.IconLocation = \'msedge.exe,0\'; $s.Save()"',
    'echo [2/3] Creating Windows Start Menu Program Entry...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath(\'Programs\') + \'\\Akash Tunnel Joint Tracer.lnk\'); $s.TargetPath = \'msedge.exe\'; $s.Arguments = \'--app=%APP_URL% --start-maximized\'; $s.Description = \'Akash Tunnel Joint Tracer PC Engineering Suite\'; $s.IconLocation = \'msedge.exe,0\'; $s.Save()"',
    'echo [3/3] Launching Akash Tunnel Joint Tracer in Native Windows Desktop Window...',
    'start "" msedge.exe --app=%APP_URL% --start-maximized',
    'echo.',
    'echo Installation Complete! A shortcut has been placed on your Windows Desktop.',
    'timeout /t 4 >nul',
    'exit',
  ];
  const content = batLines.join('\r\n');
  const blob = new Blob([content], { type: 'application/x-bat;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Install_Akash_Tunnel_Mapper_PC.bat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
