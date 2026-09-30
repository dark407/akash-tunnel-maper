import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCode2,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  Printer,
  Settings2,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  buildSmoothRibbonTransform,
  ContinuousPullRecord,
  ContinuousStripTrace,
  ContinuousTunnelStripDataset,
  exportContinuousStripToDXF,
  getDefaultSheetConfig,
  SheetCustomizationConfig,
} from '../engine/continuous3DStripEngine';
import { buildProjectNetworkCanvasLayout } from '../engine/projectNetworkStripEngine';
import { ThemeToggleButton, useTheme } from '../context/ThemeContext';

export interface CadLayerVisibilityState {
  grid1m: boolean;
  pullSeams: boolean;
  springLines: boolean;
  foliationHatch: boolean;
  lithology: boolean;
  traces: boolean;
  strikeDipLabels: boolean;
  waterInflow: boolean;
  aiRawGhost: boolean;
  junctions: boolean;
  aiCrossProj: boolean;
}

export const DEFAULT_CAD_LAYERS: CadLayerVisibilityState = {
  grid1m: true,
  pullSeams: true,
  springLines: true,
  foliationHatch: true,
  lithology: true,
  traces: true,
  strikeDipLabels: true,
  waterInflow: true,
  aiRawGhost: false,
  junctions: true,
  aiCrossProj: true,
};

interface ContinuousStripExportStudioProps {
  dataset: ContinuousTunnelStripDataset;
  projectDatasets?: ContinuousTunnelStripDataset[];
  aiViewMode: 'AFTER_AI' | 'BEFORE_AI' | 'SPLIT_GHOST';
  onUpdateSheetConfig: (cfg: SheetCustomizationConfig) => void;
  onBackToCanvas: () => void;
  cadLayers?: CadLayerVisibilityState;
  onUpdateCadLayers?: React.Dispatch<React.SetStateAction<CadLayerVisibilityState>>;
}

export type ExportSheetMode =
  | 'STANDARD_TEMPLATE_SHEET' // Power Tunnel As-Built Template (No Ground Cover, Chainage-to-Chainage)
  | 'FULL_REALISTIC_MULTIPAGE' // Multi-Page Realistic Smooth Drive Strips with Page Alignment Markers
  | 'PROJECT_NETWORK_MAP'; // Entire Project Multi-Tunnel Intersection Network Sheet

export const ContinuousStripExportStudio: React.FC<ContinuousStripExportStudioProps> = ({
  dataset,
  projectDatasets,
  aiViewMode,
  onUpdateSheetConfig,
  onBackToCanvas,
  cadLayers: propCadLayers,
  onUpdateCadLayers,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [localCadLayers, setLocalCadLayers] =
    useState<CadLayerVisibilityState>(DEFAULT_CAD_LAYERS);
  const activeLayers = propCadLayers || localCadLayers;
  const setActiveLayers = onUpdateCadLayers || setLocalCadLayers;
  const [showSheetLayersPopover, setShowSheetLayersPopover] = useState<boolean>(false);
  const [sheetZoomPct, setSheetZoomPct] = useState<number>(100);
  const sheetConfig = useMemo(
    () => dataset.sheetConfig || getDefaultSheetConfig(dataset),
    [dataset]
  );

  const minDatasetRd = useMemo(
    () =>
      dataset.pulls.length > 0
        ? Math.min(...dataset.pulls.map((p) => p.fromRd))
        : dataset.viewFromRd,
    [dataset.pulls, dataset.viewFromRd]
  );
  const maxDatasetRd = useMemo(
    () =>
      dataset.pulls.length > 0
        ? Math.max(...dataset.pulls.map((p) => p.toRd))
        : dataset.viewToRd,
    [dataset.pulls, dataset.viewToRd]
  );

  const [exportMode, setExportMode] = useState<ExportSheetMode>('STANDARD_TEMPLATE_SHEET');
  const [fromChainage, setFromChainage] = useState<number>(minDatasetRd);
  const [toChainage, setToChainage] = useState<number>(maxDatasetRd);
  const [metersPerPage, setMetersPerPage] = useState<number>(15);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [printAllPagesTogether, setPrintAllPagesTogether] = useState<boolean>(true);
  const [showSheetOptionsPanel, setShowSheetOptionsPanel] = useState<boolean>(false);

  const validFromRd = Math.min(fromChainage, toChainage - 2);
  const validToRd = Math.max(validFromRd + 2, toChainage);
  const totalSpanM = validToRd - validFromRd;

  // Compute pages for Multi-Page Realistic Drawing mode
  const multiPages = useMemo(() => {
    const step = Math.max(5, metersPerPage);
    const pages: { pageNumber: number; startRd: number; endRd: number }[] = [];
    let cur = validFromRd;
    let pNum = 1;
    while (cur < validToRd - 0.01) {
      const next = Math.min(validToRd, Number((cur + step).toFixed(2)));
      pages.push({ pageNumber: pNum, startRd: cur, endRd: next });
      cur = next;
      pNum++;
    }
    if (pages.length === 0) {
      pages.push({ pageNumber: 1, startRd: validFromRd, endRd: validToRd });
    }
    return pages;
  }, [validFromRd, validToRd, metersPerPage]);

  const safePageIdx = Math.min(activePageIndex, Math.max(0, multiPages.length - 1));

  // Helper to get active trace points based on AI alignment mode
  const getTracePoints = (tr: ContinuousStripTrace) => {
    if (aiViewMode === 'BEFORE_AI' && tr.rawPoints && tr.rawPoints.length >= 2) {
      return tr.rawPoints;
    }
    return tr.aiAlignedPoints && tr.aiAlignedPoints.length >= 2
      ? tr.aiAlignedPoints
      : tr.points;
  };

  // Logo upload handler (DataURL)
  const handleLogoUpload = (
    field: 'clientLogoUrl' | 'consultantLogoUrl' | 'contractorLogoUrl',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateSheetConfig({
          ...sheetConfig,
          [field]: reader.result,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadDXF = () => {
    const dxf = exportContinuousStripToDXF({
      ...dataset,
      viewFromRd: validFromRd,
      viewToRd: validToRd,
    });
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AsBuilt_Geological_Map_${dataset.tunnelLocationName.replace(/\s+/g, '_')}_Ch_${validFromRd}_to_${validToRd}m.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Consolidate contiguous spans for rows in the Standard Power Tunnel Template
  const getConsolidatedSpans = (
    pulls: ContinuousPullRecord[],
    startRd: number,
    endRd: number,
    getter: (p: ContinuousPullRecord) => string
  ) => {
    const visible = pulls.filter((p) => p.toRd > startRd && p.fromRd < endRd);
    const spans: { fromRd: number; toRd: number; text: string; status: string }[] = [];
    for (const p of visible) {
      const f = Math.max(startRd, p.fromRd);
      const t = Math.min(endRd, p.toRd);
      const val = getter(p) || '-';
      const last = spans[spans.length - 1];
      if (last && last.text === val && Math.abs(last.toRd - f) < 0.15) {
        last.toRd = t;
      } else {
        spans.push({ fromRd: f, toRd: t, text: val, status: p.status });
      }
    }
    return spans;
  };

  const totalPerimM = Math.max(
    6,
    dataset.upperZoneWidthM + dataset.lowerZoneWidthM
  );

  // Render the Standard As-Built Engineering Geological Map (Power Tunnel Template without Ground Cover)
  const renderStandardPowerTunnelTemplateSheet = (startRd: number, endRd: number) => {
    const spanM = Math.max(2, endRd - startRd);
    const visiblePulls = dataset.pulls.filter(
      (p) => p.toRd > startRd && p.fromRd < endRd
    );

    const totalOverbreakM3 = visiblePulls.reduce(
      (acc, p) => acc + (p.overbreakVolumeM3 || 0),
      0
    );

    const rockDescSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.rockDescription || p.rockType
    );
    const weatheringSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.weatheringCondition
    );
    const ucsSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.ucsRangeMpa
    );
    const waterSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.seepageCondition
    );
    const structureSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.structureDescription || p.rockType
    );
    const foliationSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.foliationCharacteristics || 'Continuous, slightly rough joints'
    );
    const dateSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.excavationDate || p.dateMapped || '-'
    );
    const supportClassSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.supportClass || p.rockClass
    );
    const shotcreteSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.shotcreteInstalled || '10cm WET'
    );
    const meshSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.wireMeshInstalled || '1 Layer'
    );
    const boltSpans = getConsolidatedSpans(
      dataset.pulls,
      startRd,
      endRd,
      (p) => p.rockBoltsInstalled || '40/3m'
    );

    // 1-meter chainage ticks
    const meterTicks: number[] = [];
    for (let m = Math.ceil(startRd); m <= Math.floor(endRd); m += 1) {
      meterTicks.push(m);
    }

    const dominantAz = visiblePulls[0]?.driveAzimuthDeg ?? 160;
    const dominantGrad = visiblePulls[0]?.gradientPct ?? 0.166;

    // SVG Unfolded Strip coordinates inside the template center cell
    const stripSvgW = 960;
    const stripSvgH = 290;
    const rdToX = (rd: number) => ((rd - startRd) / spanM) * stripSvgW;
    const perimToY = (py: number) => (py / totalPerimM) * stripSvgH;

    return (
      <div
        style={{ zoom: sheetZoomPct !== 100 ? `${sheetZoomPct}%` : undefined }}
        className="bg-white text-black border-2 border-black shadow-2xl mx-auto w-full max-w-[1680px] print:shadow-none print:max-w-none font-sans select-none"
      >
        {/* Optional Top Banner when Logo Placement is TOP_BANNER or BOTH */}
        {(sheetConfig.logoPlacement === 'TOP_BANNER' ||
          sheetConfig.logoPlacement === 'BOTH') && (
          <div className="flex items-center justify-between px-4 py-2 border-b-2 border-black bg-slate-50">
            <div className="flex items-center gap-3">
              {sheetConfig.clientLogoUrl ? (
                <img
                  src={sheetConfig.clientLogoUrl}
                  alt="Client Logo"
                  className="h-10 w-auto object-contain"
                />
              ) : (
                <div className="px-2.5 py-1 border border-black font-bold text-xs uppercase">
                  {sheetConfig.clientLogoText}
                </div>
              )}
              <div>
                <div className="text-xs font-black uppercase tracking-wide">
                  {sheetConfig.projectTitleLine1}
                </div>
                <div className="text-[10px] font-semibold text-slate-700">
                  {sheetConfig.consultantName}
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm font-black uppercase">
                AS BUILT DRAWING — ENGINEERING GEOLOGICAL MAP
              </div>
              <div className="text-[11px] font-bold">
                {dataset.tunnelLocationName} (FROM CH. {startRd.toFixed(0)}m TO{' '}
                {endRd.toFixed(0)}m)
              </div>
            </div>
            <div className="flex items-center gap-3">
              {sheetConfig.contractorLogoUrl ? (
                <img
                  src={sheetConfig.contractorLogoUrl}
                  alt="Contractor Logo"
                  className="h-10 w-auto object-contain"
                />
              ) : (
                <div className="px-2.5 py-1 border border-black font-bold text-xs uppercase">
                  {sheetConfig.contractorName}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MAIN 2-COLUMN ENGINEERING SHEET GRID: Left/Center Map + Table (78%) | Right Legend & Title Block (22%) */}
        <div className="grid grid-cols-12">
          {/* ==============================================================
              LEFT + CENTER MAIN COLUMN (col-span-9)
             ============================================================== */}
          <div className="col-span-9 border-r-2 border-black flex flex-col">
            {/* ROW 1: CHAINAGE (m) — Strictly 1-Meter Single-Meter Scale */}
            <div className="grid grid-cols-12 border-b border-black text-[10px]">
              <div className="col-span-2 border-r border-black px-2 py-1.5 font-bold flex items-center">
                CHAINAGE (m)
              </div>
              <div className="col-span-10 relative h-8 bg-white">
                <svg viewBox={`0 0 ${stripSvgW} 32`} className="w-full h-full overflow-visible">
                  {meterTicks.map((m) => {
                    const x = rdToX(m);
                    const isEven = m % 2 === 0;
                    return (
                      <g key={m}>
                        <line
                          x1={x}
                          y1={isEven ? 16 : 22}
                          x2={x}
                          y2={32}
                          stroke="#000"
                          strokeWidth={isEven ? 1.3 : 0.75}
                        />
                        {isEven && (
                          <text
                            x={x}
                            y={12}
                            textAnchor="middle"
                            fontSize="9.5"
                            fontWeight="700"
                            fill="#000"
                          >
                            {m}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* ROW 2: AZIMUTH AND GRADIENT OF THE TUNNEL (Note: GROUND COVER is removed as requested!) */}
            <div className="grid grid-cols-12 border-b border-black text-[10px]">
              <div className="col-span-2 border-r border-black px-2 py-1.5 font-bold flex items-center leading-tight">
                AZIMUTH AND GRADIENT OF THE TUNNEL
              </div>
              <div className="col-span-10 flex flex-col justify-center px-3 py-1 relative">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span>DRIVE DIRECTION</span>
                  <span>
                    N {dominantAz.toFixed(0)}° &nbsp;|&nbsp; GRADIENT {dominantGrad}%
                  </span>
                  <span>→ EXCAVATION ADVANCE →</span>
                </div>
                {/* Show per-pull azimuth segments if there is any 1° variation */}
                <div className="flex w-full border-t border-black/40 mt-1 pt-0.5 text-[9px]">
                  {visiblePulls.map((p) => {
                    const wPct =
                      ((Math.min(endRd, p.toRd) - Math.max(startRd, p.fromRd)) / spanM) *
                      100;
                    return (
                      <div
                        key={p.id}
                        style={{ width: `${wPct}%` }}
                        className="border-r border-black/30 last:border-r-0 text-center truncate font-semibold"
                      >
                        N {p.driveAzimuthDeg}°
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ROW 3: CONVERGENCE-DIVERGENCE MAXIMUM RECORDED (mm) */}
            {sheetConfig.showConvergenceRow && (
              <div className="grid grid-cols-12 border-b border-black text-[10px]">
                <div className="col-span-2 border-r border-black px-2 py-1 font-bold leading-tight">
                  CONVERGENCE-DIVERGENCE MAXIMUM RECORDED (mm)
                </div>
                <div className="col-span-10 flex items-center">
                  {visiblePulls.map((p) => {
                    const wPct =
                      ((Math.min(endRd, p.toRd) - Math.max(startRd, p.fromRd)) / spanM) *
                      100;
                    return (
                      <div
                        key={p.id}
                        style={{ width: `${wPct}%` }}
                        className="border-r border-black/30 last:border-r-0 text-center py-1 text-[9.5px]"
                      >
                        {p.convergenceMm || '0 mm'}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ROW 4: TUNNEL CROSS SECTION (LEFT) + UNFOLDED STRIP GEOLOGICAL MAP (CENTER) */}
            <div className="grid grid-cols-12 border-b-2 border-black">
              {/* Left Cross-Section Schematic with Convergence Points A, B, C, E, F */}
              <div className="col-span-2 border-r border-black p-2 flex flex-col items-center justify-between bg-white">
                <div className="w-full flex justify-end text-[8.5px] font-semibold">
                  <span>SPRING LINE ---</span>
                </div>
                <svg viewBox="0 0 170 185" className="w-full max-w-[155px] h-auto">
                  {/* Circular / Horseshoe Tunnel Section with Radial Hatching */}
                  <circle
                    cx="85"
                    cy="85"
                    r="58"
                    fill="none"
                    stroke="#000"
                    strokeWidth="1.6"
                  />
                  <circle
                    cx="85"
                    cy="85"
                    r="52"
                    fill="none"
                    stroke="#000"
                    strokeWidth="1"
                  />
                  {/* Invert Flat Base */}
                  <line x1="42" y1="122" x2="128" y2="122" stroke="#000" strokeWidth="1.4" />
                  {/* Center Crosshair Axes */}
                  <line
                    x1="20"
                    y1="85"
                    x2="150"
                    y2="85"
                    stroke="#000"
                    strokeWidth="0.7"
                    strokeDasharray="4,2"
                  />
                  <line
                    x1="85"
                    y1="20"
                    x2="85"
                    y2="145"
                    stroke="#000"
                    strokeWidth="0.7"
                    strokeDasharray="4,2"
                  />
                  {/* Dimension Lines */}
                  <line x1="33" y1="142" x2="137" y2="142" stroke="#000" strokeWidth="0.8" />
                  <text x="85" y="152" textAnchor="middle" fontSize="8" fontWeight="700">
                    {(dataset.tunnelDiameterWidthM || 6.4).toFixed(2)}m
                  </text>
                  {/* Convergence Measurement Points A, B, C, E, F */}
                  <circle cx="85" cy="33" r="2.2" fill="#000" />
                  <text x="85" y="27" textAnchor="middle" fontSize="8.5" fontWeight="800">
                    A
                  </text>
                  <circle cx="132" cy="64" r="2.2" fill="#000" />
                  <text x="141" y="67" fontSize="8.5" fontWeight="800">
                    B
                  </text>
                  <circle cx="132" cy="105" r="2.2" fill="#000" />
                  <text x="141" y="108" fontSize="8.5" fontWeight="800">
                    F
                  </text>
                  <circle cx="38" cy="64" r="2.2" fill="#000" />
                  <text x="27" y="67" fontSize="8.5" fontWeight="800">
                    C
                  </text>
                  <circle cx="38" cy="105" r="2.2" fill="#000" />
                  <text x="27" y="108" fontSize="8.5" fontWeight="800">
                    E
                  </text>
                  <text x="85" y="170" textAnchor="middle" fontSize="9.5" fontWeight="800">
                    {dataset.tunnelLocationName}
                  </text>
                  <text x="85" y="180" textAnchor="middle" fontSize="8" fontWeight="600">
                    CROSS SECTION (SCALE {sheetConfig.drawingScaleLabel})
                  </text>
                </svg>
                <div className="w-full text-[8px] font-bold leading-tight border-t border-black/30 pt-1">
                  A, B, C, E, F - CONVERGENCE MEASUREMENT POINTS
                </div>
              </div>

              {/* Center Unfolded Perimeter Geological Map */}
              <div className="col-span-10 relative bg-white">
                <svg
                  viewBox={`0 0 ${stripSvgW} ${stripSvgH}`}
                  className="w-full h-[295px] block"
                  preserveAspectRatio="none"
                >
                  <defs>
                    {/* Dense Foliation Hatching Pattern matching the Power Tunnel PDF */}
                    <pattern
                      id="foliationHatch"
                      width="14"
                      height="14"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(-38)"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="14"
                        stroke="#334155"
                        strokeWidth="0.65"
                      />
                      <line
                        x1="7"
                        y1="0"
                        x2="7"
                        y2="14"
                        stroke="#475569"
                        strokeWidth="0.45"
                        strokeDasharray="5,2"
                      />
                    </pattern>
                    {/* Fractured / Shattered Rockmass Cross-Hatch */}
                    <pattern
                      id="fracturedHatch"
                      width="10"
                      height="10"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 0 10 L 10 0 M -2 2 L 2 -2 M 8 12 L 12 8"
                        stroke="#1e293b"
                        strokeWidth="0.9"
                      />
                      <path
                        d="M 0 0 L 10 10"
                        stroke="#334155"
                        strokeWidth="0.7"
                      />
                    </pattern>
                  </defs>

                  {/* Base Foliation Texture & Pull Seams across Mapped Pulls */}
                  {visiblePulls.map((p) => {
                    const x1 = rdToX(Math.max(startRd, p.fromRd));
                    const x2 = rdToX(Math.min(endRd, p.toRd));
                    if (p.status === 'MISSING_GAP') {
                      return (
                        <g key={p.id}>
                          <rect
                            x={x1}
                            y={0}
                            width={Math.max(1, x2 - x1)}
                            height={stripSvgH}
                            fill="#fef2f2"
                            stroke="#dc2626"
                            strokeDasharray="4,4"
                          />
                          <text
                            x={(x1 + x2) / 2}
                            y={stripSvgH / 2}
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight="700"
                            fill="#dc2626"
                          >
                            UNMAPPED PULL GAP ({p.fromRd}–{p.toRd}m)
                          </text>
                        </g>
                      );
                    }
                    return (
                      <g key={p.id}>
                        {activeLayers.foliationHatch && (
                          <rect
                            x={x1}
                            y={0}
                            width={Math.max(1, x2 - x1)}
                            height={stripSvgH}
                            fill="url(#foliationHatch)"
                            opacity={0.55}
                          />
                        )}
                        {activeLayers.pullSeams && (
                          <line
                            x1={x2}
                            y1={0}
                            x2={x2}
                            y2={stripSvgH}
                            stroke="#334155"
                            strokeWidth="0.8"
                            strokeDasharray="4,4"
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* Lithology / Quartz Vein (+ + +) / Fractured Rockmass Polygons */}
                  {activeLayers.lithology &&
                    dataset.lithologyZones.map((lz) => {
                      const pts = lz.polygon
                        .map((pt) => `${rdToX(pt.x).toFixed(1)},${perimToY(pt.y).toFixed(1)}`)
                        .join(' ');
                      const xs = lz.polygon.map((p) => rdToX(p.x));
                      const ys = lz.polygon.map((p) => perimToY(p.y));
                      const cx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
                      const cy = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);

                      return (
                        <g key={lz.id}>
                          <polygon
                            points={pts}
                            fill={
                              lz.isIntrusionBody
                                ? '#ffffff'
                                : lz.isFracturedZone
                                ? 'url(#fracturedHatch)'
                                : 'none'
                            }
                            stroke="#000"
                            strokeWidth={lz.isIntrusionBody ? 1.4 : 0.9}
                            strokeDasharray={lz.isIntrusionBody ? undefined : '6,3'}
                          />
                          {lz.isIntrusionBody && (
                            <text
                              x={cx}
                              y={cy}
                              textAnchor="middle"
                              fontSize="10"
                              fontWeight="800"
                              fill="#000"
                            >
                              + &nbsp; + &nbsp; +
                            </text>
                          )}
                          {lz.codeSymbol && !lz.isIntrusionBody && (
                            <g transform={`translate(${cx}, ${cy})`}>
                              <ellipse
                                cx="0"
                                cy="0"
                                rx="13"
                                ry="7.5"
                                fill="#fff"
                                stroke="#000"
                                strokeWidth="1"
                              />
                              <text
                                x="0"
                                y="2.8"
                                textAnchor="middle"
                                fontSize="8"
                                fontWeight="800"
                              >
                                {lz.codeSymbol}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                  {/* Upper & Lower SPRING LINE Dashed Reference Lines + Center Crown Axis */}
                  {activeLayers.springLines && (
                    <g>
                      <line
                        x1={0}
                        y1={stripSvgH * 0.22}
                        x2={stripSvgW}
                        y2={stripSvgH * 0.22}
                        stroke="#000"
                        strokeWidth="1.05"
                        strokeDasharray="8,4"
                      />
                      <line
                        x1={0}
                        y1={stripSvgH * 0.5}
                        x2={stripSvgW}
                        y2={stripSvgH * 0.5}
                        stroke="#000"
                        strokeWidth="0.85"
                        strokeDasharray="12,3,2,3"
                      />
                      <line
                        x1={0}
                        y1={stripSvgH * 0.78}
                        x2={stripSvgW}
                        y2={stripSvgH * 0.78}
                        stroke="#000"
                        strokeWidth="1.05"
                        strokeDasharray="8,4"
                      />
                    </g>
                  )}

                  {/* Subtle 1-Meter Vertical Grid Ticks */}
                  {activeLayers.grid1m &&
                    meterTicks.map((m) => {
                      const x = rdToX(m);
                      return (
                        <line
                          key={m}
                          x1={x}
                          y1={0}
                          x2={x}
                          y2={stripSvgH}
                          stroke="#000"
                          strokeWidth={m % 10 === 0 ? 0.6 : 0.25}
                          strokeOpacity={m % 10 === 0 ? 0.45 : 0.2}
                        />
                      );
                    })}

                  {/* Structural Traces (JS1 Foliation, JS2, JS3, Shear Zones, Faults) */}
                  {activeLayers.traces &&
                    dataset.traces.map((tr) => {
                      const activePts = getTracePoints(tr);
                      if (activePts.length < 2) return null;
                      const polyStr = activePts
                        .map((p) => `${rdToX(p.x).toFixed(1)},${perimToY(p.y).toFixed(1)}`)
                        .join(' ');

                      const isShearZone =
                        tr.structureType === 'Shear Zone' ||
                        tr.structureType === 'Fault' ||
                        tr.fillingThickness === '5~10cm' ||
                        tr.fillingThickness === '>10cm';
                      const isShearJoint = tr.structureType === 'Shear Joint (5-30mm)';

                      const midIdx = Math.floor(activePts.length / 2);
                      const pA = activePts[Math.max(0, midIdx - 1)];
                      const pB = activePts[Math.min(activePts.length - 1, midIdx)];
                      const mx = rdToX((pA.x + pB.x) / 2);
                      const my = perimToY((pA.y + pB.y) / 2);

                      return (
                        <g key={tr.id}>
                          {/* Optional Ghost Raw Trace when SPLIT_GHOST or aiRawGhost is active */}
                          {(aiViewMode === 'SPLIT_GHOST' || activeLayers.aiRawGhost) &&
                            tr.rawPoints &&
                            tr.rawPoints.length >= 2 && (
                              <polyline
                                points={tr.rawPoints
                                  .map(
                                    (p) =>
                                      `${rdToX(p.x).toFixed(1)},${perimToY(p.y).toFixed(1)}`
                                  )
                                  .join(' ')}
                                fill="none"
                                stroke="#ef4444"
                                strokeWidth="1.2"
                                strokeDasharray="3,3"
                                opacity={0.75}
                              />
                            )}

                          {/* Main Structural Trace */}
                          {isShearZone && (
                            <polyline
                              points={polyStr}
                              fill="none"
                              stroke="#000"
                              strokeWidth="5.2"
                              strokeOpacity="0.22"
                            />
                          )}
                          <polyline
                            points={polyStr}
                            fill="none"
                            stroke="#000"
                            strokeWidth={isShearZone ? 2.5 : isShearJoint ? 1.9 : 1.3}
                            strokeDasharray={
                              tr.structureType === 'Geological Boundary'
                                ? '8,3'
                                : tr.structureType === 'Lithological Boundary'
                                ? '4,3'
                                : undefined
                            }
                          />

                          {/* Strike & Dip Tick Callout Box */}
                          {activeLayers.strikeDipLabels && (
                            <g transform={`translate(${mx}, ${my})`}>
                              <line x1="-5" y1="0" x2="5" y2="0" stroke="#000" strokeWidth="1.3" />
                              <line x1="0" y1="0" x2="0" y2="6.5" stroke="#000" strokeWidth="1.3" />
                              <rect
                                x="3.5"
                                y="-10.5"
                                width="42"
                                height="10.5"
                                fill="#fff"
                                stroke="#000"
                                strokeWidth="0.6"
                              />
                              <text
                                x="24.5"
                                y="-3"
                                textAnchor="middle"
                                fontSize="7"
                                fontWeight="800"
                              >
                                {tr.setId}:{tr.dipDeg}°
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                  {/* Water Inflow & Seepage Symbols on Standard Sheet */}
                  {activeLayers.waterInflow &&
                    dataset.waterSymbols.map((ws) => {
                      if (ws.position.x < startRd || ws.position.x > endRd) return null;
                      const wx = rdToX(ws.position.x);
                      const wy = perimToY(ws.position.y);
                      return (
                        <g key={ws.id} transform={`translate(${wx}, ${wy})`}>
                          <circle
                            cx="0"
                            cy="0"
                            r="4.5"
                            fill="#ffffff"
                            stroke="#1d4ed8"
                            strokeWidth="1.4"
                          />
                          <line
                            x1="4.5"
                            y1="0"
                            x2="13"
                            y2="0"
                            stroke="#1d4ed8"
                            strokeWidth="1.3"
                          />
                          <polygon points="15,0 10.5,-2.5 10.5,2.5" fill="#1d4ed8" />
                          <text
                            x="17"
                            y="2.5"
                            fontSize="7.5"
                            fontWeight="800"
                            fill="#1d4ed8"
                          >
                            {ws.condition}
                          </text>
                        </g>
                      );
                    })}
                </svg>
              </div>
            </div>

            {/* ROW 5: ROCK TYPE AND DESCRIPTION (Auto-Adapting Height) */}
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1.5 font-bold flex items-center">
                ROCK TYPE AND DESCRIPTION
              </div>
              <div className="col-span-10 flex">
                {rockDescSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 px-2 py-1.5 flex items-center justify-center text-center font-semibold leading-tight"
                    >
                      {sp.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ROW 6: DEGREE OF WEATHERING */}
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold flex items-center">
                DEGREE OF WEATHERING
              </div>
              <div className="col-span-10 flex">
                {weatheringSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 px-2 py-1 text-center font-bold"
                    >
                      {sp.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ROW 7: INTACT ROCK STRENGTH (MPa) */}
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold flex items-center">
                INTACT ROCK STRENGTH (MPa)
              </div>
              <div className="col-span-10 flex">
                {ucsSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 px-2 py-1 text-center font-bold"
                    >
                      {sp.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ROW 8: ROCK MASS RATING (RMR) & ROCK QUALITY DESIGNATION (RQD) GRAPH (0 - 100) */}
            {sheetConfig.showRmrRqdGraph && (
              <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
                <div className="col-span-2 border-r border-black px-2 py-2 font-bold flex flex-col justify-center gap-1">
                  <div className="flex items-center justify-between">
                    <span>ROCK MASS RATING - RMR</span>
                    <span className="border-b-2 border-dashed border-black w-6 inline-block" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>ROCK QUALITY DESIGNATION - RQD</span>
                    <span className="border-b-2 border-black w-6 inline-block" />
                  </div>
                </div>
                <div className="col-span-10 relative h-20 bg-white">
                  <svg viewBox={`0 0 ${stripSvgW} 80`} className="w-full h-full overflow-visible">
                    {/* Horizontal 0..100 Grid Lines */}
                    {[20, 40, 60, 80, 100].map((val) => {
                      const y = 80 - (val / 100) * 72;
                      return (
                        <g key={val}>
                          <line
                            x1={0}
                            y1={y}
                            x2={stripSvgW}
                            y2={y}
                            stroke="#94a3b8"
                            strokeWidth="0.6"
                          />
                          <text x="-4" y={y + 3} textAnchor="end" fontSize="7.5" fontWeight="700">
                            {val}
                          </text>
                        </g>
                      );
                    })}
                    {/* RQD Solid Step Line */}
                    <polyline
                      fill="none"
                      stroke="#000"
                      strokeWidth="1.6"
                      points={visiblePulls
                        .flatMap((p) => {
                          const x1 = rdToX(Math.max(startRd, p.fromRd));
                          const x2 = rdToX(Math.min(endRd, p.toRd));
                          const rqd = p.rqdValue ?? 70;
                          const y = 80 - (rqd / 100) * 72;
                          return [`${x1.toFixed(1)},${y.toFixed(1)}`, `${x2.toFixed(1)},${y.toFixed(1)}`];
                        })
                        .join(' ')}
                    />
                    {/* RMR Dashed Step Line */}
                    <polyline
                      fill="none"
                      stroke="#000"
                      strokeWidth="1.6"
                      strokeDasharray="6,4"
                      points={visiblePulls
                        .flatMap((p) => {
                          const x1 = rdToX(Math.max(startRd, p.fromRd));
                          const x2 = rdToX(Math.min(endRd, p.toRd));
                          const rmr = p.rmrValue ?? 60;
                          const y = 80 - (rmr / 100) * 72;
                          return [`${x1.toFixed(1)},${y.toFixed(1)}`, `${x2.toFixed(1)},${y.toFixed(1)}`];
                        })
                        .join(' ')}
                    />
                  </svg>
                </div>
              </div>
            )}

            {/* ROW 9: GROUND WATER CONDITION */}
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold flex items-center">
                GROUND WATER CONDITION
              </div>
              <div className="col-span-10 flex">
                {waterSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 px-2 py-1 text-center font-bold"
                    >
                      {sp.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ROW 10: ROCKMASS DESCRIPTION (STRUCTURE + FOLIATION JOINTS' CHARACTERISTICS) */}
            <div className="grid grid-cols-12 border-b border-black text-[9px]">
              <div className="col-span-2 border-r border-black flex flex-col">
                <div className="px-2 py-2 border-b border-black flex-1 flex flex-col justify-center">
                  <div className="font-bold">STRUCTURE</div>
                  <div className="text-[8px] text-slate-700">
                    Joints, Shear Zones, Fracture Zones, Faults
                  </div>
                </div>
                <div className="px-2 py-2 flex-1 flex flex-col justify-center">
                  <div className="font-bold">FOLIATION JOINTS&apos; CHARACTERISTICS</div>
                  <div className="text-[8px] text-slate-700">
                    Spacing, Persistence, Aperture, Roughness, Infilling
                  </div>
                </div>
              </div>
              <div className="col-span-10 flex flex-col">
                <div className="flex border-b border-black flex-1">
                  {structureSpans.map((sp, i) => {
                    const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                    return (
                      <div
                        key={i}
                        style={{ width: `${wPct}%` }}
                        className="border-r border-black last:border-r-0 p-1.5 text-[8.5px] leading-snug font-medium"
                      >
                        {sp.text}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-1">
                  {foliationSpans.map((sp, i) => {
                    const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                    return (
                      <div
                        key={i}
                        style={{ width: `${wPct}%` }}
                        className="border-r border-black last:border-r-0 p-1.5 text-[8.5px] leading-snug font-medium"
                      >
                        {sp.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ROW 11: GEOLOGICAL OVERBREAK (m³) */}
            {sheetConfig.showOverbreakRow && (
              <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
                <div className="col-span-2 border-r border-black px-2 py-1.5 font-bold flex items-center">
                  GEOLOGICAL OVERBREAK
                </div>
                <div className="col-span-10 flex flex-col">
                  <div className="text-center font-bold border-b border-black/50 py-0.5 text-[9px] bg-slate-50">
                    TOTAL {totalOverbreakM3.toFixed(3)} m³
                  </div>
                  <div className="flex">
                    {visiblePulls.map((p) => {
                      const wPct =
                        ((Math.min(endRd, p.toRd) - Math.max(startRd, p.fromRd)) / spanM) *
                        100;
                      return (
                        <div
                          key={p.id}
                          style={{ width: `${wPct}%` }}
                          className="border-r border-black last:border-r-0 py-1 text-center font-semibold text-[9px]"
                        >
                          {(p.overbreakVolumeM3 || 0) > 0
                            ? `${(p.overbreakVolumeM3 || 0).toFixed(3)}m³`
                            : '0m³'}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ROW 12: EXCAVATION DEFINING NO., RATE OF EXCAVATION, EXCAVATION / SUPPORT CLASS */}
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold">
                EXCAVATION DEFINING NO.
              </div>
              <div className="col-span-10 text-center py-1 font-bold">
                {visiblePulls[0]?.excavationDefiningNo || '2'}
              </div>
            </div>
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold">
                RATE OF EXCAVATION
              </div>
              <div className="col-span-10 flex">
                {dateSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 py-1 text-center font-semibold"
                    >
                      ◄─── {sp.text} ───►
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-12 border-b border-black text-[9.5px]">
              <div className="col-span-2 border-r border-black px-2 py-1 font-bold">
                EXCAVATION CLASS/SUPPORT CLASS
              </div>
              <div className="col-span-10 flex">
                {supportClassSpans.map((sp, i) => {
                  const wPct = ((sp.toRd - sp.fromRd) / spanM) * 100;
                  return (
                    <div
                      key={i}
                      style={{ width: `${wPct}%` }}
                      className="border-r border-black last:border-r-0 py-1 text-center font-bold"
                    >
                      {sp.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ROW 13: SUPPORT INSTALLED (a..e) */}
            {sheetConfig.showSupportDetailsRows && (
              <div className="border-b border-black text-[9px]">
                <div className="grid grid-cols-12 border-b border-black/40">
                  <div className="col-span-2 border-r border-black px-2 py-1 font-bold">
                    SUPPORT INSTALLED: a) SHOTCRETE
                  </div>
                  <div className="col-span-10 flex">
                    {shotcreteSpans.map((sp, i) => (
                      <div
                        key={i}
                        style={{ width: `${((sp.toRd - sp.fromRd) / spanM) * 100}%` }}
                        className="border-r border-black last:border-r-0 py-1 text-center font-semibold"
                      >
                        {sp.text}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-12 border-b border-black/40">
                  <div className="col-span-2 border-r border-black px-2 py-1 font-bold pl-6">
                    b) WIRE MESH
                  </div>
                  <div className="col-span-10 flex">
                    {meshSpans.map((sp, i) => (
                      <div
                        key={i}
                        style={{ width: `${((sp.toRd - sp.fromRd) / spanM) * 100}%` }}
                        className="border-r border-black last:border-r-0 py-1 text-center font-semibold"
                      >
                        {sp.text}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-12 border-b border-black/40">
                  <div className="col-span-2 border-r border-black px-2 py-1 font-bold pl-6">
                    c) ROCK BOLTS (NUMBER/LENGTH)
                  </div>
                  <div className="col-span-10 flex">
                    {boltSpans.map((sp, i) => (
                      <div
                        key={i}
                        style={{ width: `${((sp.toRd - sp.fromRd) / spanM) * 100}%` }}
                        className="border-r border-black last:border-r-0 py-1 text-center font-semibold"
                      >
                        {sp.text}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-12 border-b border-black/40">
                  <div className="col-span-2 border-r border-black px-2 py-1 font-bold pl-6">
                    d) STEEL RIBS (SPACING)
                  </div>
                  <div className="col-span-10 py-1 text-center text-slate-600">-</div>
                </div>
                <div className="grid grid-cols-12">
                  <div className="col-span-2 border-r border-black px-2 py-1 font-bold pl-6">
                    e) FOREPOLING (NUMBER/LENGTH)
                  </div>
                  <div className="col-span-10 py-1 text-center text-slate-600">-</div>
                </div>
              </div>
            )}

            {/* ROW 14: PHOTOGRAPHIC RECORDS */}
            {sheetConfig.showPhotoRecordsRow && (
              <div className="grid grid-cols-12 border-b border-black text-[9px]">
                <div className="col-span-2 border-r border-black px-2 py-1 font-bold flex items-center justify-between">
                  <span>PHOTOGRAPHIC RECORDS:</span>
                  <span className="text-[8px] text-right">
                    ROLL NO.
                    <br />
                    NEGATIVE NO.
                  </span>
                </div>
                <div className="col-span-10 flex">
                  {visiblePulls.map((p) => {
                    const wPct =
                      ((Math.min(endRd, p.toRd) - Math.max(startRd, p.fromRd)) / spanM) *
                      100;
                    return (
                      <div
                        key={p.id}
                        style={{ width: `${wPct}%` }}
                        className="border-r border-black/30 last:border-r-0 py-1 text-center text-[8.5px]"
                      >
                        {p.photoRollNo ? (
                          <div>
                            <div className="font-bold border-b border-black/40 inline-block px-1">
                              {p.photoRollNo}
                            </div>
                            <div>{p.photoNegativeNo}</div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ROW 15: REMARKS & BOTTOM NOTES */}
            <div className="grid grid-cols-12 border-b border-black text-[9px]">
              <div className="col-span-2 border-r border-black px-2 py-1.5 font-bold">
                REMARKS
              </div>
              <div className="col-span-10 px-2 py-1.5">
                {visiblePulls.find((p) => p.remarks)?.remarks || '-'}
              </div>
            </div>

            <div className="p-2.5 text-[8.5px] flex items-end justify-between gap-4 flex-1 bg-white">
              <div className="space-y-0.5">
                <div className="font-bold text-[9.5px] underline">Note:</div>
                {dataset.narrativeBullets.map((b, idx) => (
                  <div key={idx} className="leading-snug">
                    • {b}
                  </div>
                ))}
              </div>
              <div className="border-2 border-black px-3 py-2 text-center font-bold text-[9.5px] shrink-0">
                <div>APPROVED</div>
                <div className="text-[8.5px] font-semibold mt-0.5">BY ENGINEER / CLIENT</div>
              </div>
            </div>
          </div>

          {/* ==============================================================
              RIGHT SIDEBAR: LEGEND, ISRM TABLES, KEY PLAN & TITLE BLOCK (col-span-3)
             ============================================================== */}
          <div className="col-span-3 flex flex-col justify-between text-[8.5px]">
            {/* 1. STRUCTURAL & GEOLOGICAL LEGEND */}
            <div className="p-2.5 border-b border-black space-y-1">
              <div className="font-black text-[10px] underline mb-1">LEGEND:</div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 border-b-2 border-black" />
                <div className="col-span-8">GEOLOGICAL BOUNDARY</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 border-b border-dashed border-black" />
                <div className="col-span-8">LITHOLOGICAL BOUNDARY</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 font-bold">JS1 ───</div>
                <div className="col-span-8">FOLIATION &amp; MAIN JOINT SETS (JS1, JS2, JS3)</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 border border-black text-center font-bold text-[8px]">
                  + + +
                </div>
                <div className="col-span-8">QUARTZ VEINS</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 font-bold">┬ 60°</div>
                <div className="col-span-8">DIP DIRECTION / DIP ANGLE IN DEGREES</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 border-b-2 border-black" />
                <div className="col-span-8">SHEAR JOINT (5–30mm THICK)</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 font-bold tracking-tighter">+++++</div>
                <div className="col-span-8">SHEAR ZONE / FRACTURED ROCKMASS</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 font-bold text-red-700">───►</div>
                <div className="col-span-8">FAULT (DIRECTION OF RELATIVE MOVEMENT)</div>
              </div>
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-4 font-bold text-blue-700">○─►</div>
                <div className="col-span-8">WATER INFLOW</div>
              </div>
            </div>

            {/* 2. SYMBOLS, INTACT ROCK STRENGTH, WEATHERING & GROUNDWATER */}
            <div className="p-2 border-b border-black grid grid-cols-2 gap-2 text-[7.5px]">
              <div>
                <div className="font-bold underline mb-0.5">SYMBOLS:</div>
                <div>Qtz — QUARTZITE</div>
                <div>Ph — PHYLLITE</div>
                <div>Mm — METASANDSTONE</div>
                <div>Ms — MICA SCHIST</div>
                <div>QP — QUARTZITIC PHYLLITE</div>
                <div>PQ — PHYLLITIC QUARTZITE</div>
              </div>
              <div>
                <div className="font-bold underline mb-0.5">INTACT ROCK STRENGTH:</div>
                <div>EXTREMELY STRONG &gt;250 MPa</div>
                <div>VERY STRONG 100–250 MPa</div>
                <div>STRONG 50–100 MPa</div>
                <div>MEDIUM STRONG 25–50 MPa</div>
                <div>WEAK 5–25 MPa</div>
              </div>
              <div>
                <div className="font-bold underline mb-0.5">DEGREE OF WEATHERING:</div>
                <div>W1 — FRESH ROCK</div>
                <div>W2 — SLIGHTLY WEATHERED</div>
                <div>W3 — MODERATELY WEATHERED</div>
                <div>W4 — HIGHLY WEATHERED</div>
                <div>W5 — COMPLETELY WEATHERED</div>
              </div>
              <div>
                <div className="font-bold underline mb-0.5">GROUND WATER INFLOW:</div>
                <div>DRY — 0 l/min</div>
                <div>DAMP — &lt;10 l/min</div>
                <div>WET — 10–25 l/min</div>
                <div>DRIPPING — 25–125 l/min</div>
                <div>FLOWING — &gt;125 l/min</div>
              </div>
            </div>

            {/* 3. KEY PLAN WITH NORTH ARROW */}
            {sheetConfig.showKeyPlan && (
              <div className="p-2 border-b border-black">
                <svg viewBox="0 0 240 90" className="w-full h-20">
                  {/* North Rose */}
                  <g transform="translate(28, 26)">
                    <circle cx="0" cy="0" r="12" fill="none" stroke="#000" strokeWidth="0.8" />
                    <line x1="-16" y1="0" x2="16" y2="0" stroke="#000" strokeWidth="0.8" />
                    <line x1="0" y1="-16" x2="0" y2="16" stroke="#000" strokeWidth="0.8" />
                    <polygon points="0,-16 -3,-4 3,-4" fill="#000" />
                    <text x="0" y="-18" textAnchor="middle" fontSize="7" fontWeight="800">
                      N
                    </text>
                  </g>
                  {/* Schematic Key Plan Tunnel Alignment */}
                  <polyline
                    points="25,70 95,55 175,35 220,22"
                    fill="none"
                    stroke="#000"
                    strokeWidth="2"
                  />
                  <rect
                    x="105"
                    y="40"
                    width="45"
                    height="12"
                    fill="#000"
                    fillOpacity="0.18"
                    stroke="#000"
                    strokeWidth="1"
                  />
                  <text x="127" y="36" textAnchor="middle" fontSize="6.5" fontWeight="800">
                    MAPPED ZONE
                  </text>
                  <text x="120" y="84" textAnchor="middle" fontSize="8.5" fontWeight="800">
                    KEY PLAN (1 : 100)
                  </text>
                </svg>
              </div>
            )}

            {/* 4. ADAPTABLE CLIENT / CONSULTANT / CONTRACTOR TITLE BLOCK */}
            <div className="flex flex-col text-center">
              <div className="p-2 border-b border-black">
                {sheetConfig.clientLogoUrl && (
                  <img
                    src={sheetConfig.clientLogoUrl}
                    alt="Client"
                    className="h-8 mx-auto mb-1 object-contain"
                  />
                )}
                <div className="font-black text-xs uppercase">
                  {sheetConfig.clientLogoText}
                </div>
                <div className="text-[8px] font-semibold">{sheetConfig.clientSubtitle}</div>
              </div>
              <div className="p-1.5 border-b border-black font-bold text-[9px] uppercase">
                <div>{sheetConfig.projectTitleLine1}</div>
                <div className="text-[8px]">{sheetConfig.projectTitleLine2}</div>
              </div>
              <div className="p-1.5 border-b border-black font-bold text-[8.5px]">
                {sheetConfig.consultantName}
              </div>
              <div className="p-2 border-b border-black">
                {sheetConfig.contractorLogoUrl && (
                  <img
                    src={sheetConfig.contractorLogoUrl}
                    alt="Contractor"
                    className="h-7 mx-auto mb-1 object-contain"
                  />
                )}
                <div className="font-black text-[9px] uppercase">
                  {sheetConfig.contractorName}
                </div>
              </div>

              {/* Drawing Metadata Grid */}
              <div className="grid grid-cols-3 border-b border-black text-[7.5px]">
                <div className="border-r border-black p-1">
                  <div className="text-slate-600">LOCATION</div>
                  <div className="font-bold">{dataset.tunnelLocationName}</div>
                </div>
                <div className="border-r border-black p-1">
                  <div className="text-slate-600">TYPE OF DWG.</div>
                  <div className="font-bold">AS BUILT ENG. GEOLOGICAL MAP</div>
                </div>
                <div className="p-1">
                  <div className="text-slate-600">CHAINAGE</div>
                  <div className="font-bold">
                    CH. {startRd}m TO {endRd}m
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 text-[7.5px]">
                <div className="border-r border-black p-1 text-left space-y-0.5">
                  <div>
                    COMPILED: <span className="font-bold">{sheetConfig.compiledBy}</span>
                  </div>
                  <div>
                    DRAWN: <span className="font-bold">{sheetConfig.drawnBy}</span>
                  </div>
                  <div>
                    CHECKED: <span className="font-bold">{sheetConfig.checkedBy}</span>
                  </div>
                  <div>
                    APPROVED: <span className="font-bold">{sheetConfig.approvedBy}</span>
                  </div>
                </div>
                <div className="p-1 flex flex-col justify-between text-left">
                  <div>
                    SCALE: <span className="font-bold">{sheetConfig.drawingScaleLabel}</span>
                  </div>
                  <div>
                    DWG NO.: <span className="font-bold">{sheetConfig.drawingNumber}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Multi-Page Realistic Smooth Drive Strip Sheets with Page-to-Page Alignment Markers
  const renderMultiPageRealisticSheet = (pageObj: {
    pageNumber: number;
    startRd: number;
    endRd: number;
  }) => {
    const { pageNumber, startRd, endRd } = pageObj;
    const isFirstPage = pageNumber === 1;
    const totalPages = multiPages.length;
    const pageSpanM = Math.max(2, endRd - startRd);

    const svgW = 1180;
    const svgH = 420;
    const padX = 110;
    const usableW = svgW - padX * 2;
    const stripH = 220;
    const pxPerRdM = usableW / pageSpanM;

    const ribbon = buildSmoothRibbonTransform(
      dataset.pulls,
      startRd,
      endRd,
      totalPerimM,
      padX,
      svgH / 2,
      pxPerRdM,
      stripH,
      3.2
    );

    const topWallPoints = ribbon.samples
      .map((s) => {
        const pt = ribbon.mapRdPerimToSvg(s.rd, 0);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');
    const bottomWallPoints = [...ribbon.samples]
      .reverse()
      .map((s) => {
        const pt = ribbon.mapRdPerimToSvg(s.rd, totalPerimM);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');
    const fullRibbonPolygon = `${topWallPoints} ${bottomWallPoints}`;

    // Left & Right Alignment Match Points (A = Top Wall, B = Centerline, C = Bottom Wall)
    const leftMatchTop = ribbon.mapRdPerimToSvg(startRd, 0);
    const leftMatchMid = ribbon.mapRdPerimToSvg(startRd, totalPerimM * 0.5);
    const leftMatchBot = ribbon.mapRdPerimToSvg(startRd, totalPerimM);

    const rightMatchTop = ribbon.mapRdPerimToSvg(endRd, 0);
    const rightMatchMid = ribbon.mapRdPerimToSvg(endRd, totalPerimM * 0.5);
    const rightMatchBot = ribbon.mapRdPerimToSvg(endRd, totalPerimM);

    const startSample = ribbon.getSampleAtRd(startRd);
    const endSample = ribbon.getSampleAtRd(endRd);

    // 1-Meter Chainage ticks along the curved strip
    const meterTicks: number[] = [];
    for (let m = Math.ceil(startRd); m <= Math.floor(endRd); m += 1) {
      meterTicks.push(m);
    }

    return (
      <div
        key={pageNumber}
        className="bg-white text-black border-2 border-black shadow-2xl mx-auto w-full max-w-[1480px] mb-8 print:shadow-none print:mb-0 print:break-after-page p-4 font-sans"
      >
        {/* Top Sheet Header & Multi-Page Arrangement Index */}
        <div className="flex flex-wrap items-center justify-between border-b-2 border-black pb-2 mb-3 gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wider">
              {sheetConfig.projectTitleLine1} — {dataset.tunnelLocationName}
            </div>
            <div className="text-sm font-black text-slate-900">
              CONTINUOUS REALISTIC 3D STRIP LOG — SHEET {pageNumber} OF {totalPages} (CH.{' '}
              {startRd.toFixed(1)}m TO {endRd.toFixed(1)}m)
            </div>
          </div>

          {/* Visual Multi-Page Arrangement Diagram showing how all sheets connect */}
          <div className="flex items-center gap-1.5 border border-black px-2.5 py-1 bg-slate-50">
            <span className="text-[9px] font-bold uppercase mr-1">
              Sheet Arrangement &amp; Alignment Key:
            </span>
            {multiPages.map((mp) => (
              <div key={mp.pageNumber} className="flex items-center">
                <div
                  className={`px-2 py-0.5 text-[9px] font-bold border border-black ${
                    mp.pageNumber === pageNumber
                      ? 'bg-black text-white'
                      : 'bg-white text-black'
                  }`}
                >
                  P.{mp.pageNumber} ({mp.startRd}–{mp.endRd}m)
                </div>
                {mp.pageNumber < totalPages && (
                  <span className="text-[9px] font-black mx-0.5">⊕─</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Page 1 Includes Full Master Project Metadata, Cross-Section & Legend Header */}
        {isFirstPage && (
          <div className="grid grid-cols-12 gap-3 border-2 border-black p-2.5 mb-3 bg-slate-50/50 text-[9.5px]">
            <div className="col-span-4 border-r border-black pr-2 space-y-1">
              <div className="font-black text-[10px] underline">
                MASTER PROJECT DETAILS (PAGE 1 OF {totalPages}):
              </div>
              <div>
                <span className="font-bold">Client:</span> {sheetConfig.clientLogoText}
              </div>
              <div>
                <span className="font-bold">Consultant:</span> {sheetConfig.consultantName}
              </div>
              <div>
                <span className="font-bold">Contractor:</span> {sheetConfig.contractorName}
              </div>
              <div>
                <span className="font-bold">Total Drawing Range:</span> Ch.{' '}
                {validFromRd.toFixed(1)}m to {validToRd.toFixed(1)}m ({metersPerPage}m per
                sheet)
              </div>
            </div>
            <div className="col-span-5 border-r border-black pr-2 space-y-1">
              <div className="font-black text-[10px] underline">
                HOW TO ALIGN MULTI-PAGE PRINTED STRIPS:
              </div>
              <div>
                1. Every page has 3 precision registration crosshairs{' '}
                <span className="font-bold">
                  ⊕ ALIGN-TOP (A), ⊕ ALIGN-CENTER (B), ⊕ ALIGN-BOT (C)
                </span>{' '}
                at the exact start and end chainage seams.
              </div>
              <div>
                2. Match the right-hand markers <span className="font-bold">⊕ M-{pageNumber}R</span>{' '}
                of Sheet {pageNumber} directly onto the left-hand markers{' '}
                <span className="font-bold">⊕ M-{pageNumber + 1}L</span> of Sheet{' '}
                {pageNumber + 1} to form a continuous realistic curved tunnel strip.
              </div>
            </div>
            <div className="col-span-3 flex flex-col justify-between">
              <div className="font-black text-[10px] underline">LEGEND SUMMARY:</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8.5px]">
                <div>─── JS1 Foliation</div>
                <div>━ ━ Shear Zone</div>
                <div>- - - Spring Line</div>
                <div>+ + + Quartz Vein</div>
                <div>⊕ Match Marker</div>
                <div>1m Single-Meter Scale</div>
              </div>
            </div>
          </div>
        )}

        {/* Smooth Realistic Curved Strip SVG with Left & Right Page Alignment Markers */}
        <div className="border-2 border-black bg-white relative">
          <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto block">
            {/* Background Smooth Curved Tunnel Strip Polygon */}
            <polygon
              points={fullRibbonPolygon}
              fill="#f8fafc"
              stroke="#000"
              strokeWidth="1.8"
            />

            {/* Smooth Curved Spring Lines (22% and 78% of Perimeter) & Centerline */}
            {[0.22, 0.5, 0.78].map((frac, idx) => {
              const pts = ribbon.samples
                .map((s) => {
                  const pt = ribbon.mapRdPerimToSvg(s.rd, totalPerimM * frac);
                  return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <polyline
                  key={idx}
                  points={pts}
                  fill="none"
                  stroke="#334155"
                  strokeWidth={idx === 1 ? 1.0 : 0.9}
                  strokeDasharray={idx === 1 ? '10,3,2,3' : '6,4'}
                />
              );
            })}

            {/* 1-Meter Single-Meter Chainage Scale Ticks & Labels Along Curved Top Wall */}
            {meterTicks.map((m) => {
              const topPt = ribbon.mapRdPerimToSvg(m, 0);
              const botPt = ribbon.mapRdPerimToSvg(m, totalPerimM);
              const s = ribbon.getSampleAtRd(m);
              const isMajor = m % 2 === 0;
              const tickLen = isMajor ? 12 : 6;
              const labelX = topPt.x - s.nx * (tickLen + 8);
              const labelY = topPt.y - s.ny * (tickLen + 8);

              return (
                <g key={m}>
                  {/* Cross-strip 1m grid line */}
                  <line
                    x1={topPt.x}
                    y1={topPt.y}
                    x2={botPt.x}
                    y2={botPt.y}
                    stroke="#64748b"
                    strokeWidth={m % 5 === 0 ? 0.9 : 0.35}
                    strokeDasharray={m % 5 === 0 ? undefined : '2,3'}
                  />
                  {/* Outer 1m ruler tick */}
                  <line
                    x1={topPt.x}
                    y1={topPt.y}
                    x2={topPt.x - s.nx * tickLen}
                    y2={topPt.y - s.ny * tickLen}
                    stroke="#000"
                    strokeWidth={isMajor ? 1.4 : 0.8}
                  />
                  {isMajor && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="800"
                      fill="#000"
                    >
                      {m}m
                    </text>
                  )}
                </g>
              );
            })}

            {/* Smoothly Mapped Structural Traces clipped to this page's chainage range */}
            {dataset.traces.map((tr) => {
              const pts = getTracePoints(tr).filter(
                (p) => p.x >= startRd - 1 && p.x <= endRd + 1
              );
              if (pts.length < 2) return null;
              const mappedStr = pts
                .map((p) => {
                  const clpX = Math.max(startRd, Math.min(endRd, p.x));
                  const svgPt = ribbon.mapRdPerimToSvg(clpX, p.y);
                  return `${svgPt.x.toFixed(1)},${svgPt.y.toFixed(1)}`;
                })
                .join(' ');
              const mid = pts[Math.floor(pts.length / 2)];
              const midSvg = ribbon.mapRdPerimToSvg(
                Math.max(startRd, Math.min(endRd, mid.x)),
                mid.y
              );

              return (
                <g key={tr.id}>
                  <polyline
                    points={mappedStr}
                    fill="none"
                    stroke="#000"
                    strokeWidth={tr.structureType.includes('Shear') ? 2.4 : 1.5}
                  />
                  <text
                    x={midSvg.x}
                    y={midSvg.y - 5}
                    textAnchor="middle"
                    fontSize="8.5"
                    fontWeight="800"
                    fill="#000"
                  >
                    {tr.setId} ({tr.orientationLabel})
                  </text>
                </g>
              );
            })}

            {/* LEFT PAGE ALIGNMENT MARKERS (⊕ M-L Top, Center, Bottom) */}
            {[
              { pt: leftMatchTop, code: `M${pageNumber}-L(TOP)` },
              { pt: leftMatchMid, code: `M${pageNumber}-L(CL)` },
              { pt: leftMatchBot, code: `M${pageNumber}-L(BOT)` },
            ].map((mk, idx) => (
              <g key={idx} transform={`translate(${mk.pt.x}, ${mk.pt.y})`}>
                <circle cx="0" cy="0" r="7" fill="#fff" stroke="#dc2626" strokeWidth="1.6" />
                <line x1="-10" y1="0" x2="10" y2="0" stroke="#dc2626" strokeWidth="1.4" />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#dc2626" strokeWidth="1.4" />
                <text
                  x="-14"
                  y="3"
                  textAnchor="end"
                  fontSize="8.5"
                  fontWeight="800"
                  fill="#dc2626"
                >
                  {mk.code}
                </text>
              </g>
            ))}

            {/* RIGHT PAGE ALIGNMENT MARKERS (⊕ M-R Top, Center, Bottom) */}
            {[
              { pt: rightMatchTop, code: `M${pageNumber}-R(TOP)` },
              { pt: rightMatchMid, code: `M${pageNumber}-R(CL)` },
              { pt: rightMatchBot, code: `M${pageNumber}-R(BOT)` },
            ].map((mk, idx) => (
              <g key={idx} transform={`translate(${mk.pt.x}, ${mk.pt.y})`}>
                <circle cx="0" cy="0" r="7" fill="#fff" stroke="#2563eb" strokeWidth="1.6" />
                <line x1="-10" y1="0" x2="10" y2="0" stroke="#2563eb" strokeWidth="1.4" />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#2563eb" strokeWidth="1.4" />
                <text
                  x="14"
                  y="3"
                  textAnchor="start"
                  fontSize="8.5"
                  fontWeight="800"
                  fill="#2563eb"
                >
                  {mk.code}
                </text>
              </g>
            ))}

            {/* Left & Right Join Instructions */}
            {pageNumber > 1 && (
              <text
                x={leftMatchMid.x - 16}
                y={leftMatchMid.y - 22}
                textAnchor="end"
                fontSize="9"
                fontWeight="800"
                fill="#dc2626"
              >
                ◀ JOIN SHEET {pageNumber - 1} AT CH. {startRd}m (AZ {startSample.azimuthDeg.toFixed(1)}°N)
              </text>
            )}
            {pageNumber < totalPages && (
              <text
                x={rightMatchMid.x + 16}
                y={rightMatchMid.y - 22}
                textAnchor="start"
                fontSize="9"
                fontWeight="800"
                fill="#2563eb"
              >
                JOIN SHEET {pageNumber + 1} AT CH. {endRd}m (AZ {endSample.azimuthDeg.toFixed(1)}°N) ▶
              </text>
            )}
          </svg>
        </div>

        {/* Bottom Alignment Verification Footer */}
        <div className="flex items-center justify-between text-[9.5px] font-bold border-t border-black pt-2 mt-2">
          <div>
            START SEAM: CH. {startRd.toFixed(1)}m | DRIVE AZIMUTH: N{' '}
            {startSample.azimuthDeg.toFixed(1)}°
          </div>
          <div>
            SCALE: 1-METER TRUE CHAINAGE RULER | SMOOTH SPLINE CURVATURE ENABLED
          </div>
          <div>
            END SEAM: CH. {endRd.toFixed(1)}m | DRIVE AZIMUTH: N{' '}
            {endSample.azimuthDeg.toFixed(1)}°
          </div>
        </div>
      </div>
    );
  };

  // Render Entire Project Multi-Tunnel Intersection Network Printable Sheet
  const renderProjectNetworkSheet = () => {
    const allInProj =
      projectDatasets && projectDatasets.length > 0 ? projectDatasets : [dataset];
    const { positionedStrips, aiCrossProjections } =
      buildProjectNetworkCanvasLayout(allInProj, 17);

    return (
      <div className="bg-white text-black border-2 border-black shadow-2xl mx-auto w-full max-w-[1520px] p-4 font-sans">
        <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-3">
          <div>
            <div className="text-xs font-black uppercase">
              {sheetConfig.projectTitleLine1} — MASTER INTERSECTING TUNNEL NETWORK
            </div>
            <div className="text-sm font-black">
              ENTIRE PROJECT 3D UNFOLDED STRIP NETWORK &amp; JUNCTION ALIGNMENT MAP (
              {positionedStrips.length} TUNNEL LOCATIONS)
            </div>
          </div>
          <div className="text-right text-[10px] font-bold">
            <div>CLIENT: {sheetConfig.clientLogoText}</div>
            <div>CONTRACTOR: {sheetConfig.contractorName}</div>
          </div>
        </div>

        <div className="border-2 border-black bg-white">
          <svg viewBox="0 0 1380 860" className="w-full h-auto block">
            {/* AI Cross-Tunnel Projected Structure Lines */}
            {aiCrossProjections.map((proj) => (
              <g key={proj.id}>
                <line
                  x1={proj.fromPtSvg.x}
                  y1={proj.fromPtSvg.y}
                  x2={proj.toPtSvg.x}
                  y2={proj.toPtSvg.y}
                  stroke="#9333ea"
                  strokeWidth="1.6"
                  strokeDasharray="6,4"
                />
                <text
                  x={(proj.fromPtSvg.x + proj.toPtSvg.x) / 2}
                  y={(proj.fromPtSvg.y + proj.toPtSvg.y) / 2 - 5}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="800"
                  fill="#7e22ce"
                >
                  AI 3D Projection: {proj.setId} ({proj.orientationLabel})
                </text>
              </g>
            ))}

            {/* All Positioned Intersecting Tunnel Strips */}
            {positionedStrips.map((pos) => {
              const topPts = pos.samples
                .map((s) => {
                  const p = pos.mapRdPerimToSvg(s.rd, 0);
                  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                })
                .join(' ');
              const botPts = [...pos.samples]
                .reverse()
                .map((s) => {
                  const p = pos.mapRdPerimToSvg(s.rd, pos.totalPerimM);
                  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                })
                .join(' ');
              const polyStr = `${topPts} ${botPts}`;
              const midSample = pos.samples[Math.floor(pos.samples.length / 2)];
              const titlePt = pos.mapRdPerimToSvg(
                midSample?.rd ?? pos.startRd,
                -1.8
              );

              return (
                <g key={pos.dataset.id}>
                  {/* Junction Portal Collar on Parent Wall */}
                  {pos.junctionPortal && (
                    <g>
                      <polygon
                        points={pos.junctionPortal.portalCornersSvg
                          .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
                          .join(' ')}
                        fill="#fef3c7"
                        stroke="#d97706"
                        strokeWidth="2"
                      />
                      <line
                        x1={pos.junctionPortal.portalCenterSvg.x}
                        y1={pos.junctionPortal.portalCenterSvg.y}
                        x2={pos.junctionPortal.branchStartCenterSvg.x}
                        y2={pos.junctionPortal.branchStartCenterSvg.y}
                        stroke="#d97706"
                        strokeWidth="2"
                        strokeDasharray="4,2"
                      />
                      <text
                        x={pos.junctionPortal.portalCenterSvg.x}
                        y={pos.junctionPortal.portalCenterSvg.y - 8}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="800"
                        fill="#b45309"
                      >
                        ⊗ {pos.junctionPortal.label}
                      </text>
                    </g>
                  )}

                  <polygon
                    points={polyStr}
                    fill="#f8fafc"
                    stroke="#000"
                    strokeWidth={pos.isTrunk ? '2.0' : '1.5'}
                  />

                  <text
                    x={titlePt.x}
                    y={titlePt.y}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="900"
                    fill="#000"
                  >
                    {pos.dataset.tunnelLocationName} (Ch. {pos.startRd}–{pos.endRd}m)
                  </text>

                  {/* Traces inside this strip */}
                  {pos.dataset.traces.map((tr) => {
                    const pts = getTracePoints(tr);
                    if (pts.length < 2) return null;
                    const tStr = pts
                      .map((p) => {
                        const s = pos.mapRdPerimToSvg(p.x, p.y);
                        return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <polyline
                        key={tr.id}
                        points={tStr}
                        fill="none"
                        stroke="#000"
                        strokeWidth="1.5"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`flex-1 flex flex-col overflow-hidden transition-colors ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0B101C] text-slate-100'
      }`}
    >
      {/* ====================================================================
          TOP EXPORT & SHEET STUDIO CONTROL BAR (Hidden on Print)
         ==================================================================== */}
      <div
        className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800 shadow-xs'
            : 'bg-[#11192B] border-[#283959] text-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onBackToCanvas}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              isLight
                ? 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-600'
            }`}
          >
            <ChevronLeft className="w-4 h-4 text-cyan-500" />
            Back to 3D Strip Canvas
          </button>

          {/* Choose Export Mode */}
          <div
            className={`flex items-center border rounded-lg p-0.5 ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#090E18] border-[#2D3E5E]'
            }`}
          >
            <button
              onClick={() => setExportMode('STANDARD_TEMPLATE_SHEET')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                exportMode === 'STANDARD_TEMPLATE_SHEET'
                  ? 'bg-cyan-600 text-white'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              1. Standard As-Built Sheet
            </button>
            <button
              onClick={() => setExportMode('FULL_REALISTIC_MULTIPAGE')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                exportMode === 'FULL_REALISTIC_MULTIPAGE'
                  ? 'bg-amber-600 text-white'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              2. Multi-Page Realistic Strip
            </button>
            <button
              onClick={() => setExportMode('PROJECT_NETWORK_MAP')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                exportMode === 'PROJECT_NETWORK_MAP'
                  ? 'bg-purple-600 text-white'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              3. Project Network Map
            </button>
          </div>

          {/* Chainage From -> To Selector */}
          <div
            className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : 'bg-[#152036] border-[#2E4268] text-slate-100'
            }`}
          >
            <span className="text-slate-400 text-[11px]">Chainage (m):</span>
            <input
              type="number"
              value={fromChainage}
              onChange={(e) => setFromChainage(parseFloat(e.target.value) || 0)}
              className={`w-16 px-1.5 py-0.5 border rounded-md font-bold text-center ${
                isLight
                  ? 'bg-white border-slate-300 text-cyan-700'
                  : 'bg-[#090E18] border-slate-600 text-cyan-300'
              }`}
            />
            <span className="text-slate-400">to</span>
            <input
              type="number"
              value={toChainage}
              onChange={(e) => setToChainage(parseFloat(e.target.value) || 30)}
              className={`w-16 px-1.5 py-0.5 border rounded-md font-bold text-center ${
                isLight
                  ? 'bg-white border-slate-300 text-cyan-700'
                  : 'bg-[#090E18] border-slate-600 text-cyan-300'
              }`}
            />
            <button
              onClick={() => {
                setFromChainage(minDatasetRd);
                setToChainage(maxDatasetRd);
              }}
              className={`px-2 py-0.5 text-[10px] rounded-md border cursor-pointer ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
              }`}
            >
              Full ({minDatasetRd}–{maxDatasetRd}m)
            </button>
          </div>

          {/* Meters Per Page (When Multi-Page Realistic Mode is Active) */}
          {exportMode === 'FULL_REALISTIC_MULTIPAGE' && (
            <div
              className={`flex items-center gap-2 border rounded-lg px-2.5 py-1 text-xs ${
                isLight
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
              }`}
            >
              <span className="text-[11px] font-bold">Meters / Page:</span>
              <select
                value={metersPerPage}
                onChange={(e) => {
                  setMetersPerPage(Number(e.target.value));
                  setActivePageIndex(0);
                }}
                className={`border font-bold px-2 py-0.5 rounded-md text-xs ${
                  isLight
                    ? 'bg-white border-amber-300 text-amber-800'
                    : 'bg-[#090E18] border-amber-500/50 text-amber-300'
                }`}
              >
                <option value={10}>10m per Page</option>
                <option value={15}>15m per Page</option>
                <option value={20}>20m per Page</option>
                <option value={25}>25m per Page</option>
                <option value={50}>50m per Page</option>
              </select>
              <span className="text-[11px] font-bold">
                ({multiPages.length} Pages)
              </span>
              <label className="flex items-center gap-1 text-[11px] cursor-pointer ml-1">
                <input
                  type="checkbox"
                  checked={printAllPagesTogether}
                  onChange={(e) => setPrintAllPagesTogether(e.target.checked)}
                />
                Show All {multiPages.length} Pages
              </label>
            </div>
          )}
        </div>

        {/* Right Actions: Sheet Layers, Zoom, Sheet Options / Logo Customizer, DXF, Print, Theme */}
        <div className="flex items-center gap-1.5">
          {/* Sheet Layer Visibility Popover */}
          <div className="relative">
            <button
              onClick={() => setShowSheetLayersPopover((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                showSheetLayersPopover
                  ? 'bg-cyan-600 border-cyan-400 text-white'
                  : isLight
                  ? 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
                  : 'bg-[#162238] border-[#2E4268] text-cyan-200 hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-cyan-500" />
              Sheet Layers
            </button>
            {showSheetLayersPopover && (
              <div
                className={`absolute right-0 mt-1.5 w-64 p-2.5 border rounded-xl shadow-2xl z-50 space-y-1 text-[10px] ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-800'
                    : 'bg-[#0E1628] border-cyan-500/50 text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-300/30 pb-1 font-bold text-cyan-500">
                  <span>SHEET LAYER VISIBILITY</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveLayers(DEFAULT_CAD_LAYERS)}
                      className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-500 hover:bg-cyan-500/25 text-[9px] cursor-pointer"
                    >
                      All On
                    </button>
                    <button
                      onClick={() => setShowSheetLayersPopover(false)}
                      className="text-slate-400 hover:text-rose-500 px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {[
                  { key: 'grid1m', label: '0_CHAINAGE_1M_GRID' },
                  { key: 'pullSeams', label: '1_PULL_SEAMS_AZIMUTH' },
                  { key: 'springLines', label: '2_SPRING_LINES_CROWN' },
                  { key: 'foliationHatch', label: '3_FOLIATION_HATCH_BG' },
                  { key: 'lithology', label: '4_LITHOLOGY_QUARTZ' },
                  { key: 'traces', label: '5_STRUCTURAL_TRACES' },
                  { key: 'strikeDipLabels', label: '6_STRIKE_DIP_CALLOUTS' },
                  { key: 'waterInflow', label: '7_WATER_INFLOW_SEEPAGE' },
                  { key: 'aiRawGhost', label: '8_AI_RAW_PHOTO_GHOST' },
                ].map((ly) => {
                  const isOn = activeLayers[ly.key as keyof CadLayerVisibilityState];
                  return (
                    <label
                      key={ly.key}
                      className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-slate-500/10 cursor-pointer"
                    >
                      <span className={isOn ? 'font-semibold' : 'text-slate-400 line-through'}>
                        {ly.label}
                      </span>
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() =>
                          setActiveLayers((prev) => ({
                            ...prev,
                            [ly.key]: !prev[ly.key as keyof CadLayerVisibilityState],
                          }))
                        }
                        className="rounded border-slate-400 text-cyan-600"
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sheet Zoom / Space Utilization Selector */}
          <select
            value={sheetZoomPct}
            onChange={(e) => setSheetZoomPct(Number(e.target.value))}
            className={`px-2 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
              isLight
                ? 'bg-white border-slate-300 text-slate-800'
                : 'bg-[#162238] border-[#2E4268] text-cyan-200'
            }`}
            title="Adjust Sheet Canvas Zoom & Viewport Utilization"
          >
            <option value={90}>Zoom: 90%</option>
            <option value={95}>Zoom: 95%</option>
            <option value={100}>Fit Width (100%)</option>
            <option value={108}>Zoom: 108%</option>
            <option value={115}>Zoom: 115%</option>
          </select>

          <button
            onClick={() => setShowSheetOptionsPanel((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
              showSheetOptionsPanel
                ? 'bg-purple-600 border-purple-400 text-white'
                : isLight
                ? 'bg-purple-50 border-purple-200 text-purple-800 hover:bg-purple-100'
                : 'bg-[#162238] border-[#2E4268] text-purple-200 hover:bg-purple-950/60'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Sheet &amp; Logo Options
          </button>

          <button
            onClick={handleDownloadDXF}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              isLight
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-[#162238] hover:bg-[#1E2F4D] text-amber-300 border-amber-500/40'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Export .DXF
          </button>

          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / Save PDF
          </button>

          <ThemeToggleButton compact />
        </div>
      </div>

      {/* ====================================================================
          COLLAPSIBLE SHEET OPTIONS & LOGO PLACEMENT CUSTOMIZER PANEL
         ==================================================================== */}
      {showSheetOptionsPanel && (
        <div
          className={`border-b px-4 py-3 grid grid-cols-12 gap-4 text-xs shrink-0 print:hidden ${
            isLight
              ? 'bg-slate-50 border-purple-200 text-slate-800'
              : 'bg-[#131C30] border-purple-500/40 text-slate-100'
          }`}
        >
          {/* Column 1: Logo Placement & Organization Titles */}
          <div className="col-span-4 space-y-2 border-r border-slate-300/40 pr-4">
            <div
              className={`font-bold uppercase tracking-wider text-[11px] ${
                isLight ? 'text-purple-800' : 'text-purple-300'
              }`}
            >
              1. Logo Placement &amp; Branding
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Logo Placement</span>
                <select
                  value={sheetConfig.logoPlacement}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      logoPlacement: e.target.value as SheetCustomizationConfig['logoPlacement'],
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md font-bold ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                >
                  <option value="TITLE_BLOCK">Bottom-Right Title Block</option>
                  <option value="TOP_BANNER">Top Header Banner</option>
                  <option value="BOTH">Both Top Banner &amp; Title Block</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Drawing Scale</span>
                <input
                  type="text"
                  value={sheetConfig.drawingScaleLabel}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      drawingScaleLabel: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Client Name</span>
                <input
                  type="text"
                  value={sheetConfig.clientLogoText}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      clientLogoText: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Contractor JV Name</span>
                <input
                  type="text"
                  value={sheetConfig.contractorName}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      contractorName: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
            </div>

            {/* Upload Client & Contractor Logo Images */}
            <div className="flex items-center gap-2 pt-1">
              <label
                className={`flex-1 px-2 py-1 border rounded-md text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 border-slate-300 text-cyan-700'
                    : 'bg-[#090E18] hover:bg-slate-800 border-slate-600 text-cyan-300'
                }`}
              >
                <Upload className="w-3 h-3" />
                Upload Client Logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleLogoUpload('clientLogoUrl', e)}
                  className="hidden"
                />
              </label>
              <label
                className={`flex-1 px-2 py-1 border rounded-md text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 border-slate-300 text-amber-700'
                    : 'bg-[#090E18] hover:bg-slate-800 border-slate-600 text-amber-300'
                }`}
              >
                <Upload className="w-3 h-3" />
                Upload Contractor Logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleLogoUpload('contractorLogoUrl', e)}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Column 2: Project Title & Sign-Off Names */}
          <div className="col-span-4 space-y-2 border-r border-slate-300/40 pr-4">
            <div
              className={`font-bold uppercase tracking-wider text-[11px] ${
                isLight ? 'text-purple-800' : 'text-purple-300'
              }`}
            >
              2. Project Heading &amp; Sign-Off Table
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Project Title</span>
                <input
                  type="text"
                  value={sheetConfig.projectTitleLine1}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      projectTitleLine1: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Consultant / Engineer</span>
                <input
                  type="text"
                  value={sheetConfig.consultantName}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      consultantName: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Compiled / Drawn</span>
                <input
                  type="text"
                  value={sheetConfig.compiledBy}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      compiledBy: e.target.value,
                      drawnBy: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Checked By</span>
                <input
                  type="text"
                  value={sheetConfig.checkedBy}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      checkedBy: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Drawing No.</span>
                <input
                  type="text"
                  value={sheetConfig.drawingNumber}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      drawingNumber: e.target.value,
                    })
                  }
                  className={`w-full px-2 py-1 border rounded-md ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#090E18] border-slate-700 text-white'
                  }`}
                />
              </label>
            </div>
          </div>

          {/* Column 3: Adaptable Sheet Rows Toggles */}
          <div className="col-span-4 space-y-1.5">
            <div
              className={`font-bold uppercase tracking-wider text-[11px] ${
                isLight ? 'text-purple-800' : 'text-purple-300'
              }`}
            >
              3. Adaptable Template Rows (Ground Cover Removed)
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showConvergenceRow}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showConvergenceRow: e.target.checked,
                    })
                  }
                />
                <span>Convergence-Divergence Row</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showRmrRqdGraph}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showRmrRqdGraph: e.target.checked,
                    })
                  }
                />
                <span>RMR &amp; RQD (0–100) Graph</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showOverbreakRow}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showOverbreakRow: e.target.checked,
                    })
                  }
                />
                <span>Geological Overbreak (m³)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showSupportDetailsRows}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showSupportDetailsRows: e.target.checked,
                    })
                  }
                />
                <span>Support Installed (a–e)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showPhotoRecordsRow}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showPhotoRecordsRow: e.target.checked,
                    })
                  }
                />
                <span>Photographic Records Row</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetConfig.showKeyPlan}
                  onChange={(e) =>
                    onUpdateSheetConfig({
                      ...sheetConfig,
                      showKeyPlan: e.target.checked,
                    })
                  }
                />
                <span>Key Plan &amp; North Rose</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          PAGE STEPPER BAR WHEN VIEWING SINGLE PAGE IN MULTI-PAGE MODE
         ==================================================================== */}
      {exportMode === 'FULL_REALISTIC_MULTIPAGE' && !printAllPagesTogether && (
        <div
          className={`border-b px-4 py-1.5 flex items-center justify-center gap-3 print:hidden ${
            isLight
              ? 'bg-slate-50 border-slate-200 text-slate-800'
              : 'bg-[#0F172A] border-slate-800 text-slate-100'
          }`}
        >
          <button
            disabled={safePageIdx <= 0}
            onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
            className={`px-2.5 py-1 rounded-md border disabled:opacity-40 text-xs font-bold flex items-center gap-1 cursor-pointer ${
              isLight
                ? 'bg-white border-slate-300 text-slate-800'
                : 'bg-slate-800 border-slate-700 text-slate-100'
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev Sheet
          </button>
          <span
            className={`text-xs font-bold ${
              isLight ? 'text-amber-800' : 'text-amber-300'
            }`}
          >
            Viewing Sheet {safePageIdx + 1} of {multiPages.length} (Ch.{' '}
            {multiPages[safePageIdx]?.startRd}m – {multiPages[safePageIdx]?.endRd}m)
          </span>
          <button
            disabled={safePageIdx >= multiPages.length - 1}
            onClick={() =>
              setActivePageIndex((i) => Math.min(multiPages.length - 1, i + 1))
            }
            className={`px-2.5 py-1 rounded-md border disabled:opacity-40 text-xs font-bold flex items-center gap-1 cursor-pointer ${
              isLight
                ? 'bg-white border-slate-300 text-slate-800'
                : 'bg-slate-800 border-slate-700 text-slate-100'
            }`}
          >
            Next Sheet <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ====================================================================
          SCROLLABLE PRINTABLE SHEET PREVIEW AREA
         ==================================================================== */}
      <div
        className={`flex-1 overflow-auto p-2.5 sm:p-3.5 print:p-0 print:overflow-visible print:bg-white transition-colors ${
          isLight ? 'bg-slate-200/70' : 'bg-[#0B101C]'
        }`}
      >
        {exportMode === 'STANDARD_TEMPLATE_SHEET'
          ? renderStandardPowerTunnelTemplateSheet(validFromRd, validToRd)
          : exportMode === 'PROJECT_NETWORK_MAP'
          ? renderProjectNetworkSheet()
          : printAllPagesTogether
          ? multiPages.map((mp) => renderMultiPageRealisticSheet(mp))
          : renderMultiPageRealisticSheet(multiPages[safePageIdx])}
      </div>
    </div>
  );
};
