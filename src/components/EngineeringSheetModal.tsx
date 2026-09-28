import React, { useMemo, useRef, useState } from 'react';
import {
  Joint,
  JointSet,
  LithologyRegion,
  OutputSheetMode,
  OverbreakUndercutAnalysis,
  PhotoSurface,
  PlacedGeologicalSymbol,
  QIndexParameters,
  RockMassSummaryTable,
  SectionToSectionVolumeRow,
  SurfaceType,
  SurveyControlPoint,
  TraceFitMode,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import { getDisplayedJointGeometry } from '../engine/geometryEngine';
import { JOINT_SET_PALETTE, runQualityControlValidation } from '../engine/orientationEngine';
import {
  calculateBartonQSystem,
  createDefaultQIndexParameters,
  createDefaultRockMassSummary,
  exportGeologyAndQIndexToCSV,
  exportMappingSheetToDXF,
} from '../engine/photoWarpEngine';
import {
  computeNonOverlappingLabelPlacement,
  DipDirectionSymbolGlyph,
  getGeologicalFeatureStrokeStyle,
  getStructuralSymbolMeta,
  LabelObstacleBox,
  LabelObstacleSegment,
  LithologyPatternDefs,
  StructuralGeologicalSymbolGlyph,
} from '../engine/geologicalSymbolLibrary';
import {
  computeFinalSheetAutoLayout,
  SheetLayoutArrangement,
} from '../engine/sheetLayoutEngine';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode,
  Image as ImageIcon,
  Maximize2,
  Printer,
  X,
} from 'lucide-react';

interface EngineeringSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  photos: Record<SurfaceType, PhotoSurface>;
  joints: Joint[];
  jointSets: JointSet[];
  traceFitMode: TraceFitMode;
  onConfirmAllOrientations: () => void;
  qIndexParams?: QIndexParameters;
  rockMassSummary?: RockMassSummaryTable;
  lithologyRegions?: LithologyRegion[];
  controlPoints?: SurveyControlPoint[];
  placedSymbols?: PlacedGeologicalSymbol[];
  overbreakAnalysis?: OverbreakUndercutAnalysis;
  sectionVolumeRows?: SectionToSectionVolumeRow[];
}

export const EngineeringSheetModal: React.FC<EngineeringSheetModalProps> = ({
  isOpen,
  onClose,
  geometry,
  settings,
  photos,
  joints,
  jointSets,
  traceFitMode,
  onConfirmAllOrientations,
  qIndexParams: propQIndex,
  rockMassSummary: propRockMass,
  lithologyRegions = [],
  controlPoints = [],
  placedSymbols = [],
  overbreakAnalysis,
  sectionVolumeRows = [],
}) => {
  const [outputMode, setOutputMode] = useState<OutputSheetMode>('FINAL_ENGINEERING_SHEET');
  const [arrangement, setArrangement] = useState<SheetLayoutArrangement>('AUTO_INTELLIGENT');
  const [showConfidenceLabels, setShowConfidenceLabels] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const qIndex = useMemo(() => propQIndex || createDefaultQIndexParameters(), [propQIndex]);
  const qResult = useMemo(
    () => calculateBartonQSystem(qIndex, geometry.width),
    [qIndex, geometry.width]
  );
  const rockMass = useMemo(
    () => propRockMass || createDefaultRockMassSummary(settings.lithology),
    [propRockMass, settings.lithology]
  );

  const uploadedSurfaceCount = useMemo(
    () => Object.values(photos).filter((p) => Boolean(p.image)).length,
    [photos]
  );

  const qcReport = useMemo(
    () => runQualityControlValidation(geometry, settings, joints, uploadedSurfaceCount),
    [geometry, settings, joints, uploadedSurfaceCount]
  );

  const layout = useMemo(
    () =>
      computeFinalSheetAutoLayout({
        geometry,
        settings,
        photos,
        joints,
        jointSets,
        lithologyRegions,
        outputMode,
        arrangement,
      }),
    [geometry, settings, photos, joints, jointSets, lithologyRegions, outputMode, arrangement]
  );

  const {
    sheetW,
    sheetH,
    margin,
    showTitleAndTables,
    showPerimeterPlan,
    headerBox,
    drawingArenaBox,
    facePxPerMeter,
    faceCenterX,
    faceTopY,
    faceBottomY,
    faceWidthPx,
    faceHeightPx,
    faceSurfaceRect,
    planCenterX,
    planTopY,
    crownW_px,
    roundH_px,
    wallW_px,
    crownLeftX,
    leftWallLeftX,
    rightWallLeftX,
    roundLen,
    crownSpan,
    orientationBlock,
    legendBlock,
    jointTableBlock,
    qIndexAndNotesBlock,
    surfacePointToSheetXY,
    getSurfaceSheetRect,
    getSheetPhotoSvgTransform,
  } = layout;

  // Build SVG polygon path for the authoritative master tunnel Face cross-section
  const facePolygonPath = useMemo(
    () =>
      geometry.crossSectionPoints
        .map((pt, idx) => {
          const s = surfacePointToSheetXY(pt, 'face');
          return `${idx === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
        })
        .join(' ') + ' Z',
    [geometry.crossSectionPoints, surfacePointToSheetXY]
  );

  // Custom polygon mask path on face if active
  const faceCustomMaskPath = useMemo(
    () =>
      photos.face.transform.useCustomMask &&
      photos.face.transform.customMaskPoints &&
      photos.face.transform.customMaskPoints.length >= 3
        ? photos.face.transform.customMaskPoints
            .map((pt, idx) => {
              const s = surfacePointToSheetXY(pt, 'face');
              return `${idx === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
            })
            .join(' ') + ' Z'
        : facePolygonPath,
    [
      photos.face.transform.useCustomMask,
      photos.face.transform.customMaskPoints,
      surfacePointToSheetXY,
      facePolygonPath,
    ]
  );

  // Automatic Non-Overlapping Label Placement for Joints, Placed Symbols, and Survey Control Points
  const nonOverlappingSheetLabels = useMemo(() => {
    const occupiedBoxes: LabelObstacleBox[] = [];
    const obstacleSegments: LabelObstacleSegment[] = [];

    // 1. Add tunnel face boundary segments as obstacle segments
    const faceSheetPts = geometry.crossSectionPoints.map((pt) =>
      surfacePointToSheetXY(pt, 'face')
    );
    for (let i = 0; i < faceSheetPts.length; i++) {
      const a = faceSheetPts[i];
      const b = faceSheetPts[(i + 1) % faceSheetPts.length];
      obstacleSegments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }

    // 2. Add dimension line boxes as occupied obstacles
    occupiedBoxes.push(
      { x: faceCenterX - 90, y: faceBottomY + 6, width: 180, height: 24 },
      { x: faceCenterX - faceWidthPx / 2 - 44, y: faceTopY, width: 32, height: faceHeightPx },
      { x: faceCenterX + faceWidthPx / 2 + 12, y: faceTopY, width: 34, height: faceHeightPx }
    );

    // 3. Add all joint trace segments as obstacle segments
    for (const j of joints) {
      if (!showPerimeterPlan && j.surface !== 'face') continue;
      const geom = getDisplayedJointGeometry(j, traceFitMode);
      const pts = geom.map((pt) => surfacePointToSheetXY(pt, j.surface));
      for (let i = 0; i < pts.length - 1; i++) {
        obstacleSegments.push({
          x1: pts[i].x,
          y1: pts[i].y,
          x2: pts[i + 1].x,
          y2: pts[i + 1].y,
        });
      }
    }

    // Reserve marker circles for all visible control points and symbols
    const visibleCPs = controlPoints.filter(
      (cp) => cp.visible !== false && (showPerimeterPlan || cp.surface === 'face')
    );
    for (const cp of visibleCPs) {
      const p = surfacePointToSheetXY(cp.point, cp.surface);
      occupiedBoxes.push({ x: p.x - 8, y: p.y - 8, width: 16, height: 16 });
    }

    const visibleSymbols = placedSymbols.filter(
      (sym) => sym.visible !== false && (showPerimeterPlan || sym.surface === 'face')
    );
    for (const sym of visibleSymbols) {
      const p = surfacePointToSheetXY(sym.point, sym.surface);
      occupiedBoxes.push({ x: p.x - 14, y: p.y - 14, width: 28, height: 28 });
    }

    const arenaBounds = {
      minX: drawingArenaBox.x + 8,
      minY: drawingArenaBox.y + 8,
      maxX: drawingArenaBox.x + drawingArenaBox.width - 8,
      maxY: drawingArenaBox.y + drawingArenaBox.height - 8,
    };

    // Compute non-overlapping positions for Survey Control Point labels (CP1 / X: ... / Y: ...)
    const cpPlacements: Record<string, ReturnType<typeof computeNonOverlappingLabelPlacement>> = {};
    for (const cp of visibleCPs) {
      const anchor = surfacePointToSheetXY(cp.point, cp.surface);
      const res = computeNonOverlappingLabelPlacement({
        anchorX: anchor.x,
        anchorY: anchor.y,
        boxW: 78,
        boxH: 34,
        occupiedBoxes,
        obstacleSegments,
        bounds: arenaBounds,
      });
      cpPlacements[cp.id] = res;
      occupiedBoxes.push({
        x: res.boxX,
        y: res.boxY,
        width: res.boxW,
        height: res.boxH,
      });
    }

    // Compute non-overlapping positions for Joint Callout Labels
    const jointPlacements: Record<string, ReturnType<typeof computeNonOverlappingLabelPlacement>> = {};
    for (const j of joints) {
      if (!showPerimeterPlan && j.surface !== 'face') continue;
      const geom = getDisplayedJointGeometry(j, traceFitMode);
      if (geom.length < 2) continue;
      const sheetPts = geom.map((pt) => surfacePointToSheetXY(pt, j.surface));
      const midIdx = Math.floor(sheetPts.length / 2);
      const midPt =
        sheetPts.length % 2 === 1
          ? sheetPts[midIdx]
          : {
              x: (sheetPts[midIdx - 1].x + sheetPts[midIdx].x) / 2,
              y: (sheetPts[midIdx - 1].y + sheetPts[midIdx].y) / 2,
            };
      const labelText =
        j.customLabel ||
        `${j.jointNumber ? `${j.jointNumber} ` : ''}${j.set}:${String(
          Math.round(j.dipDirection)
        ).padStart(3, '0')}°/${String(Math.round(j.dip)).padStart(2, '0')}°`;
      const boxW = Math.max(66, labelText.length * 5.6 + (showConfidenceLabels ? 22 : 8));
      const res = computeNonOverlappingLabelPlacement({
        anchorX: midPt.x,
        anchorY: midPt.y,
        boxW,
        boxH: 14,
        occupiedBoxes,
        obstacleSegments,
        bounds: arenaBounds,
      });
      jointPlacements[j.id] = res;
      occupiedBoxes.push({
        x: res.boxX,
        y: res.boxY,
        width: res.boxW,
        height: res.boxH,
      });
    }

    // Compute non-overlapping positions for Placed Geological Symbol Labels
    const symbolPlacements: Record<string, ReturnType<typeof computeNonOverlappingLabelPlacement>> = {};
    for (const sym of visibleSymbols) {
      const anchor = surfacePointToSheetXY(sym.point, sym.surface);
      const text = `${sym.label} (${String(Math.round(sym.dipDirectionDeg)).padStart(3, '0')}°/${String(
        Math.round(sym.dipDeg)
      ).padStart(2, '0')}°)`;
      const boxW = Math.max(68, text.length * 5.4 + 10);
      const res = computeNonOverlappingLabelPlacement({
        anchorX: anchor.x,
        anchorY: anchor.y,
        boxW,
        boxH: 14,
        occupiedBoxes,
        obstacleSegments,
        bounds: arenaBounds,
      });
      symbolPlacements[sym.id] = res;
      occupiedBoxes.push({
        x: res.boxX,
        y: res.boxY,
        width: res.boxW,
        height: res.boxH,
      });
    }

    return { cpPlacements, jointPlacements, symbolPlacements };
  }, [
    geometry.crossSectionPoints,
    surfacePointToSheetXY,
    faceCenterX,
    faceBottomY,
    faceWidthPx,
    faceTopY,
    faceHeightPx,
    joints,
    showPerimeterPlan,
    traceFitMode,
    controlPoints,
    placedSymbols,
    drawingArenaBox,
    showConfidenceLabels,
  ]);

  if (!isOpen) return null;

  const showPhotos =
    outputMode === 'PHOTO_AND_AI_TRACING' ||
    outputMode === 'EXPORT_PHOTO_ONLY' ||
    (outputMode === 'FINAL_ENGINEERING_SHEET' &&
      Object.values(photos).some((p) => p.opacity > 0 && p.image));

  const showVectors = outputMode !== 'EXPORT_PHOTO_ONLY';

  // Approximate engineering drawing scale ratio (1 : N) for A3 420mm width = 1600px (~3.81 px/mm)
  const engineeringScaleDenominator = Math.max(
    10,
    Math.round(((1000 * 3.81) / Math.max(10, facePxPerMeter)) / 5) * 5
  );

  // Export SVG directly
  const handleDownloadSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgRef.current);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_mapping.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export high-resolution PNG
  const handleDownloadPNG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgRef.current);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = sheetW * 2;
      canvas.height = sheetH * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_sheet.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    img.src = url;
  };

  // Export PDF via vector print sheet
  const handlePrintPDF = () => {
    window.print();
  };

  // Export AutoCAD DXF Vector Profile & Traces
  const handleDownloadDXF = () => {
    const dxfString = exportMappingSheetToDXF(
      geometry,
      settings,
      joints,
      overbreakAnalysis,
      controlPoints
    );
    const blob = new Blob([dxfString], { type: 'application/dxf;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_vectors.dxf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export CSV Engineering Tables & Q-Index
  const handleDownloadCSV = () => {
    const csvString = exportGeologyAndQIndexToCSV(
      geometry,
      settings,
      joints,
      jointSets,
      qIndex,
      rockMass,
      overbreakAnalysis,
      controlPoints,
      sectionVolumeRows
    );
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_geology_qindex.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-sm overflow-hidden">
      {/* Top Action & Mode Bar (hidden when printing to PDF) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-[#0F141C] border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display font-bold text-sm tracking-wider text-slate-100">
            FINAL ENGINEERING TUNNEL MAPPING SHEET
          </span>
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-800">
            {(
              [
                { id: 'FINAL_ENGINEERING_SHEET', label: '1. Geological & Overbreak Sheet' },
                { id: 'ENGINEERING_QUANTITY_SHEET', label: '2. Engineering Quantity Sheet' },
                { id: 'CLEAN_MAPPING_DRAWING', label: '3. Clean Mapping Drawing' },
                { id: 'PHOTO_AND_AI_TRACING', label: '4. Photo + Vector Tracing' },
                { id: 'VECTOR_MAPPING_ONLY', label: '5. Vector Mapping Only' },
                { id: 'EXPORT_PHOTO_ONLY', label: '6. Main Photo Only' },
              ] as { id: OutputSheetMode; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setOutputMode(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  outputMode === tab.id
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Layout Engine Mode Toggle: Prominent Face + Perimeter vs Maximize Tunnel Face */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-800">
            <button
              onClick={() => setArrangement('AUTO_INTELLIGENT')}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                arrangement === 'AUTO_INTELLIGENT'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Auto-Layout: Prominent Tunnel Face + Developed Perimeter"
            >
              Auto Fit (Face + Perimeter)
            </button>
            <button
              onClick={() => setArrangement('MAXIMIZE_FACE')}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                arrangement === 'MAXIMIZE_FACE'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Maximize Main Tunnel-Face Mapping across full drawing arena"
            >
              <Maximize2 className="w-3 h-3" />
              Maximize Face
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showConfidenceLabels}
              onChange={(e) => setShowConfidenceLabels(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-cyan-500"
            />
            Show Confidence
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadDXF}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded border border-slate-700 transition-colors whitespace-nowrap"
            title="Export Master Tunnel Profile and Mapped Vector Polylines to AutoCAD .DXF"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            DXF
          </button>
          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded border border-slate-700 transition-colors whitespace-nowrap"
            title="Export Discontinuity Sets, Traces, and Barton Q-Index to .CSV"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            CSV
          </button>
          <button
            onClick={handleDownloadSVG}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded border border-slate-700 transition-colors whitespace-nowrap"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            Export SVG
          </button>
          <button
            onClick={handleDownloadPNG}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded border border-slate-700 transition-colors whitespace-nowrap"
          >
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
            Export PNG
          </button>
          <button
            onClick={handlePrintPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Export PDF / Print
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
            title="Close Export Preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Quality Control Validation Strip */}
      <div className="no-print flex items-center justify-between px-5 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-3 overflow-x-auto">
          {qcReport.passed ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-mono whitespace-nowrap">
              <CheckCircle2 className="w-4 h-4" />
              AUTO-LAYOUT VALIDATED: Face Scale {facePxPerMeter.toFixed(1)} px/m (1:{engineeringScaleDenominator}) · Master ({geometry.width}m × {geometry.height}m) · {joints.length} Traces · {placedSymbols.length} Symbols · {controlPoints.length} Control Pts
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-400 font-mono whitespace-nowrap">
              <AlertTriangle className="w-4 h-4" />
              QC CHECK: {qcReport.issues.length} item(s) flagged · Face Scale {facePxPerMeter.toFixed(1)} px/m
            </span>
          )}
          {qcReport.issues.slice(0, 2).map((iss) => (
            <span key={iss.id} className="text-slate-400 font-mono whitespace-nowrap">
              · {iss.message}
            </span>
          ))}
        </div>

        {joints.some(
          (j) =>
            j.orientationStatus !== 'CONFIRMED' &&
            j.orientationStatus !== 'DIRECTLY_MEASURED' &&
            j.orientationStatus !== 'GEOMETRICALLY_CALCULATED'
        ) && (
          <button
            onClick={onConfirmAllOrientations}
            className="px-2.5 py-1 text-xs font-mono bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded whitespace-nowrap"
          >
            Confirm Estimated Orientations
          </button>
        )}
      </div>

      {/* Main Engineering Sheet Preview Stage */}
      <div className="flex-1 overflow-auto p-4 flex items-start justify-center bg-[#0B0E14] print:p-0 print:bg-white">
        <div className="bg-white shadow-2xl border border-slate-300 print:shadow-none print:border-none">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${sheetW} ${sheetH}`}
            width={sheetW}
            height={sheetH}
            className="block bg-white text-black select-none max-w-full h-auto"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            <defs>
              {/* Authoritative Master Tunnel Face Clip Path (No black border inside or outside!) */}
              <clipPath id="sheet-face-clip">
                <path d={faceCustomMaskPath} />
              </clipPath>
              <clipPath id="sheet-crown-clip">
                <rect x={crownLeftX} y={planTopY} width={crownW_px} height={roundH_px} />
              </clipPath>
              <clipPath id="sheet-leftwall-clip">
                <rect x={leftWallLeftX} y={planTopY} width={wallW_px} height={roundH_px} />
              </clipPath>
              <clipPath id="sheet-rightwall-clip">
                <rect x={rightWallLeftX} y={planTopY} width={wallW_px} height={roundH_px} />
              </clipPath>

              {/* Right Column Table Clip Paths to Prevent Any Text Intersection (Section 16) */}
              <clipPath id="sheet-right-col-clip">
                <rect
                  x={orientationBlock.x}
                  y={orientationBlock.y}
                  width={orientationBlock.width}
                  height={sheetH - orientationBlock.y - margin}
                />
              </clipPath>

              {/* Engineering Grid Pattern */}
              <pattern id="eng-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                <path
                  d="M 25 0 L 0 0 0 25"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="0.6"
                />
              </pattern>

              {/* All 25 Professional Lithology Patterns (Sections 13 & 14) */}
              <LithologyPatternDefs prefix="sheet-lith-" forPrintSheet={true} />

              {/* Print-Ready Overbreak & Undercut Engineering Hatch Patterns */}
              <pattern
                id="sheet-overbreak-hatch"
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="7" stroke="#E11D48" strokeWidth="1.2" strokeOpacity="0.7" />
              </pattern>
              <pattern
                id="sheet-undercut-hatch"
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(-45)"
              >
                <line x1="0" y1="0" x2="0" y2="7" stroke="#D97706" strokeWidth="1.2" strokeOpacity="0.75" />
              </pattern>
            </defs>

            {/* White Technical Drawing Sheet Background */}
            <rect x="0" y="0" width={sheetW} height={sheetH} fill="#FFFFFF" />

            {/* Outer Drawing Frame & Double Engineering Border */}
            <rect
              x={margin - 4}
              y={margin - 4}
              width={sheetW - (margin - 4) * 2}
              height={sheetH - (margin - 4) * 2}
              fill="none"
              stroke="#0F172A"
              strokeWidth="2.2"
            />
            <rect
              x={margin + 4}
              y={margin + 4}
              width={sheetW - (margin + 4) * 2}
              height={sheetH - (margin + 4) * 2}
              fill="url(#eng-grid)"
              stroke="#0F172A"
              strokeWidth="0.9"
            />

            {/* ==============================================================
                1. COMPACT ENGINEERING HEADER BLOCK (Priority 6: Project Info)
               ============================================================== */}
            {showTitleAndTables && (
              <g>
                <rect
                  x={headerBox.x}
                  y={headerBox.y}
                  width={headerBox.width}
                  height={headerBox.height}
                  fill="#F8FAFC"
                  stroke="#0F172A"
                  strokeWidth="1.2"
                />
                {/* Vertical dividers in header */}
                <line x1="490" y1={headerBox.y} x2="490" y2={headerBox.y + headerBox.height} stroke="#0F172A" strokeWidth="1" />
                <line x1="880" y1={headerBox.y} x2="880" y2={headerBox.y + headerBox.height} stroke="#0F172A" strokeWidth="1" />
                <line x1="1270" y1={headerBox.y} x2="1270" y2={headerBox.y + headerBox.height} stroke="#0F172A" strokeWidth="1" />
                <line x1="490" y1={headerBox.y + 38} x2={headerBox.x + headerBox.width} y2={headerBox.y + 38} stroke="#0F172A" strokeWidth="0.8" />

                {/* Zone 1: Title & Project */}
                <text x="36" y={headerBox.y + 23} fontSize="14.5" fontWeight="700" fill="#0F172A">
                  {outputMode === 'ENGINEERING_QUANTITY_SHEET'
                    ? 'ENGINEERING OVERBREAK, UNDERCUT & EXCAVATION QUANTITY SHEET'
                    : 'ENGINEERING GEOLOGICAL TUNNEL MAPPING SHEET'}
                </text>
                <text x="36" y={headerBox.y + 44} fontSize="11.5" fontWeight="700" fill="#1E293B">
                  TUNNEL: {settings.tunnelName.toUpperCase()}
                </text>
                <text x="36" y={headerBox.y + 63} fontSize="10.5" fill="#334155">
                  LITHOLOGY: {settings.lithology.slice(0, 38)} · PROFILE: {geometry.crownGeometry.toUpperCase().replace('_', '-')} ({geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m)
                </text>

                {/* Zone 2: Chainage & Pull */}
                <text x="504" y={headerBox.y + 16} fontSize="9.5" fill="#475569">
                  CHAINAGE / RD INTERVAL:
                </text>
                <text x="504" y={headerBox.y + 31} fontSize="11.5" fontWeight="700" fill="#0F172A">
                  {settings.chainage}
                </text>
                <text x="504" y={headerBox.y + 53} fontSize="10" fill="#475569">
                  FACE RD: <tspan fontWeight="700" fill="#0F172A">{settings.faceChainage}</tspan> · PULL: <tspan fontWeight="700" fill="#0F172A">{settings.roundLength.toFixed(2)} m</tspan>
                </text>

                {/* Zone 3: Drive Direction & Master Dimensions */}
                <text x="894" y={headerBox.y + 16} fontSize="9.5" fill="#475569">
                  TUNNEL DRIVE DIRECTION (AZIMUTH):
                </text>
                <text x="894" y={headerBox.y + 31} fontSize="12" fontWeight="700" fill="#0F172A">
                  N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E (Az {settings.driveDirection.toFixed(1)}°)
                </text>
                <text x="894" y={headerBox.y + 53} fontSize="10" fill="#475569">
                  SPAN: <tspan fontWeight="700" fill="#0F172A">{geometry.width.toFixed(2)}m</tspan> · HT: <tspan fontWeight="700" fill="#0F172A">{geometry.height.toFixed(2)}m</tspan> · WALL: <tspan fontWeight="700" fill="#0F172A">{geometry.wallHeight.toFixed(2)}m</tspan>
                </text>

                {/* Zone 4: Date, Geologist & Scale */}
                <text x="1284" y={headerBox.y + 18} fontSize="10" fill="#475569">
                  DATE: <tspan fontWeight="700" fill="#0F172A">{settings.date}</tspan>
                </text>
                <text x="1284" y={headerBox.y + 32} fontSize="10" fill="#475569">
                  MAPPED BY: <tspan fontWeight="700" fill="#0F172A">{settings.mappedBy}</tspan>
                </text>
                <text x="1284" y={headerBox.y + 53} fontSize="10" fontWeight="700" fill="#0F172A">
                  FACE SCALE 1:{engineeringScaleDenominator} ({geometry.source.toUpperCase()})
                </text>
              </g>
            )}

            {/* ==============================================================
                2. DEVELOPED PERIMETER MAPPING (Priority 2: Left Wall | Crown | Right Wall)
               ============================================================== */}
            {showPerimeterPlan && (
              <g>
                <text
                  x={planCenterX}
                  y={planTopY - 12}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  DEVELOPED PERIMETER MAPPING (LEFT WALL — CROWN ARCH — RIGHT WALL) · PULL = {roundLen.toFixed(2)} m
                </text>

                {/* Drive Direction Indicator Arrow on Left */}
                <g transform={`translate(${leftWallLeftX - 28}, ${planTopY + roundH_px / 2})`}>
                  <line x1="0" y1="24" x2="0" y2="-24" stroke="#0F172A" strokeWidth="1.5" />
                  <polygon points="0,-29 -3.5,-19 3.5,-19" fill="#0F172A" />
                  <text
                    x="-8"
                    y="0"
                    textAnchor="middle"
                    fontSize="8.5"
                    fontWeight="700"
                    fill="#0F172A"
                    transform="rotate(-90, -8, 0)"
                  >
                    DRIVE N{String(Math.round(settings.driveDirection)).padStart(3, '0')}°
                  </text>
                </g>

                {/* Clean White Background Inside Unfolded Perimeter Boxes */}
                <rect
                  x={leftWallLeftX}
                  y={planTopY}
                  width={wallW_px * 2 + crownW_px}
                  height={roundH_px}
                  fill="#F8FAFC"
                />

                {/* LAYER 1: Registered Photographs for Left Wall, Crown, Right Wall (Preserving exact canvas transform!) */}
                {showPhotos && photos.leftWall.image && (
                  <g clipPath="url(#sheet-leftwall-clip)">
                    <g transform={getSheetPhotoSvgTransform('leftWall', photos.leftWall.transform)}>
                      <image
                        href={photos.leftWall.warpedImage || photos.leftWall.image}
                        x={leftWallLeftX}
                        y={planTopY}
                        width={wallW_px}
                        height={roundH_px}
                        preserveAspectRatio="none"
                        opacity={outputMode === 'PHOTO_AND_AI_TRACING' ? 0.88 : photos.leftWall.opacity / 100}
                      />
                    </g>
                  </g>
                )}
                {showPhotos && photos.crown.image && (
                  <g clipPath="url(#sheet-crown-clip)">
                    <g transform={getSheetPhotoSvgTransform('crown', photos.crown.transform)}>
                      <image
                        href={photos.crown.warpedImage || photos.crown.image}
                        x={crownLeftX}
                        y={planTopY}
                        width={crownW_px}
                        height={roundH_px}
                        preserveAspectRatio="none"
                        opacity={outputMode === 'PHOTO_AND_AI_TRACING' ? 0.88 : photos.crown.opacity / 100}
                      />
                    </g>
                  </g>
                )}
                {showPhotos && photos.rightWall.image && (
                  <g clipPath="url(#sheet-rightwall-clip)">
                    <g transform={getSheetPhotoSvgTransform('rightWall', photos.rightWall.transform)}>
                      <image
                        href={photos.rightWall.warpedImage || photos.rightWall.image}
                        x={rightWallLeftX}
                        y={planTopY}
                        width={wallW_px}
                        height={roundH_px}
                        preserveAspectRatio="none"
                        opacity={outputMode === 'PHOTO_AND_AI_TRACING' ? 0.88 : photos.rightWall.opacity / 100}
                      />
                    </g>
                  </g>
                )}

                {/* Left Wall Box */}
                <rect
                  x={leftWallLeftX}
                  y={planTopY}
                  width={wallW_px}
                  height={roundH_px}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                />
                <text
                  x={leftWallLeftX + wallW_px / 2}
                  y={planTopY + roundH_px + 12}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#334155"
                >
                  LEFT WALL ({geometry.wallHeight.toFixed(2)}m)
                </text>

                {/* Crown Box */}
                <rect
                  x={crownLeftX}
                  y={planTopY}
                  width={crownW_px}
                  height={roundH_px}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="1.7"
                />
                <line
                  x1={planCenterX}
                  y1={planTopY}
                  x2={planCenterX}
                  y2={planTopY + roundH_px}
                  stroke="#475569"
                  strokeWidth="0.8"
                  strokeDasharray="5,4"
                />
                <text
                  x={planCenterX}
                  y={planTopY + roundH_px + 12}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  CROWN ARCH (SPAN {crownSpan.toFixed(2)}m · C.L.)
                </text>

                {/* Right Wall Box */}
                <rect
                  x={rightWallLeftX}
                  y={planTopY}
                  width={wallW_px}
                  height={roundH_px}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                />
                <text
                  x={rightWallLeftX + wallW_px / 2}
                  y={planTopY + roundH_px + 12}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#334155"
                >
                  RIGHT WALL ({geometry.wallHeight.toFixed(2)}m)
                </text>

                {/* Pull Dimension on Right Side of Perimeter Plan */}
                <line
                  x1={rightWallLeftX + wallW_px + 12}
                  y1={planTopY}
                  x2={rightWallLeftX + wallW_px + 12}
                  y2={planTopY + roundH_px}
                  stroke="#0F172A"
                  strokeWidth="0.9"
                />
                <text
                  x={rightWallLeftX + wallW_px + 18}
                  y={planTopY + roundH_px / 2 + 3}
                  fontSize="8"
                  fontWeight="600"
                  fill="#334155"
                >
                  {roundLen.toFixed(2)}m
                </text>
              </g>
            )}

            {/* ==============================================================
                3. PRIORITY 1: MAIN TUNNEL-FACE GEOLOGICAL MAPPING
                Strict Layer Order (Section 14):
                PHOTO -> LITHOLOGY -> GEOLOGICAL FEATURES -> JOINTS -> SYMBOLS -> LABELS -> DIMENSIONS
               ============================================================== */}
            <g>
              <text
                x={faceCenterX}
                y={faceTopY - 14}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="700"
                fill="#0F172A"
              >
                MAIN TUNNEL FACE GEOLOGICAL MAPPING ({settings.faceChainage} · DRIVE N{' '}
                {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E · {geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m)
              </text>

              {/* Clean Paper-Neutral Interior Fill Inside Tunnel Profile (Never Black!) */}
              <path d={facePolygonPath} fill="#F8FAFC" />

              {/* LAYER 1: REGISTERED MAIN FACE PHOTOGRAPH (Cropped strictly to tunnel boundary, using exact canvas transform) */}
              {showPhotos && photos.face.image && (
                <g clipPath="url(#sheet-face-clip)">
                  <g transform={getSheetPhotoSvgTransform('face', photos.face.transform)}>
                    <image
                      href={photos.face.warpedImage || photos.face.image}
                      x={faceSurfaceRect.x}
                      y={faceSurfaceRect.y}
                      width={faceSurfaceRect.width}
                      height={faceSurfaceRect.height}
                      preserveAspectRatio="none"
                      opacity={outputMode === 'PHOTO_AND_AI_TRACING' ? 0.92 : photos.face.opacity / 100}
                    />
                  </g>
                </g>
              )}

              {/* LAYER 2: SUBTLE LITHOLOGY REGIONS (Transparent geological pattern below joints & symbols) */}
              {showVectors && lithologyRegions.length > 0 && (
                <g>
                  {lithologyRegions.map((reg) => {
                    if (!showPerimeterPlan && reg.surface !== 'face') return null;
                    if (reg.polygon.length < 3) return null;
                    const sheetPts = reg.polygon.map((pt) =>
                      surfacePointToSheetXY(pt, reg.surface)
                    );
                    const dPoly =
                      sheetPts
                        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                        .join(' ') + ' Z';
                    const clipId =
                      reg.surface === 'face'
                        ? 'url(#sheet-face-clip)'
                        : reg.surface === 'crown'
                        ? 'url(#sheet-crown-clip)'
                        : reg.surface === 'leftWall'
                        ? 'url(#sheet-leftwall-clip)'
                        : 'url(#sheet-rightwall-clip)';
                    const cx =
                      sheetPts.reduce((acc, p) => acc + p.x, 0) / sheetPts.length;
                    const cy =
                      sheetPts.reduce((acc, p) => acc + p.y, 0) / sheetPts.length;

                    return (
                      <g key={`sheet-lith-${reg.id}`} clipPath={clipId}>
                        <path
                          d={dPoly}
                          fill={reg.colorHex}
                          fillOpacity={Math.min(0.22, reg.opacity * 0.48)}
                        />
                        <path
                          d={dPoly}
                          fill={`url(#sheet-lith-${reg.patternType})`}
                          fillOpacity={Math.min(0.78, reg.opacity * 1.9)}
                          stroke={reg.colorHex}
                          strokeOpacity="0.5"
                          strokeWidth="1"
                          strokeDasharray="5,3"
                        />
                        <text
                          x={cx}
                          y={cy}
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="700"
                          fill="#0F172A"
                          fillOpacity="0.78"
                        >
                          {reg.lithologyName.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* LAYER 2.5: OVERBREAK / UNDERCUT VECTOR ANALYSIS REGIONS & SURVEYED AS-BUILT PROFILE */}
              {showVectors &&
                overbreakAnalysis &&
                overbreakAnalysis.hasValidSurveyProfile &&
                overbreakAnalysis.surface === 'face' && (
                  <g>
                    {overbreakAnalysis.overbreakRegions.map((reg) => {
                      if (reg.polygon.length < 3) return null;
                      const pts = reg.polygon.map((p) => surfacePointToSheetXY(p, 'face'));
                      const d =
                        pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
                        ' Z';
                      const maxPt = surfacePointToSheetXY(reg.maxRadialPoint, 'face');
                      return (
                        <g key={`sheet-ob-${reg.id}`}>
                          <path
                            d={d}
                            fill="rgba(225, 29, 72, 0.14)"
                            stroke="#E11D48"
                            strokeWidth="1.2"
                          />
                          <path d={d} fill="url(#sheet-overbreak-hatch)" />
                          {reg.areaSqMeters >= 0.02 && (
                            <g>
                              <rect
                                x={maxPt.x - 42}
                                y={maxPt.y - 19}
                                width="84"
                                height="13"
                                rx="1.5"
                                fill="#FFFFFF"
                                fillOpacity="0.92"
                                stroke="#E11D48"
                                strokeWidth="0.8"
                              />
                              <text
                                x={maxPt.x}
                                y={maxPt.y - 10}
                                textAnchor="middle"
                                fontSize="7.5"
                                fontWeight="700"
                                fill="#BE123C"
                              >
                                {reg.id}: +{reg.areaSqMeters.toFixed(2)}m² (+{reg.maxRadialMeters.toFixed(2)}m)
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {overbreakAnalysis.undercutRegions.map((reg) => {
                      if (reg.polygon.length < 3) return null;
                      const pts = reg.polygon.map((p) => surfacePointToSheetXY(p, 'face'));
                      const d =
                        pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
                        ' Z';
                      const maxPt = surfacePointToSheetXY(reg.maxRadialPoint, 'face');
                      return (
                        <g key={`sheet-uc-${reg.id}`}>
                          <path
                            d={d}
                            fill="rgba(217, 119, 6, 0.16)"
                            stroke="#D97706"
                            strokeWidth="1.2"
                          />
                          <path d={d} fill="url(#sheet-undercut-hatch)" />
                          {reg.areaSqMeters >= 0.02 && (
                            <g>
                              <rect
                                x={maxPt.x - 42}
                                y={maxPt.y + 5}
                                width="84"
                                height="13"
                                rx="1.5"
                                fill="#FFFFFF"
                                fillOpacity="0.92"
                                stroke="#D97706"
                                strokeWidth="0.8"
                              />
                              <text
                                x={maxPt.x}
                                y={maxPt.y + 14}
                                textAnchor="middle"
                                fontSize="7.5"
                                fontWeight="700"
                                fill="#B45309"
                              >
                                {reg.id}: -{reg.areaSqMeters.toFixed(2)}m² (-{reg.maxRadialMeters.toFixed(2)}m)
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Connected Surveyed As-Built Profile Polyline */}
                    {overbreakAnalysis.surveyedPolygon.length >= 2 && (
                      <path
                        d={
                          overbreakAnalysis.surveyedPolygon
                            .map((pt, idx) => {
                              const s = surfacePointToSheetXY(pt, 'face');
                              return `${idx === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
                            })
                            .join(' ') + ' Z'
                        }
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2.1"
                        strokeDasharray="7,4"
                      />
                    )}
                  </g>
                )}

              {/* Springline & Centerline Engineering Reference Lines */}
              <g clipPath="url(#sheet-face-clip)">
                <line
                  x1={faceCenterX - faceWidthPx / 2}
                  y1={faceBottomY - geometry.wallHeight * facePxPerMeter}
                  x2={faceCenterX + faceWidthPx / 2}
                  y2={faceBottomY - geometry.wallHeight * facePxPerMeter}
                  stroke="#64748B"
                  strokeWidth="0.9"
                  strokeDasharray="6,4"
                />
                <line
                  x1={faceCenterX}
                  y1={faceTopY}
                  x2={faceCenterX}
                  y2={faceBottomY}
                  stroke="#64748B"
                  strokeWidth="0.9"
                  strokeDasharray="6,4"
                />
              </g>

              {/* Authoritative Master Tunnel Cross-Section Outline */}
              <path
                d={facePolygonPath}
                fill="none"
                stroke="#0F172A"
                strokeWidth="2.6"
              />
            </g>

            {/* ==============================================================
                4. LAYERS 3, 4 & 5: GEOLOGICAL FEATURES, JOINTS & STRUCTURAL SYMBOLS
               ============================================================== */}
            {showVectors && (
              <g>
                {/* Traced Geological Features & Discontinuities */}
                {joints.map((joint) => {
                  if (!showPerimeterPlan && joint.surface !== 'face') return null;
                  const displayedGeom = getDisplayedJointGeometry(joint, traceFitMode);
                  if (displayedGeom.length < 2) return null;
                  const sheetPts = displayedGeom.map((pt) =>
                    surfacePointToSheetXY(pt, joint.surface)
                  );
                  const dPath = sheetPts
                    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                    .join(' ');

                  const palette = JOINT_SET_PALETTE[joint.set] || { color: '#0F172A' };
                  const strokeColor = palette.color;
                  const styleInfo = getGeologicalFeatureStrokeStyle(joint.featureType, false);

                  const midIdx = Math.floor(sheetPts.length / 2);
                  const midPt =
                    sheetPts.length % 2 === 1
                      ? sheetPts[midIdx]
                      : {
                          x: (sheetPts[midIdx - 1].x + sheetPts[midIdx].x) / 2,
                          y: (sheetPts[midIdx - 1].y + sheetPts[midIdx].y) / 2,
                        };
                  const tA = sheetPts[Math.max(0, midIdx - 1)];
                  const tB = sheetPts[Math.min(sheetPts.length - 1, midIdx)];
                  const segAngleRad = Math.atan2(tB.y - tA.y, tB.x - tA.x);

                  return (
                    <g key={joint.id}>
                      {/* Shear / Fault / Vein / Clay Band Highlight */}
                      {styleInfo.isBand && (
                        <path
                          d={dPath}
                          fill="none"
                          stroke={strokeColor}
                          strokeOpacity={styleInfo.bandOpacity ?? 0.2}
                          strokeWidth="7.5"
                          strokeLinecap="round"
                        />
                      )}

                      {/* Primary Vector Discontinuity Polyline */}
                      {joint.vertexWidths && joint.vertexWidths.length === sheetPts.length ? (
                        sheetPts.slice(0, -1).map((ptA, segIdx) => {
                          const ptB = sheetPts[segIdx + 1];
                          const wNorm =
                            ((joint.vertexWidths![segIdx] ?? 0.5) +
                              (joint.vertexWidths![segIdx + 1] ?? 0.5)) /
                            2;
                          const baseW = styleInfo.isBand ? 2.0 : 1.35;
                          const segStrokeW = Number(
                            (baseW + wNorm * (styleInfo.isBand ? 2.4 : 1.7)).toFixed(2)
                          );
                          return (
                            <line
                              key={`${joint.id}-shseg-${segIdx}`}
                              x1={ptA.x}
                              y1={ptA.y}
                              x2={ptB.x}
                              y2={ptB.y}
                              stroke={strokeColor}
                              strokeWidth={segStrokeW}
                              strokeDasharray={styleInfo.dashArray}
                              strokeLinecap="round"
                            />
                          );
                        })
                      ) : (
                        <path
                          d={dPath}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={styleInfo.isBand ? '2.5' : '1.85'}
                          strokeDasharray={styleInfo.dashArray}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* Genuine Rock Termination T-Bar Ticks */}
                      {joint.terminationStart === 'ROCK_TERMINATION' && sheetPts.length >= 2 && (() => {
                        const a = sheetPts[0];
                        const b = sheetPts[1];
                        const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
                        const dx = Math.cos(ang) * 4.5;
                        const dy = Math.sin(ang) * 4.5;
                        return (
                          <line
                            x1={a.x - dx}
                            y1={a.y - dy}
                            x2={a.x + dx}
                            y2={a.y + dy}
                            stroke={strokeColor}
                            strokeWidth="1.5"
                          />
                        );
                      })()}
                      {joint.terminationEnd === 'ROCK_TERMINATION' && sheetPts.length >= 2 && (() => {
                        const a = sheetPts[sheetPts.length - 2];
                        const b = sheetPts[sheetPts.length - 1];
                        const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
                        const dx = Math.cos(ang) * 4.5;
                        const dy = Math.sin(ang) * 4.5;
                        return (
                          <line
                            x1={b.x - dx}
                            y1={b.y - dy}
                            x2={b.x + dx}
                            y2={b.y + dy}
                            stroke={strokeColor}
                            strokeWidth="1.5"
                          />
                        );
                      })()}

                      {/* LAYER 5: Proper Structural Dip / Dip-Direction Symbol on Joint (Section 12) */}
                      <DipDirectionSymbolGlyph
                        midX={midPt.x}
                        midY={midPt.y}
                        tangentAngleRad={segAngleRad}
                        dipDeg={joint.dip}
                        dipDirectionDeg={joint.dipDirection}
                        featureType={joint.featureType}
                        orientationStatus={joint.orientationStatus}
                        color={strokeColor}
                        scale={joint.symbolScale || 1}
                        forPrintSheet={true}
                      />
                    </g>
                  );
                })}

                {/* LAYER 5B: Placed Standalone Structural Geological Symbols (Sections 9, 10, 15) */}
                {placedSymbols
                  .filter((sym) => sym.visible !== false && (showPerimeterPlan || sym.surface === 'face'))
                  .map((sym) => {
                    const pt = surfacePointToSheetXY(sym.point, sym.surface);
                    const meta = getStructuralSymbolMeta(sym.symbolType);
                    const color = sym.color || meta.sheetColor;
                    return (
                      <g
                        key={`sheet-sym-${sym.id}`}
                        transform={`translate(${pt.x}, ${pt.y}) rotate(${sym.rotationDeg})`}
                      >
                        <StructuralGeologicalSymbolGlyph
                          symbolType={sym.symbolType}
                          color={color}
                          scale={sym.scale * 0.9}
                          dipDeg={sym.dipDeg}
                          uncertainOrientation={sym.uncertainOrientation}
                        />
                      </g>
                    );
                  })}
              </g>
            )}

            {/* ==============================================================
                5. LAYER 6: NON-OVERLAPPING LABELS WITH LEADER LINES (Sections 2, 7, 11)
               ============================================================== */}
            {showVectors && (
              <g>
                {/* 6A. Joint Callout Labels (Non-Overlapping) */}
                {joints.map((joint) => {
                  if (!showPerimeterPlan && joint.surface !== 'face') return null;
                  const placement = nonOverlappingSheetLabels.jointPlacements[joint.id];
                  if (!placement) return null;
                  const palette = JOINT_SET_PALETTE[joint.set] || { color: '#0F172A' };
                  const estSuffix =
                    joint.orientationStatus === 'ESTIMATED' ||
                    joint.orientationStatus === 'APPARENT_ORIENTATION'
                      ? '*'
                      : joint.orientationStatus === 'REQUIRES_CONFIRMATION' ||
                        joint.orientationStatus === 'INSUFFICIENT_3D_CONSTRAINT'
                      ? '?'
                      : '';
                  const textStr =
                    joint.customLabel ||
                    `${joint.jointNumber ? `${joint.jointNumber} ` : ''}${joint.set}:${String(
                      Math.round(joint.dipDirection)
                    ).padStart(3, '0')}°/${String(Math.round(joint.dip)).padStart(2, '0')}°${estSuffix}${
                      showConfidenceLabels ? ` [${joint.confidence[0]}]` : ''
                    }`;

                  return (
                    <g key={`sheet-j-lbl-${joint.id}`}>
                      {placement.needsLeader && (
                        <line
                          x1={placement.anchorX}
                          y1={placement.anchorY}
                          x2={placement.leaderTargetX}
                          y2={placement.leaderTargetY}
                          stroke={palette.color}
                          strokeWidth="0.85"
                          strokeDasharray="2,2"
                        />
                      )}
                      <rect
                        x={placement.boxX}
                        y={placement.boxY}
                        width={placement.boxW}
                        height={placement.boxH}
                        rx="2"
                        fill="#FFFFFF"
                        fillOpacity="0.92"
                        stroke={palette.color}
                        strokeWidth="0.8"
                      />
                      <text
                        x={placement.boxX + 4}
                        y={placement.boxY + 10}
                        fontSize="8.5"
                        fontWeight="700"
                        fill="#0F172A"
                      >
                        {textStr}
                      </text>
                    </g>
                  );
                })}

                {/* 6B. Placed Geological Symbol Labels (Non-Overlapping) */}
                {placedSymbols
                  .filter((sym) => sym.visible !== false && (showPerimeterPlan || sym.surface === 'face'))
                  .map((sym) => {
                    const placement = nonOverlappingSheetLabels.symbolPlacements[sym.id];
                    if (!placement) return null;
                    const meta = getStructuralSymbolMeta(sym.symbolType);
                    const color = sym.color || meta.sheetColor;
                    return (
                      <g key={`sheet-sym-lbl-${sym.id}`}>
                        {placement.needsLeader && (
                          <line
                            x1={placement.anchorX}
                            y1={placement.anchorY}
                            x2={placement.leaderTargetX}
                            y2={placement.leaderTargetY}
                            stroke={color}
                            strokeWidth="0.85"
                            strokeDasharray="2,2"
                          />
                        )}
                        <rect
                          x={placement.boxX}
                          y={placement.boxY}
                          width={placement.boxW}
                          height={placement.boxH}
                          rx="2"
                          fill="#FFFFFF"
                          fillOpacity="0.92"
                          stroke={color}
                          strokeWidth="0.8"
                        />
                        <text
                          x={placement.boxX + 4}
                          y={placement.boxY + 10}
                          fontSize="8.5"
                          fontWeight="700"
                          fill="#0F172A"
                        >
                          {sym.label} ({String(Math.round(sym.dipDirectionDeg)).padStart(3, '0')}°/
                          {String(Math.round(sym.dipDeg)).padStart(2, '0')}°
                          {sym.uncertainOrientation ? '?' : ''})
                        </text>
                      </g>
                    );
                  })}

                {/* 6C. Survey Control Points & Multi-Line Non-Overlapping Labels (Sections 5, 6, 7) */}
                {controlPoints
                  .filter((cp) => cp.visible !== false && (showPerimeterPlan || cp.surface === 'face'))
                  .map((cp) => {
                    const pt = surfacePointToSheetXY(cp.point, cp.surface);
                    const placement = nonOverlappingSheetLabels.cpPlacements[cp.id];
                    return (
                      <g key={`sheet-cp-${cp.id}`}>
                        {/* Leader line if displaced */}
                        {placement && (
                          <line
                            x1={pt.x}
                            y1={pt.y}
                            x2={placement.leaderTargetX}
                            y2={placement.leaderTargetY}
                            stroke="#059669"
                            strokeWidth="0.95"
                            strokeDasharray={placement.needsLeader ? '3,2' : undefined}
                          />
                        )}
                        {/* Survey Control Point Target Marker at exact survey location */}
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="5.5"
                          fill="#FFFFFF"
                          stroke="#059669"
                          strokeWidth="1.6"
                        />
                        <line x1={pt.x - 7.5} y1={pt.y} x2={pt.x + 7.5} y2={pt.y} stroke="#059669" strokeWidth="1.3" />
                        <line x1={pt.x} y1={pt.y - 7.5} x2={pt.x} y2={pt.y + 7.5} stroke="#059669" strokeWidth="1.3" />

                        {/* Multi-line Control Point Callout Box: CP1 / X: 2.93 m / Y: -2.98 m */}
                        {placement && (
                          <g transform={`translate(${placement.boxX}, ${placement.boxY})`}>
                            <rect
                              x="0"
                              y="0"
                              width={placement.boxW}
                              height={placement.boxH}
                              rx="2.5"
                              fill="#FFFFFF"
                              fillOpacity="0.95"
                              stroke="#059669"
                              strokeWidth="1"
                            />
                            <text x="5" y="10.5" fontSize="8.5" fontWeight="700" fill="#065F46">
                              {cp.label}
                            </text>
                            <text x="5" y="20.5" fontSize="7.8" fontWeight="600" fill="#0F172A">
                              X: {cp.point.x.toFixed(2)} m
                            </text>
                            <text x="5" y="30" fontSize="7.8" fontWeight="600" fill="#0F172A">
                              Y: {cp.point.y.toFixed(2)} m
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
              </g>
            )}

            {/* ==============================================================
                6. LAYER 7: TUNNEL FACE ENGINEERING DIMENSIONS (Priority 5)
               ============================================================== */}
            <g>
              {/* Bottom Width Dimension Line */}
              <g transform={`translate(0, ${faceBottomY + 20})`}>
                <line
                  x1={faceCenterX - faceWidthPx / 2}
                  y1="-14"
                  x2={faceCenterX - faceWidthPx / 2}
                  y2="6"
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1={faceCenterX + faceWidthPx / 2}
                  y1="-14"
                  x2={faceCenterX + faceWidthPx / 2}
                  y2="6"
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1={faceCenterX - faceWidthPx / 2}
                  y1="0"
                  x2={faceCenterX + faceWidthPx / 2}
                  y2="0"
                  stroke="#0F172A"
                  strokeWidth="1.2"
                />
                <rect
                  x={faceCenterX - 78}
                  y="-9"
                  width="156"
                  height="17"
                  fill="#FFFFFF"
                />
                <text
                  x={faceCenterX}
                  y="3.5"
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  TUNNEL WIDTH = {geometry.width.toFixed(2)} m
                </text>
              </g>

              {/* Left Wall Height Dimension Line */}
              <g transform={`translate(${faceCenterX - faceWidthPx / 2 - 22}, 0)`}>
                <line
                  x1="-5"
                  y1={faceBottomY}
                  x2="16"
                  y2={faceBottomY}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1="-5"
                  y1={faceBottomY - geometry.wallHeight * facePxPerMeter}
                  x2="16"
                  y2={faceBottomY - geometry.wallHeight * facePxPerMeter}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1="0"
                  y1={faceBottomY}
                  x2="0"
                  y2={faceBottomY - geometry.wallHeight * facePxPerMeter}
                  stroke="#0F172A"
                  strokeWidth="1.2"
                />
                <text
                  x="-8"
                  y={faceBottomY - (geometry.wallHeight * facePxPerMeter) / 2}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill="#0F172A"
                  transform={`rotate(-90, -8, ${faceBottomY - (geometry.wallHeight * facePxPerMeter) / 2})`}
                >
                  WALL HT = {geometry.wallHeight.toFixed(2)} m
                </text>
              </g>

              {/* Right Total Height Dimension Line */}
              <g transform={`translate(${faceCenterX + faceWidthPx / 2 + 22}, 0)`}>
                <line
                  x1="-16"
                  y1={faceBottomY}
                  x2="5"
                  y2={faceBottomY}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1="-16"
                  y1={faceTopY}
                  x2="5"
                  y2={faceTopY}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <line
                  x1="0"
                  y1={faceBottomY}
                  x2="0"
                  y2={faceTopY}
                  stroke="#0F172A"
                  strokeWidth="1.2"
                />
                <text
                  x="11"
                  y={(faceTopY + faceBottomY) / 2}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill="#0F172A"
                  transform={`rotate(90, 11, ${(faceTopY + faceBottomY) / 2})`}
                >
                  TOTAL HT = {geometry.height.toFixed(2)} m (CROWN R={geometry.crownRadius.toFixed(2)}m)
                </text>
              </g>
            </g>

            {/* ==============================================================
                7. RIGHT ENGINEERING COLUMN: COMPASS, GEOLOGICAL LEGEND,
                   NON-INTERSECTING JOINT DATA TABLE & BARTON Q-INDEX BLOCK
               ============================================================== */}
            {showTitleAndTables && (
              <g clipPath="url(#sheet-right-col-clip)">
                {/* 7A. Structural Orientation & Tunnel Drive Azimuth Compass */}
                <g transform={`translate(${orientationBlock.x}, ${orientationBlock.y})`}>
                  <rect
                    x="0"
                    y="0"
                    width={orientationBlock.width}
                    height={orientationBlock.height}
                    fill="#F8FAFC"
                    stroke="#0F172A"
                    strokeWidth="1.2"
                  />
                  <text x="12" y="18" fontSize="10.5" fontWeight="700" fill="#0F172A">
                    DRIVE DIRECTION &amp; STEREOGRAPHIC POLE SUMMARY
                  </text>

                  {/* Stereonet Circle */}
                  <g transform="translate(72, 80)">
                    <circle cx="0" cy="0" r="46" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.3" />
                    <circle cx="0" cy="0" r="31" fill="none" stroke="#94A3B8" strokeWidth="0.6" strokeDasharray="2,2" />
                    <circle cx="0" cy="0" r="16" fill="none" stroke="#94A3B8" strokeWidth="0.6" strokeDasharray="2,2" />
                    <line x1="-49" y1="0" x2="49" y2="0" stroke="#94A3B8" strokeWidth="0.7" />
                    <line x1="0" y1="-49" x2="0" y2="49" stroke="#94A3B8" strokeWidth="0.7" />
                    <text x="0" y="-51" textAnchor="middle" fontSize="8" fontWeight="700" fill="#0F172A">N</text>
                    <text x="55" y="3" textAnchor="middle" fontSize="7.5" fill="#475569">E</text>
                    <text x="0" y="58" textAnchor="middle" fontSize="7.5" fill="#475569">S</text>
                    <text x="-55" y="3" textAnchor="middle" fontSize="7.5" fill="#475569">W</text>

                    {/* Drive Azimuth Vector */}
                    {(() => {
                      const rad = ((settings.driveDirection - 90) * Math.PI) / 180;
                      const ax = Math.cos(rad) * 41;
                      const ay = Math.sin(rad) * 41;
                      return (
                        <line
                          x1="0"
                          y1="0"
                          x2={ax}
                          y2={ay}
                          stroke="#0F172A"
                          strokeWidth="2.2"
                        />
                      );
                    })()}

                    {/* Plot Dip Direction poles for each joint */}
                    {joints.map((j) => {
                      const rad = ((j.dipDirection - 90) * Math.PI) / 180;
                      const r = (j.dip / 90) * 42;
                      const px = Math.cos(rad) * r;
                      const py = Math.sin(rad) * r;
                      const color = JOINT_SET_PALETTE[j.set]?.color || '#DC2626';
                      return (
                        <circle
                          key={`pole-${j.id}`}
                          cx={px}
                          cy={py}
                          r="3"
                          fill={color}
                          stroke="#FFFFFF"
                          strokeWidth="0.6"
                        />
                      );
                    })}
                  </g>

                  <g transform="translate(144, 34)">
                    <text x="0" y="0" fontSize="9.5" fontWeight="700" fill="#0F172A">
                      TUNNEL DRIVE AZIMUTH: N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                    </text>
                    <text x="0" y="16" fontSize="8.5" fill="#334155">
                      · Left Wall Normal: N {String(Math.round((settings.driveDirection + 270) % 360)).padStart(3, '0')}° E · Right Wall: N {String(Math.round((settings.driveDirection + 90) % 360)).padStart(3, '0')}° E
                    </text>
                    <text x="0" y="32" fontSize="8.5" fill="#334155">
                      · Convention: Dip Direction (000°–360°) / Dip Angle (00°–90°)
                    </text>
                    <text x="0" y="48" fontSize="8" fill="#475569">
                      * / ? Marks uncertain or single-surface apparent orientations.
                    </text>
                    <text x="0" y="66" fontSize="8.5" fontWeight="700" fill="#0F172A">
                      MAPPED TRACES: {joints.length} ({jointSets.length} Sets) · SYMBOLS: {placedSymbols.length} · CONTROL PTS: {controlPoints.length}
                    </text>
                  </g>
                </g>

                {/* 7B. Professional Geological & Lithological Legend (Priority 4) */}
                <g transform={`translate(${legendBlock.x}, ${legendBlock.y})`}>
                  <rect
                    x="0"
                    y="0"
                    width={legendBlock.width}
                    height={legendBlock.height}
                    fill="#F8FAFC"
                    stroke="#0F172A"
                    strokeWidth="1.2"
                  />
                  <text x="12" y="18" fontSize="10.5" fontWeight="700" fill="#0F172A">
                    GEOLOGICAL &amp; LITHOLOGICAL MAPPING LEGEND
                  </text>
                  <line x1="0" y1="25" x2={legendBlock.width} y2="25" stroke="#0F172A" strokeWidth="0.8" />

                  {/* Column 1: Structural Symbols */}
                  <g transform="translate(14, 40)">
                    <line x1="0" y1="0" x2="32" y2="0" stroke="#DC2626" strokeWidth="2" />
                    <line x1="16" y1="0" x2="16" y2="7" stroke="#DC2626" strokeWidth="1.6" />
                    <text x="40" y="3" fontSize="8.5" fill="#0F172A">
                      Joint Trace + Dip Dir / Dip
                    </text>

                    <line x1="0" y1="22" x2="32" y2="22" stroke="#0284C7" strokeWidth="2" strokeDasharray="6,3" />
                    <polygon points="12,22 20,22 16,29" fill="none" stroke="#0284C7" strokeWidth="1.3" />
                    <text x="40" y="25" fontSize="8.5" fill="#0F172A">
                      Bedding (S0) / Foliation (S1)
                    </text>

                    <line x1="0" y1="45" x2="32" y2="45" stroke="#E11D48" strokeWidth="5.5" strokeOpacity="0.22" />
                    <line x1="0" y1="45" x2="32" y2="45" stroke="#E11D48" strokeWidth="2.2" strokeDasharray="8,2,2,2" />
                    <polygon points="12,45 20,45 16,52" fill="#E11D48" />
                    <text x="40" y="48" fontSize="8.5" fill="#0F172A">
                      Fault / Shear Zone / Gouge
                    </text>

                    <path d="M 2 68 Q 9 63 16 68 T 30 68" fill="none" stroke="#0284C7" strokeWidth="1.6" />
                    <text x="40" y="71" fontSize="8.5" fill="#0F172A">
                      Water Seepage / Flow / Vein
                    </text>

                    <circle cx="16" cy="92" r="4.5" fill="#FFFFFF" stroke="#059669" strokeWidth="1.5" />
                    <line x1="10" y1="92" x2="22" y2="92" stroke="#059669" strokeWidth="1.2" />
                    <line x1="16" y1="86" x2="16" y2="98" stroke="#059669" strokeWidth="1.2" />
                    <text x="40" y="95" fontSize="8.5" fill="#0F172A">
                      Survey Control Point (CP)
                    </text>
                  </g>

                  {/* Column 2: Active Lithology Units & Standard Rock Patterns */}
                  <g transform="translate(262, 34)">
                    {(lithologyRegions.length > 0
                      ? Array.from(
                          new Map(lithologyRegions.map((r) => [r.patternType, r])).values()
                        ).slice(0, 5)
                      : [
                          { patternType: 'quartzite', lithologyName: 'Quartzite', colorHex: '#EAB308' },
                          { patternType: 'phyllite', lithologyName: 'Phyllite / Schist', colorHex: '#38BDF8' },
                          { patternType: 'granite', lithologyName: 'Granite / Gneiss', colorHex: '#FB7185' },
                          { patternType: 'dolerite', lithologyName: 'Dolerite / Basalt', colorHex: '#475569' },
                          { patternType: 'shear_zone', lithologyName: 'Shear / Breccia Zone', colorHex: '#EF4444' },
                        ]
                    ).map((unit, uIdx) => (
                      <g key={`leg-lith-${uIdx}`} transform={`translate(0, ${uIdx * 23})`}>
                        <rect
                          x="0"
                          y="0"
                          width="32"
                          height="14"
                          fill={unit.colorHex}
                          fillOpacity="0.2"
                          stroke="#334155"
                          strokeWidth="0.8"
                        />
                        <rect
                          x="0"
                          y="0"
                          width="32"
                          height="14"
                          fill={`url(#sheet-lith-${unit.patternType})`}
                          stroke="#334155"
                          strokeWidth="0.8"
                        />
                        <text x="40" y="10.5" fontSize="8.5" fontWeight="600" fill="#0F172A">
                          {unit.lithologyName.slice(0, 26)}
                        </text>
                      </g>
                    ))}
                  </g>
                </g>

                {/* 7C. When ENGINEERING_QUANTITY_SHEET: Regional Overbreak & Undercut Breakdown Table; otherwise Discontinuity-Set Table */}
                {outputMode === 'ENGINEERING_QUANTITY_SHEET' ? (
                  <>
                    <g transform={`translate(${jointTableBlock.x}, ${jointTableBlock.y})`}>
                      <rect
                        x="0"
                        y="0"
                        width={jointTableBlock.width}
                        height={jointTableBlock.height}
                        fill="#FFFFFF"
                        stroke="#0F172A"
                        strokeWidth="1.4"
                      />
                      <rect x="0" y="0" width={jointTableBlock.width} height="23" fill="#0F172A" />
                      <text x="12" y="15.5" fontSize="9.5" fontWeight="700" fill="#FFFFFF">
                        OVERBREAK &amp; UNDERCUT REGIONAL BREAKDOWN (REASONS &amp; LINKED SETS)
                      </text>
                      <g transform="translate(0, 23)">
                        <rect x="0" y="0" width={jointTableBlock.width} height="20" fill="#F1F5F9" stroke="#0F172A" strokeWidth="0.8" />
                        <text x="8" y="13.5" fontSize="7.8" fontWeight="700" fill="#0F172A">ZONE</text>
                        <text x="58" y="13.5" fontSize="7.8" fontWeight="700" fill="#0F172A">SECTOR</text>
                        <text x="150" y="13.5" fontSize="7.8" fontWeight="700" fill="#0F172A">AREA / %</text>
                        <text x="228" y="13.5" fontSize="7.8" fontWeight="700" fill="#0F172A">MAX RAD.</text>
                        <text x="290" y="13.5" fontSize="7.8" fontWeight="700" fill="#0F172A">REASON CATEGORY &amp; LINKED SETS</text>
                      </g>
                      {(() => {
                        const zones = [
                          ...(overbreakAnalysis?.overbreakRegions || []),
                          ...(overbreakAnalysis?.undercutRegions || []),
                        ];
                        if (zones.length === 0) {
                          return (
                            <text x={jointTableBlock.width / 2} y="95" textAnchor="middle" fontSize="9" fill="#64748B">
                              Connect Survey Control Points (CP1→CP2→...) to compute Overbreak &amp; Undercut zones.
                            </text>
                          );
                        }
                        return zones.slice(0, 6).map((z, idx) => {
                          const rowH = 36;
                          const rowY = 43 + idx * rowH;
                          const isOB = z.type === 'OVERBREAK';
                          return (
                            <g key={z.id} transform={`translate(0, ${rowY})`}>
                              <rect
                                x="0"
                                y="0"
                                width={jointTableBlock.width}
                                height={rowH}
                                fill={idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'}
                                stroke="#CBD5E1"
                                strokeWidth="0.6"
                              />
                              <rect
                                x="6"
                                y="6"
                                width="44"
                                height="16"
                                rx="2"
                                fill={isOB ? '#E11D48' : '#D97706'}
                              />
                              <text x="28" y="17" textAnchor="middle" fontSize="8" fontWeight="700" fill="#FFFFFF">
                                {z.id}
                              </text>
                              <text x="58" y="14" fontSize="8" fontWeight="700" fill="#0F172A">
                                {z.locationLabel.slice(0, 16)}
                              </text>
                              <text x="58" y="26" fontSize="7.2" fill="#475569">
                                Perim: {z.affectedPerimeterMeters.toFixed(2)}m
                              </text>
                              <text x="150" y="14" fontSize="8.5" fontWeight="700" fill={isOB ? '#BE123C' : '#B45309'}>
                                {isOB ? '+' : '-'}{z.areaSqMeters.toFixed(2)} m²
                              </text>
                              <text x="150" y="26" fontSize="7.5" fill="#475569">
                                ({z.percentageOfDesign.toFixed(1)}% of Design)
                              </text>
                              <text x="228" y="18" fontSize="8.5" fontWeight="700" fill="#0F172A">
                                {isOB ? '+' : '-'}{z.maxRadialMeters.toFixed(2)} m
                              </text>
                              <text x="290" y="13" fontSize="7.8" fontWeight="700" fill="#0F172A">
                                [{z.reasonCategory === 'GEOLOGICAL' ? 'GEOLOGICAL' : 'MECHANICAL'}]{' '}
                                {z.linkedJointSets
                                  ? `(${Array.isArray(z.linkedJointSets) ? z.linkedJointSets.join(', ') : z.linkedJointSets})`
                                  : ''}
                              </text>
                              <text x="290" y="25" fontSize="7.2" fill="#334155">
                                {z.reasonDetail.slice(0, 36)}
                              </text>
                            </g>
                          );
                        });
                      })()}
                    </g>

                    {/* 7D. EXCAVATION QUANTITY & MULTI-SECTION VOLUME BLOCK */}
                    <g transform={`translate(${qIndexAndNotesBlock.x}, ${qIndexAndNotesBlock.y})`}>
                      <rect
                        x="0"
                        y="0"
                        width={qIndexAndNotesBlock.width}
                        height={qIndexAndNotesBlock.height}
                        fill="#F8FAFC"
                        stroke="#0F172A"
                        strokeWidth="1.4"
                      />
                      <rect x="0" y="0" width={qIndexAndNotesBlock.width} height="23" fill="#0F172A" />
                      <text x="12" y="15.5" fontSize="9.5" fontWeight="700" fill="#FFFFFF">
                        EXCAVATION QUANTITY SUMMARY &amp; SECTION-TO-SECTION VOLUMES
                      </text>

                      <rect
                        x="8"
                        y="29"
                        width={qIndexAndNotesBlock.width - 16}
                        height="58"
                        fill="#FFFFFF"
                        stroke="#CBD5E1"
                        strokeWidth="0.9"
                      />
                      <text x="14" y="43" fontSize="8.5" fontWeight="700" fill="#0F172A">
                        DESIGN AREA: {overbreakAnalysis ? overbreakAnalysis.designAreaSqMeters.toFixed(2) : '0.00'} m² · SURVEYED AREA: {overbreakAnalysis ? overbreakAnalysis.surveyedAreaSqMeters.toFixed(2) : '0.00'} m² · PULL: {settings.roundLength.toFixed(2)} m
                      </text>
                      <text x="14" y="58" fontSize="8.5" fontWeight="700" fill="#BE123C">
                        OVERBREAK: +{overbreakAnalysis ? overbreakAnalysis.overbreakAreaSqMeters.toFixed(2) : '0.00'} m² ({overbreakAnalysis ? overbreakAnalysis.overbreakPercent.toFixed(2) : '0.00'}%) · Max +{overbreakAnalysis ? overbreakAnalysis.maxRadialOverbreakMeters.toFixed(2) : '0.00'}m · Vol: {overbreakAnalysis?.overbreakVolumeCubicMeters !== null && overbreakAnalysis?.overbreakVolumeCubicMeters !== undefined ? `+${overbreakAnalysis.overbreakVolumeCubicMeters.toFixed(2)} m³` : 'Requires Pull Interval'}
                      </text>
                      <text x="14" y="73" fontSize="8.5" fontWeight="700" fill="#B45309">
                        UNDERCUT: -{overbreakAnalysis ? overbreakAnalysis.undercutAreaSqMeters.toFixed(2) : '0.00'} m² ({overbreakAnalysis ? overbreakAnalysis.undercutPercent.toFixed(2) : '0.00'}%) · Max -{overbreakAnalysis ? overbreakAnalysis.maxRadialUndercutMeters.toFixed(2) : '0.00'}m · Vol: {overbreakAnalysis?.undercutVolumeCubicMeters !== null && overbreakAnalysis?.undercutVolumeCubicMeters !== undefined ? `-${overbreakAnalysis.undercutVolumeCubicMeters.toFixed(2)} m³` : 'Requires Pull Interval'}
                      </text>

                      <text x="12" y="102" fontSize="8" fontWeight="700" fill="#0F172A">
                        PRIMARY OVERBREAK REASON: [{overbreakAnalysis?.overallOverbreakCategory || 'GEOLOGICAL'}] {(overbreakAnalysis?.overallOverbreakReason || '').slice(0, 52)}
                      </text>
                      <text x="12" y="116" fontSize="8" fontWeight="700" fill="#334155">
                        PRIMARY UNDERCUT REASON: [{overbreakAnalysis?.overallUndercutCategory || 'MECHANICAL_EXCAVATION'}] {(overbreakAnalysis?.overallUndercutReason || '').slice(0, 50)}
                      </text>

                      <line x1="8" y1="123" x2={qIndexAndNotesBlock.width - 8} y2="123" stroke="#CBD5E1" strokeWidth="0.8" />
                      <text x="12" y="136" fontSize="8" fontWeight="700" fill="#0F172A">
                        MULTI-SECTION VOLUME SUMMARY (AVERAGE END AREA &amp; PRISMOIDAL):
                      </text>
                      {sectionVolumeRows.length === 0 ? (
                        <text x="12" y="152" fontSize="8" fill="#475569">
                          Single cross-section active ({settings.faceChainage}). Save 2+ sections in Project Memory for section-to-section volumes.
                        </text>
                      ) : (
                        sectionVolumeRows.slice(0, 2).map((vr, vIdx) => (
                          <text key={vr.id} x="12" y={150 + vIdx * 14} fontSize="7.8" fill="#0F172A">
                            · {vr.fromChainageLabel} → {vr.toChainageLabel} (L={vr.intervalLengthMeters.toFixed(1)}m): Design={vr.designVolumeCubicMeters.toFixed(1)}m³ | Survey={vr.surveyedVolumeCubicMeters.toFixed(1)}m³ | OB=+{vr.overbreakVolumeAvgEndAreaCubicMeters.toFixed(2)}m³ | UC=-{vr.undercutVolumeAvgEndAreaCubicMeters.toFixed(2)}m³
                          </text>
                        ))
                      )}

                      <line
                        x1="8"
                        y1={qIndexAndNotesBlock.height - 24}
                        x2={qIndexAndNotesBlock.width - 8}
                        y2={qIndexAndNotesBlock.height - 24}
                        stroke="#CBD5E1"
                        strokeWidth="0.7"
                      />
                      <text
                        x="12"
                        y={qIndexAndNotesBlock.height - 10}
                        fontSize="8"
                        fontWeight="700"
                        fill="#0F172A"
                      >
                        CHIEF SURVEYOR SIGN: ____________________ · ENGINEERING GEOLOGIST SIGN: ____________________
                      </text>
                    </g>
                  </>
                ) : (
                  <>
                {/* 7C. Non-Intersecting Discontinuity-Set & Structural Data Table (Section 16) */}
                <g transform={`translate(${jointTableBlock.x}, ${jointTableBlock.y})`}>
                  <rect
                    x="0"
                    y="0"
                    width={jointTableBlock.width}
                    height={jointTableBlock.height}
                    fill="#FFFFFF"
                    stroke="#0F172A"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="0"
                    y="0"
                    width={jointTableBlock.width}
                    height="23"
                    fill="#0F172A"
                  />
                  <text x="12" y="15.5" fontSize="10" fontWeight="700" fill="#FFFFFF">
                    DISCONTINUITY-SET &amp; STRUCTURAL PARAMETERS TABLE
                  </text>

                  {/* Strictly Partitioned Table Columns with Vertical Dividers (Zero Intersection!) */}
                  <g transform="translate(0, 23)">
                    <rect x="0" y="0" width={jointTableBlock.width} height="20" fill="#F1F5F9" stroke="#0F172A" strokeWidth="0.8" />
                    <line x1="44" y1="0" x2="44" y2={jointTableBlock.height - 23} stroke="#CBD5E1" strokeWidth="0.7" />
                    <line x1="138" y1="0" x2="138" y2={jointTableBlock.height - 23} stroke="#CBD5E1" strokeWidth="0.7" />
                    <line x1="214" y1="0" x2="214" y2={jointTableBlock.height - 23} stroke="#CBD5E1" strokeWidth="0.7" />
                    <line x1="278" y1="0" x2="278" y2={jointTableBlock.height - 23} stroke="#CBD5E1" strokeWidth="0.7" />
                    <line x1="348" y1="0" x2="348" y2={jointTableBlock.height - 23} stroke="#CBD5E1" strokeWidth="0.7" />

                    <text x="8" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">SET</text>
                    <text x="49" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">DIP DIR / DIP</text>
                    <text x="143" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">SPACING</text>
                    <text x="219" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">PERSIST.</text>
                    <text x="283" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">APERTURE</text>
                    <text x="353" y="13.5" fontSize="8" fontWeight="700" fill="#0F172A">ROUGHNESS / INFILL</text>
                  </g>

                  {jointSets.length === 0 ? (
                    <text x={jointTableBlock.width / 2} y="95" textAnchor="middle" fontSize="9.5" fill="#64748B">
                      No discontinuity sets plotted yet. Run AI Trace or Add Joint.
                    </text>
                  ) : (
                    jointSets.slice(0, 7).map((js, idx) => {
                      const availRowsH = jointTableBlock.height - 45;
                      const rowH = Math.min(42, Math.max(32, Math.floor(availRowsH / Math.max(1, Math.min(7, jointSets.length)))));
                      const rowY = 43 + idx * rowH;
                      return (
                        <g key={js.id} transform={`translate(0, ${rowY})`}>
                          <rect
                            x="0"
                            y="0"
                            width={jointTableBlock.width}
                            height={rowH}
                            fill={idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'}
                            stroke="#CBD5E1"
                            strokeWidth="0.6"
                          />
                          <rect x="6" y="6" width="32" height="16" rx="2" fill={js.color} />
                          <text
                            x="22"
                            y="17"
                            textAnchor="middle"
                            fontSize="8.5"
                            fontWeight="700"
                            fill="#FFFFFF"
                          >
                            {js.id}
                          </text>
                          <text x="49" y="14" fontSize="8.5" fontWeight="700" fill="#0F172A">
                            {js.orientation.slice(0, 15)}
                          </text>
                          <text x="49" y="26" fontSize="7.5" fill="#475569">
                            Str: {js.avgStrike !== null ? `${String(js.avgStrike).padStart(3, '0')}°` : 'N/A'} ({js.jointCount || 1}j)
                          </text>

                          {/* Strictly truncated cell text so columns never intersect */}
                          <text x="143" y="18" fontSize="8" fill="#0F172A">
                            {js.spacing.slice(0, 12)}
                          </text>
                          <text x="219" y="18" fontSize="8" fill="#0F172A">
                            {js.persistence.slice(0, 10)}
                          </text>
                          <text x="283" y="18" fontSize="8" fill="#0F172A">
                            {js.aperture.slice(0, 11)}
                          </text>
                          <text x="353" y="13" fontSize="7.5" fontWeight="600" fill="#0F172A">
                            {js.roughness.slice(0, 25)}
                          </text>
                          <text x="353" y="23" fontSize="7.2" fill="#334155">
                            Infill: {js.infilling.slice(0, 21)} · {js.water}
                          </text>
                        </g>
                      );
                    })
                  )}
                </g>

                {/* 7D. BARTON Q-INDEX (Priority 7) & GEOLOGICAL DESCRIPTION / NOTES (Priority 8) */}
                <g transform={`translate(${qIndexAndNotesBlock.x}, ${qIndexAndNotesBlock.y})`}>
                  <rect
                    x="0"
                    y="0"
                    width={qIndexAndNotesBlock.width}
                    height={qIndexAndNotesBlock.height}
                    fill="#F8FAFC"
                    stroke="#0F172A"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="0"
                    y="0"
                    width={qIndexAndNotesBlock.width}
                    height="23"
                    fill="#0F172A"
                  />
                  <text x="12" y="15.5" fontSize="10" fontWeight="700" fill="#FFFFFF">
                    BARTON Q-INDEX (NGI ROCK MASS RATING) &amp; GEOLOGY DESCRIPTION
                  </text>

                  {/* Formula & 6 Parameters Row */}
                  <rect
                    x="8"
                    y="29"
                    width={qIndexAndNotesBlock.width - 16}
                    height="42"
                    fill="#FFFFFF"
                    stroke="#CBD5E1"
                    strokeWidth="0.9"
                  />
                  <text x="14" y="44" fontSize="8.5" fontWeight="700" fill="#0F172A">
                    Q = (RQD/Jn) × (Jr/Ja) × (Jw/SRF) = ({qIndex.rqd}%/{qResult.effectiveJn}) × ({qIndex.jr}/{qIndex.ja}) × ({qIndex.jw}/{qIndex.srf})
                  </text>
                  <text x="14" y="60" fontSize="8" fill="#334155">
                    RQD: <tspan fontWeight="700" fill="#0F172A">{qIndex.rqd}%</tspan> · Jn: <tspan fontWeight="700" fill="#0F172A">{qResult.effectiveJn}</tspan> · Jr: <tspan fontWeight="700" fill="#0F172A">{qIndex.jr}</tspan> · Ja: <tspan fontWeight="700" fill="#0F172A">{qIndex.ja}</tspan> · Jw: <tspan fontWeight="700" fill="#0F172A">{qIndex.jw}</tspan> · SRF: <tspan fontWeight="700" fill="#0F172A">{qIndex.srf}</tspan>
                  </text>

                  {/* Highlighted Q-Value & Rock Class Box */}
                  <rect
                    x={qIndexAndNotesBlock.width - 134}
                    y="33"
                    width="120"
                    height="34"
                    rx="2"
                    fill="#0F172A"
                  />
                  <text
                    x={qIndexAndNotesBlock.width - 74}
                    y="47"
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="700"
                    fill="#38BDF8"
                  >
                    Q = {qResult.qValue.toFixed(3)}
                  </text>
                  <text
                    x={qIndexAndNotesBlock.width - 74}
                    y="60"
                    textAnchor="middle"
                    fontSize="7.5"
                    fontWeight="700"
                    fill="#FFFFFF"
                  >
                    {qResult.rockMassClass.toUpperCase()}
                  </text>

                  <text x="12" y="86" fontSize="8.5" fontWeight="700" fill="#0F172A">
                    EST. RMR89: {qResult.estimatedRmr} · ESR: {qIndex.esr} · De: {qResult.equivalentDimensionDe.toFixed(2)}m · SUPPORT: <tspan fontWeight="600">{qResult.recommendedSupport.slice(0, 42)}</tspan>
                  </text>

                  <line
                    x1="8"
                    y1="94"
                    x2={qIndexAndNotesBlock.width - 8}
                    y2="94"
                    stroke="#CBD5E1"
                    strokeWidth="0.8"
                  />

                  {/* Lithology & Geological Description Summary */}
                  <text x="12" y="109" fontSize="8.5" fontWeight="700" fill="#0F172A">
                    LITHOLOGY: <tspan fontWeight="600" fill="#1E293B">{(lithologyRegions[0]?.lithologyName || rockMass.rockType).slice(0, 68)}</tspan>
                  </text>
                  <text x="12" y="124" fontSize="8" fill="#334155">
                    DESCRIPTION: <tspan fontWeight="600" fill="#0F172A">{(lithologyRegions[0]?.description || `${rockMass.weatheringGrade} · ${rockMass.strengthGrade}`).slice(0, 74)}</tspan>
                  </text>
                  <text x="12" y="139" fontSize="8" fill="#334155">
                    STRUCTURAL: <tspan fontWeight="600" fill="#0F172A">{(lithologyRegions[0]?.structuralFeatures || `${rockMass.foliationBeddingSpacing} · ${rockMass.groundwaterCondition}`).slice(0, 74)}</tspan>
                  </text>
                  <text x="12" y="154" fontSize="8" fill="#334155">
                    OVERBREAK / UNDERCUT:{' '}
                    <tspan fontWeight="700" fill="#0F172A">
                      {overbreakAnalysis && overbreakAnalysis.hasValidSurveyProfile
                        ? `OB: +${overbreakAnalysis.overbreakAreaSqMeters.toFixed(2)}m² (${overbreakAnalysis.overbreakPercent.toFixed(1)}%, Max +${overbreakAnalysis.maxRadialOverbreakMeters.toFixed(2)}m) · UC: -${overbreakAnalysis.undercutAreaSqMeters.toFixed(2)}m² (${overbreakAnalysis.undercutPercent.toFixed(1)}%) · Vol: ${
                            overbreakAnalysis.overbreakVolumeCubicMeters !== null
                              ? `+${overbreakAnalysis.overbreakVolumeCubicMeters.toFixed(2)}m³`
                              : overbreakAnalysis.volumeStatusMessage
                          }`.slice(0, 74)
                        : `${rockMass.overbreakCondition} · ${rockMass.installedSupport}`.slice(0, 66)}
                    </tspan>
                  </text>
                  <text x="12" y="169" fontSize="8" fill="#475569">
                    NOTES: <tspan fontWeight="600" fill="#0F172A">{(lithologyRegions[0]?.notes || rockMass.geologistRemarks || '').slice(0, 78)}</tspan>
                  </text>

                  <line
                    x1="8"
                    y1={qIndexAndNotesBlock.height - 24}
                    x2={qIndexAndNotesBlock.width - 8}
                    y2={qIndexAndNotesBlock.height - 24}
                    stroke="#CBD5E1"
                    strokeWidth="0.7"
                  />
                  <text
                    x="12"
                    y={qIndexAndNotesBlock.height - 10}
                    fontSize="8"
                    fontWeight="700"
                    fill="#0F172A"
                  >
                    ENGINEERING GEOLOGIST SIGN: ____________________ · RESIDENT ENGINEER SIGN: ____________________
                  </text>
                </g>
                  </>
                )}
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};
