import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useContainerResizeObserver, useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { ThemeToggleButton, useTheme } from '../context/ThemeContext';
import {
  Joint,
  JointSet,
  LithologyRegion,
  OutputSheetMode,
  OverbreakUndercutAnalysis,
  PhotoSurface,
  PlacedGeologicalSymbol,
  QIndexParameters,
  QSystemParamKey,
  RmrParameters,
  RockMassClassificationMethodId,
  RockMassSummaryTable,
  GsiParameters,
  ParameterInputStatus,
  SavedProjectRecord,
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
} from '../engine/photoWarpEngine';
import {
  exportMappedGeologicalSheetToDXF,
  triggerDownloadDXFSheet,
} from '../engine/kinematicsSupportAndDxfEngine';
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
  saveSheetConfigToStorage,
  SheetLayoutArrangement,
  wrapSheetTextLines,
} from '../engine/sheetLayoutEngine';
import {
  calculateBieniawskiRmr,
  calculateHoekGsi,
  createDefaultGsiParameters,
  createDefaultQParamStatus,
  createDefaultRmrParameters,
  evaluateQSystemWithValidation,
} from '../engine/rockMassClassificationEngine';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode,
  Image as ImageIcon,
  Maximize2,
  PanelLeft,
  PanelRight,
  Printer,
  Sliders,
  X,
} from 'lucide-react';
import { SheetSettingsAndStorageEditor } from './SheetSettingsAndStorageEditor';

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
  qParamStatus?: Record<QSystemParamKey, ParameterInputStatus>;
  selectedClassificationMethod?: RockMassClassificationMethodId;
  onChangeSelectedClassificationMethod?: (method: RockMassClassificationMethodId) => void;
  rmrParams?: RmrParameters;
  gsiParams?: GsiParameters;
  rockMassSummary?: RockMassSummaryTable;
  lithologyRegions?: LithologyRegion[];
  controlPoints?: SurveyControlPoint[];
  placedSymbols?: PlacedGeologicalSymbol[];
  overbreakAnalysis?: OverbreakUndercutAnalysis;
  sectionVolumeRows?: SectionToSectionVolumeRow[];
  initialOutputMode?: OutputSheetMode;
  onUpdateSettings?: React.Dispatch<React.SetStateAction<TunnelSettings>>;
  savedProjects?: SavedProjectRecord[];
  onSaveCurrentProject?: () => void;
  onLoadProjectRecord?: (record: SavedProjectRecord) => void;
  onDeleteProjectRecord?: (id: string) => void;
  onCreateNextChainageSection?: () => void;
}

export const EngineeringSheetModal: React.FC<EngineeringSheetModalProps> = ({
  isOpen,
  onClose,
  geometry,
  settings: propSettings,
  photos,
  joints,
  jointSets,
  traceFitMode,
  onConfirmAllOrientations,
  qIndexParams: propQIndex,
  qParamStatus: propQParamStatus,
  selectedClassificationMethod = 'Q_SYSTEM',
  onChangeSelectedClassificationMethod,
  rmrParams: propRmrParams,
  gsiParams: propGsiParams,
  rockMassSummary: propRockMass,
  lithologyRegions = [],
  controlPoints = [],
  placedSymbols = [],
  overbreakAnalysis,
  sectionVolumeRows = [],
  initialOutputMode = 'FINAL_ENGINEERING_SHEET',
  onUpdateSettings: propOnUpdateSettings,
  savedProjects = [],
  onSaveCurrentProject,
  onLoadProjectRecord,
  onDeleteProjectRecord,
  onCreateNextChainageSection,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [localSettings, setLocalSettings] = useState<TunnelSettings>(propSettings);
  useEffect(() => {
    setLocalSettings(propSettings);
  }, [propSettings]);

  const settings = propOnUpdateSettings ? propSettings : localSettings;
  const handleUpdateSettings: React.Dispatch<React.SetStateAction<TunnelSettings>> =
    propOnUpdateSettings || setLocalSettings;

  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState<boolean>(false);
  const [drawerDockSide, setDrawerDockSide] = useState<'left' | 'right'>('left');
  const [drawerWidthPx, setDrawerWidthPx] = useState<number>(420);
  const [resizingDrawer, setResizingDrawer] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!resizingDrawer) return;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - resizingDrawer.startX;
      const delta = drawerDockSide === 'left' ? dx : -dx;
      setDrawerWidthPx(
        Math.max(300, Math.min(700, Math.round(resizingDrawer.startWidth + delta)))
      );
    };
    const onUp = () => setResizingDrawer(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingDrawer, drawerDockSide]);
  const [outputMode, setOutputMode] = useState<OutputSheetMode>(initialOutputMode);
  const [overlayOverbreakOnGeology, setOverlayOverbreakOnGeology] = useState<boolean>(false);
  const [overlayJointsOnQuantity, setOverlayJointsOnQuantity] = useState<boolean>(false);
  const [arrangement, setArrangement] = useState<SheetLayoutArrangement>('AUTO_INTELLIGENT');
  const [showConfidenceLabels, setShowConfidenceLabels] = useState<boolean>(false);
  const [sheetZoomMode, setSheetZoomMode] = useState<'auto_fit' | '100' | '125' | '150'>('auto_fit');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const responsive = useResponsiveLayout();
  const previewBounds = useContainerResizeObserver(previewContainerRef, 1280, 820, isOpen);

  useEffect(() => {
    if (isOpen && initialOutputMode) {
      setOutputMode(initialOutputMode);
    }
  }, [isOpen, initialOutputMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    previewBounds.recalculate();
  }, [
    isOpen,
    isSettingsDrawerOpen,
    outputMode,
    arrangement,
    sheetZoomMode,
    responsive.viewportWidth,
    responsive.viewportHeight,
    previewBounds.recalculate,
  ]);

  const qIndex = useMemo(() => propQIndex || createDefaultQIndexParameters(), [propQIndex]);
  const qStatus = useMemo(
    () => propQParamStatus || createDefaultQParamStatus(),
    [propQParamStatus]
  );
  const qResult = useMemo(
    () => evaluateQSystemWithValidation(qIndex, geometry.width, qStatus),
    [qIndex, geometry.width, qStatus]
  );
  const rmr = useMemo(() => propRmrParams || createDefaultRmrParameters(), [propRmrParams]);
  const rmrResult = useMemo(() => calculateBieniawskiRmr(rmr), [rmr]);
  const gsi = useMemo(() => propGsiParams || createDefaultGsiParameters(), [propGsiParams]);
  const gsiResult = useMemo(() => calculateHoekGsi(gsi), [gsi]);
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

  const totalOverbreakZones = useMemo(
    () =>
      (overbreakAnalysis?.overbreakRegions?.length || 0) +
      (overbreakAnalysis?.undercutRegions?.length || 0),
    [overbreakAnalysis]
  );

  const combinedNotesLength = useMemo(() => {
    const desc = lithologyRegions[0]?.description || `${rockMass.weatheringGrade} ${rockMass.strengthGrade}`;
    const struct = lithologyRegions[0]?.structuralFeatures || `${rockMass.foliationBeddingSpacing} ${rockMass.groundwaterCondition}`;
    const notes = lithologyRegions[0]?.notes || rockMass.geologistRemarks || '';
    return desc.length + struct.length + notes.length;
  }, [lithologyRegions, rockMass]);

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
        overbreakZoneCount: totalOverbreakZones,
        notesTextLength: combinedNotesLength,
        placedSymbolCount: placedSymbols.length,
        controlPointCount: controlPoints.length,
        sectionVolumeRowCount: sectionVolumeRows.length,
      }),
    [
      geometry,
      settings,
      photos,
      joints,
      jointSets,
      lithologyRegions,
      outputMode,
      arrangement,
      totalOverbreakZones,
      combinedNotesLength,
      placedSymbols.length,
      controlPoints.length,
      sectionVolumeRows.length,
    ]
  );

  const {
    sheetW,
    sheetH,
    margin,
    showTitleAndTables,
    showPerimeterPlan,
    headerBox,
    drawingArenaBox,
    rightColumnBox,
    contentMetrics,
    effectiveSheetConfig,
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
    leftWallW_px,
    rightWallW_px,
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

  const renderedSheetDimensions = useMemo(() => {
    if (sheetZoomMode !== 'auto_fit') {
      const pct = Number(sheetZoomMode) / 100;
      return {
        width: Math.round(sheetW * pct),
        height: Math.round(sheetH * pct),
      };
    }
    const padX = responsive.isCompactScreen ? 6 : 12;
    const padY = responsive.isCompactScreen ? 6 : 10;
    const availW = Math.max(320, previewBounds.width - padX);
    const availH = Math.max(240, previewBounds.height - padY);
    const fitScale = Math.min(availW / sheetW, availH / sheetH);
    return {
      width: Math.floor(sheetW * fitScale),
      height: Math.floor(sheetH * fitScale),
    };
  }, [
    sheetZoomMode,
    previewBounds.width,
    previewBounds.height,
    previewBounds.revision,
    responsive.isCompactScreen,
    responsive.layoutRevision,
    sheetW,
    sheetH,
  ]);

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
  const getExportReadySvgString = () => {
    if (!svgRef.current) return '';
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `0 0 ${sheetW} ${sheetH}`);
    clone.setAttribute('width', String(sheetW));
    clone.setAttribute('height', String(sheetH));
    clone.style.width = `${sheetW}px`;
    clone.style.height = `${sheetH}px`;
    const serializer = new XMLSerializer();
    return serializer.serializeToString(clone);
  };

  const handleDownloadSVG = () => {
    const svgString = getExportReadySvgString();
    if (!svgString) return;
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
    const svgString = getExportReadySvgString();
    if (!svgString) return;
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
    const dxfContent = exportMappedGeologicalSheetToDXF({
      geometry,
      settings,
      joints,
      jointSets,
      selectedMethod: selectedClassificationMethod,
      qIndexParams: qIndex,
      rmrParams: rmr,
      gsiParams: gsi,
      qValue: qResult.isComplete ? qResult.qValue : null,
      rmrValue: rmrResult.finalRmr,
    });
    triggerDownloadDXFSheet(
      `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_Geological_Sheet.dxf`,
      dxfContent
    );
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
    <div className="fixed inset-0 z-50 flex flex-col h-dvh w-full max-w-full max-h-dvh bg-slate-950/95 backdrop-blur-sm overflow-hidden">
      {/* Top Action & Mode Bar (hidden when printing to PDF) */}
      <div
        className={`no-print flex flex-wrap items-center justify-between gap-2 ${
          responsive.toolbarCompact ? 'px-3 py-1.5' : 'px-5 py-2.5'
        } bg-[#0F141C] border-b border-slate-800 shrink-0`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold text-xs xl:text-sm tracking-wider text-slate-100">
            {outputMode === 'ENGINEERING_QUANTITY_SHEET'
              ? 'OVERBREAK & ENGINEERING QUANTITY SHEET'
              : 'GEOLOGICAL TUNNEL MAPPING SHEET'}
          </span>
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-800">
            {(
              [
                { id: 'FINAL_ENGINEERING_SHEET', label: '1. Geological Mapping Sheet' },
                { id: 'ENGINEERING_QUANTITY_SHEET', label: '2. Overbreak & Quantity Sheet' },
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
                    ? tab.id === 'ENGINEERING_QUANTITY_SHEET'
                      ? 'bg-rose-600 text-white font-bold'
                      : 'bg-cyan-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {outputMode === 'FINAL_ENGINEERING_SHEET' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none px-2 py-1 rounded bg-slate-900 border border-slate-800">
              <input
                type="checkbox"
                checked={overlayOverbreakOnGeology}
                onChange={(e) => setOverlayOverbreakOnGeology(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-rose-500"
              />
              + Overbreak Overlay
            </label>
          )}

          {outputMode === 'ENGINEERING_QUANTITY_SHEET' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none px-2 py-1 rounded bg-slate-900 border border-slate-800">
              <input
                type="checkbox"
                checked={overlayJointsOnQuantity}
                onChange={(e) => setOverlayJointsOnQuantity(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500"
              />
              + Geology Traces Overlay
            </label>
          )}

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

          {/* Quick Toggle: Adaptive Layout (Auto-Resizing) vs Fixed Layout (Manual Control) */}
          <div
            className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-800"
            title="Switch between Adaptive Layout (auto-font/table resizing) and Fixed Layout (manual control)"
          >
            <button
              type="button"
              onClick={() => {
                const nextCfg = {
                  ...effectiveSheetConfig,
                  layoutMode: 'ADAPTIVE_LAYOUT' as const,
                };
                saveSheetConfigToStorage(nextCfg);
                handleUpdateSettings((prev) => ({ ...prev, sheetConfig: nextCfg }));
              }}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap cursor-pointer ${
                (effectiveSheetConfig.layoutMode || 'ADAPTIVE_LAYOUT') === 'ADAPTIVE_LAYOUT'
                  ? 'bg-cyan-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Adaptive Layout
            </button>
            <button
              type="button"
              onClick={() => {
                const nextCfg = {
                  ...effectiveSheetConfig,
                  layoutMode: 'FIXED_LAYOUT' as const,
                };
                saveSheetConfigToStorage(nextCfg);
                handleUpdateSettings((prev) => ({ ...prev, sheetConfig: nextCfg }));
                setIsSettingsDrawerOpen(true);
              }}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap cursor-pointer ${
                effectiveSheetConfig.layoutMode === 'FIXED_LAYOUT'
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fixed Layout
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

          {/* Screen Fit / Zoom Selector */}
          <select
            value={sheetZoomMode}
            onChange={(e) =>
              setSheetZoomMode(e.target.value as 'auto_fit' | '100' | '125' | '150')
            }
            className="bg-slate-900 text-cyan-300 font-mono text-xs px-2 py-1 rounded border border-slate-700"
            title="Auto-fit sheet to screen without scrollbars or inspect at 100%–150%"
          >
            <option value="auto_fit">Fit to Screen (Auto)</option>
            <option value="100">100% Actual Size</option>
            <option value="125">125% Zoom</option>
            <option value="150">150% Zoom</option>
          </select>

          {/* Classification Method Selector for Final Engineering Sheet */}
          {onChangeSelectedClassificationMethod && (
            <select
              value={selectedClassificationMethod}
              onChange={(e) =>
                onChangeSelectedClassificationMethod(
                  e.target.value as RockMassClassificationMethodId
                )
              }
              className="bg-indigo-950 text-indigo-200 font-mono text-xs font-bold px-2 py-1 rounded border border-indigo-500/60"
              title="Select Rock Mass Classification Method displayed on Final Engineering Sheet"
            >
              <option value="RMR">Sheet Method: RMR ({rmr.version})</option>
              <option value="Q_SYSTEM">Sheet Method: Q-System (NGI)</option>
              <option value="BOTH_RMR_AND_Q">Sheet Method: Both (RMR + Q-System)</option>
              <option value="GSI">Sheet Method: GSI (Hoek &amp; Marinos)</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSettingsDrawerOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded border transition-colors whitespace-nowrap cursor-pointer ${
              isSettingsDrawerOpen
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                : 'bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border-emerald-600/70'
            }`}
            title="Edit Project Details, Location, Client/Contractor Logos, Block Placement & Chainage Storage"
          >
            <Sliders className="w-3.5 h-3.5" />
            {isSettingsDrawerOpen ? 'Hide Sheet Settings & Storage' : 'Sheet Settings, Logos & Storage'}
          </button>
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
          <ThemeToggleButton compact />
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

      {/* Main Engineering Sheet Preview Stage + Optional Live Settings & Chainage Storage Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {isSettingsDrawerOpen && (
          <aside
            style={{ width: `${drawerWidthPx}px` }}
            className={`no-print relative max-w-[54vw] bg-[#111621] ${
              drawerDockSide === 'left' ? 'order-first border-r' : 'order-last border-l'
            } border-slate-800 flex flex-col h-full shrink-0 z-20 shadow-2xl transition-[width] duration-75`}
          >
            {/* Interactive Drag-to-Resize Handle (Extend Left or Right) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setResizingDrawer({ startX: e.clientX, startWidth: drawerWidthPx });
              }}
              title="Drag Left or Right to Extend / Resize Settings Drawer"
              className={`flex items-center justify-center absolute top-0 bottom-0 w-2.5 cursor-col-resize z-30 group ${
                drawerDockSide === 'left' ? '-right-1.5' : '-left-1.5'
              }`}
            >
              <div className="h-16 w-1 rounded-full bg-slate-700 group-hover:bg-emerald-400 transition-colors" />
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 bg-[#0D121B] border-b border-slate-800 gap-1">
              <div className="min-w-0">
                <div className="font-display font-bold text-xs text-emerald-300 tracking-wide truncate">
                  SHEET SETTINGS, LOGOS &amp; CHAINAGE STORAGE
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  Live-edit project details, logos, placement &amp; face records
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setDrawerDockSide((s) => (s === 'left' ? 'right' : 'left'))}
                  className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-mono flex items-center gap-0.5 cursor-pointer"
                  title="Move Drawer to Left or Right Side"
                >
                  {drawerDockSide === 'left' ? (
                    <PanelRight className="w-3 h-3" />
                  ) : (
                    <PanelLeft className="w-3 h-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerWidthPx((w) => Math.max(300, w - 50))}
                  className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono cursor-pointer"
                  title="Narrow Drawer"
                >
                  −W
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerWidthPx((w) => Math.min(700, w + 50))}
                  className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[10px] font-mono cursor-pointer"
                  title="Extend Drawer Width"
                >
                  +W
                </button>
                <button
                  type="button"
                  onClick={() => setIsSettingsDrawerOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                  title="Close Settings Drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SheetSettingsAndStorageEditor
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                savedProjects={savedProjects}
                onSaveCurrentProject={() => onSaveCurrentProject?.()}
                onLoadProjectRecord={onLoadProjectRecord}
                onDeleteProjectRecord={onDeleteProjectRecord}
                onCreateNextChainageSection={onCreateNextChainageSection}
                compactDrawerMode={true}
              />
            </div>
          </aside>
        )}

      <div
        ref={previewContainerRef}
        className={`flex-1 flex items-center justify-center print:p-0 print:bg-white ${
          isLight ? 'bg-slate-200' : 'bg-[#0B0E14]'
        } ${
          sheetZoomMode === 'auto_fit' ? 'overflow-hidden p-2' : 'overflow-auto p-4 items-start'
        }`}
      >
        <div
          className="bg-white shadow-2xl border border-slate-300 print:shadow-none print:border-none print:w-full print:h-auto"
          style={{
            width: `${renderedSheetDimensions.width}px`,
            height: `${renderedSheetDimensions.height}px`,
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${sheetW} ${sheetH}`}
            width={sheetW}
            height={sheetH}
            preserveAspectRatio="xMidYMid meet"
            className="block w-full h-full bg-white text-black select-none"
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
                <rect x={leftWallLeftX} y={planTopY} width={leftWallW_px} height={roundH_px} />
              </clipPath>
              <clipPath id="sheet-rightwall-clip">
                <rect x={rightWallLeftX} y={planTopY} width={rightWallW_px} height={roundH_px} />
              </clipPath>

              {/* Engineering Column Clip Path to Prevent Any Text Intersection (Supports RIGHT or LEFT column) */}
              <clipPath id="sheet-right-col-clip">
                <rect
                  x={rightColumnBox.x}
                  y={rightColumnBox.y}
                  width={rightColumnBox.width}
                  height={rightColumnBox.height + 6}
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
              fill={effectiveSheetConfig.showBackgroundGrid !== false ? 'url(#eng-grid)' : '#FFFFFF'}
              stroke="#0F172A"
              strokeWidth="0.9"
            />

            {/* ==============================================================
                1. CUSTOMIZABLE ENGINEERING HEADER & TITLE BLOCK
                   (Includes Project, Location, Client, Contractor, Logos & Chainage)
               ============================================================== */}
            {showTitleAndTables &&
              (() => {
                const cfg = effectiveSheetConfig;
                const logoPos = cfg.logoPosition || 'HEADER_CORNERS';
                const logoW =
                  cfg.logoSize === 'LARGE' ? 112 : cfg.logoSize === 'COMPACT' ? 76 : 94;
                const logoH = headerBox.height - 10;

                const hasClientLogo =
                  logoPos !== 'HIDDEN' &&
                  logoPos !== 'BOTTOM_SIGN_BLOCK' &&
                  Boolean(cfg.clientLogoDataUrl);
                const hasContractorLogo =
                  logoPos !== 'HIDDEN' &&
                  logoPos !== 'BOTTOM_SIGN_BLOCK' &&
                  Boolean(cfg.contractorLogoDataUrl);
                const hasConsultantLogo =
                  logoPos !== 'HIDDEN' &&
                  logoPos !== 'BOTTOM_SIGN_BLOCK' &&
                  Boolean(cfg.consultantLogoDataUrl);

                // Compute left & right logo reservations inside headerBox so logos NEVER overlap text
                let leftLogoSpace = 0;
                let rightLogoSpace = 0;
                if (logoPos === 'HEADER_CORNERS') {
                  if (hasClientLogo) leftLogoSpace = logoW + 14;
                  if (hasContractorLogo) rightLogoSpace += logoW + 10;
                  if (hasConsultantLogo) rightLogoSpace += logoW + 10;
                } else if (logoPos === 'HEADER_LEFT_GROUP') {
                  const cnt =
                    (hasClientLogo ? 1 : 0) +
                    (hasContractorLogo ? 1 : 0) +
                    (hasConsultantLogo ? 1 : 0);
                  leftLogoSpace = cnt > 0 ? cnt * (logoW + 8) + 8 : 0;
                } else if (logoPos === 'HEADER_RIGHT_GROUP') {
                  const cnt =
                    (hasClientLogo ? 1 : 0) +
                    (hasContractorLogo ? 1 : 0) +
                    (hasConsultantLogo ? 1 : 0);
                  rightLogoSpace = cnt > 0 ? cnt * (logoW + 8) + 8 : 0;
                }

                const textLeftX = headerBox.x + leftLogoSpace;
                const textRightX = headerBox.x + headerBox.width - rightLogoSpace;
                const textAvailW = Math.max(800, textRightX - textLeftX);

                // 4 proportional zones inside [textLeftX, textRightX]
                const div1X = Math.round(textLeftX + textAvailW * 0.36);
                const div2X = Math.round(textLeftX + textAvailW * 0.60);
                const div3X = Math.round(textLeftX + textAvailW * 0.81);
                const midRowY = headerBox.y + Math.round(headerBox.height * 0.52);

                const sheetTitleText =
                  outputMode === 'ENGINEERING_QUANTITY_SHEET'
                    ? cfg.quantitySheetTitle ||
                      'ENGINEERING OVERBREAK, UNDERCUT & EXCAVATION QUANTITY SHEET'
                    : cfg.geologySheetTitle || 'ENGINEERING GEOLOGICAL TUNNEL MAPPING SHEET';

                const locLabel =
                  settings.locationName || settings.location || 'Main Underground Heading';

                return (
                  <g>
                    <rect
                      x={headerBox.x}
                      y={headerBox.y}
                      width={headerBox.width}
                      height={headerBox.height}
                      fill="#F8FAFC"
                      stroke="#0F172A"
                      strokeWidth="1.3"
                    />

                    {/* Render Header Logos in Selected Position */}
                    {logoPos === 'HEADER_CORNERS' && (
                      <>
                        {hasClientLogo && cfg.clientLogoDataUrl && (
                          <g>
                            <rect
                              x={headerBox.x + 6}
                              y={headerBox.y + 5}
                              width={logoW}
                              height={logoH}
                              fill="#FFFFFF"
                              stroke="#CBD5E1"
                              strokeWidth="0.8"
                            />
                            <image
                              href={cfg.clientLogoDataUrl}
                              x={headerBox.x + 8}
                              y={headerBox.y + 7}
                              width={logoW - 4}
                              height={logoH - 4}
                              preserveAspectRatio="xMidYMid meet"
                            />
                            <line
                              x1={textLeftX}
                              y1={headerBox.y}
                              x2={textLeftX}
                              y2={headerBox.y + headerBox.height}
                              stroke="#0F172A"
                              strokeWidth="1"
                            />
                          </g>
                        )}
                        {(hasContractorLogo || hasConsultantLogo) && (
                          <g>
                            <line
                              x1={textRightX}
                              y1={headerBox.y}
                              x2={textRightX}
                              y2={headerBox.y + headerBox.height}
                              stroke="#0F172A"
                              strokeWidth="1"
                            />
                            {hasContractorLogo && cfg.contractorLogoDataUrl && (
                              <g>
                                <rect
                                  x={textRightX + 5}
                                  y={headerBox.y + 5}
                                  width={logoW}
                                  height={logoH}
                                  fill="#FFFFFF"
                                  stroke="#CBD5E1"
                                  strokeWidth="0.8"
                                />
                                <image
                                  href={cfg.contractorLogoDataUrl}
                                  x={textRightX + 7}
                                  y={headerBox.y + 7}
                                  width={logoW - 4}
                                  height={logoH - 4}
                                  preserveAspectRatio="xMidYMid meet"
                                />
                              </g>
                            )}
                            {hasConsultantLogo && cfg.consultantLogoDataUrl && (
                              <g>
                                <rect
                                  x={textRightX + (hasContractorLogo ? logoW + 10 : 5)}
                                  y={headerBox.y + 5}
                                  width={logoW}
                                  height={logoH}
                                  fill="#FFFFFF"
                                  stroke="#CBD5E1"
                                  strokeWidth="0.8"
                                />
                                <image
                                  href={cfg.consultantLogoDataUrl}
                                  x={textRightX + (hasContractorLogo ? logoW + 12 : 7)}
                                  y={headerBox.y + 7}
                                  width={logoW - 4}
                                  height={logoH - 4}
                                  preserveAspectRatio="xMidYMid meet"
                                />
                              </g>
                            )}
                          </g>
                        )}
                      </>
                    )}

                    {logoPos === 'HEADER_LEFT_GROUP' && leftLogoSpace > 0 && (
                      <g>
                        {[
                          cfg.clientLogoDataUrl,
                          cfg.contractorLogoDataUrl,
                          cfg.consultantLogoDataUrl,
                        ]
                          .filter((u): u is string => Boolean(u))
                          .map((url, idx) => (
                            <g key={`hdr-l-logo-${idx}`}>
                              <rect
                                x={headerBox.x + 6 + idx * (logoW + 8)}
                                y={headerBox.y + 5}
                                width={logoW}
                                height={logoH}
                                fill="#FFFFFF"
                                stroke="#CBD5E1"
                                strokeWidth="0.8"
                              />
                              <image
                                href={url}
                                x={headerBox.x + 8 + idx * (logoW + 8)}
                                y={headerBox.y + 7}
                                width={logoW - 4}
                                height={logoH - 4}
                                preserveAspectRatio="xMidYMid meet"
                              />
                            </g>
                          ))}
                        <line
                          x1={textLeftX}
                          y1={headerBox.y}
                          x2={textLeftX}
                          y2={headerBox.y + headerBox.height}
                          stroke="#0F172A"
                          strokeWidth="1"
                        />
                      </g>
                    )}

                    {logoPos === 'HEADER_RIGHT_GROUP' && rightLogoSpace > 0 && (
                      <g>
                        <line
                          x1={textRightX}
                          y1={headerBox.y}
                          x2={textRightX}
                          y2={headerBox.y + headerBox.height}
                          stroke="#0F172A"
                          strokeWidth="1"
                        />
                        {[
                          cfg.clientLogoDataUrl,
                          cfg.contractorLogoDataUrl,
                          cfg.consultantLogoDataUrl,
                        ]
                          .filter((u): u is string => Boolean(u))
                          .map((url, idx) => (
                            <g key={`hdr-r-logo-${idx}`}>
                              <rect
                                x={textRightX + 6 + idx * (logoW + 8)}
                                y={headerBox.y + 5}
                                width={logoW}
                                height={logoH}
                                fill="#FFFFFF"
                                stroke="#CBD5E1"
                                strokeWidth="0.8"
                              />
                              <image
                                href={url}
                                x={textRightX + 8 + idx * (logoW + 8)}
                                y={headerBox.y + 7}
                                width={logoW - 4}
                                height={logoH - 4}
                                preserveAspectRatio="xMidYMid meet"
                              />
                            </g>
                          ))}
                      </g>
                    )}

                    {/* Vertical & horizontal dividers in header */}
                    <line
                      x1={div1X}
                      y1={headerBox.y}
                      x2={div1X}
                      y2={headerBox.y + headerBox.height}
                      stroke="#0F172A"
                      strokeWidth="1"
                    />
                    <line
                      x1={div2X}
                      y1={headerBox.y}
                      x2={div2X}
                      y2={headerBox.y + headerBox.height}
                      stroke="#0F172A"
                      strokeWidth="1"
                    />
                    <line
                      x1={div3X}
                      y1={headerBox.y}
                      x2={div3X}
                      y2={headerBox.y + headerBox.height}
                      stroke="#0F172A"
                      strokeWidth="1"
                    />
                    <line
                      x1={div1X}
                      y1={midRowY}
                      x2={textRightX}
                      y2={midRowY}
                      stroke="#0F172A"
                      strokeWidth="0.8"
                    />

                    {/* Zone 1: Editable Sheet Title, Project, Location & Tunnel */}
                    <text
                      x={textLeftX + 10}
                      y={headerBox.y + 20}
                      fontSize={Math.min(13.5, contentMetrics.headerTitleFontSize)}
                      fontWeight="700"
                      fill="#0F172A"
                    >
                      {sheetTitleText.slice(0, 58)}
                    </text>
                    <text
                      x={textLeftX + 10}
                      y={headerBox.y + 39}
                      fontSize="10.5"
                      fontWeight="700"
                      fill="#0F172A"
                    >
                      PROJECT: {(cfg.projectName || 'Underground Tunnel Project').slice(0, 34)} ·
                      LOC: {locLabel.slice(0, 22)}
                    </text>
                    <text
                      x={textLeftX + 10}
                      y={headerBox.y + 55}
                      fontSize="10"
                      fontWeight="700"
                      fill="#1E293B"
                    >
                      TUNNEL: {settings.tunnelName.toUpperCase().slice(0, 22)} · PROFILE:{' '}
                      {(
                        geometry.customProfile?.name || geometry.crownGeometry.replace(/_/g, '-')
                      )
                        .toUpperCase()
                        .slice(0, 18)}{' '}
                      ({geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m)
                    </text>
                    <text x={textLeftX + 10} y={headerBox.y + 69} fontSize="9.2" fill="#334155">
                      LITHOLOGY: {(settings.lithology || 'Mapped Rock Mass').slice(0, 38)} · DRIVE: N{' '}
                      {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                    </text>

                    {/* Zone 2: Client, Contractor & Consultant (Top) + Chainage & Pull (Bottom) */}
                    <text x={div1X + 10} y={headerBox.y + 15} fontSize="9.2" fill="#475569">
                      CLIENT:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {(cfg.clientName || 'Project Authority').slice(0, 30)}
                      </tspan>
                    </text>
                    <text x={div1X + 10} y={headerBox.y + 30} fontSize="9.2" fill="#475569">
                      CONTRACTOR:{' '}
                      <tspan fontWeight="700" fill="#065F46">
                        {(cfg.contractorName || 'Main Contractor').slice(0, 26)}
                      </tspan>
                    </text>
                    <text x={div1X + 10} y={midRowY + 14} fontSize="9.5" fill="#475569">
                      FACE CHAINAGE:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {settings.faceChainage}
                      </tspan>{' '}
                      · PULL:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {settings.roundLength.toFixed(2)}m
                      </tspan>
                    </text>
                    <text x={div1X + 10} y={midRowY + 28} fontSize="9.0" fill="#334155">
                      INTERVAL: <tspan fontWeight="700">{settings.chainage.slice(0, 28)}</tspan>
                    </text>

                    {/* Zone 3: Consultant & Contract No. (Top) + Dimensions & Azimuth (Bottom) */}
                    <text x={div2X + 10} y={headerBox.y + 15} fontSize="9.2" fill="#475569">
                      CONSULTANT:{' '}
                      <tspan fontWeight="700" fill="#1E293B">
                        {(cfg.consultantName || 'Supervision Consultant').slice(0, 24)}
                      </tspan>
                    </text>
                    <text x={div2X + 10} y={headerBox.y + 30} fontSize="9.2" fill="#475569">
                      CONTRACT:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {(cfg.contractNumber || 'PKG-01').slice(0, 24)}
                      </tspan>
                    </text>
                    <text x={div2X + 10} y={midRowY + 14} fontSize="9.2" fill="#475569">
                      SPAN W:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {geometry.width.toFixed(2)}m
                      </tspan>{' '}
                      · HT:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {geometry.height.toFixed(2)}m
                      </tspan>{' '}
                      · WALL:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {geometry.wallHeight.toFixed(2)}m
                      </tspan>
                    </text>
                    <text x={div2X + 10} y={midRowY + 28} fontSize="9.0" fill="#334155">
                      DESIGN AREA:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {(
                          overbreakAnalysis?.designAreaSqMeters ??
                          geometry.designAreaSqMeters ??
                          geometry.width * geometry.height * 0.85
                        ).toFixed(2)}{' '}
                        m²
                      </tspan>{' '}
                      · CROWN: {geometry.crownArcLength.toFixed(2)}m
                    </text>

                    {/* Zone 4: Drawing No, Revision, Date, Mapped By & Scale */}
                    <text x={div3X + 10} y={headerBox.y + 15} fontSize="9.2" fill="#475569">
                      DWG NO:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {(cfg.drawingNumber || 'DWG-001').slice(0, 15)}
                      </tspan>{' '}
                      ({(cfg.revisionNumber || 'Rev 0').slice(0, 6)})
                    </text>
                    <text x={div3X + 10} y={headerBox.y + 30} fontSize="9.2" fill="#475569">
                      DATE:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {settings.date}
                      </tspan>
                    </text>
                    <text x={div3X + 10} y={midRowY + 14} fontSize="9.2" fill="#475569">
                      MAPPED BY:{' '}
                      <tspan fontWeight="700" fill="#0F172A">
                        {(settings.mappedBy || 'Geologist / Surveyor').slice(0, 18)}
                      </tspan>
                    </text>
                    <text
                      x={div3X + 10}
                      y={midRowY + 28}
                      fontSize="9.2"
                      fontWeight="700"
                      fill="#0F172A"
                    >
                      SCALE 1:{engineeringScaleDenominator} ({geometry.source.toUpperCase()})
                    </text>
                  </g>
                );
              })()}

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
                  {outputMode === 'ENGINEERING_QUANTITY_SHEET'
                    ? `DEVELOPED PERIMETER OVERBREAK & AS-BUILT SURVEY STRIP (LEFT WALL — CROWN ARCH — RIGHT WALL) · PULL = ${roundLen.toFixed(2)} m`
                    : `DEVELOPED PERIMETER GEOLOGICAL MAPPING (LEFT WALL — CROWN ARCH — RIGHT WALL) · PULL = ${roundLen.toFixed(2)} m`}
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
                  width={leftWallW_px + crownW_px + rightWallW_px}
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
                        width={leftWallW_px}
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
                        width={rightWallW_px}
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
                  width={leftWallW_px}
                  height={roundH_px}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                />
                <text
                  x={leftWallLeftX + leftWallW_px / 2}
                  y={planTopY + roundH_px + 13}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#334155"
                >
                  LEFT WALL = {(geometry.leftWallArcLength ?? geometry.leftWallHeight ?? geometry.wallHeight).toFixed(2)} m
                </text>

                {/* Crown Box (Length strictly equals Tunnel Face Crown Arc Length = geometry.crownArcLength) */}
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
                  y={planTopY + roundH_px + 13}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  CROWN ARC = {geometry.crownArcLength.toFixed(2)} m (SPAN {geometry.width.toFixed(2)}m · DEV PERIM {((geometry.leftWallArcLength ?? geometry.leftWallHeight ?? geometry.wallHeight) + geometry.crownArcLength + (geometry.rightWallArcLength ?? geometry.rightWallHeight ?? geometry.wallHeight)).toFixed(2)}m)
                </text>

                {/* Right Wall Box */}
                <rect
                  x={rightWallLeftX}
                  y={planTopY}
                  width={rightWallW_px}
                  height={roundH_px}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                />
                <text
                  x={rightWallLeftX + rightWallW_px / 2}
                  y={planTopY + roundH_px + 13}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#334155"
                >
                  RIGHT WALL = {(geometry.rightWallArcLength ?? geometry.rightWallHeight ?? geometry.wallHeight).toFixed(2)} m
                </text>

                {/* Orthographic Projection Alignment Lines connecting Crown Edges & Centerline directly to Tunnel Face */}
                <line
                  x1={crownLeftX}
                  y1={planTopY + roundH_px}
                  x2={faceCenterX - faceWidthPx / 2}
                  y2={faceBottomY - (geometry.leftWallHeight ?? geometry.wallHeight) * facePxPerMeter}
                  stroke="#64748B"
                  strokeWidth="0.85"
                  strokeDasharray="4,4"
                />
                <line
                  x1={rightWallLeftX}
                  y1={planTopY + roundH_px}
                  x2={faceCenterX + faceWidthPx / 2}
                  y2={faceBottomY - (geometry.rightWallHeight ?? geometry.wallHeight) * facePxPerMeter}
                  stroke="#64748B"
                  strokeWidth="0.85"
                  strokeDasharray="4,4"
                />
                <line
                  x1={planCenterX}
                  y1={planTopY + roundH_px + 16}
                  x2={faceCenterX}
                  y2={faceTopY}
                  stroke="#94A3B8"
                  strokeWidth="0.75"
                  strokeDasharray="3,4"
                />

                {/* Top Dimension Line across Unfolded Perimeter (Left Wall + Crown + Right Wall) */}
                <g transform={`translate(0, ${planTopY - 6})`}>
                  <line x1={leftWallLeftX} y1="-4" x2={leftWallLeftX} y2="4" stroke="#0F172A" strokeWidth="1" />
                  <line x1={crownLeftX} y1="-4" x2={crownLeftX} y2="4" stroke="#0F172A" strokeWidth="1" />
                  <line x1={rightWallLeftX} y1="-4" x2={rightWallLeftX} y2="4" stroke="#0F172A" strokeWidth="1" />
                  <line x1={rightWallLeftX + rightWallW_px} y1="-4" x2={rightWallLeftX + rightWallW_px} y2="4" stroke="#0F172A" strokeWidth="1" />
                  <line x1={leftWallLeftX} y1="0" x2={rightWallLeftX + rightWallW_px} y2="0" stroke="#0F172A" strokeWidth="0.9" />
                </g>

                {/* Pull Dimension on Right Side of Perimeter Plan */}
                <line
                  x1={rightWallLeftX + rightWallW_px + 6}
                  y1={planTopY}
                  x2={rightWallLeftX + rightWallW_px + 16}
                  y2={planTopY}
                  stroke="#0F172A"
                  strokeWidth="0.9"
                />
                <line
                  x1={rightWallLeftX + rightWallW_px + 6}
                  y1={planTopY + roundH_px}
                  x2={rightWallLeftX + rightWallW_px + 16}
                  y2={planTopY + roundH_px}
                  stroke="#0F172A"
                  strokeWidth="0.9"
                />
                <line
                  x1={rightWallLeftX + rightWallW_px + 12}
                  y1={planTopY}
                  x2={rightWallLeftX + rightWallW_px + 12}
                  y2={planTopY + roundH_px}
                  stroke="#0F172A"
                  strokeWidth="1.0"
                />
                <text
                  x={rightWallLeftX + rightWallW_px + 18}
                  y={planTopY + roundH_px / 2 + 3}
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  PULL = {roundLen.toFixed(2)}m
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
                {outputMode === 'ENGINEERING_QUANTITY_SHEET'
                  ? `TUNNEL CROSS-SECTION — DESIGN vs. AS-BUILT GEOLOGICAL OVERBREAK & UNDERCUT PROFILE (${settings.faceChainage} · ${geometry.width.toFixed(2)}m × ${geometry.height.toFixed(2)}m)`
                  : `MAIN TUNNEL FACE GEOLOGICAL MAPPING (${settings.faceChainage} · DRIVE N ${String(Math.round(settings.driveDirection)).padStart(3, '0')}° E · ${geometry.width.toFixed(2)}m × ${geometry.height.toFixed(2)}m)`}
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

              {/* LAYER 2: SUBTLE LITHOLOGY REGIONS (Shown on Geological Mapping Sheet, or if overlayJointsOnQuantity is enabled) */}
              {showVectors &&
                (outputMode !== 'ENGINEERING_QUANTITY_SHEET' || overlayJointsOnQuantity) &&
                lithologyRegions.length > 0 && (
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

              {/* LAYER 2.5: OVERBREAK / UNDERCUT VECTOR ANALYSIS REGIONS & SURVEYED AS-BUILT PROFILE (Dedicated to Overbreak & Quantity Sheet, or optional overlay on Geology Sheet) */}
              {showVectors &&
                (outputMode === 'ENGINEERING_QUANTITY_SHEET' || overlayOverbreakOnGeology) &&
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
              {/* Custom Profile Control Point Nodes on Face Boundary */}
              {geometry.customProfile &&
                geometry.customProfile.controlPoints.map((cp) => {
                  const s = surfacePointToSheetXY({ x: cp.x, y: cp.y }, 'face');
                  return (
                    <circle
                      key={`sheet-custom-cp-${cp.id}`}
                      cx={s.x}
                      cy={s.y}
                      r="2.8"
                      fill="#0284C7"
                      stroke="#FFFFFF"
                      strokeWidth="0.9"
                    />
                  );
                })}
            </g>

            {/* ==============================================================
                4. LAYERS 3, 4 & 5: GEOLOGICAL FEATURES, JOINTS & STRUCTURAL SYMBOLS
               ============================================================== */}
            {showVectors && (outputMode !== 'ENGINEERING_QUANTITY_SHEET' || overlayJointsOnQuantity) && (
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
                {(outputMode !== 'ENGINEERING_QUANTITY_SHEET' || overlayJointsOnQuantity) &&
                  joints.map((joint) => {
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
                {(outputMode !== 'ENGINEERING_QUANTITY_SHEET' || overlayJointsOnQuantity) &&
                  placedSymbols
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

                {/* 6C. Survey Control Points & Multi-Line Non-Overlapping Labels (Dedicated to Overbreak & Quantity Sheet, or optional overlay on Geology Sheet) */}
                {(outputMode === 'ENGINEERING_QUANTITY_SHEET' || overlayOverbreakOnGeology) &&
                  controlPoints
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
               {/* Bottom Width & Crown Arc Length Dimension Line */}
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
                  x={faceCenterX - 134}
                  y="-9"
                  width="268"
                  height="17"
                  fill="#FFFFFF"
                />
                <text
                  x={faceCenterX}
                  y="3.5"
                  textAnchor="middle"
                  fontSize="9.8"
                  fontWeight="700"
                  fill="#0F172A"
                >
                  SPAN W = {geometry.width.toFixed(2)} m · CROWN ARC = {geometry.crownArcLength.toFixed(2)} m
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
                {orientationBlock.height > 0 && (
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
                  <text
                    x="12"
                    y="17"
                    fontSize={contentMetrics.blockTitleFontSize}
                    fontWeight="700"
                    fill="#0F172A"
                  >
                    {outputMode === 'ENGINEERING_QUANTITY_SHEET'
                      ? 'CROSS-SECTION RADIAL DEVIATION & POLAR OVERBREAK PROFILE'
                      : 'DRIVE DIRECTION & STEREOGRAPHIC POLE SUMMARY'}
                  </text>

                  {/* Stereonet OR Radial Overbreak Deviation Diagram */}
                  {(() => {
                    const stereoR = Math.max(40, Math.min(70, (orientationBlock.height - 42) / 2));
                    const stereoCx = Math.round(stereoR + 22);
                    const stereoCy = Math.round(24 + (orientationBlock.height - 26) / 2);
                    const textStartX = stereoCx + stereoR + 20;
                    const availInfoH = Math.max(85, orientationBlock.height - 38);
                    const lineSpacing = Math.max(14.5, Math.min(26, availInfoH / 4.3));
                    const stereoScaleBoost = Math.max(1.0, Math.min(1.25, orientationBlock.height / 145));
                    const infoTitleFs = Number((contentMetrics.legendFontSize + 0.9 * stereoScaleBoost).toFixed(2));
                    const infoBodyFs = Number((contentMetrics.legendFontSize * Math.min(1.14, stereoScaleBoost)).toFixed(2));
                    const poleRadius = Number(Math.max(2.9, Math.min(4.2, stereoR * 0.062)).toFixed(1));
                    const cardinalFs = Number(Math.max(8.0, Math.min(10.2, stereoR * 0.16)).toFixed(1));

                    if (outputMode === 'ENGINEERING_QUANTITY_SHEET') {
                      const obArea = overbreakAnalysis?.overbreakAreaSqMeters ?? 0;
                      const ucArea = overbreakAnalysis?.undercutAreaSqMeters ?? 0;
                      const maxOb = overbreakAnalysis?.maxRadialOverbreakMeters ?? 0;
                      const avgOb = overbreakAnalysis?.avgRadialOverbreakMeters ?? 0;
                      const maxUc = overbreakAnalysis?.maxRadialUndercutMeters ?? 0;
                      const desPerim =
                        overbreakAnalysis?.designPerimeterMeters ??
                        geometry.totalPerimeterMeters ??
                        25.4;
                      const survPerim = overbreakAnalysis?.surveyedPerimeterMeters ?? desPerim;
                      const designR = stereoR * 0.76;

                      return (
                        <>
                          <g transform={`translate(${stereoCx}, ${stereoCy})`}>
                            <circle cx="0" cy="0" r={stereoR} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
                            {/* Design Reference Circle */}
                            <circle
                              cx="0"
                              cy="0"
                              r={designR}
                              fill="rgba(14, 165, 233, 0.06)"
                              stroke="#0F172A"
                              strokeWidth="1.5"
                              strokeDasharray="4,3"
                            />
                            {/* Simulated Polar Overbreak / Undercut Contour */}
                            <path
                              d={`M ${-designR * 1.04} ${designR * 0.55} L ${-designR * 1.12} 0 L ${-designR * 0.85} ${-designR * 0.82} L 0 ${-designR * 1.16} L ${designR * 0.88} ${-designR * 0.8} L ${designR * 1.1} 0 L ${designR * 0.96} ${designR * 0.55} Z`}
                              fill="rgba(225, 29, 72, 0.14)"
                              stroke="#E11D48"
                              strokeWidth="1.5"
                            />
                            <line x1={-stereoR} y1="0" x2={stereoR} y2="0" stroke="#94A3B8" strokeWidth="0.7" />
                            <line x1="0" y1={-stereoR} x2="0" y2={stereoR} stroke="#94A3B8" strokeWidth="0.7" />
                            <text x="0" y={-stereoR - 4} textAnchor="middle" fontSize={cardinalFs - 0.5} fontWeight="700" fill="#BE123C">
                              CROWN (+{maxOb.toFixed(2)}m)
                            </text>
                            <text x="0" y={stereoR + 10} textAnchor="middle" fontSize={cardinalFs - 0.5} fontWeight="600" fill="#475569">
                              INVERT (0.00m)
                            </text>
                          </g>

                          <g transform={`translate(${textStartX}, ${Math.round(33 + (availInfoH - lineSpacing * 4) * 0.22)})`}>
                            <text x="0" y="0" fontSize={infoTitleFs} fontWeight="700" fill="#0F172A">
                              STATION: {settings.faceChainage} · PULL INTERVAL: {(overbreakAnalysis?.effectivePullIntervalMeters ?? settings.roundLength).toFixed(2)} m
                            </text>
                            <text x="0" y={lineSpacing} fontSize={infoBodyFs} fill="#BE123C" fontWeight="700">
                              · Radial Overbreak: Max = +{maxOb.toFixed(3)} m · Avg = +{avgOb.toFixed(3)} m ({overbreakAnalysis?.overbreakRegions.length ?? 0} Zones)
                            </text>
                            <text x="0" y={lineSpacing * 2} fontSize={infoBodyFs} fill="#B45309" fontWeight="700">
                              · Radial Undercut: Max = -{maxUc.toFixed(3)} m · Area = {ucArea.toFixed(2)} m² ({overbreakAnalysis?.undercutRegions.length ?? 0} Zones)
                            </text>
                            <text x="0" y={lineSpacing * 3} fontSize={infoBodyFs - 0.3} fill="#334155">
                              · Perimeter: Design = {desPerim.toFixed(2)} m vs. Surveyed As-Built = {survPerim.toFixed(2)} m
                            </text>
                            <text x="0" y={lineSpacing * 4.05} fontSize={infoBodyFs} fontWeight="700" fill="#0F172A">
                              NET OVERBREAK: +{obArea.toFixed(2)} m² ({(overbreakAnalysis?.overbreakPercent ?? 0).toFixed(1)}%) · CONTROL PTS: {controlPoints.length}
                            </text>
                          </g>
                        </>
                      );
                    }

                    return (
                      <>
                        <g transform={`translate(${stereoCx}, ${stereoCy})`}>
                          <circle cx="0" cy="0" r={stereoR} fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
                          <circle cx="0" cy="0" r={stereoR * 0.67} fill="none" stroke="#94A3B8" strokeWidth="0.7" strokeDasharray="2.5,2.5" />
                          <circle cx="0" cy="0" r={stereoR * 0.34} fill="none" stroke="#94A3B8" strokeWidth="0.7" strokeDasharray="2.5,2.5" />
                          <line x1={-stereoR - 4} y1="0" x2={stereoR + 4} y2="0" stroke="#94A3B8" strokeWidth="0.8" />
                          <line x1="0" y1={-stereoR - 4} x2="0" y2={stereoR + 4} stroke="#94A3B8" strokeWidth="0.8" />
                          <text x="0" y={-stereoR - 5} textAnchor="middle" fontSize={cardinalFs} fontWeight="700" fill="#0F172A">N</text>
                          <text x={stereoR + 9} y="3" textAnchor="middle" fontSize={cardinalFs - 0.5} fontWeight="600" fill="#475569">E</text>
                          <text x="0" y={stereoR + 11} textAnchor="middle" fontSize={cardinalFs - 0.5} fontWeight="600" fill="#475569">S</text>
                          <text x={-stereoR - 9} y="3" textAnchor="middle" fontSize={cardinalFs - 0.5} fontWeight="600" fill="#475569">W</text>

                          {/* Drive Azimuth Vector */}
                          {(() => {
                            const rad = ((settings.driveDirection - 90) * Math.PI) / 180;
                            const ax = Math.cos(rad) * (stereoR - 4);
                            const ay = Math.sin(rad) * (stereoR - 4);
                            return (
                              <line
                                x1="0"
                                y1="0"
                                x2={ax}
                                y2={ay}
                                stroke="#0F172A"
                                strokeWidth="2.3"
                              />
                            );
                          })()}

                          {/* Plot Dip Direction poles for each joint */}
                          {joints.map((j) => {
                            const rad = ((j.dipDirection - 90) * Math.PI) / 180;
                            const r = (j.dip / 90) * (stereoR - 4);
                            const px = Math.cos(rad) * r;
                            const py = Math.sin(rad) * r;
                            const color = JOINT_SET_PALETTE[j.set]?.color || '#DC2626';
                            return (
                              <circle
                                key={`pole-${j.id}`}
                                cx={px}
                                cy={py}
                                r={poleRadius}
                                fill={color}
                                stroke="#FFFFFF"
                                strokeWidth="0.75"
                              />
                            );
                          })}
                        </g>

                        <g transform={`translate(${textStartX}, ${Math.round(33 + (availInfoH - lineSpacing * 4) * 0.22)})`}>
                          <text x="0" y="0" fontSize={infoTitleFs} fontWeight="700" fill="#0F172A">
                            TUNNEL DRIVE AZIMUTH: N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                          </text>
                          <text x="0" y={lineSpacing} fontSize={infoBodyFs} fill="#334155">
                            · Left Wall Normal: N {String(Math.round((settings.driveDirection + 270) % 360)).padStart(3, '0')}° E · Right Wall: N {String(Math.round((settings.driveDirection + 90) % 360)).padStart(3, '0')}° E
                          </text>
                          <text x="0" y={lineSpacing * 2} fontSize={infoBodyFs} fill="#334155">
                            · Convention: Dip Direction (000°–360°) / Dip Angle (00°–90°)
                          </text>
                          <text x="0" y={lineSpacing * 3} fontSize={infoBodyFs - 0.4} fill="#475569">
                            · Perimeter Ratio: P = 2×{geometry.wallHeight.toFixed(2)}m + {geometry.crownArcLength.toFixed(2)}m = {(geometry.wallHeight * 2 + geometry.crownArcLength).toFixed(2)}m
                          </text>
                          <text x="0" y={lineSpacing * 4.05} fontSize={infoBodyFs} fontWeight="700" fill="#0F172A">
                            MAPPED TRACES: {joints.length} ({jointSets.length} Sets) · SYMBOLS: {placedSymbols.length} · CONTROL PTS: {controlPoints.length}
                          </text>
                        </g>
                      </>
                    );
                  })()}
                </g>
                )}

                {/* 7B. Professional Legend (Geological & Lithological OR Overbreak, Undercut & Survey Legend) */}
                {legendBlock.height > 0 && (
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
                  <text
                    x="12"
                    y="17"
                    fontSize={contentMetrics.blockTitleFontSize}
                    fontWeight="700"
                    fill="#0F172A"
                  >
                    {outputMode === 'ENGINEERING_QUANTITY_SHEET'
                      ? 'OVERBREAK, UNDERCUT & AS-BUILT SURVEY LEGEND'
                      : 'GEOLOGICAL & LITHOLOGICAL MAPPING LEGEND'}
                  </text>
                  <line x1="0" y1="24" x2={legendBlock.width} y2="24" stroke="#0F172A" strokeWidth="0.8" />

                  {outputMode === 'ENGINEERING_QUANTITY_SHEET' ? (
                    (() => {
                      const ls = contentMetrics.legendRowSpacing;
                      const lf = contentMetrics.legendFontSize;
                      const sw = Math.round(Math.max(32, Math.min(42, legendBlock.width * 0.07)));
                      const midSw = sw / 2;
                      const textX = sw + 10;
                      const startY = Math.round(36 + Math.max(0, (legendBlock.height - 36 - ls * 4.2) * 0.25));
                      return (
                        <>
                          <g transform={`translate(14, ${startY})`}>
                            <line x1="0" y1="0" x2={sw} y2="0" stroke="#0F172A" strokeWidth="2.4" />
                            <text x={textX} y="3.5" fontSize={lf} fontWeight="700" fill="#0F172A">
                              Design Excavation Boundary
                            </text>

                            <line x1="0" y1={ls} x2={sw} y2={ls} stroke="#059669" strokeWidth="2.2" strokeDasharray="6,3" />
                            <text x={textX} y={ls + 3.5} fontSize={lf} fontWeight="700" fill="#065F46">
                              Surveyed As-Built Profile
                            </text>

                            <rect x="0" y={ls * 2 - 7} width={sw} height="13" fill="rgba(225, 29, 72, 0.16)" stroke="#E11D48" strokeWidth="1.1" />
                            <rect x="0" y={ls * 2 - 7} width={sw} height="13" fill="url(#sheet-overbreak-hatch)" />
                            <text x={textX} y={ls * 2 + 3} fontSize={lf} fontWeight="700" fill="#BE123C">
                              Overbreak (Outside Design)
                            </text>

                            <rect x="0" y={ls * 3 - 7} width={sw} height="13" fill="rgba(217, 119, 6, 0.18)" stroke="#D97706" strokeWidth="1.1" />
                            <rect x="0" y={ls * 3 - 7} width={sw} height="13" fill="url(#sheet-undercut-hatch)" />
                            <text x={textX} y={ls * 3 + 3} fontSize={lf} fontWeight="700" fill="#B45309">
                              Undercut (Inside Design)
                            </text>

                            <circle cx={midSw} cy={ls * 4} r="4.8" fill="#FFFFFF" stroke="#059669" strokeWidth="1.5" />
                            <line x1={midSw - 6} y1={ls * 4} x2={midSw + 6} y2={ls * 4} stroke="#059669" strokeWidth="1.3" />
                            <line x1={midSw} y1={ls * 4 - 6} x2={midSw} y2={ls * 4 + 6} stroke="#059669" strokeWidth="1.3" />
                            <text x={textX} y={ls * 4 + 3.5} fontSize={lf} fontWeight="700" fill="#0F172A">
                              Survey Control Point (CP1..CPn)
                            </text>
                          </g>

                          <g transform={`translate(${Math.round(legendBlock.width * 0.51)}, ${startY})`}>
                            <rect x="0" y="-7" width={sw} height="14" rx="2" fill="#FFE4E6" stroke="#E11D48" strokeWidth="1" />
                            <text x={midSw} y="3" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#BE123C">GEO</text>
                            <text x={textX} y="3" fontSize={lf} fontWeight="700" fill="#0F172A">
                              Geological Wedge / Joint Overbreak
                            </text>

                            <rect x="0" y={ls - 7} width={sw} height="14" rx="2" fill="#FEF3C7" stroke="#D97706" strokeWidth="1" />
                            <text x={midSw} y={ls + 3} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#B45309">MECH</text>
                            <text x={textX} y={ls + 3} fontSize={lf} fontWeight="700" fill="#0F172A">
                              Mechanical / Drill Lookout Cause
                            </text>

                            <text x="0" y={ls * 2.15} fontSize={lf - 0.3} fontWeight="700" fill="#0F172A">
                              VOLUME FORMULA (SINGLE SECTION):
                            </text>
                            <text x="0" y={ls * 2.95} fontSize={lf - 0.5} fill="#334155">
                              V = Area (m²) × Pull Interval L (m)
                            </text>
                            <text x="0" y={ls * 3.85} fontSize={lf - 0.3} fontWeight="700" fill="#0F172A">
                              MULTI-SECTION PRISMOIDAL VOLUME:
                            </text>
                            <text x="0" y={ls * 4.55} fontSize={lf - 0.5} fill="#334155">
                              V = (ΔRD / 6) × (A₁ + 4·Aₘ + A₂)
                            </text>
                          </g>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      {/* Column 1: Structural Symbols (Auto-scaled to legendBlock.height) */}
                      {(() => {
                        const ls = contentMetrics.legendRowSpacing;
                        const lf = contentMetrics.legendFontSize;
                        const sw = Math.round(Math.max(30, Math.min(40, legendBlock.width * 0.068)));
                        const midSw = sw / 2;
                        const textX = sw + 10;
                        const startY = Math.round(36 + Math.max(0, (legendBlock.height - 36 - ls * 4.5) * 0.3));
                        return (
                          <g transform={`translate(14, ${startY})`}>
                            <line x1="0" y1="0" x2={sw} y2="0" stroke="#DC2626" strokeWidth="2.2" />
                            <line x1={midSw} y1="0" x2={midSw} y2="7.5" stroke="#DC2626" strokeWidth="1.7" />
                            <text x={textX} y="3.5" fontSize={lf} fontWeight="600" fill="#0F172A">
                              Joint Trace + Dip Dir / Dip
                            </text>

                            <line x1="0" y1={ls} x2={sw} y2={ls} stroke="#0284C7" strokeWidth="2.2" strokeDasharray="6,3" />
                            <polygon points={`${midSw - 4.5},${ls} ${midSw + 4.5},${ls} ${midSw},${ls + 7.5}`} fill="none" stroke="#0284C7" strokeWidth="1.4" />
                            <text x={textX} y={ls + 3.5} fontSize={lf} fontWeight="600" fill="#0F172A">
                              Bedding (S0) / Foliation (S1)
                            </text>

                            <line x1="0" y1={ls * 2} x2={sw} y2={ls * 2} stroke="#E11D48" strokeWidth="5.5" strokeOpacity="0.22" />
                            <line x1="0" y1={ls * 2} x2={sw} y2={ls * 2} stroke="#E11D48" strokeWidth="2.2" strokeDasharray="8,2,2,2" />
                            <polygon points={`${midSw - 4.5},${ls * 2} ${midSw + 4.5},${ls * 2} ${midSw},${ls * 2 + 7.5}`} fill="#E11D48" />
                            <text x={textX} y={ls * 2 + 3.5} fontSize={lf} fontWeight="600" fill="#0F172A">
                              Fault / Shear Zone / Gouge
                            </text>

                            <path d={`M 2 ${ls * 3} Q ${midSw * 0.55} ${ls * 3 - 5} ${midSw} ${ls * 3} T ${sw - 2} ${ls * 3}`} fill="none" stroke="#0284C7" strokeWidth="1.8" />
                            <text x={textX} y={ls * 3 + 3.5} fontSize={lf} fontWeight="600" fill="#0F172A">
                              Water Seepage / Flow / Vein
                            </text>

                            <circle cx={midSw} cy={ls * 4} r="4.8" fill="#FFFFFF" stroke="#059669" strokeWidth="1.5" />
                            <line x1={midSw - 6} y1={ls * 4} x2={midSw + 6} y2={ls * 4} stroke="#059669" strokeWidth="1.3" />
                            <line x1={midSw} y1={ls * 4 - 6} x2={midSw} y2={ls * 4 + 6} stroke="#059669" strokeWidth="1.3" />
                            <text x={textX} y={ls * 4 + 3.5} fontSize={lf} fontWeight="600" fill="#0F172A">
                              Survey Control Point (CP)
                            </text>
                          </g>
                        );
                      })()}

                      {/* Column 2: Active Lithology Units & Standard Rock Patterns (Auto-scaled swatches & text) */}
                      {(() => {
                        const ls = contentMetrics.legendRowSpacing;
                        const swatchW = Math.round(Math.max(32, Math.min(42, legendBlock.width * 0.07)));
                        const swatchH = Math.round(Math.max(14, Math.min(18, ls * 0.64)));
                        const startY = Math.round(30 + Math.max(0, (legendBlock.height - 36 - ls * 4.5) * 0.25));
                        return (
                          <g transform={`translate(${Math.round(legendBlock.width * 0.51)}, ${startY})`}>
                            {(lithologyRegions.length > 0
                              ? Array.from(
                                  new Map(lithologyRegions.map((r) => [r.patternType, r])).values()
                                ).slice(0, contentMetrics.maxLegendLithologyRows)
                              : [
                                  { patternType: 'quartzite', lithologyName: 'Quartzite', colorHex: '#EAB308' },
                                  { patternType: 'phyllite', lithologyName: 'Phyllite / Schist', colorHex: '#38BDF8' },
                                  { patternType: 'granite', lithologyName: 'Granite / Gneiss', colorHex: '#FB7185' },
                                  { patternType: 'dolerite', lithologyName: 'Dolerite / Basalt', colorHex: '#475569' },
                                  { patternType: 'shear_zone', lithologyName: 'Shear / Breccia Zone', colorHex: '#EF4444' },
                                ]
                            ).map((unit, uIdx) => (
                              <g key={`leg-lith-${uIdx}`} transform={`translate(0, ${uIdx * ls})`}>
                                <rect
                                  x="0"
                                  y="0"
                                  width={swatchW}
                                  height={swatchH}
                                  fill={unit.colorHex}
                                  fillOpacity="0.22"
                                  stroke="#334155"
                                  strokeWidth="0.9"
                                />
                                <rect
                                  x="0"
                                  y="0"
                                  width={swatchW}
                                  height={swatchH}
                                  fill={`url(#sheet-lith-${unit.patternType})`}
                                  stroke="#334155"
                                  strokeWidth="0.9"
                                />
                                <text
                                  x={swatchW + 9}
                                  y={Math.round(swatchH * 0.74)}
                                  fontSize={contentMetrics.legendFontSize}
                                  fontWeight="700"
                                  fill="#0F172A"
                                >
                                  {unit.lithologyName.slice(0, 27)}
                                </text>
                              </g>
                            ))}
                          </g>
                        );
                      })()}
                    </>
                  )}
                </g>
                )}

                {/* 7C. Content-Aware Table: Regional Overbreak & Undercut Breakdown OR Discontinuity-Set Table */}
                {outputMode === 'ENGINEERING_QUANTITY_SHEET' ? (
                  <>
                    {jointTableBlock.height > 0 && (
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
                      <rect x="0" y="0" width={jointTableBlock.width} height="22" fill="#0F172A" />
                      <text
                        x="12"
                        y="15"
                        fontSize={contentMetrics.blockTitleFontSize - 0.4}
                        fontWeight="700"
                        fill="#FFFFFF"
                      >
                        OVERBREAK &amp; UNDERCUT REGIONAL BREAKDOWN (REASONS &amp; LINKED SETS)
                      </text>
                      <g transform="translate(0, 22)">
                        <rect
                          x="0"
                          y="0"
                          width={jointTableBlock.width}
                          height="19"
                          fill="#F1F5F9"
                          stroke="#0F172A"
                          strokeWidth="0.8"
                        />
                        {contentMetrics.overbreakColumns.slice(1).map((col) => (
                          <line
                            key={`ob-div-${col.key}`}
                            x1={col.x}
                            y1="0"
                            x2={col.x}
                            y2={jointTableBlock.height - 22}
                            stroke="#CBD5E1"
                            strokeWidth="0.7"
                          />
                        ))}
                        {contentMetrics.overbreakColumns.map((col) => (
                          <text
                            key={`ob-hdr-${col.key}`}
                            x={col.x + 5}
                            y="13"
                            fontSize={contentMetrics.tableHeaderFontSize}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            {col.label}
                          </text>
                        ))}
                      </g>
                      {(() => {
                        const zones = [
                          ...(overbreakAnalysis?.overbreakRegions || []),
                          ...(overbreakAnalysis?.undercutRegions || []),
                        ];
                        const visibleZones = zones.slice(0, contentMetrics.maxVisibleOverbreakZones);
                        const availTableH = jointTableBlock.height - 42;
                        const isFixedMode = effectiveSheetConfig.layoutMode === 'FIXED_LAYOUT';
                        const rowH =
                          visibleZones.length > 0
                            ? isFixedMode
                              ? Math.min(
                                  64,
                                  Math.max(
                                    19,
                                    Math.min(
                                      effectiveSheetConfig.manualTableRowHeight ?? 34,
                                      Math.floor(availTableH / Math.max(1, visibleZones.length))
                                    )
                                  )
                                )
                              : Math.min(
                                  68,
                                  Math.max(19, Math.floor(availTableH / Math.max(1, visibleZones.length)))
                                )
                            : 0;
                        const usedRowsH = visibleZones.length * rowH;
                        const remainingBottomH = isFixedMode ? 0 : availTableH - usedRowsH;
                        const cols = contentMetrics.overbreakColumns;
                        const cellFs = contentMetrics.tableCellFontSize;
                        const subFs = contentMetrics.tableSubCellFontSize;
                        const compactRow = rowH < 25;

                        return (
                          <>
                            {visibleZones.length === 0 && (
                              <text
                                x={jointTableBlock.width / 2}
                                y={Math.min(72, jointTableBlock.height / 3)}
                                textAnchor="middle"
                                fontSize={cellFs}
                                fontWeight="600"
                                fill="#475569"
                              >
                                Connect Survey Control Points (CP1→CP2→...) to compute Overbreak &amp; Undercut zones.
                              </text>
                            )}
                            {visibleZones.map((z, idx) => {
                              const rowY = 41 + idx * rowH;
                              const isOB = z.type === 'OVERBREAK';
                              const badgeH = Math.min(20, Math.max(14, Math.round(rowH * 0.44)));
                              const badgeY = Math.max(2, (rowH - badgeH) / 2);
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
                                    x="5"
                                    y={badgeY}
                                    width={cols[0].width - 10}
                                    height={badgeH}
                                    rx="2"
                                    fill={isOB ? '#E11D48' : '#D97706'}
                                  />
                                  <text
                                    x={cols[0].width / 2}
                                    y={badgeY + badgeH * 0.72}
                                    textAnchor="middle"
                                    fontSize={subFs + 0.4}
                                    fontWeight="700"
                                    fill="#FFFFFF"
                                  >
                                    {z.id}
                                  </text>
                                  <text
                                    x={cols[1].x + 5}
                                    y={compactRow ? rowH * 0.62 : rowH * 0.42}
                                    fontSize={cellFs}
                                    fontWeight="700"
                                    fill="#0F172A"
                                  >
                                    {z.locationLabel.slice(0, cols[1].maxChars)}
                                  </text>
                                  {!compactRow && (
                                    <text
                                      x={cols[1].x + 5}
                                      y={rowH * 0.78}
                                      fontSize={subFs}
                                      fill="#475569"
                                    >
                                      Perim: {z.affectedPerimeterMeters.toFixed(2)}m
                                    </text>
                                  )}
                                  <text
                                    x={cols[2].x + 5}
                                    y={compactRow ? rowH * 0.62 : rowH * 0.42}
                                    fontSize={cellFs}
                                    fontWeight="700"
                                    fill={isOB ? '#BE123C' : '#B45309'}
                                  >
                                    {isOB ? '+' : '-'}
                                    {z.areaSqMeters.toFixed(2)} m²
                                  </text>
                                  {!compactRow && (
                                    <text
                                      x={cols[2].x + 5}
                                      y={rowH * 0.78}
                                      fontSize={subFs}
                                      fill="#475569"
                                    >
                                      ({z.percentageOfDesign.toFixed(1)}%)
                                    </text>
                                  )}
                                  <text
                                    x={cols[3].x + 5}
                                    y={rowH * 0.56}
                                    fontSize={cellFs}
                                    fontWeight="700"
                                    fill="#0F172A"
                                  >
                                    {isOB ? '+' : '-'}
                                    {z.maxRadialMeters.toFixed(2)} m
                                  </text>
                                  <text
                                    x={cols[4].x + 5}
                                    y={compactRow ? rowH * 0.62 : rowH * 0.42}
                                    fontSize={subFs + 0.3}
                                    fontWeight="700"
                                    fill="#0F172A"
                                  >
                                    [{z.reasonCategory === 'GEOLOGICAL' ? 'GEOL' : 'MECH'}]{' '}
                                    {z.linkedJointSets
                                      ? `(${Array.isArray(z.linkedJointSets) ? z.linkedJointSets.join(', ') : z.linkedJointSets})`
                                      : ''}
                                  </text>
                                  {!compactRow && (
                                    <text
                                      x={cols[4].x + 5}
                                      y={rowH * 0.78}
                                      fontSize={subFs}
                                      fill="#334155"
                                    >
                                      {z.reasonDetail.slice(0, cols[4].subMaxChars)}
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                            {/* Adaptive Station Excavation & Control Point Matrix to Utilize Any Remaining White Space */}
                            {remainingBottomH >= 48 && (() => {
                              const fillerY = 41 + usedRowsH;
                              const desA = overbreakAnalysis?.designAreaSqMeters ?? geometry.width * geometry.height * 0.85;
                              const srvA = overbreakAnalysis?.surveyedAreaSqMeters ?? desA;
                              const obA = overbreakAnalysis?.overbreakAreaSqMeters ?? 0;
                              const ucA = overbreakAnalysis?.undercutAreaSqMeters ?? 0;
                              const pullM = overbreakAnalysis?.effectivePullIntervalMeters ?? settings.roundLength;
                              const netDiffA = srvA - desA;
                              const netDiffVol = netDiffA * pullM;
                              const cellW = Math.floor(jointTableBlock.width / 3);
                              return (
                                <g transform={`translate(0, ${fillerY})`}>
                                  <rect
                                    x="0"
                                    y="0"
                                    width={jointTableBlock.width}
                                    height={remainingBottomH}
                                    fill="#F8FAFC"
                                    stroke="#0F172A"
                                    strokeWidth="0.9"
                                  />
                                  <rect x="0" y="0" width={jointTableBlock.width} height="18" fill="#E2E8F0" />
                                  <text x="10" y="12.5" fontSize={subFs + 0.4} fontWeight="700" fill="#0F172A">
                                    STATION AS-BUILT QUANTITY &amp; PAYLINE RECONCILIATION MATRIX ({settings.faceChainage})
                                  </text>
                                  <line x1={cellW} y1="18" x2={cellW} y2={remainingBottomH} stroke="#CBD5E1" strokeWidth="0.8" />
                                  <line x1={cellW * 2} y1="18" x2={cellW * 2} y2={remainingBottomH} stroke="#CBD5E1" strokeWidth="0.8" />
                                  <text x="10" y="33" fontSize={subFs + 0.3} fontWeight="700" fill="#0F172A">
                                    Design Area: {desA.toFixed(2)} m²
                                  </text>
                                  <text x="10" y="46" fontSize={subFs} fill="#334155">
                                    Design Vol ({pullM.toFixed(1)}m): {(desA * pullM).toFixed(2)} m³
                                  </text>
                                  <text x={cellW + 10} y="33" fontSize={subFs + 0.3} fontWeight="700" fill="#065F46">
                                    Surveyed Area: {srvA.toFixed(2)} m²
                                  </text>
                                  <text x={cellW + 10} y="46" fontSize={subFs} fill="#334155">
                                    As-Built Vol ({pullM.toFixed(1)}m): {(srvA * pullM).toFixed(2)} m³
                                  </text>
                                  <text x={cellW * 2 + 10} y="33" fontSize={subFs + 0.3} fontWeight="700" fill={netDiffA >= 0 ? '#BE123C' : '#B45309'}>
                                    Net Diff: {netDiffA >= 0 ? '+' : ''}{netDiffA.toFixed(2)} m² ({netDiffVol >= 0 ? '+' : ''}{netDiffVol.toFixed(2)} m³)
                                  </text>
                                  <text x={cellW * 2 + 10} y="46" fontSize={subFs} fill="#334155">
                                    OB: +{obA.toFixed(2)}m² · UC: -{ucA.toFixed(2)}m² · CPs: {controlPoints.length}
                                  </text>
                                </g>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </g>
                    )}

                    {/* 7D. EXCAVATION QUANTITY & MULTI-SECTION VOLUME BLOCK */}
                    {qIndexAndNotesBlock.height > 0 && (
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
                      <rect x="0" y="0" width={qIndexAndNotesBlock.width} height="22" fill="#0F172A" />
                      <text
                        x="12"
                        y="15"
                        fontSize={contentMetrics.blockTitleFontSize - 0.4}
                        fontWeight="700"
                        fill="#FFFFFF"
                      >
                        EXCAVATION QUANTITY SUMMARY &amp; SECTION-TO-SECTION VOLUMES
                      </text>

                      <rect
                        x="8"
                        y="27"
                        width={qIndexAndNotesBlock.width - 16}
                        height="52"
                        fill="#FFFFFF"
                        stroke="#CBD5E1"
                        strokeWidth="0.9"
                      />
                      <text x="14" y="40" fontSize={contentMetrics.notesFontSize} fontWeight="700" fill="#0F172A">
                        DESIGN AREA: {overbreakAnalysis ? overbreakAnalysis.designAreaSqMeters.toFixed(2) : '0.00'} m² · SURVEYED AREA: {overbreakAnalysis ? overbreakAnalysis.surveyedAreaSqMeters.toFixed(2) : '0.00'} m² · PULL: {settings.roundLength.toFixed(2)} m
                      </text>
                      <text x="14" y="54" fontSize={contentMetrics.notesFontSize} fontWeight="700" fill="#BE123C">
                        OVERBREAK: +{overbreakAnalysis ? overbreakAnalysis.overbreakAreaSqMeters.toFixed(2) : '0.00'} m² ({overbreakAnalysis ? overbreakAnalysis.overbreakPercent.toFixed(2) : '0.00'}%) · Max +{overbreakAnalysis ? overbreakAnalysis.maxRadialOverbreakMeters.toFixed(2) : '0.00'}m · Vol: {overbreakAnalysis?.overbreakVolumeCubicMeters !== null && overbreakAnalysis?.overbreakVolumeCubicMeters !== undefined ? `+${overbreakAnalysis.overbreakVolumeCubicMeters.toFixed(2)} m³` : 'Requires Pull Interval'}
                      </text>
                      <text x="14" y="68" fontSize={contentMetrics.notesFontSize} fontWeight="700" fill="#B45309">
                        UNDERCUT: -{overbreakAnalysis ? overbreakAnalysis.undercutAreaSqMeters.toFixed(2) : '0.00'} m² ({overbreakAnalysis ? overbreakAnalysis.undercutPercent.toFixed(2) : '0.00'}%) · Max -{overbreakAnalysis ? overbreakAnalysis.maxRadialUndercutMeters.toFixed(2) : '0.00'}m · Vol: {overbreakAnalysis?.undercutVolumeCubicMeters !== null && overbreakAnalysis?.undercutVolumeCubicMeters !== undefined ? `-${overbreakAnalysis.undercutVolumeCubicMeters.toFixed(2)} m³` : 'Requires Pull Interval'}
                      </text>

                      <text x="12" y="94" fontSize={contentMetrics.notesFontSize - 0.2} fontWeight="700" fill="#0F172A">
                        PRIMARY OVERBREAK REASON: [{overbreakAnalysis?.overallOverbreakCategory || 'GEOLOGICAL'}] {(overbreakAnalysis?.overallOverbreakReason || '').slice(0, contentMetrics.notesMaxCharsPerLine - 28)}
                      </text>
                      <text x="12" y={94 + contentMetrics.notesLineSpacing} fontSize={contentMetrics.notesFontSize - 0.2} fontWeight="700" fill="#334155">
                        PRIMARY UNDERCUT REASON: [{overbreakAnalysis?.overallUndercutCategory || 'MECHANICAL_EXCAVATION'}] {(overbreakAnalysis?.overallUndercutReason || '').slice(0, contentMetrics.notesMaxCharsPerLine - 30)}
                      </text>

                      <line
                        x1="8"
                        y1={94 + contentMetrics.notesLineSpacing + 7}
                        x2={qIndexAndNotesBlock.width - 8}
                        y2={94 + contentMetrics.notesLineSpacing + 7}
                        stroke="#CBD5E1"
                        strokeWidth="0.8"
                      />
                      <text
                        x="12"
                        y={94 + contentMetrics.notesLineSpacing * 2 + 4}
                        fontSize={contentMetrics.notesFontSize - 0.2}
                        fontWeight="700"
                        fill="#0F172A"
                      >
                        MULTI-SECTION VOLUME SUMMARY (AVERAGE END AREA &amp; PRISMOIDAL):
                      </text>
                      {sectionVolumeRows.length === 0 ? (
                        <text
                          x="12"
                          y={94 + contentMetrics.notesLineSpacing * 3 + 4}
                          fontSize={contentMetrics.notesFontSize - 0.3}
                          fill="#475569"
                        >
                          Single cross-section active ({settings.faceChainage}). Save 2+ sections in Project Memory for section-to-section volumes.
                        </text>
                      ) : (
                        sectionVolumeRows.slice(0, 3).map((vr, vIdx) => (
                          <text
                            key={vr.id}
                            x="12"
                            y={94 + contentMetrics.notesLineSpacing * (3 + vIdx) + 2}
                            fontSize={contentMetrics.notesFontSize - 0.4}
                            fill="#0F172A"
                          >
                            · {vr.fromChainageLabel} → {vr.toChainageLabel} (L={vr.intervalLengthMeters.toFixed(1)}m): Design={vr.designVolumeCubicMeters.toFixed(1)}m³ | Survey={vr.surveyedVolumeCubicMeters.toFixed(1)}m³ | OB=+{vr.overbreakVolumeAvgEndAreaCubicMeters.toFixed(2)}m³ | UC=-{vr.undercutVolumeAvgEndAreaCubicMeters.toFixed(2)}m³
                          </text>
                        ))
                      )}

                      <line
                        x1="8"
                        y1={qIndexAndNotesBlock.height - 22}
                        x2={qIndexAndNotesBlock.width - 8}
                        y2={qIndexAndNotesBlock.height - 22}
                        stroke="#CBD5E1"
                        strokeWidth="0.7"
                      />
                       <text
                        x="12"
                        y={qIndexAndNotesBlock.height - 8}
                        fontSize={contentMetrics.notesFontSize - 0.2}
                        fontWeight="700"
                        fill="#0F172A"
                      >
                        {(effectiveSheetConfig.leftSignatoryTitle || 'CONTRACTOR GEOLOGIST SIGN')}: ____________________ · {(effectiveSheetConfig.rightSignatoryTitle || 'CLIENT GEOLOGIST SIGN')}: ____________________
                      </text>
                      {effectiveSheetConfig.logoPosition === 'BOTTOM_SIGN_BLOCK' && (
                        <g transform={`translate(${qIndexAndNotesBlock.width - 170}, ${qIndexAndNotesBlock.height - 21})`}>
                          {[
                            effectiveSheetConfig.clientLogoDataUrl,
                            effectiveSheetConfig.contractorLogoDataUrl,
                            effectiveSheetConfig.consultantLogoDataUrl,
                          ]
                            .filter((u): u is string => Boolean(u))
                            .map((url, idx) => (
                              <image
                                key={`bot-q-logo-${idx}`}
                                href={url}
                                x={idx * 54}
                                y="0"
                                width="50"
                                height="19"
                                preserveAspectRatio="xMidYMid meet"
                              />
                            ))}
                        </g>
                      )}
                    </g>
                    )}
                  </>
                ) : (
                  <>
                    {/* 7C. Content-Aware Discontinuity-Set & Structural Data Table (Zero Intersection!) */}
                    {jointTableBlock.height > 0 && (
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
                        height="22"
                        fill="#0F172A"
                      />
                      <text
                        x="12"
                        y="15"
                        fontSize={contentMetrics.blockTitleFontSize}
                        fontWeight="700"
                        fill="#FFFFFF"
                      >
                        DISCONTINUITY-SET &amp; STRUCTURAL PARAMETERS TABLE
                      </text>

                      {/* Strictly Partitioned Table Columns with Dynamic Widths & Vertical Dividers */}
                      <g transform="translate(0, 22)">
                        <rect
                          x="0"
                          y="0"
                          width={jointTableBlock.width}
                          height="19"
                          fill="#F1F5F9"
                          stroke="#0F172A"
                          strokeWidth="0.8"
                        />
                        {contentMetrics.discontinuityColumns.slice(1).map((col) => (
                          <line
                            key={`disc-div-${col.key}`}
                            x1={col.x}
                            y1="0"
                            x2={col.x}
                            y2={jointTableBlock.height - 22}
                            stroke="#CBD5E1"
                            strokeWidth="0.7"
                          />
                        ))}
                        {contentMetrics.discontinuityColumns.map((col) => (
                          <text
                            key={`disc-hdr-${col.key}`}
                            x={col.x + 5}
                            y="13"
                            fontSize={contentMetrics.tableHeaderFontSize}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            {col.label}
                          </text>
                        ))}
                      </g>

                      {jointSets.length === 0 ? (
                        <text
                          x={jointTableBlock.width / 2}
                          y={Math.min(95, jointTableBlock.height / 2 + 12)}
                          textAnchor="middle"
                          fontSize="9.5"
                          fill="#64748B"
                        >
                          No discontinuity sets plotted yet. Run AI Trace or Add Joint.
                        </text>
                      ) : (
                        (() => {
                          const visibleSets = jointSets.slice(0, contentMetrics.maxVisibleJointSets);
                          const availRowsH = jointTableBlock.height - 42;
                          const isFixedMode = effectiveSheetConfig.layoutMode === 'FIXED_LAYOUT';
                          const rowH = isFixedMode
                            ? Math.min(
                                64,
                                Math.max(
                                  19,
                                  Math.min(
                                    effectiveSheetConfig.manualTableRowHeight ?? 34,
                                    Math.floor(availRowsH / Math.max(1, visibleSets.length))
                                  )
                                )
                              )
                            : Math.min(
                                68,
                                Math.max(19, Math.floor(availRowsH / Math.max(1, visibleSets.length)))
                              );
                          const usedRowsH = visibleSets.length * rowH;
                          const remainingBottomH = isFixedMode ? 0 : availRowsH - usedRowsH;
                          const cols = contentMetrics.discontinuityColumns;
                          const cellFs = contentMetrics.tableCellFontSize;
                          const subFs = contentMetrics.tableSubCellFontSize;
                          const compactRow = rowH < 25;

                          return (
                            <>
                              {visibleSets.map((js, idx) => {
                                const rowY = 41 + idx * rowH;
                                const badgeH = Math.min(20, Math.max(13, Math.round(rowH * 0.46)));
                                const badgeY = Math.max(2, (rowH - badgeH) / 2);

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
                                    <rect
                                      x="5"
                                      y={badgeY}
                                      width={cols[0].width - 10}
                                      height={badgeH}
                                      rx="2"
                                      fill={js.color}
                                    />
                                    <text
                                      x={cols[0].width / 2}
                                      y={badgeY + badgeH * 0.74}
                                      textAnchor="middle"
                                      fontSize={cellFs}
                                      fontWeight="700"
                                      fill="#FFFFFF"
                                    >
                                      {js.id}
                                    </text>
                                    <text
                                      x={cols[1].x + 5}
                                      y={compactRow ? rowH * 0.64 : rowH * 0.42}
                                      fontSize={cellFs}
                                      fontWeight="700"
                                      fill="#0F172A"
                                    >
                                      {js.orientation.slice(0, cols[1].maxChars)}
                                    </text>
                                    {!compactRow && (
                                      <text
                                        x={cols[1].x + 5}
                                        y={rowH * 0.78}
                                        fontSize={subFs}
                                        fill="#475569"
                                      >
                                        Str:{' '}
                                        {js.avgStrike !== null
                                          ? `${String(js.avgStrike).padStart(3, '0')}°`
                                          : 'N/A'}{' '}
                                        ({js.jointCount || 1}j)
                                      </text>
                                    )}

                                    {/* Strictly fitted cell text using computed column char budgets */}
                                    <text
                                      x={cols[2].x + 5}
                                      y={rowH * 0.56}
                                      fontSize={cellFs}
                                      fill="#0F172A"
                                    >
                                      {js.spacing.slice(0, cols[2].maxChars)}
                                    </text>
                                    <text
                                      x={cols[3].x + 5}
                                      y={rowH * 0.56}
                                      fontSize={cellFs}
                                      fill="#0F172A"
                                    >
                                      {js.persistence.slice(0, cols[3].maxChars)}
                                    </text>
                                    <text
                                      x={cols[4].x + 5}
                                      y={rowH * 0.56}
                                      fontSize={cellFs}
                                      fill="#0F172A"
                                    >
                                      {js.aperture.slice(0, cols[4].maxChars)}
                                    </text>
                                    <text
                                      x={cols[5].x + 5}
                                      y={compactRow ? rowH * 0.64 : rowH * 0.41}
                                      fontSize={subFs + 0.3}
                                      fontWeight="600"
                                      fill="#0F172A"
                                    >
                                      {js.roughness.slice(0, cols[5].maxChars)}
                                    </text>
                                    {!compactRow && (
                                      <text
                                        x={cols[5].x + 5}
                                        y={rowH * 0.77}
                                        fontSize={subFs}
                                        fill="#334155"
                                      >
                                        Infill: {js.infilling.slice(0, Math.max(12, cols[5].subMaxChars - 12))} ·{' '}
                                        {js.water}
                                      </text>
                                    )}
                                  </g>
                                );
                              })}

                              {/* Adaptive Geological & Structural Station Matrix when table has remaining height */}
                              {remainingBottomH >= 46 && (() => {
                                const fillerY = 41 + usedRowsH;
                                const cellW = Math.floor(jointTableBlock.width / 3);
                                const confirmedCnt = joints.filter(
                                  (j) =>
                                    j.orientationStatus === 'CONFIRMED' ||
                                    j.orientationStatus === 'DIRECTLY_MEASURED' ||
                                    j.orientationStatus === 'GEOMETRICALLY_CALCULATED'
                                ).length;
                                return (
                                  <g transform={`translate(0, ${fillerY})`}>
                                    <rect
                                      x="0"
                                      y="0"
                                      width={jointTableBlock.width}
                                      height={remainingBottomH}
                                      fill="#F8FAFC"
                                      stroke="#0F172A"
                                      strokeWidth="0.9"
                                    />
                                    <rect x="0" y="0" width={jointTableBlock.width} height="18" fill="#E2E8F0" />
                                    <text x="10" y="12.5" fontSize={subFs + 0.4} fontWeight="700" fill="#0F172A">
                                      STATION STRUCTURAL &amp; KINEMATIC SUMMARY MATRIX ({settings.faceChainage})
                                    </text>
                                    <line x1={cellW} y1="18" x2={cellW} y2={remainingBottomH} stroke="#CBD5E1" strokeWidth="0.8" />
                                    <line x1={cellW * 2} y1="18" x2={cellW * 2} y2={remainingBottomH} stroke="#CBD5E1" strokeWidth="0.8" />
                                    <text x="10" y="33" fontSize={subFs + 0.3} fontWeight="700" fill="#0F172A">
                                      Mapped Discontinuities: {joints.length} ({jointSets.length} Sets)
                                    </text>
                                    <text x="10" y="45" fontSize={subFs} fill="#334155">
                                      3D Solved / Confirmed: {confirmedCnt} of {joints.length} traces
                                    </text>
                                    <text x={cellW + 10} y="33" fontSize={subFs + 0.3} fontWeight="700" fill="#0F172A">
                                      Drive Azimuth: N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                                    </text>
                                    <text x={cellW + 10} y="45" fontSize={subFs} fill="#334155">
                                      Pull Interval: {settings.roundLength.toFixed(2)} m · Scale 1:{engineeringScaleDenominator}
                                    </text>
                                    <text x={cellW * 2 + 10} y="33" fontSize={subFs + 0.3} fontWeight="700" fill="#0F172A">
                                      Lithology Zones: {lithologyRegions.length || 1} ({settings.lithology.slice(0, 18)})
                                    </text>
                                    <text x={cellW * 2 + 10} y="45" fontSize={subFs} fill="#334155">
                                      Placed Symbols: {placedSymbols.length} · Survey CPs: {controlPoints.length}
                                    </text>
                                  </g>
                                );
                              })()}
                            </>
                          );
                        })()
                      )}
                    </g>
                    )}

                    {/* 7D. ROCK MASS CLASSIFICATION (Method-Specific: RMR / Q-System / Both / GSI) & CONTENT-AWARE GEOLOGICAL DESCRIPTION */}
                    {qIndexAndNotesBlock.height > 0 && (
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
                        height="22"
                        fill="#0F172A"
                      />
                      <text
                        x="12"
                        y="15"
                        fontSize={contentMetrics.blockTitleFontSize}
                        fontWeight="700"
                        fill="#FFFFFF"
                      >
                        {selectedClassificationMethod === 'RMR'
                          ? `ROCK MASS CLASSIFICATION (METHOD: RMR — BIENIAWSKI ${rmr.version}) & GEOLOGY DESCRIPTION`
                          : selectedClassificationMethod === 'BOTH_RMR_AND_Q'
                          ? `ROCK MASS CLASSIFICATION (METHODS: RMR ${rmr.version} + BARTON Q-SYSTEM) & GEOLOGY DESCRIPTION`
                          : selectedClassificationMethod === 'GSI'
                          ? `ROCK MASS CLASSIFICATION (METHOD: GSI — HOEK & MARINOS) & GEOLOGY DESCRIPTION`
                          : `ROCK MASS CLASSIFICATION (METHOD: Q-SYSTEM — BARTON NGI) & GEOLOGY DESCRIPTION`}
                      </text>

                      {/* Method-Specific Parameters & Result Box */}
                      {selectedClassificationMethod === 'RMR' ? (
                        <>
                          <rect
                            x="8"
                            y="27"
                            width={qIndexAndNotesBlock.width - 16}
                            height="40"
                            fill="#FFFFFF"
                            stroke="#CBD5E1"
                            strokeWidth="0.9"
                          />
                          <text
                            x="14"
                            y="41"
                            fontSize={contentMetrics.notesFontSize + 0.2}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            Method: RMR ({rmr.version}) ·{' '}
                            {rmrResult.isComplete
                              ? `RMR = R1(${rmrResult.r1StrengthRating}) + R2(${rmrResult.r2RqdRating}) + R3(${rmrResult.r3SpacingRating}) + R4(${rmrResult.r4ConditionRating}) + R5(${rmrResult.r5GroundwaterRating}) [Basic=${rmrResult.basicRmr}] + Adj(${rmrResult.orientationAdjustment})`
                              : 'Required input not available — Confirm missing RMR parameters'}
                          </text>
                          <text x="14" y="56" fontSize={contentMetrics.notesFontSize} fill="#334155">
                            UCS:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {rmr.intactStrengthValueMPa !== null
                                ? `${rmr.intactStrengthValueMPa}MPa (R1=${rmrResult.r1StrengthRating})`
                                : 'N/A'}
                            </tspan>{' '}
                            · RQD:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {rmr.rqdPercent !== null
                                ? `${rmr.rqdPercent}% (R2=${rmrResult.r2RqdRating})`
                                : 'N/A'}
                            </tspan>{' '}
                            · Spc:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {rmr.spacingMeters !== null
                                ? `${rmr.spacingMeters}m (R3=${rmrResult.r3SpacingRating})`
                                : 'N/A'}
                            </tspan>{' '}
                            · Cond:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              R4={rmrResult.r4ConditionRating ?? 'N/A'}
                            </tspan>{' '}
                            · Water:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              R5={rmrResult.r5GroundwaterRating ?? 'N/A'}
                            </tspan>{' '}
                            · Adj:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {rmrResult.orientationAdjustment ?? 'N/A'}
                            </tspan>
                          </text>

                          {/* Highlighted RMR Value & Class Box */}
                          <rect
                            x={qIndexAndNotesBlock.width - 150}
                            y="30"
                            width="136"
                            height="34"
                            rx="2"
                            fill="#0F172A"
                          />
                          <text
                            x={qIndexAndNotesBlock.width - 82}
                            y="44"
                            textAnchor="middle"
                            fontSize="9.8"
                            fontWeight="700"
                            fill="#818CF8"
                          >
                            {rmrResult.isComplete && rmrResult.finalRmr !== null
                              ? `RMR: ${rmrResult.finalRmr}`
                              : 'RMR: N/A'}
                          </text>
                          <text
                            x={qIndexAndNotesBlock.width - 82}
                            y="57"
                            textAnchor="middle"
                            fontSize="6.9"
                            fontWeight="700"
                            fill="#FFFFFF"
                          >
                            {rmrResult.rockMassClassLabel.toUpperCase().slice(0, 26)}
                          </text>

                          <text
                            x="12"
                            y="81"
                            fontSize={contentMetrics.notesFontSize + 0.2}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            STAND-UP: {rmrResult.averageStandUpTime} · Em:{' '}
                            {rmrResult.deformationModulusGPa !== null
                              ? `${rmrResult.deformationModulusGPa} GPa`
                              : 'N/A'}{' '}
                            · SUPPORT:{' '}
                            <tspan fontWeight="600">
                              {rmrResult.recommendedSupportGuidelines.slice(
                                0,
                                Math.max(34, contentMetrics.notesMaxCharsPerLine - 44)
                              )}
                            </tspan>
                          </text>
                        </>
                      ) : selectedClassificationMethod === 'BOTH_RMR_AND_Q' ? (
                        <>
                          {/* Dual Separate Boxes for RMR and Q-System (Without Mixing Parameters) */}
                          <rect
                            x="8"
                            y="27"
                            width={(qIndexAndNotesBlock.width - 22) / 2}
                            height="42"
                            fill="#FFFFFF"
                            stroke="#6366F1"
                            strokeWidth="1"
                          />
                          <text
                            x="14"
                            y="40"
                            fontSize={contentMetrics.notesFontSize}
                            fontWeight="700"
                            fill="#312E81"
                          >
                            METHOD 1: RMR ({rmr.version}) →{' '}
                            {rmrResult.isComplete && rmrResult.finalRmr !== null
                              ? `RMR = ${rmrResult.finalRmr} (${rmrResult.rockMassClassLabel})`
                              : 'Required input not available'}
                          </text>
                          <text
                            x="14"
                            y="53"
                            fontSize={contentMetrics.notesFontSize - 0.5}
                            fill="#334155"
                          >
                            R1(UCS):{rmrResult.r1StrengthRating ?? '—'} · R2(RQD):
                            {rmrResult.r2RqdRating ?? '—'} · R3(Spc):
                            {rmrResult.r3SpacingRating ?? '—'} · R4(Cnd):
                            {rmrResult.r4ConditionRating ?? '—'} · R5(H2O):
                            {rmrResult.r5GroundwaterRating ?? '—'} · Adj:
                            {rmrResult.orientationAdjustment ?? '—'}
                          </text>
                          <text
                            x="14"
                            y="64"
                            fontSize={contentMetrics.notesFontSize - 0.6}
                            fontWeight="600"
                            fill="#475569"
                          >
                            Basic RMR: {rmrResult.basicRmr ?? '—'} · Em:{' '}
                            {rmrResult.deformationModulusGPa ?? '—'} GPa · c: {rmrResult.cohesionKPa}
                          </text>

                          <rect
                            x={14 + (qIndexAndNotesBlock.width - 22) / 2}
                            y="27"
                            width={(qIndexAndNotesBlock.width - 22) / 2}
                            height="42"
                            fill="#FFFFFF"
                            stroke="#0284C7"
                            strokeWidth="1"
                          />
                          <text
                            x={20 + (qIndexAndNotesBlock.width - 22) / 2}
                            y="40"
                            fontSize={contentMetrics.notesFontSize}
                            fontWeight="700"
                            fill="#0C4A6E"
                          >
                            METHOD 2: Q-SYSTEM →{' '}
                            {qResult.isComplete
                              ? `Q = ${qResult.qValue.toFixed(2)} (${qResult.rockMassClass})`
                              : 'Required input not available'}
                          </text>
                          <text
                            x={20 + (qIndexAndNotesBlock.width - 22) / 2}
                            y="53"
                            fontSize={contentMetrics.notesFontSize - 0.5}
                            fill="#334155"
                          >
                            RQD:{qStatus.rqd === 'MISSING' ? '—' : `${qIndex.rqd}%`} · Jn:
                            {qStatus.jn === 'MISSING' ? '—' : qResult.effectiveJn} · Jr:
                            {qStatus.jr === 'MISSING' ? '—' : qIndex.jr} · Ja:
                            {qStatus.ja === 'MISSING' ? '—' : qIndex.ja} · Jw:
                            {qStatus.jw === 'MISSING' ? '—' : qIndex.jw} · SRF:
                            {qStatus.srf === 'MISSING' ? '—' : qIndex.srf}
                          </text>
                          <text
                            x={20 + (qIndexAndNotesBlock.width - 22) / 2}
                            y="64"
                            fontSize={contentMetrics.notesFontSize - 0.6}
                            fontWeight="600"
                            fill="#475569"
                          >
                            Q = (RQD/Jn)×(Jr/Ja)×(Jw/SRF) · De: {qResult.equivalentDimensionDe.toFixed(2)}m · ESR: {qIndex.esr}
                          </text>

                          <text
                            x="12"
                            y="81"
                            fontSize={contentMetrics.notesFontSize + 0.1}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            SUPPORT (RMR &amp; Q):{' '}
                            <tspan fontWeight="600">
                              {qResult.recommendedSupport.slice(
                                0,
                                Math.max(40, contentMetrics.notesMaxCharsPerLine - 24)
                              )}
                            </tspan>
                          </text>
                        </>
                      ) : selectedClassificationMethod === 'GSI' ? (
                        <>
                          <rect
                            x="8"
                            y="27"
                            width={qIndexAndNotesBlock.width - 16}
                            height="40"
                            fill="#FFFFFF"
                            stroke="#CBD5E1"
                            strokeWidth="0.9"
                          />
                          <text
                            x="14"
                            y="41"
                            fontSize={contentMetrics.notesFontSize + 0.2}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            Method: GSI (Hoek &amp; Marinos) ·{' '}
                            {gsiResult.isComplete
                              ? gsiResult.calculationSummaryFormula
                              : 'Required input not available'}
                          </text>
                          <text x="14" y="56" fontSize={contentMetrics.notesFontSize} fill="#334155">
                            Structure Rating:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {gsi.structureRating ?? 'N/A'} ({gsi.structureCategory})
                            </tspan>{' '}
                            · Surface Condition:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {gsi.surfaceConditionRating ?? 'N/A'} ({gsi.surfaceConditionCategory})
                            </tspan>{' '}
                            · UCS:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {gsi.intactUcsMPa ?? 'N/A'} MPa
                            </tspan>
                          </text>

                          <rect
                            x={qIndexAndNotesBlock.width - 150}
                            y="30"
                            width="136"
                            height="34"
                            rx="2"
                            fill="#0F172A"
                          />
                          <text
                            x={qIndexAndNotesBlock.width - 82}
                            y="44"
                            textAnchor="middle"
                            fontSize="9.8"
                            fontWeight="700"
                            fill="#34D399"
                          >
                            {gsiResult.isComplete && gsiResult.gsiValue !== null
                              ? `GSI: ${gsiResult.gsiValue}`
                              : 'GSI: N/A'}
                          </text>
                          <text
                            x={qIndexAndNotesBlock.width - 82}
                            y="57"
                            textAnchor="middle"
                            fontSize="6.9"
                            fontWeight="700"
                            fill="#FFFFFF"
                          >
                            {gsiResult.rockMassClassLabel.toUpperCase().slice(0, 26)}
                          </text>

                          <text
                            x="12"
                            y="81"
                            fontSize={contentMetrics.notesFontSize + 0.2}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            HOEK-BROWN: mb={gsiResult.mbReducedConstant ?? '—'} · s=
                            {gsiResult.sConstant ?? '—'} · Em=
                            {gsiResult.deformationModulusGPa ?? '—'} GPa · SUPPORT:{' '}
                            <tspan fontWeight="600">
                              {gsiResult.recommendedSupportGuidelines.slice(
                                0,
                                Math.max(34, contentMetrics.notesMaxCharsPerLine - 44)
                              )}
                            </tspan>
                          </text>
                        </>
                      ) : (
                        <>
                          {/* Q-System (Default / Selected) */}
                          <rect
                            x="8"
                            y="27"
                            width={qIndexAndNotesBlock.width - 16}
                            height="40"
                            fill="#FFFFFF"
                            stroke="#CBD5E1"
                            strokeWidth="0.9"
                          />
                          <text
                            x="14"
                            y="41"
                            fontSize={contentMetrics.notesFontSize + 0.3}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            Method: Q-System ·{' '}
                            {qResult.isComplete
                              ? `Q = (RQD/Jn) × (Jr/Ja) × (Jw/SRF) = (${qIndex.rqd}%/${qResult.effectiveJn}) × (${qIndex.jr}/${qIndex.ja}) × (${qIndex.jw}/${qIndex.srf})`
                              : 'Required input not available — Confirm missing Q-System parameters'}
                          </text>
                          <text x="14" y="56" fontSize={contentMetrics.notesFontSize} fill="#334155">
                            RQD:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.rqd === 'MISSING' ? 'N/A' : `${qIndex.rqd}%`}
                            </tspan>{' '}
                            · Jn:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.jn === 'MISSING' ? 'N/A' : qResult.effectiveJn}
                            </tspan>{' '}
                            · Jr:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.jr === 'MISSING' ? 'N/A' : qIndex.jr}
                            </tspan>{' '}
                            · Ja:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.ja === 'MISSING' ? 'N/A' : qIndex.ja}
                            </tspan>{' '}
                            · Jw:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.jw === 'MISSING' ? 'N/A' : qIndex.jw}
                            </tspan>{' '}
                            · SRF:{' '}
                            <tspan fontWeight="700" fill="#0F172A">
                              {qStatus.srf === 'MISSING' ? 'N/A' : qIndex.srf}
                            </tspan>
                          </text>

                          {/* Highlighted Q-Value & Rock Class Box */}
                          <rect
                            x={qIndexAndNotesBlock.width - 134}
                            y="30"
                            width="120"
                            height="34"
                            rx="2"
                            fill="#0F172A"
                          />
                          <text
                            x={qIndexAndNotesBlock.width - 74}
                            y="44"
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight="700"
                            fill="#38BDF8"
                          >
                            {qResult.isComplete ? `Q: ${qResult.qValue.toFixed(3)}` : 'Q: N/A'}
                          </text>
                          <text
                            x={qIndexAndNotesBlock.width - 74}
                            y="57"
                            textAnchor="middle"
                            fontSize="7.3"
                            fontWeight="700"
                            fill="#FFFFFF"
                          >
                            {qResult.isComplete
                              ? qResult.rockMassClass.toUpperCase()
                              : 'INPUT NOT AVAILABLE'}
                          </text>

                          <text
                            x="12"
                            y="81"
                            fontSize={contentMetrics.notesFontSize + 0.2}
                            fontWeight="700"
                            fill="#0F172A"
                          >
                            ESR: {qIndex.esr} · De: {qResult.equivalentDimensionDe.toFixed(2)}m ·
                            SUPPORT:{' '}
                            <tspan fontWeight="600">
                              {qResult.isComplete
                                ? qResult.recommendedSupport.slice(
                                    0,
                                    Math.max(34, contentMetrics.notesMaxCharsPerLine - 44)
                                  )
                                : 'Required input not available'}
                            </tspan>
                          </text>
                        </>
                      )}

                      <line
                        x1="8"
                        y1="88"
                        x2={qIndexAndNotesBlock.width - 8}
                        y2="88"
                        stroke="#CBD5E1"
                        strokeWidth="0.8"
                      />

                      {/* Dynamic Content-Aware Multi-Line Lithology & Geological Notes */}
                      {(() => {
                        const startY = 102;
                        const footerY = qIndexAndNotesBlock.height - 23;
                        const availTextH = Math.max(54, footerY - startY - 4);
                        const rawLith =
                          lithologyRegions.length > 0
                            ? Array.from(new Set(lithologyRegions.map((r) => r.lithologyName))).join(' / ')
                            : rockMass.rockType;
                        const rawDesc =
                          lithologyRegions[0]?.description ||
                          `${rockMass.weatheringGrade} · ${rockMass.strengthGrade}`;
                        const rawStruct =
                          lithologyRegions[0]?.structuralFeatures ||
                          `${rockMass.foliationBeddingSpacing} · ${rockMass.groundwaterCondition}`;
                        const rawOB =
                          overbreakAnalysis && overbreakAnalysis.hasValidSurveyProfile
                            ? `OB: +${overbreakAnalysis.overbreakAreaSqMeters.toFixed(2)}m² (${overbreakAnalysis.overbreakPercent.toFixed(1)}%, Max +${overbreakAnalysis.maxRadialOverbreakMeters.toFixed(2)}m) · UC: -${overbreakAnalysis.undercutAreaSqMeters.toFixed(2)}m² (${overbreakAnalysis.undercutPercent.toFixed(1)}%) · Vol: ${
                                overbreakAnalysis.overbreakVolumeCubicMeters !== null
                                  ? `+${overbreakAnalysis.overbreakVolumeCubicMeters.toFixed(2)}m³`
                                  : overbreakAnalysis.volumeStatusMessage
                              }`
                            : `${rockMass.overbreakCondition} · ${rockMass.installedSupport}`;
                        const rawNotes =
                          lithologyRegions[0]?.notes || rockMass.geologistRemarks || '';

                        const maxChars = contentMetrics.notesMaxCharsPerLine;
                        const descLines = wrapSheetTextLines(`DESCRIPTION: ${rawDesc}`, maxChars, 2);
                        const structLines = wrapSheetTextLines(`STRUCTURAL: ${rawStruct}`, maxChars, 2);
                        const notesLines = rawNotes
                          ? wrapSheetTextLines(`NOTES: ${rawNotes}`, maxChars, 2)
                          : [];

                        const allEntries: { label: string; text: string; bold?: boolean }[] = [
                          {
                            label: 'LITHOLOGY',
                            text: `LITHOLOGY: ${rawLith.slice(0, maxChars - 12)}`,
                            bold: true,
                          },
                          ...descLines.map((t, i) => ({
                            label: `DESC-${i}`,
                            text: t,
                          })),
                          ...structLines.map((t, i) => ({
                            label: `STRUCT-${i}`,
                            text: t,
                          })),
                          {
                            label: 'OB',
                            text: `OVERBREAK / UNDERCUT: ${rawOB.slice(0, maxChars - 22)}`,
                            bold: true,
                          },
                          ...notesLines.map((t, i) => ({
                            label: `NOTES-${i}`,
                            text: t,
                          })),
                        ];

                        const maxFittingLines = Math.max(4, Math.floor(availTextH / 11));
                        const visibleEntries = allEntries.slice(0, maxFittingLines);
                        const dynamicStep = Math.min(
                          14.5,
                          Math.max(10.5, availTextH / Math.max(1, visibleEntries.length))
                        );
                        const dynamicFs = Math.min(
                          contentMetrics.notesFontSize,
                          Math.max(6.7, dynamicStep * 0.64)
                        );

                        return visibleEntries.map((entry, idx) => (
                          <text
                            key={entry.label}
                            x="12"
                            y={startY + idx * dynamicStep}
                            fontSize={dynamicFs}
                            fontWeight={entry.bold ? '700' : '600'}
                            fill={entry.bold ? '#0F172A' : '#1E293B'}
                          >
                            {entry.text}
                          </text>
                        ));
                      })()}

                      <line
                        x1="8"
                        y1={qIndexAndNotesBlock.height - 22}
                        x2={qIndexAndNotesBlock.width - 8}
                        y2={qIndexAndNotesBlock.height - 22}
                        stroke="#CBD5E1"
                        strokeWidth="0.7"
                      />
                       <text
                        x="12"
                        y={qIndexAndNotesBlock.height - 8}
                        fontSize={contentMetrics.notesFontSize - 0.2}
                        fontWeight="700"
                        fill="#0F172A"
                      >
                        {(effectiveSheetConfig.leftSignatoryTitle || 'CONTRACTOR GEOLOGIST SIGN')}: ____________________ · {(effectiveSheetConfig.rightSignatoryTitle || 'CLIENT GEOLOGIST SIGN')}: ____________________
                      </text>
                      {effectiveSheetConfig.logoPosition === 'BOTTOM_SIGN_BLOCK' && (
                        <g transform={`translate(${qIndexAndNotesBlock.width - 170}, ${qIndexAndNotesBlock.height - 21})`}>
                          {[
                            effectiveSheetConfig.clientLogoDataUrl,
                            effectiveSheetConfig.contractorLogoDataUrl,
                            effectiveSheetConfig.consultantLogoDataUrl,
                          ]
                            .filter((u): u is string => Boolean(u))
                            .map((url, idx) => (
                              <image
                                key={`bot-g-logo-${idx}`}
                                href={url}
                                x={idx * 54}
                                y="0"
                                width="50"
                                height="19"
                                preserveAspectRatio="xMidYMid meet"
                              />
                            ))}
                        </g>
                      )}
                    </g>
                    )}
                  </>
                )}
              </g>
            )}
          </svg>
        </div>
      </div>
      </div>
    </div>
  );
};
