import React, { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

export interface EswaTunnelLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'splash';
  variant?: 'emblem' | 'lockup' | 'inline' | 'splash';
  animated?: boolean;
  showBadge?: boolean;
  className?: string;
}

const SIZE_MAP: Record<NonNullable<EswaTunnelLogoProps['size']>, number> = {
  xs: 24,
  sm: 36,
  md: 56,
  lg: 104,
  xl: 140,
  '2xl': 180,
  splash: 210,
};

/**
 * High-Resolution Vector Logo Component for ESWA TUNNEL MAPPER (512×512 Geometric Precision SVG)
 * Adapts automatically to both Dark Mode and Light Mode.
 */
export const EswaTunnelLogo: React.FC<EswaTunnelLogoProps> = ({
  size = 'md',
  variant = 'emblem',
  animated = false,
  showBadge = true,
  className = '',
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const px = SIZE_MAP[size];

  const emblemNode = (
    <div
      className={`relative inline-flex items-center justify-center select-none shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      <svg
        viewBox="0 0 512 512"
        width={px}
        height={px}
        shapeRendering="geometricPrecision"
        textRendering="geometricPrecision"
        className={
          isLight
            ? 'overflow-visible drop-shadow-[0_8px_20px_rgba(15,23,42,0.14)]'
            : 'overflow-visible drop-shadow-[0_0_24px_rgba(34,211,238,0.22)]'
        }
        aria-label="ESWA Tunnel Mapper High-Resolution Logo"
      >
        <defs>
          <linearGradient id="eswaHiResBgDark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#060A12" />
            <stop offset="50%" stopColor="#0C1424" />
            <stop offset="100%" stopColor="#081220" />
          </linearGradient>

          <linearGradient id="eswaHiResBgLight" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#F1F5F9" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>

          <linearGradient id="eswaHiResBezel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0284C7" stopOpacity="0.8" />
            <stop offset="50%" stopColor={isLight ? '#94A3B8' : '#1E293B'} stopOpacity="0.9" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0.8" />
          </linearGradient>

          <linearGradient id="eswaHiResArch" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isLight ? '#0284C7' : '#22D3EE'} />
            <stop offset="50%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor={isLight ? '#059669' : '#10B981'} />
          </linearGradient>

          <linearGradient id="eswaHiResMonogram" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isLight ? '#0F172A' : '#F8FAFC'} />
            <stop offset="50%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>

          <radialGradient id="eswaHiResPortalVoidDark" cx="50%" cy="48%" r="50%">
            <stop offset="0%" stopColor="#112238" stopOpacity="0.95" />
            <stop offset="62%" stopColor="#09111E" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#05080F" stopOpacity="1" />
          </radialGradient>

          <radialGradient id="eswaHiResPortalVoidLight" cx="50%" cy="48%" r="50%">
            <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.95" />
            <stop offset="65%" stopColor="#F1F5F9" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#E2E8F0" stopOpacity="1" />
          </radialGradient>

          <linearGradient id="eswaLaserSweep" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0" />
            <stop offset="20%" stopColor="#0EA5E9" stopOpacity="0.85" />
            <stop offset="50%" stopColor={isLight ? '#0284C7' : '#F8FAFC'} stopOpacity="1" />
            <stop offset="80%" stopColor="#0EA5E9" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Outer Geotechnical Instrument Chassis */}
        <rect
          x="16"
          y="16"
          width="480"
          height="480"
          rx="92"
          fill={isLight ? 'url(#eswaHiResBgLight)' : 'url(#eswaHiResBgDark)'}
          stroke="url(#eswaHiResBezel)"
          strokeWidth="6"
        />

        {/* Inner Stereonet Compass Ring */}
        <circle
          cx="256"
          cy="244"
          r="204"
          fill="none"
          stroke={isLight ? '#CBD5E1' : '#1E293B'}
          strokeWidth="2.5"
        />
        <circle
          cx="256"
          cy="244"
          r="192"
          fill="none"
          stroke={isLight ? 'rgba(2,132,199,0.35)' : 'rgba(56,189,248,0.24)'}
          strokeWidth="1.75"
          strokeDasharray="8 10"
        />

        {/* Cardinal & Intercardinal Azimuth Ticks */}
        <g stroke={isLight ? '#64748B' : '#475569'} strokeLinecap="round">
          <line x1="256" y1="34" x2="256" y2="54" stroke={isLight ? '#0284C7' : '#22D3EE'} strokeWidth="4" />
          <line x1="466" y1="244" x2="446" y2="244" stroke={isLight ? '#0284C7' : '#22D3EE'} strokeWidth="4" />
          <line x1="46" y1="244" x2="66" y2="244" stroke={isLight ? '#0284C7' : '#22D3EE'} strokeWidth="4" />
          <line x1="108" y1="96" x2="122" y2="110" strokeWidth="3" />
          <line x1="404" y1="96" x2="390" y2="110" strokeWidth="3" />
          <line x1="108" y1="392" x2="122" y2="378" strokeWidth="3" />
          <line x1="404" y1="392" x2="390" y2="378" strokeWidth="3" />
        </g>

        {/* As-Built Overbreak Excavation Contour (Rose Dashed Geological Profile) */}
        <path
          d="M 82 388 L 74 232 L 102 146 L 166 88 L 256 68 L 348 86 L 412 148 L 438 236 L 430 388"
          fill="rgba(244,63,94,0.06)"
          stroke="#E11D48"
          strokeWidth="6.5"
          strokeDasharray="16 10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Primary D-Shaped Tunnel Design Profile Arch */}
        <path
          d="M 102 388 L 102 236 A 154 154 0 0 1 410 236 L 410 388 Z"
          fill={isLight ? 'url(#eswaHiResPortalVoidLight)' : 'url(#eswaHiResPortalVoidDark)'}
          stroke="url(#eswaHiResArch)"
          strokeWidth="15"
          strokeLinejoin="round"
        />

        {/* 3D Perspective Inner Tunnel Advance Rings */}
        <path
          d="M 132 370 L 132 240 A 124 124 0 0 1 380 240 L 380 370 Z"
          fill="none"
          stroke={isLight ? 'rgba(2,132,199,0.35)' : 'rgba(56,189,248,0.32)'}
          strokeWidth="3"
          strokeDasharray="8 8"
        />

        {/* Mapped Geological Discontinuity Traces Across Tunnel Face */}
        <path
          d="M 114 298 L 194 246 L 288 198 L 396 158"
          fill="none"
          stroke={isLight ? '#D97706' : '#F59E0B'}
          strokeWidth="8.5"
          strokeLinecap="round"
        />
        <path
          d="M 144 150 L 228 216 L 316 292 L 394 358"
          fill="none"
          stroke={isLight ? '#0284C7' : '#38BDF8'}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M 114 354 L 228 322 L 338 288 L 398 264"
          fill="none"
          stroke={isLight ? '#059669' : '#10B981'}
          strokeWidth="7.5"
          strokeLinecap="round"
        />

        {/* Precision-Machined "ESWA" Central Structural Monogram ("E" Lockup) */}
        <g>
          <path
            d="M 196 168 H 322 M 196 168 V 336 M 196 252 H 298 M 196 336 H 322"
            fill="none"
            stroke={isLight ? '#FFFFFF' : '#060A12'}
            strokeWidth="34"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 196 168 H 322 M 196 168 V 336 M 196 252 H 298 M 196 336 H 322"
            fill="none"
            stroke="url(#eswaHiResMonogram)"
            strokeWidth="22"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Animated Photogrammetry Laser Scan Line */}
        {animated && (
          <g>
            <line
              x1="92"
              y1="236"
              x2="420"
              y2="236"
              stroke="url(#eswaLaserSweep)"
              strokeWidth="6"
              strokeLinecap="round"
            >
              <animate
                attributeName="y1"
                values="96;382;96"
                dur="2.6s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="y2"
                values="96;382;96"
                dur="2.6s"
                repeatCount="indefinite"
              />
            </line>
          </g>
        )}

        {/* 3D Survey Control Targets (CP1, CP2, CP3) */}
        <g>
          <circle cx="102" cy="236" r="13" fill="#10B981" stroke="#FFFFFF" strokeWidth="4.5" />
          <circle cx="256" cy="82" r="13" fill="#0EA5E9" stroke="#FFFFFF" strokeWidth="4.5" />
          <circle cx="410" cy="236" r="13" fill="#10B981" stroke="#FFFFFF" strokeWidth="4.5" />
        </g>

        {/* Invert Nameplate Lockup ("ESWA") */}
        {showBadge && (
          <g>
            <rect
              x="106"
              y="404"
              width="300"
              height="68"
              rx="18"
              fill={isLight ? '#0F172A' : '#070B14'}
              stroke={isLight ? '#0284C7' : '#22D3EE'}
              strokeWidth="4"
            />
            <text
              x="256"
              y="449"
              textAnchor="middle"
              fill="#F8FAFC"
              fontSize="40"
              fontWeight="800"
              fontFamily="Chakra Petch, sans-serif"
              letterSpacing="12"
            >
              ESWA
            </text>
          </g>
        )}
      </svg>
    </div>
  );

  if (variant === 'emblem') {
    return emblemNode;
  }

  if (variant === 'inline') {
    return (
      <div className="inline-flex items-center gap-2.5 select-none">
        {emblemNode}
        <span
          className={`font-display text-sm font-bold tracking-wider whitespace-nowrap ${
            isLight ? 'text-slate-900' : 'text-slate-100'
          }`}
        >
          ESWA Tunnel Mapper
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center select-none">
      {emblemNode}
      <div className="mt-4 space-y-1">
        <div
          className={`font-display text-3xl sm:text-4xl font-bold tracking-[0.16em] ${
            isLight ? 'text-slate-900' : 'text-white'
          }`}
        >
          ESWA
        </div>
        <div
          className={`font-display text-xs sm:text-sm font-semibold tracking-[0.22em] ${
            isLight ? 'text-sky-700' : 'text-cyan-300'
          }`}
        >
          Tunnel Mapper · 3D Geotechnical CAD
        </div>
      </div>
    </div>
  );
};

interface EswaLoadingScreenProps {
  onComplete: () => void;
}

/**
 * Centered High-Resolution 'ESWA' Brand Splash Screen Displayed During Application Boot
 * Fully supports Dark Mode and Light Mode with an embedded architectural CAD grid backdrop.
 */
export const EswaLoadingScreen: React.FC<EswaLoadingScreenProps> = ({ onComplete }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [progress, setProgress] = useState<number>(25);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setProgress((prev) => Math.min(100, prev + 25));
    }, 140);

    const timer = window.setTimeout(() => {
      onComplete();
    }, 800);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-4 select-none transition-colors overflow-hidden ${
        isLight
          ? 'bg-slate-50/95 text-slate-900'
          : 'bg-[#080C14]/95 text-slate-100'
      } backdrop-blur-md`}
      onClick={onComplete}
      role="dialog"
      aria-label="ESWA Brand Boot Splash Screen"
    >
      {/* Subtle Architectural CAD Grid Backdrop */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-35"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="eswaBootGrid"
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke={isLight ? '#CBD5E1' : '#1E293B'}
              strokeWidth="0.75"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#eswaBootGrid)" />
      </svg>

      <div
        className={`relative z-10 w-full max-w-md flex flex-col items-center text-center space-y-6 p-8 rounded-2xl border shadow-2xl ${
          isLight
            ? 'bg-white/95 border-slate-200 shadow-slate-300/60'
            : 'bg-[#0F1624]/95 border-slate-800 shadow-black/70'
        }`}
      >
        <EswaTunnelLogo size="2xl" variant="lockup" animated showBadge />

        <div className="w-full space-y-2 pt-1">
          <div
            className={`w-full h-1.5 rounded-full overflow-hidden ${
              isLight ? 'bg-slate-200' : 'bg-slate-800'
            }`}
          >
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div
            className={`text-xs font-mono tabular-nums ${
              isLight ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            Initializing Photogrammetry &amp; 3D Strip CAD Engine · {progress}%
          </div>
        </div>
      </div>
    </div>
  );
};
