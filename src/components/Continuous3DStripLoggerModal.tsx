import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  FileCode2,
  FolderKanban,
  GitCommitHorizontal,
  Hand,
  Layers,
  MapPin,
  MousePointer,
  PenTool,
  Plus,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { ThemeToggleButton, useTheme } from '../context/ThemeContext';
import { EswaTunnelLogo } from './EswaBrandIdentity';
import {
  buildSmoothRibbonTransform,
  ContinuousPullRecord,
  ContinuousStripLithologyZone,
  ContinuousStripTrace,
  ContinuousTunnelStripDataset,
  exportContinuousStripToDXF,
  getDefaultSheetConfig,
  loadAllContinuousStripDatasets,
  normalizePullsWithMissingGaps,
  runAiTrendAlignmentOnDataset,
  saveAllContinuousStripDatasets,
  SheetCustomizationConfig,
  StripFillingThicknessId,
  StripGroundwaterId,
  StripRockTypeId,
  StripStructureTypeId,
  syncSavedProjectsIntoStripDatasets,
  TunnelIntersectionConfig,
} from '../engine/continuous3DStripEngine';
import {
  buildProjectNetworkCanvasLayout,
  createOffsetStripTrace,
  ensureIntersectingBranchDatasets,
  extendStripTraceToBoundary,
  trimStripTraceSegment,
} from '../engine/projectNetworkStripEngine';
import {
  Joint,
  JointSet,
  LithologyRegion,
  OverbreakUndercutAnalysis,
  PlacedGeologicalSymbol,
  Point2D,
  SavedProjectRecord,
  SurfaceType,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  ContinuousStripExportStudio,
  CadLayerVisibilityState,
} from './ContinuousStripExportStudio';

export interface LearnedJointSetCluster {
  setId: string;
  structureType: StripStructureTypeId;
  meanDipDir: number;
  meanDip: number;
  meanSpacingM: number;
  sampleCount: number;
}

export interface ContinuousSelfLearningAiBrain {
  generation: number;
  learnedSamplesCount: number;
  userCorrectionsCount: number;
  predictionConfidencePct: number;
  seamToleranceM: number;
  autoLearnEnabled: boolean;
  autoPredictNewTrace: boolean;
  learnedClusters: LearnedJointSetCluster[];
  recentLearnLog: string[];
  lastTrainedAt: string;
}

const AI_BRAIN_STORAGE_KEY = 'eswa_continuous_ai_brain_v2_fresh';

const DEFAULT_CAD_LAYERS: CadLayerVisibilityState = {
  grid1m: true,
  springLines: true,
  pullSeams: true,
  lithology: true,
  traces: true,
  waterInflows: true,
  aiRawGhost: true,
  junctions: true,
  aiCrossProj: true,
  foliationHatch: true,
};

export interface Continuous3DStripLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  geometry?: TunnelGeometry;
  settings?: TunnelSettings;
  joints?: Joint[];
  jointSets?: JointSet[];
  lithologyRegions?: LithologyRegion[];
  placedSymbols?: PlacedGeologicalSymbol[];
  overbreakAnalysis?: OverbreakUndercutAnalysis;
  savedProjects: SavedProjectRecord[];
  onSelectSurface?: (s: SurfaceType) => void;
  onLoadProjectRecord?: (rec: SavedProjectRecord) => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

type StripCanvasTool =
  | 'SELECT'
  | 'PAN'
  | 'DRAW_TRACE'
  | 'DRAW_SPLINE'
  | 'DRAW_LITHOLOGY'
  | 'PLACE_WATER'
  | 'MEASURE_DIST';

type CanvasDriveMode =
  | 'SMOOTH_REALISTIC_CURVE' // Smooth spline curved ribbon following 1° drive azimuth variations
  | 'STRAIGHTENED_1M_CANVAS'; // Straightened 1-meter chainage editing canvas

type CanvasScopeMode =
  | 'SINGLE_LOCATION' // Single selected tunnel location strip
  | 'PROJECT_NETWORK'; // Entire Project Multi-Tunnel Network Canvas with Intersections

type AiAlignViewMode =
  | 'AFTER_AI' // Clean AI trend-aligned continuous traces
  | 'BEFORE_AI' // Raw unaligned photo-traced segments with seam kinks
  | 'SPLIT_GHOST'; // Shows both: dashed red raw photo trace + solid AI-aligned trace

export const Continuous3DStripLoggerModal: React.FC<
  Continuous3DStripLoggerModalProps
> = ({
  isOpen,
  onClose,
  geometry,
  settings,
  joints,
  lithologyRegions,
  placedSymbols,
  savedProjects,
}) => {
  const [datasets, setDatasets] = useState<ContinuousTunnelStripDataset[]>(() =>
    loadAllContinuousStripDatasets()
  );
  const [activeDatasetId, setActiveDatasetId] = useState<string>(
    'dataset-fresh-workspace'
  );

  // Main View Switcher: 'CANVAS' (Main Strip Canvas Only) vs 'EXPORT_STUDIO' (Printable Sheets & Multi-Page Alignment)
  const [workspaceView, setWorkspaceView] = useState<'CANVAS' | 'EXPORT_STUDIO'>(
    'CANVAS'
  );

  // Scope Switcher: 'SINGLE_LOCATION' vs 'PROJECT_NETWORK' (All Project Tunnels & Intersections)
  const [canvasScope, setCanvasScope] = useState<CanvasScopeMode>('SINGLE_LOCATION');

  // Canvas Display Modes
  const [canvasDriveMode, setCanvasDriveMode] = useState<CanvasDriveMode>(
    'SMOOTH_REALISTIC_CURVE'
  );
  const [aiViewMode, setAiViewMode] = useState<AiAlignViewMode>('SPLIT_GHOST');
  const [aiAlignBannerMsg, setAiAlignBannerMsg] = useState<string | null>(null);

  // ESWACAD Viewport Zoom & Pan + Layer Manager + Command Line
  const [cadZoom, setCadZoom] = useState<number>(1.0);
  const [cadPan, setCadPan] = useState<Point2D>({ x: 0, y: 0 });
  const [isPanningCanvas, setIsPanningCanvas] = useState<boolean>(false);
  const [panStartClient, setPanStartClient] = useState<Point2D | null>(null);
  const [dynEnabled, setDynEnabled] = useState<boolean>(true);
  const [orthoEnabled, setOrthoEnabled] = useState<boolean>(false);
  const [offsetDistM, setOffsetDistM] = useState<number>(1.8);
  const [measurePts, setMeasurePts] = useState<Point2D[]>([]);
  const [cadCmdInput, setCadCmdInput] = useState<string>('');
  const [cadCmdStatus, setCadCmdStatus] = useState<string>(
    'ESWACAD 3D Strip Model Space Ready — Type PLINE, SPLINE, OFFSET, EXTEND, TRIM, DIST, NETWORK, AIALIGN, or PLOT'
  );
  const [cadLayers, setCadLayers] = useState<CadLayerVisibilityState>(
    DEFAULT_CAD_LAYERS
  );

  // Continuous Self-Learning Geotechnical AI Brain State
  const [aiBrain, setAiBrain] = useState<ContinuousSelfLearningAiBrain>(() => {
    try {
      const raw = localStorage.getItem(AI_BRAIN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.generation === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return {
      generation: 1,
      learnedSamplesCount: 0,
      userCorrectionsCount: 0,
      predictionConfidencePct: 0,
      seamToleranceM: 1.45,
      autoLearnEnabled: true,
      autoPredictNewTrace: true,
      learnedClusters: [],
      recentLearnLog: [],
      lastTrainedAt: new Date().toISOString(),
    };
  });

  // CAD Tool & Selection State
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [showLayersPopover, setShowLayersPopover] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<StripCanvasTool>('SELECT');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedLithId, setSelectedLithId] = useState<string | null>(null);
  const [selectedWaterId, setSelectedWaterId] = useState<string | null>(null);
  const [selectedPullId, setSelectedPullId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [cursorRdPerim, setCursorRdPerim] = useState<Point2D | null>(null);
  const [cursorSvgPt, setCursorSvgPt] = useState<Point2D | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{
    traceId: string;
    vertexIdx: number;
  } | null>(null);
  const [draggingLithVertex, setDraggingLithVertex] = useState<{
    lithId: string;
    vertexIdx: number;
  } | null>(null);
  const [draggingWaterId, setDraggingWaterId] = useState<string | null>(null);

  // Collapsible Right Inspector Drawer (Keep main window focused on the Strip Canvas!)
  const [showRightInspector, setShowRightInspector] = useState<boolean>(true);
  const [inspectorTab, setInspectorTab] = useState<
    'TRACES_AI' | 'PULLS_DRIVE' | 'INTERSECTIONS' | 'NEW_LOCATION'
  >('TRACES_AI');

  // AutoCAD OSNAP
  const [osnapEnabled, setOsnapEnabled] = useState<boolean>(true);

  // New Trace / Lithology / Water Defaults
  const [newTraceStructure, setNewTraceStructure] =
    useState<StripStructureTypeId>('JS1 - Foliation');
  const [newTraceSetId, setNewTraceSetId] = useState<string>('JS1');
  const [newTraceOrientation, setNewTraceOrientation] =
    useState<string>('055/50');
  const [newTraceFilling, setNewTraceFilling] =
    useState<StripFillingThicknessId>('Clay Coated');
  const [newLithRockType, setNewLithRockType] =
    useState<StripRockTypeId>('Quartz veins');
  const [newWaterCondition, setNewWaterCondition] =
    useState<StripGroundwaterId>('Dripping');

  // Quick Add Pull State
  const [newPullFrom, setNewPullFrom] = useState<string>('0');
  const [newPullTo, setNewPullTo] = useState<string>('5');
  const [newPullAzimuth, setNewPullAzimuth] = useState<string>('0');
  const [newPullRock, setNewPullRock] = useState<string>('');

  // New Project / Tunnel Location Creator State
  const [newProjNameInput, setNewProjNameInput] = useState<string>('');
  const [newLocNameInput, setNewLocNameInput] = useState<string>('');
  const [newLocAzimuthInput, setNewLocAzimuthInput] = useState<string>('0');

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Sync savedProjects into datasets when modal opens (including Intersecting Branch Tunnels)
  useEffect(() => {
    if (!isOpen) return;
    const loaded = loadAllContinuousStripDatasets();
    const synced = ensureIntersectingBranchDatasets(
      syncSavedProjectsIntoStripDatasets(
        loaded,
        savedProjects,
        settings,
        geometry,
        joints,
        lithologyRegions,
        placedSymbols
      )
    );
    setDatasets(synced);
    saveAllContinuousStripDatasets(synced);
    if (!synced.some((d) => d.id === activeDatasetId) && synced.length > 0) {
      setActiveDatasetId(synced[0].id);
    }
  }, [
    isOpen,
    savedProjects,
    settings,
    geometry,
    joints,
    lithologyRegions,
    placedSymbols,
    activeDatasetId,
  ]);

  const activeDataset = useMemo(() => {
    return (
      datasets.find((d) => d.id === activeDatasetId) ||
      datasets[0] ||
      loadAllContinuousStripDatasets()[0]
    );
  }, [datasets, activeDatasetId]);

  const projectNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of datasets) set.add(d.projectName);
    return Array.from(set);
  }, [datasets]);

  const locationsForActiveProject = useMemo(() => {
    return datasets.filter((d) => d.projectName === activeDataset.projectName);
  }, [datasets, activeDataset.projectName]);

  // Entire Project Multi-Tunnel Network Layout (Intersections & AI 3D Cross-Tunnel Projections)
  const projectNetworkLayout = useMemo(() => {
    return buildProjectNetworkCanvasLayout(locationsForActiveProject, 20);
  }, [locationsForActiveProject]);

  const selectedTrace = useMemo(
    () => activeDataset.traces.find((t) => t.id === selectedTraceId) || null,
    [activeDataset.traces, selectedTraceId]
  );

  const selectedLith = useMemo(
    () => activeDataset.lithologyZones.find((l) => l.id === selectedLithId) || null,
    [activeDataset.lithologyZones, selectedLithId]
  );

  const selectedWater = useMemo(
    () => activeDataset.waterSymbols.find((w) => w.id === selectedWaterId) || null,
    [activeDataset.waterSymbols, selectedWaterId]
  );

  const selectedPull = useMemo(
    () => activeDataset.pulls.find((p) => p.id === selectedPullId) || null,
    [activeDataset.pulls, selectedPullId]
  );

  // Unfolded Strip Dimensions & 1-Meter Chainage Scale
  const totalPerimM = Math.max(
    6,
    activeDataset.upperZoneWidthM + activeDataset.lowerZoneWidthM
  );
  const viewStartRd = activeDataset.viewFromRd;
  const viewEndRd = Math.max(viewStartRd + 5, activeDataset.viewToRd);
  const totalRdSpanM = viewEndRd - viewStartRd;

  // Main Canvas SVG Coordinate System
  const svgW = 1360;
  const svgH = 620;
  const stripLeftX = 95;
  const stripTopY = 125;
  const stripWidthPx = 1190;
  const stripHeightPx = 360;

  const pxPerRdM = stripWidthPx / totalRdSpanM;
  const pxPerPerimM = stripHeightPx / totalPerimM;

  // Smooth Continuous Spline Ribbon Transform (eliminates brittle kinks on 1° drive turns)
  const smoothRibbon = useMemo(() => {
    return buildSmoothRibbonTransform(
      activeDataset.pulls,
      viewStartRd,
      viewEndRd,
      totalPerimM,
      stripLeftX,
      stripTopY + stripHeightPx * 0.5,
      pxPerRdM,
      stripHeightPx,
      3.2
    );
  }, [
    activeDataset.pulls,
    viewStartRd,
    viewEndRd,
    totalPerimM,
    stripLeftX,
    stripTopY,
     pxPerRdM,
    stripHeightPx,
  ]);

  // Universal Coordinate Mapper: maps (rd, perimM) to SVG (x, y) in either Smooth Curved or Straightened mode
  const mapRdPerimToSvg = (rd: number, perimM: number): Point2D => {
    if (canvasDriveMode === 'SMOOTH_REALISTIC_CURVE') {
      return smoothRibbon.mapRdPerimToSvg(rd, perimM);
    }
    return {
      x: stripLeftX + (rd - viewStartRd) * pxPerRdM,
      y: stripTopY + perimM * pxPerPerimM,
    };
  };

  // Inverse Mapper: maps mouse click on SVG back to (rd, perimM) in 1-meter chainage coordinates (accounting for zoom & pan)
  const svgToRdPerim = (clientX: number, clientY: number): Point2D | null => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const sx = ((clientX - rect.left) / rect.width) * (svgW / cadZoom) - cadPan.x;
    const sy = ((clientY - rect.top) / rect.height) * (svgH / cadZoom) - cadPan.y;

    if (canvasDriveMode === 'SMOOTH_REALISTIC_CURVE') {
      // Find closest sample on the smooth ribbon centerline
      let bestSample = smoothRibbon.samples[0];
      let bestDistSq = Infinity;
      for (const s of smoothRibbon.samples) {
        const dx = sx - s.cx;
        const dy = sy - s.cy;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestSample = s;
        }
      }
      if (!bestSample) return null;
      const dx = sx - bestSample.cx;
      const dy = sy - bestSample.cy;
      // Project onto normal vector (nx, ny)
      const normalOffsetPx = dx * bestSample.nx + dy * bestSample.ny;
      const normPerim = normalOffsetPx / stripHeightPx + 0.5;
      const perim = Number(
        Math.max(0, Math.min(totalPerimM, normPerim * totalPerimM)).toFixed(2)
      );
      const rd = Number(
        Math.max(viewStartRd, Math.min(viewEndRd, bestSample.rd)).toFixed(2)
      );
      return { x: rd, y: perim };
    }

    const rd = Number(
      Math.max(
        viewStartRd,
        Math.min(viewEndRd, viewStartRd + (sx - stripLeftX) / pxPerRdM)
      ).toFixed(2)
    );
    const perim = Number(
      Math.max(
        0,
        Math.min(totalPerimM, (sy - stripTopY) / pxPerPerimM)
      ).toFixed(2)
    );
    return { x: rd, y: perim };
  };

  // 1-Meter Single-Meter Chainage Ticks across the active view window
  const singleMeterTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let m = Math.ceil(viewStartRd); m <= Math.floor(viewEndRd); m += 1) {
      ticks.push(m);
    }
    return ticks;
  }, [viewStartRd, viewEndRd]);

  // OSNAP Candidate Computation
  const osnapCandidate = useMemo(() => {
    if (!osnapEnabled || !cursorRdPerim) return null;
    let best: {
      pt: Point2D;
      label: string;
      dist: number;
    } | null = null;
    const tol = 0.85;

    const check = (pt: Point2D, label: string) => {
      const d = Math.hypot(pt.x - cursorRdPerim.x, pt.y - cursorRdPerim.y);
      if (d <= tol && (!best || d < best.dist)) {
        best = { pt, label, dist: d };
      }
    };

    for (const tr of activeDataset.traces) {
      if (tr.points.length >= 2) {
        check(tr.points[0], 'ENDPOINT');
        check(tr.points[tr.points.length - 1], 'SEAM-CONTINUE');
      }
    }
    for (const p of activeDataset.pulls) {
      check({ x: p.fromRd, y: totalPerimM * 0.5 }, 'PULL-CL');
      check({ x: p.toRd, y: totalPerimM * 0.5 }, 'PULL-CL');
    }
    return best as { pt: Point2D; label: string; dist: number } | null;
  }, [osnapEnabled, cursorRdPerim, activeDataset.traces, activeDataset.pulls, totalPerimM]);

  const updateActiveDataset = (
    updater: (prev: ContinuousTunnelStripDataset) => ContinuousTunnelStripDataset
  ) => {
    setDatasets((prevList) => {
      const nextList = prevList.map((d) =>
        d.id === activeDataset.id
          ? { ...updater(d), updatedAt: new Date().toISOString() }
          : d
      );
      saveAllContinuousStripDatasets(nextList);
      return nextList;
    });
  };

  // Helper to update and persist the Self-Learning AI Brain whenever it eats new field data or user edits
  const recordAiSelfLearningEvent = (
    eventSummary: string,
    options?: {
      addedSamples?: number;
      isUserCorrection?: boolean;
      newTrace?: ContinuousStripTrace;
      datasetToScan?: ContinuousTunnelStripDataset;
    }
  ) => {
    setAiBrain((prev) => {
      const ds = options?.datasetToScan || activeDataset;
      const allTraces = options?.newTrace
        ? [...ds.traces, options.newTrace]
        : ds.traces;

      // Recompute learned clusters from all structural traces across project datasets
      const clusterMap = new Map<
        string,
        {
          setId: string;
          structureType: StripStructureTypeId;
          sumDipDir: number;
          sumDip: number;
          count: number;
        }
      >();

      const sourceDatasets = datasets.length > 0 ? datasets : [ds];
      for (const d of sourceDatasets) {
        const list = d.id === ds.id ? allTraces : d.traces;
        for (const t of list) {
          const key = (t.setId || 'JS1').toUpperCase();
          const cur = clusterMap.get(key) || {
            setId: key,
            structureType: t.structureType,
            sumDipDir: 0,
            sumDip: 0,
            count: 0,
          };
          cur.sumDipDir += t.dipDirectionDeg || 55;
          cur.sumDip += t.dipDeg || 50;
          cur.count += 1;
          clusterMap.set(key, cur);
        }
      }

      const nextClusters: LearnedJointSetCluster[] = Array.from(
        clusterMap.values()
      )
        .filter((c) => c.count > 0)
        .map((c, idx) => ({
          setId: c.setId,
          structureType: c.structureType,
          meanDipDir: Math.round(c.sumDipDir / c.count) % 360,
          meanDip: Math.max(5, Math.min(89, Math.round(c.sumDip / c.count))),
          meanSpacingM: Number(
            Math.max(0.8, 3.2 - Math.min(1.8, c.count * 0.08) + idx * 0.25).toFixed(2)
          ),
          sampleCount: c.count,
        }));

      const added = options?.addedSamples ?? 1;
      const nextSamples = prev.learnedSamplesCount + added;
      const nextCorrections =
        prev.userCorrectionsCount + (options?.isUserCorrection ? 1 : 0);
      const nextGen = prev.generation + 1;
      const nextConf = Number(
        Math.min(
          99.4,
          prev.predictionConfidencePct +
            (options?.isUserCorrection ? 0.35 : 0.2)
        ).toFixed(1)
      );

      const nextBrain: ContinuousSelfLearningAiBrain = {
        ...prev,
        generation: nextGen,
        learnedSamplesCount: nextSamples,
        userCorrectionsCount: nextCorrections,
        predictionConfidencePct: nextConf,
        seamToleranceM: Number(
          Math.max(
            0.9,
            Math.min(
              2.2,
              prev.seamToleranceM + (options?.isUserCorrection ? -0.02 : 0.01)
            )
          ).toFixed(2)
        ),
        learnedClusters:
          nextClusters.length > 0 ? nextClusters : prev.learnedClusters,
        recentLearnLog: [
          `[Gen #${nextGen}] ${eventSummary}`,
          ...prev.recentLearnLog.slice(0, 7),
        ],
        lastTrainedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(AI_BRAIN_STORAGE_KEY, JSON.stringify(nextBrain));
      } catch {
        // ignore storage errors
      }
      return nextBrain;
    });
  };

  // Autonomous AI Action: Feed & Digest all project tunnels + Predict continuation traces
  const handleAiEatAndLearnProject = (synthesizePredictedTrace = false) => {
    const totalTracesAcrossProject = datasets.reduce(
      (acc, d) => acc + d.traces.length,
      0
    );
    const totalLithAcrossProject = datasets.reduce(
      (acc, d) => acc + d.lithologyZones.length,
      0
    );

    if (synthesizePredictedTrace && aiBrain.learnedClusters.length > 0) {
      // Pick dominant learned cluster & synthesize a predicted trace in the forward chainage zone
      const dom =
        aiBrain.learnedClusters[
          aiBrain.generation % aiBrain.learnedClusters.length
        ] || aiBrain.learnedClusters[0];
      const span = Math.max(8, viewEndRd - viewStartRd);
      const startRd = Number(
        (
          viewStartRd +
          ((aiBrain.generation * 7) % Math.max(5, Math.floor(span - 6)))
        ).toFixed(1)
      );
      const endRd = Math.min(viewEndRd - 0.5, startRd + 6.5);
      const slopeSign = dom.meanDipDir > 180 ? -1 : 1;
      const pStart = Number(
        Math.max(
          1.2,
          Math.min(totalPerimM - 1.5, totalPerimM * (slopeSign > 0 ? 0.24 : 0.76))
        ).toFixed(2)
      );
      const pMid = Number(
        Math.max(
          1.0,
          Math.min(
            totalPerimM - 1.0,
            pStart + slopeSign * (dom.meanDip / 90) * 3.8
          )
        ).toFixed(2)
      );
      const pEnd = Number(
        Math.max(
          1.0,
          Math.min(
            totalPerimM - 1.0,
            pStart + slopeSign * (dom.meanDip / 90) * 7.2
          )
        ).toFixed(2)
      );
      const orientStr = `${String(dom.meanDipDir).padStart(3, '0')}/${String(
        dom.meanDip
      ).padStart(2, '0')}`;
      const synthPts: Point2D[] = [
        { x: startRd, y: pStart },
        { x: Number(((startRd + endRd) / 2).toFixed(2)), y: pMid },
        { x: endRd, y: pEnd },
      ];
      const predictedTrace: ContinuousStripTrace = {
        id: `tr-ai-pred-${Date.now()}`,
        structureType: dom.structureType,
        setId: dom.setId,
        orientationLabel: orientStr,
        dipDirectionDeg: dom.meanDipDir,
        dipDeg: dom.meanDip,
        fillingThickness: 'Clay Coated',
        rawPoints: synthPts.map((p) => ({
          x: p.x,
          y: Number((p.y + (Math.random() - 0.5) * 0.45).toFixed(2)),
        })),
        points: synthPts,
        aiAlignedPoints: synthPts,
      };
      updateActiveDataset((prev) => ({
        ...prev,
        traces: [...prev.traces, predictedTrace],
      }));
      setSelectedTraceId(predictedTrace.id);
      recordAiSelfLearningEvent(
        `AI synthesized predicted ${dom.setId} (${orientStr}) continuation trace at Ch. ${startRd}–${endRd}m`,
        { addedSamples: 3, newTrace: predictedTrace }
      );
      setAiAlignBannerMsg(
        `Self-Learning AI (Gen #${aiBrain.generation + 1}): Predicted & projected new ${dom.setId} (${orientStr}) trace at Ch. ${startRd}–${endRd}m from learned 3D rock mass memory.`
      );
      return;
    }

    const { updatedDataset, alignedCount, stitchedSeamsCount } =
      runAiTrendAlignmentOnDataset(activeDataset);
    updateActiveDataset(() => updatedDataset);
    recordAiSelfLearningEvent(
      `Digested ${totalTracesAcrossProject} traces & ${totalLithAcrossProject} lithology bodies across ${datasets.length} tunnels (${stitchedSeamsCount} seams stitched)`,
      { addedSamples: Math.max(2, alignedCount), datasetToScan: updatedDataset }
    );
    setAiAlignBannerMsg(
      `Self-Learning AI Brain (Gen #${aiBrain.generation + 1}): Ate ${totalTracesAcrossProject} traces & ${totalLithAcrossProject} rock zones across ${datasets.length} tunnels — Confidence now ${Math.min(99.4, aiBrain.predictionConfidencePct + 0.3).toFixed(1)}%.`
    );
  };

  // Run AI Structural Trend & Seam Alignment
  const handleRunAiTrendAlignment = () => {
    const { updatedDataset, alignedCount, stitchedSeamsCount } =
      runAiTrendAlignmentOnDataset(activeDataset);
    updateActiveDataset(() => updatedDataset);
    setAiViewMode('SPLIT_GHOST');
    setCadLayers((prev) => ({ ...prev, aiRawGhost: true, traces: true }));
    if (aiBrain.autoLearnEnabled) {
      recordAiSelfLearningEvent(
        `Aligned ${alignedCount} photo traces & stitched ${stitchedSeamsCount} pull seams on ${activeDataset.tunnelLocationName}`,
        { addedSamples: Math.max(1, alignedCount), datasetToScan: updatedDataset }
      );
    }
    setAiAlignBannerMsg(
      `AI Trend Alignment Complete (Gen #${aiBrain.generation + 1}): Smoothed ${alignedCount} structural traces along strike/dip trend & stitched ${stitchedSeamsCount} cross-pull seam offsets.`
    );
  };

  // Reset traces back to Raw Photo Traces
  const handleRestoreRawPhotoTraces = () => {
    updateActiveDataset((prev) => ({
      ...prev,
      traces: prev.traces.map((tr) => ({
        ...tr,
        points:
          tr.rawPoints && tr.rawPoints.length >= 2
            ? tr.rawPoints.map((p) => ({ ...p }))
            : tr.points,
      })),
    }));
    setAiViewMode('BEFORE_AI');
    setAiAlignBannerMsg('Restored original unaligned photo-traced segments.');
  };

  // Get points to display for a trace based on aiViewMode
  const getDisplayedTracePoints = (tr: ContinuousStripTrace): Point2D[] => {
    if (aiViewMode === 'BEFORE_AI' && tr.rawPoints && tr.rawPoints.length >= 2) {
      return tr.rawPoints;
    }
    return tr.points;
  };

  // Canvas Click Handler
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rawPt = svgToRdPerim(e.clientX, e.clientY);
    if (!rawPt) return;
    let pt = osnapCandidate ? osnapCandidate.pt : rawPt;

    // Apply ORTHO lock when drawing or measuring if orthoEnabled is active
    if (
      orthoEnabled &&
      (activeTool === 'DRAW_TRACE' || activeTool === 'DRAW_SPLINE' || activeTool === 'DRAW_LITHOLOGY') &&
      draftPoints.length > 0
    ) {
      const last = draftPoints[draftPoints.length - 1];
      if (Math.abs(pt.x - last.x) >= Math.abs(pt.y - last.y)) {
        pt = { x: pt.x, y: last.y };
      } else {
        pt = { x: last.x, y: pt.y };
      }
    }

    if (activeTool === 'MEASURE_DIST') {
      setMeasurePts((prev) => {
        if (prev.length >= 2) return [pt];
        const next = [...prev, pt];
        if (next.length === 2) {
          const dRd = next[1].x - next[0].x;
          const dPerim = next[1].y - next[0].y;
          const dist = Math.hypot(dRd, dPerim);
          const ang = ((Math.atan2(dPerim, dRd) * 180) / Math.PI).toFixed(1);
          setCadCmdStatus(
            `DIST = ${dist.toFixed(2)}m | ΔChainage = ${dRd >= 0 ? '+' : ''}${dRd.toFixed(2)}m | ΔPerim = ${dPerim >= 0 ? '+' : ''}${dPerim.toFixed(2)}m | Angle = ${ang}°`
          );
        }
        return next;
      });
      return;
    }

    if (activeTool === 'DRAW_TRACE' || activeTool === 'DRAW_SPLINE' || activeTool === 'DRAW_LITHOLOGY') {
      setDraftPoints((prev) => [...prev, pt]);
      return;
    }
    if (activeTool === 'PLACE_WATER') {
      const newW = {
        id: `ws-${Date.now()}`,
        condition: newWaterCondition,
        position: pt,
        label: newWaterCondition,
      };
      updateActiveDataset((prev) => ({
        ...prev,
        waterSymbols: [...prev.waterSymbols, newW],
      }));
      setActiveTool('SELECT');
    }
  };

  // AutoCAD Modify: OFFSET selected trace by offsetDistM
  const handleCadOffsetSelectedTrace = (sign: 1 | -1 = 1) => {
    setCanvasScope('SINGLE_LOCATION');
    if (!selectedTrace) {
      setCadCmdStatus('OFFSET: Select a structural trace first, then click OFFSET.');
      return;
    }
    const offsetTr = createOffsetStripTrace(
      selectedTrace,
      sign * offsetDistM,
      totalPerimM
    );
    updateActiveDataset((prev) => ({
      ...prev,
      traces: [...prev.traces, offsetTr],
    }));
    setSelectedTraceId(offsetTr.id);
    setCadCmdStatus(
      `OFFSET Complete: Created parallel ${offsetTr.setId} trace at ${sign > 0 ? '+' : '-'}${offsetDistM.toFixed(2)}m spacing.`
    );
  };

  // AutoCAD Modify: EXTEND selected trace to opposite wall or next pull boundary
  const handleCadExtendSelectedTrace = () => {
    setCanvasScope('SINGLE_LOCATION');
    if (!selectedTrace) {
      setCadCmdStatus('EXTEND: Select a structural trace first, then click EXTEND.');
      return;
    }
    const extended = extendStripTraceToBoundary(
      selectedTrace,
      viewStartRd,
      viewEndRd,
      totalPerimM
    );
    updateActiveDataset((prev) => ({
      ...prev,
      traces: prev.traces.map((t) => (t.id === selectedTrace.id ? extended : t)),
    }));
    setCadCmdStatus(
      `EXTEND Complete: Projected ${selectedTrace.setId} (${selectedTrace.orientationLabel}) along strike/dip vector.`
    );
  };

  // AutoCAD Modify: TRIM last segment of selected trace
  const handleCadTrimSelectedTrace = () => {
    setCanvasScope('SINGLE_LOCATION');
    if (!selectedTrace) {
      setCadCmdStatus('TRIM: Select a structural trace first, then click TRIM.');
      return;
    }
    const trimmed = trimStripTraceSegment(selectedTrace);
    updateActiveDataset((prev) => ({
      ...prev,
      traces: prev.traces.map((t) => (t.id === selectedTrace.id ? trimmed : t)),
    }));
    setCadCmdStatus(`TRIM Complete: Trimmed end segment of ${selectedTrace.setId}.`);
  };

  // Execute ESWACAD Command Line Input
  const handleExecuteCadCommand = (rawCmd: string) => {
    const cmd = rawCmd.trim().toUpperCase();
    if (!cmd) return;
    setCadCmdInput('');

    if (cmd === 'PLINE' || cmd === 'L' || cmd === 'LINE' || cmd === 'TRACE') {
      setCanvasScope('SINGLE_LOCATION');
      setActiveTool('DRAW_TRACE');
      setDraftPoints([]);
      setCadCmdStatus('ESWACAD PLINE active: Click 1m chainage strip to draw structural trace.');
    } else if (cmd === 'SPLINE' || cmd === 'SP' || cmd === 'CURVE') {
      setCanvasScope('SINGLE_LOCATION');
      setActiveTool('DRAW_SPLINE');
      setDraftPoints([]);
      setCadCmdStatus('ESWACAD SPLINE active: Click control points on the strip to fit a smooth spline curve.');
    } else if (cmd === 'HATCH' || cmd === 'LITH' || cmd === 'BOUNDARY') {
      setCanvasScope('SINGLE_LOCATION');
      setActiveTool('DRAW_LITHOLOGY');
      setDraftPoints([]);
      setCadCmdStatus('ESWACAD HATCH active: Click polygon vertices to draw Lithology / Quartz Vein.');
    } else if (cmd.startsWith('OFFSET') || cmd === 'O') {
      const parts = cmd.split(/\s+/);
      if (parts[1] && !isNaN(parseFloat(parts[1]))) {
        setOffsetDistM(Math.max(0.2, parseFloat(parts[1])));
      }
      handleCadOffsetSelectedTrace(1);
    } else if (cmd === 'EXTEND' || cmd === 'EX') {
      handleCadExtendSelectedTrace();
    } else if (cmd === 'TRIM' || cmd === 'TR') {
      handleCadTrimSelectedTrace();
    } else if (cmd === 'DIST' || cmd === 'DI' || cmd === 'MEASURE') {
      setCanvasScope('SINGLE_LOCATION');
      setActiveTool('MEASURE_DIST');
      setMeasurePts([]);
      setCadCmdStatus('ESWACAD DIST active: Click two points on the strip to measure ΔRD, ΔPerim & True Length.');
    } else if (cmd === 'AIALIGN' || cmd === 'ALIGN') {
      handleRunAiTrendAlignment();
    } else if (cmd === 'NETWORK' || cmd === 'INTERSECT' || cmd === 'PROJECT') {
      setCanvasScope((prev) =>
        prev === 'PROJECT_NETWORK' ? 'SINGLE_LOCATION' : 'PROJECT_NETWORK'
      );
      setCadCmdStatus('Switched between Single Tunnel Strip & Entire Project Multi-Tunnel Network.');
    } else if (cmd === 'ZOOM' || cmd === 'ZE' || cmd === 'Z') {
      setCadZoom(1.0);
      setCadPan({ x: 0, y: 0 });
      setCadCmdStatus('ZOOM EXTENTS: Reset viewport zoom to 100%.');
    } else if (cmd === 'PLOT' || cmd === 'EXPORT' || cmd === 'PRINT') {
      setWorkspaceView('EXPORT_STUDIO');
    } else {
      setCadCmdStatus(
        `Unknown ESWACAD command "${cmd}". Supported: PLINE, SPLINE, HATCH, OFFSET, EXTEND, TRIM, DIST, AIALIGN, NETWORK, ZOOM, PLOT`
      );
    }
  };

  // Helper: Catmull-Rom Spline interpolation for ESWACAD SPLINE tool
  const interpolateCatmullRomSpline = (ctrlPts: Point2D[], segmentsPerSpan = 6): Point2D[] => {
    if (ctrlPts.length <= 2) return ctrlPts.map((p) => ({ ...p }));
    const out: Point2D[] = [];
    for (let i = 0; i < ctrlPts.length - 1; i++) {
      const p0 = ctrlPts[Math.max(0, i - 1)];
      const p1 = ctrlPts[i];
      const p2 = ctrlPts[i + 1];
      const p3 = ctrlPts[Math.min(ctrlPts.length - 1, i + 2)];
      for (let s = 0; s < segmentsPerSpan; s++) {
        const t = s / segmentsPerSpan;
        const t2 = t * t;
        const t3 = t2 * t;
        const x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        out.push({
          x: Number(x.toFixed(2)),
          y: Number(Math.max(0.1, Math.min(totalPerimM - 0.1, y)).toFixed(2)),
        });
      }
    }
    const last = ctrlPts[ctrlPts.length - 1];
    out.push({ x: Number(last.x.toFixed(2)), y: Number(last.y.toFixed(2)) });
    return out;
  };

  // Commit newly drawn Trace, Spline, or Lithology Zone
  const handleCommitDraft = () => {
    if ((activeTool === 'DRAW_TRACE' || activeTool === 'DRAW_SPLINE') && draftPoints.length >= 2) {
      const finalGeometryPoints =
        activeTool === 'DRAW_SPLINE' && draftPoints.length >= 3
          ? interpolateCatmullRomSpline(draftPoints, 6)
          : draftPoints.map((p) => ({ ...p }));
      let finalStructure = newTraceStructure;
      let finalSetId = newTraceSetId;
      let finalOrient = newTraceOrientation;
      let dipDir = parseInt(newTraceOrientation.split('/')[0], 10) || 55;
      let dipVal = parseInt(newTraceOrientation.split('/')[1], 10) || 50;

      // If AI Auto-Predict is active, infer 3D strike/dip & closest learned cluster from the drawn 2D unfolded trajectory!
      if (aiBrain.autoPredictNewTrace && draftPoints.length >= 2) {
        const firstPt = draftPoints[0];
        const lastPt = draftPoints[draftPoints.length - 1];
        const dRd = lastPt.x - firstPt.x;
        const dPerim = lastPt.y - firstPt.y;
        const driveAz =
          activeDataset.pulls.find(
            (p) => firstPt.x >= p.fromRd && firstPt.x <= p.toRd
          )?.driveAzimuthDeg || 160;
        const inferredDip = Math.max(
          18,
          Math.min(
            85,
            Math.round((Math.atan2(Math.abs(dPerim), Math.max(0.4, Math.abs(dRd))) * 180) / Math.PI)
          )
        );
        const rawDipDir =
          Math.round(
            (driveAz + (dPerim >= 0 ? -95 : 85) + (dRd >= 0 ? 15 : -15) + 360) %
              360
          );

        // Match closest learned cluster if within 45 deg, or learn as new variation
        let bestCluster: LearnedJointSetCluster | null = null;
        let bestDiff = 999;
        for (const cl of aiBrain.learnedClusters) {
          const diff = Math.min(
            Math.abs(cl.meanDipDir - rawDipDir),
            360 - Math.abs(cl.meanDipDir - rawDipDir)
          );
          if (diff < bestDiff) {
            bestDiff = diff;
            bestCluster = cl;
          }
        }
        if (bestCluster && bestDiff <= 48) {
          finalSetId = bestCluster.setId;
          finalStructure = bestCluster.structureType;
          dipDir = Math.round(bestCluster.meanDipDir * 0.65 + rawDipDir * 0.35) % 360;
          dipVal = Math.round(bestCluster.meanDip * 0.6 + inferredDip * 0.4);
        } else {
          dipDir = rawDipDir;
          dipVal = inferredDip;
        }
        finalOrient = `${String(dipDir).padStart(3, '0')}/${String(dipVal).padStart(2, '0')}`;
        setNewTraceSetId(finalSetId);
        setNewTraceStructure(finalStructure);
        setNewTraceOrientation(finalOrient);
      }

      const newTr: ContinuousStripTrace = {
        id: `tr-${Date.now()}`,
        structureType: finalStructure,
        setId: finalSetId,
        orientationLabel: finalOrient,
        dipDirectionDeg: dipDir,
        dipDeg: dipVal,
        fillingThickness: newTraceFilling,
        rawPoints: finalGeometryPoints.map((p) => ({ ...p })),
        points: finalGeometryPoints.map((p) => ({ ...p })),
      };
      updateActiveDataset((prev) => ({
        ...prev,
        traces: [...prev.traces, newTr],
      }));
      setSelectedTraceId(newTr.id);
      setDraftPoints([]);
      setActiveTool('SELECT');

      if (aiBrain.autoLearnEnabled) {
        recordAiSelfLearningEvent(
          `Learned new user-drawn ${finalSetId} (${finalOrient}) trace across ${draftPoints.length} vertices`,
          { addedSamples: 1, newTrace: newTr }
        );
        setCadCmdStatus(
          `AI Brain ate new ${finalSetId} (${finalOrient}) trace — Generation #${aiBrain.generation + 1} updated.`
        );
      }
    } else if (activeTool === 'DRAW_LITHOLOGY' && draftPoints.length >= 3) {
      const newZone: ContinuousStripLithologyZone = {
        id: `lith-${Date.now()}`,
        rockType: newLithRockType,
        codeSymbol:
          newLithRockType === 'Quartz veins'
            ? '+ + +'
            : newLithRockType.slice(0, 3),
        label: `${newLithRockType} Zone`,
        polygon: draftPoints,
        isIntrusionBody: newLithRockType === 'Quartz veins',
      };
      updateActiveDataset((prev) => ({
        ...prev,
        lithologyZones: [...prev.lithologyZones, newZone],
      }));
      setSelectedLithId(newZone.id);
      setDraftPoints([]);
      setActiveTool('SELECT');
      if (aiBrain.autoLearnEnabled) {
        recordAiSelfLearningEvent(
          `Learned new ${newLithRockType} lithology boundary (${draftPoints.length} vertices)`,
          { addedSamples: 1 }
        );
      }
    }
  };

  // Add New Pull Interval
  const handleAddPullInterval = () => {
    const fromVal = parseFloat(newPullFrom);
    const toVal = parseFloat(newPullTo);
    const azVal = parseFloat(newPullAzimuth) || 160;
    if (isNaN(fromVal) || isNaN(toVal) || toVal <= fromVal) return;

    const newPull: ContinuousPullRecord = {
      id: `pull-${fromVal}-${toVal}-${Date.now()}`,
      fromRd: fromVal,
      toRd: toVal,
      driveAzimuthDeg: azVal,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: (azVal + 180) % 360,
      convergenceMm: '0 mm',
      rockType: newPullRock || 'Qtz - Quartzite',
      rockDescription: `${newPullRock || 'Quartzite'}, medium grained, very strong.`,
      rockClass: 'II',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      seepageCondition: 'DRY',
      weatheringCondition: 'W2',
      ucsRangeMpa: '150 MPa (VERY STRONG)',
      rmrValue: 60,
      rqdValue: 72,
      overbreakVolumeM3: 0.35,
      excavationDefiningNo: '2',
      excavationDate: new Date().toISOString().slice(0, 10),
      supportClass: '2/3a',
      status: 'MAPPED',
      dateMapped: new Date().toISOString().slice(0, 10),
    };

    updateActiveDataset((prev) => {
      const merged = [
        ...prev.pulls.filter(
          (p) =>
            p.status === 'MAPPED' &&
            !(Math.abs(p.fromRd - fromVal) < 0.1 && Math.abs(p.toRd - toVal) < 0.1)
        ),
        newPull,
      ];
      const normalized = normalizePullsWithMissingGaps(merged);
      return {
        ...prev,
        pulls: normalized,
        viewFromRd: Math.min(prev.viewFromRd, normalized[0]?.fromRd ?? 0),
        viewToRd: Math.max(
          prev.viewToRd,
          normalized[normalized.length - 1]?.toRd ?? 30
        ),
      };
    });

    setNewPullFrom(String(toVal));
    setNewPullTo(String(toVal + 5));
  };

  // Create New Project / Tunnel Location Dataset
  const handleCreateNewLocationDataset = () => {
    const proj = newProjNameInput.trim() || activeDataset.projectName || 'New Tunnel Project';
    const loc = newLocNameInput.trim() || 'New Tunnel Heading';
    const az = parseFloat(newLocAzimuthInput) || 0;
    const opp = (az + 180) % 360;
    const newId = `ds-${Date.now()}`;
    const newDs: ContinuousTunnelStripDataset = {
      id: newId,
      projectName: proj,
      tunnelLocationName: loc,
      clientName: activeDataset.clientName || '',
      contractorName: activeDataset.contractorName || '',
      geologistContractor: activeDataset.geologistContractor || '',
      geologistClient: activeDataset.geologistClient || '',
      upperZoneLabel: 'LEFT WALL TO CROWN (SPRING LINE)',
      lowerZoneLabel: 'CROWN TO RIGHT WALL (SPRING LINE)',
      upperZoneWidthM: 7.5,
      lowerZoneWidthM: 7.5,
      tunnelDiameterWidthM: 8.4,
      tunnelArchHeightM: 7.2,
      viewFromRd: 0,
      viewToRd: 30,
      leftCornerAzimuthLabel: `${String(Math.round(opp)).padStart(3, '0')}°N`,
      rightCornerAzimuthLabel: `${String(Math.round(az)).padStart(3, '0')}°N`,
      pulls: [],
      traces: [],
      lithologyZones: [],
      waterSymbols: [],
      narrativeBullets: [],
      sheetConfig: getDefaultSheetConfig({
        projectName: proj,
        tunnelLocationName: loc,
      }),
      updatedAt: new Date().toISOString(),
    };
    const next = [...datasets, newDs];
    setDatasets(next);
    saveAllContinuousStripDatasets(next);
    setActiveDatasetId(newDs.id);
    setInspectorTab('TRACES_AI');
  };

  // Keyboard shortcuts for CAD drawing & editing (Enter = Commit, Esc = Cancel/Deselect, Del = Delete)
  useEffect(() => {
    if (!isOpen || workspaceView !== 'CANVAS') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Enter' && draftPoints.length >= 2) {
        e.preventDefault();
        handleCommitDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (draftPoints.length > 0) {
          setDraftPoints([]);
          setCadCmdStatus('Canceled in-progress drawing.');
        } else {
          setActiveTool('SELECT');
          setSelectedTraceId(null);
          setSelectedLithId(null);
          setSelectedWaterId(null);
          setMeasurePts([]);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTraceId) {
          e.preventDefault();
          updateActiveDataset((prev) => ({
            ...prev,
            traces: prev.traces.filter((t) => t.id !== selectedTraceId),
          }));
          setSelectedTraceId(null);
          setCadCmdStatus('Deleted selected structural trace.');
        } else if (selectedLithId) {
          e.preventDefault();
          updateActiveDataset((prev) => ({
            ...prev,
            lithologyZones: prev.lithologyZones.filter((l) => l.id !== selectedLithId),
          }));
          setSelectedLithId(null);
          setCadCmdStatus('Deleted selected lithology zone.');
        } else if (selectedWaterId) {
          e.preventDefault();
          updateActiveDataset((prev) => ({
            ...prev,
            waterSymbols: prev.waterSymbols.filter((w) => w.id !== selectedWaterId),
          }));
          setSelectedWaterId(null);
          setCadCmdStatus('Deleted selected water inflow symbol.');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  // Build outer smooth ribbon wall polygon strings for Smooth Realistic Curve mode
  const topWallPtsStr = smoothRibbon.samples
    .map((s) => {
      const p = smoothRibbon.mapRdPerimToSvg(s.rd, 0);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
  const botWallPtsStr = [...smoothRibbon.samples]
    .reverse()
    .map((s) => {
      const p = smoothRibbon.mapRdPerimToSvg(s.rd, totalPerimM);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
  const fullRibbonPolyStr = `${topWallPtsStr} ${botWallPtsStr}`;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col font-mono overflow-hidden transition-colors ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#070B12] text-slate-100'
      }`}
    >
      {/* ====================================================================
          SLEEK ARCHITECTURAL HEADER: BRAND EMBLEM + PROJECT -> LOCATION + SCOPE
         ==================================================================== */}
      <header
        className={`border-b px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0 print:hidden transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800 shadow-xs'
            : 'bg-[#0B101B] border-slate-800/90 text-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <EswaTunnelLogo size="xs" variant="inline" showBadge={false} />

          {/* STEP 1: CHOOSE PROJECT */}
          <div
            className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : 'bg-slate-900/90 border-slate-700/80 text-slate-100'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] text-slate-400 font-semibold">Project:</span>
            <select
              value={activeDataset.projectName}
              onChange={(e) => {
                const targetProj = e.target.value;
                const firstInProj = datasets.find((d) => d.projectName === targetProj);
                if (firstInProj) {
                  setActiveDatasetId(firstInProj.id);
                  setSelectedTraceId(null);
                  setSelectedLithId(null);
                  setSelectedWaterId(null);
                  setSelectedPullId(null);
                }
              }}
              className={`bg-transparent font-bold outline-none cursor-pointer text-xs max-w-[200px] truncate ${
                isLight ? 'text-amber-700' : 'text-amber-300'
              }`}
            >
              {projectNames.map((pName) => (
                <option
                  key={pName}
                  value={pName}
                  className={isLight ? 'bg-white text-slate-900' : 'bg-[#0E1525] text-white'}
                >
                  {pName}
                </option>
              ))}
            </select>
          </div>

          {/* STEP 2: CHOOSE TUNNEL LOCATION */}
          <div
            className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ${
              isLight
                ? 'bg-cyan-50/60 border-cyan-300 text-slate-800'
                : 'bg-slate-900/90 border-cyan-500/40 text-slate-100'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-500" />
            <span className="text-[10px] text-slate-400 font-semibold">Location:</span>
            <select
              value={activeDataset.id}
              onChange={(e) => {
                setActiveDatasetId(e.target.value);
                setSelectedTraceId(null);
                setSelectedLithId(null);
                setSelectedWaterId(null);
                setSelectedPullId(null);
              }}
              className={`bg-transparent font-bold outline-none cursor-pointer text-xs max-w-[190px] truncate ${
                isLight ? 'text-cyan-700' : 'text-cyan-300'
              }`}
            >
              {locationsForActiveProject.map((ds) => (
                <option
                  key={ds.id}
                  value={ds.id}
                  className={isLight ? 'bg-white text-slate-900' : 'bg-[#0E1525] text-white'}
                >
                  {ds.tunnelLocationName} (Ch. {ds.viewFromRd}–{ds.viewToRd}m)
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setWorkspaceView('CANVAS');
                setShowRightInspector(true);
                setInspectorTab('NEW_LOCATION');
              }}
              title="Create a new Project or Tunnel Location"
              className={`ml-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold cursor-pointer ${
                isLight
                  ? 'bg-cyan-600 text-white border-cyan-600 hover:bg-cyan-700'
                  : 'bg-cyan-600/25 hover:bg-cyan-600/40 text-cyan-300 border-cyan-500/40'
              }`}
            >
              + New
            </button>
          </div>

          {/* SCOPE SWITCHER: SINGLE TUNNEL STRIP vs ENTIRE PROJECT NETWORK */}
          <div
            className={`flex items-center border rounded-lg p-0.5 ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900/90 border-slate-800'
            }`}
          >
            <button
              onClick={() => {
                setWorkspaceView('CANVAS');
                setCanvasScope('SINGLE_LOCATION');
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                workspaceView === 'CANVAS' && canvasScope === 'SINGLE_LOCATION'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              Single Strip (1m)
            </button>
            <button
              onClick={() => {
                setWorkspaceView('CANVAS');
                setCanvasScope('PROJECT_NETWORK');
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                workspaceView === 'CANVAS' && canvasScope === 'PROJECT_NETWORK'
                  ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                  : isLight
                  ? 'text-amber-700 hover:text-amber-900'
                  : 'text-amber-300 hover:text-white'
              }`}
            >
              <GitCommitHorizontal className="w-3.5 h-3.5" />
              Project Network ({locationsForActiveProject.length})
            </button>
          </div>
        </div>

        {/* Right: Canvas vs Export Studio + Theme + Close */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center border rounded-lg p-0.5 ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900/90 border-slate-800'
            }`}
          >
            <button
              onClick={() => setWorkspaceView('CANVAS')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                workspaceView === 'CANVAS'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              CAD Canvas
            </button>
            <button
              onClick={() => setWorkspaceView('EXPORT_STUDIO')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                workspaceView === 'EXPORT_STUDIO'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : isLight
                  ? 'text-emerald-700 hover:text-emerald-900'
                  : 'text-emerald-300 hover:text-white'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              Export &amp; Sheet Studio
            </button>
          </div>

          <ThemeToggleButton compact />

          <button
            onClick={onClose}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold flex items-center gap-1 cursor-pointer ${
              isLight
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300'
                : 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border-rose-500/40'
            }`}
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>
      </header>

      {/* ====================================================================
          VIEW A: EXPORT & PRINTABLE SHEET STUDIO (Adopted Template & Multi-Page)
         ==================================================================== */}
      {workspaceView === 'EXPORT_STUDIO' ? (
        <ContinuousStripExportStudio
          dataset={activeDataset}
          projectDatasets={locationsForActiveProject}
          aiViewMode={aiViewMode}
          cadLayers={cadLayers}
          onUpdateCadLayers={setCadLayers}
          onUpdateSheetConfig={(newCfg: SheetCustomizationConfig) =>
            updateActiveDataset((prev) => ({
              ...prev,
              sheetConfig: newCfg,
            }))
          }
          onBackToCanvas={() => setWorkspaceView('CANVAS')}
        />
      ) : (
        /* ====================================================================
            VIEW B: DEDICATED MAIN STRIP CANVAS WINDOW (1-Meter Chainage Scale,
            AI Trend Align Before/After, Smooth Non-Brittle Drive Curvature)
           ==================================================================== */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* SINGLE CLEAN CAD WORKSPACE TOOLBAR */}
          <div
            className={`border-b px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0 transition-colors ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : 'bg-[#0F1624] border-slate-800/90 text-slate-100'
            }`}
          >
            {/* Left Group: Smooth Drive Curve vs Straight 1m + AI Trend Alignment */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Smooth Drive Direction Mode Toggle */}
              <div
                className={`flex items-center border rounded-lg p-0.5 ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <button
                  onClick={() => setCanvasDriveMode('SMOOTH_REALISTIC_CURVE')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                    canvasDriveMode === 'SMOOTH_REALISTIC_CURVE'
                      ? 'bg-amber-600 text-white'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Smooth Catmull-Rom Curved Strip following Drive Direction (°N)"
                >
                  <Compass className="w-3 h-3" />
                  Smooth Curve
                </button>
                <button
                  onClick={() => setCanvasDriveMode('STRAIGHTENED_1M_CANVAS')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                    canvasDriveMode === 'STRAIGHTENED_1M_CANVAS'
                      ? 'bg-cyan-600 text-white'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Orthogonal 1m Chainage Grid"
                >
                  <Layers className="w-3 h-3" />
                  1m Grid
                </button>
              </div>

              {/* AI Trend Alignment Action + Before/After View Toggle */}
              <div
                className={`flex items-center gap-1 border rounded-lg p-0.5 ${
                  isLight
                    ? 'bg-purple-50/70 border-purple-200'
                    : 'bg-slate-900/90 border-purple-500/40'
                }`}
              >
                <button
                  onClick={handleRunAiTrendAlignment}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                  title="Run AI Trend Alignment & Seam Stitching across Pulls"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  AI Align
                </button>

                <button
                  onClick={() => {
                    setAiViewMode('BEFORE_AI');
                    setCadLayers((prev) => ({ ...prev, traces: true }));
                  }}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${
                    aiViewMode === 'BEFORE_AI'
                      ? 'bg-rose-600 text-white'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Before
                </button>
                <button
                  onClick={() => {
                    setAiViewMode('AFTER_AI');
                    setCadLayers((prev) => ({ ...prev, traces: true, aiRawGhost: false }));
                  }}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${
                    aiViewMode === 'AFTER_AI'
                      ? 'bg-emerald-600 text-white'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  After
                </button>
                <button
                  onClick={() => {
                    setAiViewMode('SPLIT_GHOST');
                    setCadLayers((prev) => ({ ...prev, traces: true, aiRawGhost: true }));
                  }}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${
                    aiViewMode === 'SPLIT_GHOST'
                      ? 'bg-purple-600 text-white'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Compare
                </button>
                <button
                  onClick={() => handleAiEatAndLearnProject(true)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                    isLight
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 border-amber-500/40'
                  }`}
                  title="Self-Learning AI Brain: Digest current patterns & synthesize predicted trace continuation"
                >
                  <span>🧠 AI Learn &amp; Predict (Gen #{aiBrain.generation})</span>
                </button>
              </div>
            </div>

            {/* Center Group: CAD Drawing & Modify Tools (Auto-switches to Single Strip when clicked) */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => {
                  setActiveTool('SELECT');
                  setDraftPoints([]);
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'SELECT'
                    ? 'bg-cyan-600 border-cyan-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <MousePointer className="w-3 h-3" />
                Select / Edit
              </button>

              <button
                onClick={() => {
                  setActiveTool((t) => (t === 'PAN' ? 'SELECT' : 'PAN'));
                }}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'PAN'
                    ? 'bg-sky-600 border-sky-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Pan Canvas (or Middle-Click / Shift+Drag)"
              >
                <Hand className="w-3 h-3" />
                Pan
              </button>

              <button
                onClick={() => {
                  setCanvasScope('SINGLE_LOCATION');
                  setActiveTool('DRAW_TRACE');
                  setDraftPoints([]);
                  setCadCmdStatus('ESWACAD PLINE active: Click points on the 1m strip. Double-click or press Enter to finish.');
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'DRAW_TRACE'
                    ? 'bg-amber-600 border-amber-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <PenTool className="w-3 h-3" />
                + Trace
              </button>

              <button
                onClick={() => {
                  setCanvasScope('SINGLE_LOCATION');
                  setActiveTool('DRAW_SPLINE');
                  setDraftPoints([]);
                  setCadCmdStatus('ESWACAD SPLINE active: Click control points to fit a smooth structural spline curve. Double-click to finish.');
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'DRAW_SPLINE'
                    ? 'bg-fuchsia-600 border-fuchsia-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="ESWACAD SPLINE (SP): Draw smooth Catmull-Rom curved structural trace"
              >
                <Sparkles className="w-3 h-3 text-fuchsia-400" />
                + Spline
              </button>

              <button
                onClick={() => {
                  setCanvasScope('SINGLE_LOCATION');
                  setActiveTool('DRAW_LITHOLOGY');
                  setDraftPoints([]);
                  setCadCmdStatus('Draw Lithology active: Click 3+ polygon corners. Double-click or press Enter to finish.');
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'DRAW_LITHOLOGY'
                    ? 'bg-emerald-600 border-emerald-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                + Lithology
              </button>

              <button
                onClick={() => {
                  setCanvasScope('SINGLE_LOCATION');
                  setActiveTool('PLACE_WATER');
                  setDraftPoints([]);
                  setCadCmdStatus('Water Inflow active: Click anywhere on the strip to place a groundwater symbol.');
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  activeTool === 'PLACE_WATER'
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Droplets className="w-3 h-3" />
                + Water
              </button>

              {draftPoints.length >= 2 && (
                <button
                  onClick={handleCommitDraft}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] flex items-center gap-1 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Finish ({draftPoints.length} pts)
                </button>
              )}

              {/* Compact CAD Modify Group */}
              <div
                className={`flex items-center gap-0.5 border rounded-lg p-0.5 ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <button
                  onClick={() => handleCadOffsetSelectedTrace(1)}
                  title="ESWACAD OFFSET: Create parallel joint/shear trace at spacing (m)"
                  className={`px-2 py-0.5 rounded-md hover:bg-cyan-600 hover:text-white text-[10px] font-bold cursor-pointer ${
                    isLight ? 'text-cyan-700' : 'text-cyan-300'
                  }`}
                >
                  Offset ({offsetDistM}m)
                </button>
                <button
                  onClick={handleCadExtendSelectedTrace}
                  title="ESWACAD EXTEND: Project selected trace along strike/dip to wall"
                  className={`px-2 py-0.5 rounded-md hover:bg-cyan-600 hover:text-white text-[10px] font-bold cursor-pointer ${
                    isLight ? 'text-cyan-700' : 'text-cyan-300'
                  }`}
                >
                  Extend
                </button>
                <button
                  onClick={handleCadTrimSelectedTrace}
                  title="ESWACAD TRIM: Trim end segment of selected trace"
                  className={`px-2 py-0.5 rounded-md hover:bg-cyan-600 hover:text-white text-[10px] font-bold cursor-pointer ${
                    isLight ? 'text-cyan-700' : 'text-cyan-300'
                  }`}
                >
                  Trim
                </button>
                <button
                  onClick={() => {
                    setCanvasScope('SINGLE_LOCATION');
                    setActiveTool((t) =>
                      t === 'MEASURE_DIST' ? 'SELECT' : 'MEASURE_DIST'
                    );
                    setMeasurePts([]);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer ${
                    activeTool === 'MEASURE_DIST'
                      ? 'bg-amber-500 text-slate-950 font-black'
                      : isLight
                      ? 'hover:bg-amber-500 hover:text-white text-amber-700'
                      : 'hover:bg-amber-700 text-amber-300'
                  }`}
                >
                  Measure
                </button>
              </div>
            </div>

            {/* Right Group: CAD Layers Popover + Snap Controls + Zoom + Inspector Toggle */}
            <div className="flex items-center gap-1">
              {/* Collapsible CAD Layers Popover */}
              <div className="relative">
                <button
                  onClick={() => setShowLayersPopover((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 cursor-pointer transition-all ${
                    showLayersPopover
                      ? 'bg-cyan-600 text-white border-cyan-400 shadow-sm'
                      : isLight
                      ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  <Layers className="w-3 h-3 text-cyan-400" />
                  <span>
                    Layers ({Object.values(cadLayers).filter(Boolean).length}/10)
                  </span>
                </button>
                {showLayersPopover && (
                  <div
                    className={`absolute right-0 mt-1.5 w-80 p-3 border rounded-xl shadow-2xl z-50 space-y-2 text-[10px] backdrop-blur-md transition-colors ${
                      isLight
                        ? 'bg-white/98 border-slate-300 text-slate-800 shadow-slate-400/30'
                        : 'bg-[#0E1628]/98 border-cyan-500/50 text-slate-100 shadow-black/70'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between border-b pb-1.5 font-bold ${
                        isLight
                          ? 'border-slate-200 text-cyan-700'
                          : 'border-slate-700/80 text-cyan-400'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        ESWACAD LAYER MANAGER (SYNCED)
                      </span>
                      <button
                        onClick={() => setShowLayersPopover(false)}
                        className="text-slate-400 hover:text-rose-500 px-1 font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Quick Bulk Actions */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          setCadLayers({
                            grid1m: true,
                            springLines: true,
                            pullSeams: true,
                            lithology: true,
                            traces: true,
                            waterInflows: true,
                            aiRawGhost: true,
                            junctions: true,
                            aiCrossProj: true,
                            foliationHatch: true,
                          })
                        }
                        className={`flex-1 py-1 rounded-md border font-bold cursor-pointer ${
                          isLight
                            ? 'bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border-cyan-200'
                            : 'bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-300 border-cyan-500/30'
                        }`}
                      >
                        Show All
                      </button>
                      <button
                        onClick={() =>
                          setCadLayers({
                            grid1m: false,
                            springLines: false,
                            pullSeams: false,
                            lithology: false,
                            traces: false,
                            waterInflows: false,
                            aiRawGhost: false,
                            junctions: false,
                            aiCrossProj: false,
                            foliationHatch: false,
                          })
                        }
                        className={`flex-1 py-1 rounded-md border font-bold cursor-pointer ${
                          isLight
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        }`}
                      >
                        Hide All
                      </button>
                      <button
                        onClick={() => setCadLayers(DEFAULT_CAD_LAYERS)}
                        className={`px-2 py-1 rounded-md border font-bold cursor-pointer ${
                          isLight
                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        Reset
                      </button>
                    </div>

                    <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
                      {[
                        {
                          key: 'grid1m',
                          label: '0_CHAINAGE_1M_GRID',
                          desc: '1m Chainage Ruler & Ticks',
                          dot: '#0284c7',
                          count: singleMeterTicks.length,
                          color: isLight ? 'text-sky-700 font-semibold' : 'text-sky-300',
                        },
                        {
                          key: 'springLines',
                          label: '1_SPRING_LINES_CROWN',
                          desc: 'Crown & L/R Spring Lines',
                          dot: '#38bdf8',
                          count: 3,
                          color: isLight ? 'text-slate-700 font-semibold' : 'text-slate-200',
                        },
                        {
                          key: 'pullSeams',
                          label: '2_PULL_SEAMS_AZIMUTH',
                          desc: 'Pull Boundaries & °N Badges',
                          dot: '#f59e0b',
                          count: activeDataset.pulls.length,
                          color: isLight ? 'text-amber-700 font-semibold' : 'text-amber-300',
                        },
                        {
                          key: 'foliationHatch',
                          label: '3_FOLIATION_BASE_HATCH',
                          desc: 'Host Rock Pattern Hatch',
                          dot: '#64748b',
                          count: 1,
                          color: isLight ? 'text-slate-600 font-semibold' : 'text-slate-300',
                        },
                        {
                          key: 'lithology',
                          label: '4_LITHOLOGY_QUARTZ',
                          desc: 'Quartz Veins & Rock Zones',
                          dot: '#d97706',
                          count: activeDataset.lithologyZones.length,
                          color: isLight ? 'text-amber-700 font-semibold' : 'text-amber-300',
                        },
                        {
                          key: 'traces',
                          label: '5_STRUCTURAL_TRACES',
                          desc: 'Joint Sets, Shears & Faults',
                          dot: '#10b981',
                          count: activeDataset.traces.length,
                          color: isLight ? 'text-emerald-700 font-semibold' : 'text-emerald-300',
                        },
                        {
                          key: 'aiRawGhost',
                          label: '6_AI_RAW_PHOTO_GHOST',
                          desc: 'Unaligned Raw Photo Traces',
                          dot: '#f43f5e',
                          count: activeDataset.traces.filter(
                            (t) => t.rawPoints && t.rawPoints.length >= 2
                          ).length,
                          color: isLight ? 'text-rose-600 font-semibold' : 'text-rose-300',
                        },
                        {
                          key: 'waterInflows',
                          label: '7_GROUNDWATER_SEEPAGE',
                          desc: 'Dripping / Wet / Flowing',
                          dot: '#2563eb',
                          count: activeDataset.waterSymbols.length,
                          color: isLight ? 'text-blue-700 font-semibold' : 'text-blue-300',
                        },
                        {
                          key: 'junctions',
                          label: '8_TUNNEL_INTERSECTIONS',
                          desc: 'Branch Portals & Collars',
                          dot: '#ea580c',
                          count: locationsForActiveProject.filter((b) =>
                            Boolean(b.intersectionConfig)
                          ).length,
                          color: isLight ? 'text-amber-600 font-semibold' : 'text-amber-400',
                        },
                        {
                          key: 'aiCrossProj',
                          label: '9_AI_3D_CROSS_TUNNEL',
                          desc: '3D Inter-Tunnel Projections',
                          dot: '#d946ef',
                          count: projectNetworkLayout.aiCrossProjections.length,
                          color: isLight ? 'text-fuchsia-700 font-semibold' : 'text-fuchsia-300',
                        },
                      ].map((ly) => {
                        const k = ly.key as keyof CadLayerVisibilityState;
                        const isOn = cadLayers[k];
                        return (
                          <div
                            key={ly.key}
                            className={`flex items-center justify-between py-1 px-1.5 rounded-lg border transition-colors ${
                              isOn
                                ? isLight
                                  ? 'bg-slate-50/90 border-slate-200'
                                  : 'bg-slate-900/70 border-slate-800'
                                : isLight
                                ? 'bg-slate-100/50 border-transparent opacity-60'
                                : 'bg-slate-950/40 border-transparent opacity-55'
                            }`}
                          >
                            <label className="flex items-center gap-2 flex-1 cursor-pointer truncate">
                              <input
                                type="checkbox"
                                checked={isOn}
                                onChange={() => {
                                  const nextVal = !cadLayers[k];
                                  setCadLayers((prev) => ({
                                    ...prev,
                                    [k]: nextVal,
                                  }));
                                  if (k === 'aiRawGhost' && nextVal && aiViewMode === 'AFTER_AI') {
                                    setAiViewMode('SPLIT_GHOST');
                                  }
                                }}
                                className="rounded border-slate-400 text-cyan-600 cursor-pointer"
                              />
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: ly.dot }}
                              />
                              <div className="truncate">
                                <div
                                  className={`truncate ${
                                    isOn ? ly.color : 'text-slate-400 line-through'
                                  }`}
                                >
                                  {ly.label}
                                </div>
                                <div className="text-[9px] text-slate-400 truncate">
                                  {ly.desc}
                                </div>
                              </div>
                            </label>
                            <div className="flex items-center gap-1 shrink-0 ml-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  isLight
                                    ? 'bg-slate-200 text-slate-700'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {ly.count}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setCadLayers({
                                    grid1m: k === 'grid1m',
                                    springLines: k === 'springLines',
                                    pullSeams: k === 'pullSeams',
                                    lithology: k === 'lithology',
                                    traces: k === 'traces',
                                    waterInflows: k === 'waterInflows',
                                    aiRawGhost: k === 'aiRawGhost',
                                    junctions: k === 'junctions',
                                    aiCrossProj: k === 'aiCrossProj',
                                    foliationHatch: k === 'foliationHatch',
                                  })
                                }
                                title="Isolate only this layer"
                                className={`px-1.5 py-0.5 rounded border text-[8.5px] font-bold cursor-pointer ${
                                  isLight
                                    ? 'bg-white hover:bg-amber-50 text-slate-600 border-slate-300'
                                    : 'bg-slate-800 hover:bg-amber-950 text-slate-300 border-slate-700'
                                }`}
                              >
                                ISO
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setOsnapEnabled((v) => !v)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                  osnapEnabled
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                      : 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
                title="Toggle Endpoint & Seam Object Snap"
              >
                OSNAP
              </button>
              <button
                onClick={() => setOrthoEnabled((v) => !v)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                  orthoEnabled
                    ? isLight
                      ? 'bg-amber-50 border-amber-400 text-amber-700'
                      : 'bg-amber-950/80 border-amber-500/50 text-amber-300'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
                title="Toggle Orthogonal Lock"
              >
                ORTHO
              </button>
              <button
                onClick={() => setDynEnabled((v) => !v)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                  dynEnabled
                    ? isLight
                      ? 'bg-cyan-50 border-cyan-400 text-cyan-700'
                      : 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
                title="Toggle Dynamic Coordinate HUD"
              >
                DYN
              </button>

              <div
                className={`flex items-center border rounded-lg px-1 py-0.5 text-[10px] ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                }`}
              >
                <button
                  onClick={() =>
                    setCadZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))
                  }
                  className="px-1.5 font-bold cursor-pointer"
                >
                  -
                </button>
                <button
                  onClick={() => {
                    setCadZoom(1.0);
                    setCadPan({ x: 0, y: 0 });
                  }}
                  className={`px-1.5 font-bold cursor-pointer ${
                    isLight ? 'text-cyan-700' : 'text-cyan-300'
                  }`}
                  title="Reset Zoom & Pan to 100%"
                >
                  {Math.round(cadZoom * 100)}%
                </button>
                <button
                  onClick={() =>
                    setCadZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))
                  }
                  className="px-1.5 font-bold cursor-pointer"
                >
                  +
                </button>
              </div>

              <button
                onClick={() => setShowRightInspector((v) => !v)}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 border-slate-200 text-cyan-700'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-cyan-300'
                }`}
              >
                {showRightInspector ? 'Hide Panel' : 'Inspector'}
              </button>
            </div>
          </div>

          {/* AI Alignment Status Toast Banner */}
          {aiAlignBannerMsg && (
            <div className="bg-purple-950/90 border-b border-purple-500/50 px-4 py-1.5 flex items-center justify-between text-xs text-purple-100 shrink-0">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-amber-300" />
                <span>{aiAlignBannerMsg}</span>
              </div>
              <button
                onClick={() => setAiAlignBannerMsg(null)}
                className="text-purple-300 hover:text-white text-xs font-bold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ==================================================================
              MAIN INTERACTIVE STRIP CANVAS AREA + COLLAPSIBLE RIGHT INSPECTOR
             ================================================================== */}
          <div className="flex-1 flex overflow-hidden">
            {/* FULL-SCREEN UNFOLDED STRIP CANVAS (SINGLE LOCATION OR ENTIRE PROJECT NETWORK) */}
            <div
              className={`flex-1 relative overflow-auto flex items-center justify-center p-3 transition-colors ${
                isLight ? 'bg-slate-200/70' : 'bg-[#070B14]'
              }`}
            >
              {canvasScope === 'PROJECT_NETWORK' ? (
                /* ==============================================================
                   ENTIRE PROJECT MULTI-TUNNEL NETWORK CANVAS (WITH INTERSECTIONS
                   & AI 3D CROSS-TUNNEL STRUCTURAL PROJECTION)
                   ============================================================== */
                <div
                  className={`w-full max-w-[1480px] border rounded-xl shadow-2xl p-3 transition-colors ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#0B1220] border-amber-500/50 text-slate-100'
                  }`}
                >
                  <div
                    className={`flex flex-wrap items-center justify-between text-xs pb-2 mb-2 border-b ${
                      isLight ? 'border-slate-200' : 'border-[#1E2D4A]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black rounded-md text-[11px]">
                        ENTIRE PROJECT MULTI-TUNNEL NETWORK
                      </span>
                      <span
                        className={`font-bold uppercase ${
                          isLight ? 'text-slate-800' : 'text-amber-200'
                        }`}
                      >
                        {activeDataset.projectName} (
                        {projectNetworkLayout.positionedStrips.length} Interconnected
                        Tunnels)
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px]">
                      <span
                        className={`flex items-center gap-1.5 font-bold ${
                          isLight ? 'text-amber-700' : 'text-amber-300'
                        }`}
                      >
                        <span className="w-3 h-3 border-2 border-dashed border-amber-500 inline-block" />
                        Junction Portal Cutout
                      </span>
                      <span
                        className={`flex items-center gap-1.5 font-bold ${
                          isLight ? 'text-fuchsia-700' : 'text-fuchsia-300'
                        }`}
                      >
                        <span className="w-4 border-b-2 border-dashed border-fuchsia-500 inline-block" />
                        AI 3D Cross-Tunnel Shear/Joint Projection
                      </span>
                      <span className="text-slate-400">
                        Click any tunnel to select • Double-click to open Single-Strip 1m Editor
                      </span>
                    </div>
                  </div>

                  <svg
                    viewBox={`${-cadPan.x} ${-cadPan.y} ${Math.round(
                      1500 / cadZoom
                    )} ${Math.round(780 / cadZoom)}`}
                    onWheel={(e) => {
                      e.preventDefault();
                      const delta = e.deltaY < 0 ? 0.12 : -0.12;
                      setCadZoom((z) =>
                        Math.max(0.55, Math.min(2.6, Number((z + delta).toFixed(2))))
                      );
                    }}
                    className={`w-full h-auto border rounded-lg select-none ${
                      isLight
                        ? 'bg-[#F8FAFC] border-slate-300'
                        : 'bg-[#060A12] border-[#1E2E4D]'
                    }`}
                  >
                    <defs>
                      <pattern
                        id="netCadGrid"
                        width="40"
                        height="40"
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d="M 40 0 L 0 0 0 40"
                          fill="none"
                          stroke={isLight ? '#cbd5e1' : '#1e293b'}
                          strokeWidth="0.6"
                        />
                      </pattern>
                    </defs>
                    {cadLayers.grid1m && (
                      <rect x="-500" y="-500" width="2600" height="1800" fill="url(#netCadGrid)" />
                    )}

                    {/* 1. Render Every Tunnel Strip in the Project Network */}
                    {projectNetworkLayout.positionedStrips.map((tNode) => {
                      const ds = tNode.dataset;
                      const isSelectedTunnel = ds.id === activeDataset.id;
                      const topWall = tNode.samples
                        .map((s) => {
                          const p = tNode.mapRdPerimToSvg(s.rd, 0);
                          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                        })
                        .join(' ');
                      const botWall = [...tNode.samples]
                        .reverse()
                        .map((s) => {
                          const p = tNode.mapRdPerimToSvg(s.rd, tNode.totalPerimM);
                          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                        })
                        .join(' ');
                      const polyStr = `${topWall} ${botWall}`;

                      const labelAnchor = tNode.mapRdPerimToSvg(
                        (tNode.startRd + tNode.endRd) / 2,
                        -1.6
                      );

                      // 2m chainage ticks along each tunnel in the network
                      const netTicks: number[] = [];
                      for (
                        let m = Math.ceil(tNode.startRd);
                        m <= Math.floor(tNode.endRd);
                        m += 2
                      ) {
                        netTicks.push(m);
                      }

                      return (
                        <g
                          key={ds.id}
                          onClick={() => setActiveDatasetId(ds.id)}
                          onDoubleClick={() => {
                            setActiveDatasetId(ds.id);
                            setCanvasScope('SINGLE_LOCATION');
                          }}
                          className="cursor-pointer"
                        >
                          {/* Unfolded Strip Polygon */}
                          <polygon
                            points={polyStr}
                            fill={
                              isLight
                                ? isSelectedTunnel
                                  ? '#e0f2fe'
                                  : '#ffffff'
                                : isSelectedTunnel
                                ? '#112240'
                                : '#0B1528'
                            }
                            stroke={
                              isSelectedTunnel
                                ? '#0284c7'
                                : !tNode.isTrunk
                                ? '#d97706'
                                : isLight
                                ? '#334155'
                                : '#64748b'
                            }
                            strokeWidth={isSelectedTunnel ? 2.6 : 1.6}
                          />

                          {/* Crown Centerline & Spring Lines */}
                          {cadLayers.springLines &&
                            [0.22, 0.5, 0.78].map((frac, idx) => {
                              const linePts = tNode.samples
                                .map((s) => {
                                  const pt = tNode.mapRdPerimToSvg(
                                    s.rd,
                                    tNode.totalPerimM * frac
                                  );
                                  return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                                })
                                .join(' ');
                              return (
                                <polyline
                                  key={idx}
                                  points={linePts}
                                  fill="none"
                                  stroke={
                                    idx === 1
                                      ? isLight
                                        ? '#0284c7'
                                        : '#38bdf8'
                                      : '#64748b'
                                  }
                                  strokeWidth={idx === 1 ? 1.0 : 0.7}
                                  strokeDasharray="6,4"
                                  opacity={0.75}
                                />
                              );
                            })}

                          {/* 1m/2m Chainage Grid Ticks on Tunnel */}
                          {cadLayers.grid1m &&
                            netTicks.map((m) => {
                              const pTop = tNode.mapRdPerimToSvg(m, 0);
                              const pBot = tNode.mapRdPerimToSvg(m, tNode.totalPerimM);
                              const is5m = m % 5 === 0;
                              return (
                                <g key={m}>
                                  <line
                                    x1={pTop.x}
                                    y1={pTop.y}
                                    x2={pBot.x}
                                    y2={pBot.y}
                                    stroke={isLight ? '#94a3b8' : '#475569'}
                                    strokeWidth={is5m ? 0.8 : 0.35}
                                    strokeOpacity={0.55}
                                  />
                                  {is5m && (
                                    <text
                                      x={pTop.x}
                                      y={pTop.y - 5}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontWeight="800"
                                      fill={isLight ? '#0369a1' : '#38bdf8'}
                                    >
                                      Ch.{m}m
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                          {/* Lithology Zones inside Network Tunnel */}
                          {cadLayers.lithology &&
                            ds.lithologyZones.map((lz) => {
                              const lPts = lz.polygon
                                .map((p) => {
                                  const sp = tNode.mapRdPerimToSvg(p.x, p.y);
                                  return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                                })
                                .join(' ');
                              return (
                                <polygon
                                  key={lz.id}
                                  points={lPts}
                                  fill={lz.isIntrusionBody ? '#fbbf24' : '#94a3b8'}
                                  fillOpacity={0.25}
                                  stroke={lz.isIntrusionBody ? '#d97706' : '#64748b'}
                                  strokeWidth="1"
                                />
                              );
                            })}

                           {/* Structural Traces inside Network Tunnel */}
                          {cadLayers.traces &&
                            ds.traces.map((tr) => {
                              const pts = getDisplayedTracePoints(tr);
                              if (pts.length < 2) return null;
                              const tStr = pts
                                .map((p) => {
                                  const sp = tNode.mapRdPerimToSvg(p.x, p.y);
                                  return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                                })
                                .join(' ');
                              const rawNetStr =
                                cadLayers.aiRawGhost &&
                                tr.rawPoints &&
                                tr.rawPoints.length >= 2
                                  ? tr.rawPoints
                                      .map((p) => {
                                        const sp = tNode.mapRdPerimToSvg(p.x, p.y);
                                        return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                                      })
                                      .join(' ')
                                  : null;
                              const isShear =
                                tr.structureType === 'Shear Zone' ||
                                tr.structureType === 'Fault' ||
                                tr.structureType === 'Shear Joint (5-30mm)';
                              return (
                                <g key={tr.id}>
                                  {rawNetStr && (
                                    <polyline
                                      points={rawNetStr}
                                      fill="none"
                                      stroke="#f43f5e"
                                      strokeWidth="1.2"
                                      strokeDasharray="3,3"
                                      opacity={0.75}
                                    />
                                  )}
                                  <polyline
                                    points={tStr}
                                    fill="none"
                                    stroke={
                                      isShear
                                        ? '#ef4444'
                                        : isLight
                                        ? '#059669'
                                        : '#34d399'
                                    }
                                    strokeWidth={isShear ? 2.4 : 1.5}
                                  />
                                </g>
                              );
                            })}

                          {/* Water Inflow Symbols inside Network Tunnel */}
                          {cadLayers.waterInflows &&
                            ds.waterSymbols.map((ws) => {
                              const wp = tNode.mapRdPerimToSvg(
                                ws.position.x,
                                ws.position.y
                              );
                              return (
                                <circle
                                  key={ws.id}
                                  cx={wp.x}
                                  cy={wp.y}
                                  r="4.5"
                                  fill="#2563eb"
                                  stroke="#93c5fd"
                                  strokeWidth="1.2"
                                />
                              );
                            })}

                          {/* Tunnel Title Callout Banner */}
                          <g
                            transform={`translate(${labelAnchor.x}, ${labelAnchor.y})`}
                          >
                            <rect
                              x="-125"
                              y="-13"
                              width="250"
                              height="20"
                              rx="4"
                              fill={
                                isSelectedTunnel
                                  ? '#0284c7'
                                  : isLight
                                  ? '#1e293b'
                                  : '#0F172A'
                              }
                              stroke={isSelectedTunnel ? '#38bdf8' : '#475569'}
                              strokeWidth="1.2"
                            />
                            <text
                              x="0"
                              y="1"
                              textAnchor="middle"
                              fontSize="9"
                              fontWeight="800"
                              fill="#ffffff"
                            >
                              {ds.tunnelLocationName} (Ch. {tNode.startRd}–{tNode.endRd}m)
                            </text>
                          </g>
                        </g>
                      );
                    })}

                    {/* 2. Render Physical Intersection Portal Cutouts & Match Lines */}
                    {cadLayers.junctions &&
                      projectNetworkLayout.positionedStrips
                        .filter((s) => Boolean(s.junctionPortal))
                        .map((s, idx) => {
                          const jp = s.junctionPortal!;
                          return (
                            <g key={idx}>
                              {/* Portal Cutout Polygon on Parent Tunnel Wall */}
                              <polygon
                                points={jp.portalCornersSvg
                                  .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                                  .join(' ')}
                                fill="#f59e0b"
                                fillOpacity="0.28"
                                stroke="#d97706"
                                strokeWidth="2"
                                strokeDasharray="4,2"
                              />
                              {/* Match-Line Tie from Parent Wall Cutout to Branch Collar */}
                              <line
                                x1={jp.portalCenterSvg.x}
                                y1={jp.portalCenterSvg.y}
                                x2={jp.branchStartCenterSvg.x}
                                y2={jp.branchStartCenterSvg.y}
                                stroke="#d97706"
                                strokeWidth="1.8"
                                strokeDasharray="5,3"
                              />
                              <circle
                                cx={jp.portalCenterSvg.x}
                                cy={jp.portalCenterSvg.y}
                                r="4.5"
                                fill="#fbbf24"
                                stroke="#000"
                              />
                              {/* Junction Callout Tag */}
                              <g
                                transform={`translate(${jp.portalCenterSvg.x}, ${
                                  jp.portalCenterSvg.y - 14
                                })`}
                              >
                                <rect
                                  x="-115"
                                  y="-12"
                                  width="230"
                                  height="16"
                                  rx="3"
                                  fill="#451a03"
                                  stroke="#fbbf24"
                                  strokeWidth="1"
                                />
                                <text
                                  x="0"
                                  y="-1"
                                  textAnchor="middle"
                                  fontSize="8"
                                  fontWeight="800"
                                  fill="#fde68a"
                                >
                                  ⊕ {jp.label}
                                </text>
                              </g>
                            </g>
                          );
                        })}

                    {/* 3. Render AI 3D Cross-Tunnel Structural Projections */}
                    {cadLayers.aiCrossProj &&
                      projectNetworkLayout.aiCrossProjections.map((cp) => (
                        <g key={cp.id}>
                          <line
                            x1={cp.fromPtSvg.x}
                            y1={cp.fromPtSvg.y}
                            x2={cp.toPtSvg.x}
                            y2={cp.toPtSvg.y}
                            stroke="#d946ef"
                            strokeWidth="2.0"
                            strokeDasharray="7,4"
                          />
                          <circle
                            cx={cp.fromPtSvg.x}
                            cy={cp.fromPtSvg.y}
                            r="4"
                            fill="#d946ef"
                          />
                          <circle
                            cx={cp.toPtSvg.x}
                            cy={cp.toPtSvg.y}
                            r="4"
                            fill="#d946ef"
                          />
                          <g
                            transform={`translate(${
                              (cp.fromPtSvg.x + cp.toPtSvg.x) / 2
                            }, ${(cp.fromPtSvg.y + cp.toPtSvg.y) / 2})`}
                          >
                            <rect
                              x="-135"
                              y="-10"
                              width="270"
                              height="15"
                              rx="3"
                              fill="#3b0764"
                              stroke="#e879f9"
                              strokeWidth="1"
                            />
                            <text
                              x="0"
                              y="1"
                              textAnchor="middle"
                              fontSize="7.5"
                              fontWeight="800"
                              fill="#f5d0fe"
                            >
                              AI 3D PROJECTION: {cp.setId} ({cp.orientationLabel}) →{' '}
                              {cp.toTunnelName}
                            </text>
                          </g>
                        </g>
                      ))}

                    {/* AutoCAD UCS Icon in Bottom-Left of Network Model Space */}
                    <g transform="translate(36, 735)">
                      <line x1="0" y1="0" x2="45" y2="0" stroke="#16a34a" strokeWidth="2" />
                      <line x1="0" y1="0" x2="0" y2="-45" stroke="#dc2626" strokeWidth="2" />
                      <rect
                        x="-4"
                        y="-4"
                        width="8"
                        height="8"
                        fill="none"
                        stroke={isLight ? '#0f172a' : '#fff'}
                      />
                      <text x="50" y="3" fontSize="8.5" fontWeight="800" fill="#16a34a">
                        X (EASTING / RD)
                      </text>
                      <text x="-8" y="-50" fontSize="8.5" fontWeight="800" fill="#dc2626">
                        Y (NORTHING)
                      </text>
                    </g>
                  </svg>
                </div>
              ) : (
                <div
                  className={`w-full max-w-[1440px] border rounded-xl shadow-2xl p-3 transition-colors ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-[#0B1220] border-[#243656] text-slate-100'
                  }`}
                >
                {/* Canvas Top Info Strip */}
                <div
                  className={`flex flex-wrap items-center justify-between text-xs pb-2 mb-2 border-b ${
                    isLight ? 'border-slate-200' : 'border-[#1E2D4A]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-bold uppercase ${
                        isLight ? 'text-cyan-700' : 'text-cyan-300'
                      }`}
                    >
                      {activeDataset.projectName} — {activeDataset.tunnelLocationName}
                    </span>
                    <span
                      className={`px-2 py-0.5 border rounded-md text-[11px] font-bold ${
                        isLight
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-slate-800 border-slate-700 text-amber-300'
                      }`}
                    >
                      1-Meter Chainage Scale: Ch. {viewStartRd}m to {viewEndRd}m (
                      {totalRdSpanM}m span)
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    {aiViewMode === 'SPLIT_GHOST' && (
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-rose-500 font-bold">
                          <span className="w-4 border-b-2 border-dashed border-rose-500 inline-block" />
                          Raw Photo Trace (Before AI)
                        </span>
                        <span className="flex items-center gap-1 text-emerald-600 font-bold">
                          <span className="w-4 border-b-2 border-emerald-500 inline-block" />
                          AI Trend-Aligned Trace
                        </span>
                      </div>
                    )}
                    {cursorRdPerim && (
                      <span
                        className={`font-bold px-2 py-0.5 rounded-md border ${
                          isLight
                            ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                            : 'bg-[#111C33] text-cyan-300 border-cyan-500/30'
                        }`}
                      >
                        Chainage: {cursorRdPerim.x.toFixed(2)}m | Perimeter:{' '}
                        {cursorRdPerim.y.toFixed(2)}m
                      </span>
                    )}
                  </div>
                </div>

                {/* INTERACTIVE SVG STRIP CANVAS */}
                <svg
                  ref={svgRef}
                  viewBox={`${-cadPan.x} ${-cadPan.y} ${Math.round(
                    svgW / cadZoom
                  )} ${Math.round(svgH / cadZoom)}`}
                  onClick={handleCanvasClick}
                  onDoubleClick={() => {
                    if (draftPoints.length >= 2) {
                      handleCommitDraft();
                    }
                  }}
                  onWheel={(e) => {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 0.12 : -0.12;
                    setCadZoom((z) =>
                      Math.max(0.55, Math.min(2.6, Number((z + delta).toFixed(2))))
                    );
                  }}
                  onMouseDown={(e) => {
                    if (activeTool === 'PAN' || e.button === 1 || e.shiftKey) {
                      setIsPanningCanvas(true);
                      setPanStartClient({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  onMouseMove={(e) => {
                    if (isPanningCanvas && panStartClient) {
                      const dx = (e.clientX - panStartClient.x) / cadZoom;
                      const dy = (e.clientY - panStartClient.y) / cadZoom;
                      setCadPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
                      setPanStartClient({ x: e.clientX, y: e.clientY });
                      return;
                    }
                    const svgEl = svgRef.current;
                    if (svgEl) {
                      const r = svgEl.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0) {
                        setCursorSvgPt({
                          x: ((e.clientX - r.left) / r.width) * (svgW / cadZoom) - cadPan.x,
                          y: ((e.clientY - r.top) / r.height) * (svgH / cadZoom) - cadPan.y,
                        });
                      }
                    }
                    const pt = svgToRdPerim(e.clientX, e.clientY);
                    if (pt) setCursorRdPerim(pt);
                    if (draggingVertex && pt) {
                      updateActiveDataset((prev) => ({
                        ...prev,
                        traces: prev.traces.map((t) => {
                          if (t.id !== draggingVertex.traceId) return t;
                          const nextPts = t.points.map((p, idx) =>
                            idx === draggingVertex.vertexIdx ? pt : p
                          );
                          return {
                            ...t,
                            points: nextPts,
                            aiAlignedPoints: nextPts,
                          };
                        }),
                      }));
                    } else if (draggingLithVertex && pt) {
                      updateActiveDataset((prev) => ({
                        ...prev,
                        lithologyZones: prev.lithologyZones.map((lz) => {
                          if (lz.id !== draggingLithVertex.lithId) return lz;
                          const nextPoly = lz.polygon.map((p, idx) =>
                            idx === draggingLithVertex.vertexIdx ? pt : p
                          );
                          return { ...lz, polygon: nextPoly };
                        }),
                      }));
                    } else if (draggingWaterId && pt) {
                      updateActiveDataset((prev) => ({
                        ...prev,
                        waterSymbols: prev.waterSymbols.map((w) =>
                          w.id === draggingWaterId ? { ...w, position: pt } : w
                        ),
                      }));
                    }
                  }}
                  onMouseUp={() => {
                    if (draggingVertex && aiBrain.autoLearnEnabled) {
                      const editedTr = activeDataset.traces.find(
                        (t) => t.id === draggingVertex.traceId
                      );
                      if (editedTr) {
                        recordAiSelfLearningEvent(
                          `Learned manual vertex refinement on ${editedTr.setId} (${editedTr.orientationLabel}) Vertex #${draggingVertex.vertexIdx + 1}`,
                          { isUserCorrection: true }
                        );
                      }
                    }
                    setDraggingVertex(null);
                    setDraggingLithVertex(null);
                    setDraggingWaterId(null);
                    setIsPanningCanvas(false);
                    setPanStartClient(null);
                  }}
                  className={`w-full h-auto border rounded-lg select-none ${
                    activeTool === 'PAN' || isPanningCanvas
                      ? 'cursor-grab active:cursor-grabbing'
                      : 'cursor-crosshair'
                  } ${
                    isLight
                      ? 'bg-[#F8FAFC] border-slate-300'
                      : 'bg-[#090F1C] border-[#1E2E4D]'
                  }`}
                >
                  <defs>
                    <pattern
                      id="canvasFoliationPattern"
                      width="16"
                      height="16"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(-35)"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="16"
                        stroke={isLight ? '#cbd5e1' : '#334155'}
                        strokeWidth="0.8"
                      />
                    </pattern>
                    <pattern
                      id="canvasFracturedPattern"
                      width="12"
                      height="12"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 0 12 L 12 0 M 0 0 L 12 12"
                        stroke="#f59e0b"
                        strokeWidth="0.7"
                        strokeOpacity="0.45"
                      />
                    </pattern>
                  </defs>

                  {/* ==========================================================
                      1. BASE STRIP BACKGROUND (SMOOTH REALISTIC CURVE OR STRAIGHT)
                     ========================================================== */}
                  {canvasDriveMode === 'SMOOTH_REALISTIC_CURVE' ? (
                    <g>
                      <polygon
                        points={fullRibbonPolyStr}
                        fill={isLight ? '#ffffff' : '#0F172A'}
                        stroke={isLight ? '#0284c7' : '#38bdf8'}
                        strokeWidth="1.8"
                      />
                      {cadLayers.foliationHatch && (
                        <polygon
                          points={fullRibbonPolyStr}
                          fill="url(#canvasFoliationPattern)"
                          opacity={isLight ? 0.45 : 0.55}
                        />
                      )}
                    </g>
                  ) : (
                    <g>
                      <rect
                        x={stripLeftX}
                        y={stripTopY}
                        width={stripWidthPx}
                        height={stripHeightPx}
                        fill={isLight ? '#ffffff' : '#0F172A'}
                        stroke={isLight ? '#0284c7' : '#38bdf8'}
                        strokeWidth="1.8"
                      />
                      {cadLayers.foliationHatch && (
                        <rect
                          x={stripLeftX}
                          y={stripTopY}
                          width={stripWidthPx}
                          height={stripHeightPx}
                          fill="url(#canvasFoliationPattern)"
                          opacity={isLight ? 0.45 : 0.55}
                        />
                      )}
                    </g>
                  )}

                  {/* ==========================================================
                      2. PULL SEAM BOUNDARIES & DRIVE AZIMUTH ANNOTATIONS
                     ========================================================== */}
                  {cadLayers.pullSeams &&
                    activeDataset.pulls.map((p) => {
                    if (p.toRd <= viewStartRd || p.fromRd >= viewEndRd) return null;
                    const clpFrom = Math.max(viewStartRd, p.fromRd);
                    const clpTo = Math.min(viewEndRd, p.toRd);
                    const midRd = (clpFrom + clpTo) / 2;

                    const seamTop = mapRdPerimToSvg(clpTo, 0);
                    const seamBot = mapRdPerimToSvg(clpTo, totalPerimM);
                    const badgePos = mapRdPerimToSvg(midRd, totalPerimM + 1.3);
                    const isSelected = p.id === selectedPullId;

                    // Missing gap highlight
                    if (p.status === 'MISSING_GAP') {
                      const g1 = mapRdPerimToSvg(clpFrom, 0);
                      const g2 = mapRdPerimToSvg(clpTo, 0);
                      const g3 = mapRdPerimToSvg(clpTo, totalPerimM);
                      const g4 = mapRdPerimToSvg(clpFrom, totalPerimM);
                      return (
                        <g
                          key={p.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedPullId(p.id);
                          }}
                          className="cursor-pointer"
                        >
                          <polygon
                            points={`${g1.x},${g1.y} ${g2.x},${g2.y} ${g3.x},${g3.y} ${g4.x},${g4.y}`}
                            fill={isLight ? '#fee2e2' : '#450a0a'}
                            fillOpacity="0.65"
                            stroke="#ef4444"
                            strokeWidth="1.5"
                            strokeDasharray="6,4"
                          />
                          <text
                            x={(g1.x + g3.x) / 2}
                            y={(g1.y + g3.y) / 2}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="800"
                            fill={isLight ? '#b91c1c' : '#fca5a5'}
                          >
                            UNMAPPED PULL SPACE ({p.fromRd}–{p.toRd}m)
                          </text>
                        </g>
                      );
                    }

                    return (
                      <g
                        key={p.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedPullId(p.id);
                          setShowRightInspector(true);
                          setInspectorTab('PULLS_DRIVE');
                        }}
                        className="cursor-pointer"
                      >
                        {/* Subtle Pull Boundary Seam */}
                        <line
                          x1={seamTop.x}
                          y1={seamTop.y}
                          x2={seamBot.x}
                          y2={seamBot.y}
                          stroke={isSelected ? '#d97706' : isLight ? '#94a3b8' : '#475569'}
                          strokeWidth={isSelected ? 2.0 : 1.0}
                          strokeDasharray="5,5"
                        />
                        {/* Pull Drive Azimuth & RMR Pill */}
                        <g transform={`translate(${badgePos.x}, ${badgePos.y})`}>
                          <rect
                            x="-52"
                            y="-10"
                            width="104"
                            height="20"
                            rx="4"
                            fill={
                              isSelected
                                ? '#b45309'
                                : isLight
                                ? '#f1f5f9'
                                : '#111C33'
                            }
                            stroke={
                              isSelected
                                ? '#fbbf24'
                                : isLight
                                ? '#cbd5e1'
                                : '#334155'
                            }
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y="3"
                            textAnchor="middle"
                            fontSize="8.5"
                            fontWeight="700"
                            fill={
                              isSelected
                                ? '#ffffff'
                                : isLight
                                ? '#334155'
                                : '#fde68a'
                            }
                          >
                            Pull {p.fromRd}–{p.toRd}m · N{p.driveAzimuthDeg}°
                          </text>
                        </g>
                      </g>
                    );
                  })}

                  {/* ==========================================================
                      3. SMOOTH SPRING LINES (22% & 78%) & CROWN CENTERLINE (50%)
                     ========================================================== */}
                  {cadLayers.springLines &&
                    [
                      { frac: 0.22, label: 'LEFT SPRING LINE' },
                      { frac: 0.5, label: 'CROWN CENTERLINE' },
                      { frac: 0.78, label: 'RIGHT SPRING LINE' },
                    ].map((lineObj, idx) => {
                      const pts = smoothRibbon.samples
                        .map((s) => {
                          const pt = mapRdPerimToSvg(s.rd, totalPerimM * lineObj.frac);
                          return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                        })
                        .join(' ');
                      const leftLabelPt = mapRdPerimToSvg(
                        viewStartRd,
                        totalPerimM * lineObj.frac
                      );
                      return (
                        <g key={idx}>
                          <polyline
                            points={pts}
                            fill="none"
                            stroke={
                              idx === 1
                                ? isLight
                                  ? '#0284c7'
                                  : '#38bdf8'
                                : isLight
                                ? '#64748b'
                                : '#94a3b8'
                            }
                            strokeWidth={idx === 1 ? 1.1 : 0.9}
                            strokeDasharray={idx === 1 ? '10,4,2,4' : '6,4'}
                            opacity={0.75}
                          />
                          <text
                            x={leftLabelPt.x - 8}
                            y={leftLabelPt.y + 3}
                            textAnchor="end"
                            fontSize="8"
                            fontWeight="700"
                            fill={
                              idx === 1
                                ? isLight
                                  ? '#0284c7'
                                  : '#38bdf8'
                                : isLight
                                ? '#475569'
                                : '#94a3b8'
                            }
                          >
                            {lineObj.label}
                          </text>
                        </g>
                      );
                    })}

                  {/* ==========================================================
                      4. SINGLE-METER (1m) CHAINAGE RULER & GRID TICKS
                     ========================================================== */}
                  {cadLayers.grid1m &&
                    singleMeterTicks.map((m) => {
                      const topPt = mapRdPerimToSvg(m, 0);
                      const botPt = mapRdPerimToSvg(m, totalPerimM);
                      const s = smoothRibbon.getSampleAtRd(m);
                      const nx = canvasDriveMode === 'SMOOTH_REALISTIC_CURVE' ? s.nx : 0;
                      const ny = canvasDriveMode === 'SMOOTH_REALISTIC_CURVE' ? s.ny : 1;

                      const isMajor5m = m % 5 === 0;
                      const isEven2m = m % 2 === 0;
                      const tickLen = isMajor5m ? 14 : isEven2m ? 10 : 6;

                      return (
                        <g key={m}>
                          {/* 1m Vertical Grid Line across the strip */}
                          <line
                            x1={topPt.x}
                            y1={topPt.y}
                            x2={botPt.x}
                            y2={botPt.y}
                            stroke={isLight ? '#94a3b8' : '#64748b'}
                            strokeWidth={isMajor5m ? 0.85 : 0.3}
                            strokeOpacity={isMajor5m ? 0.55 : 0.25}
                          />
                          {/* Top 1m Chainage Ruler Tick */}
                          <line
                            x1={topPt.x}
                            y1={topPt.y}
                            x2={topPt.x - nx * tickLen}
                            y2={topPt.y - ny * tickLen}
                            stroke={
                              isMajor5m
                                ? isLight
                                  ? '#0284c7'
                                  : '#38bdf8'
                                : isLight
                                ? '#64748b'
                                : '#cbd5e1'
                            }
                            strokeWidth={isMajor5m ? 1.6 : 1.0}
                          />
                          {/* Every 1m or 2m Chainage Label */}
                          {(totalRdSpanM <= 35 || isEven2m) && (
                            <text
                              x={topPt.x - nx * (tickLen + 8)}
                              y={topPt.y - ny * (tickLen + 8)}
                              textAnchor="middle"
                              fontSize={isMajor5m ? '9.5' : '8'}
                              fontWeight={isMajor5m ? '800' : '600'}
                              fill={
                                isMajor5m
                                  ? isLight
                                    ? '#0284c7'
                                    : '#38bdf8'
                                  : isLight
                                  ? '#334155'
                                  : '#e2e8f0'
                              }
                            >
                              {m}
                            </text>
                          )}
                        </g>
                      );
                    })}

                  {/* ==========================================================
                      5. LITHOLOGY ZONES, QUARTZ VEINS (+ + +) & FRACTURED ZONES
                     ========================================================== */}
                  {cadLayers.lithology &&
                    activeDataset.lithologyZones.map((lz) => {
                      const isLithSel = lz.id === selectedLithId;
                      const polyPts = lz.polygon
                        .map((p) => {
                          const svgPt = mapRdPerimToSvg(p.x, p.y);
                          return `${svgPt.x.toFixed(1)},${svgPt.y.toFixed(1)}`;
                        })
                        .join(' ');
                      const mapped = lz.polygon.map((p) => mapRdPerimToSvg(p.x, p.y));
                      const cx =
                        mapped.reduce((acc, p) => acc + p.x, 0) /
                        Math.max(1, mapped.length);
                      const cy =
                        mapped.reduce((acc, p) => acc + p.y, 0) /
                        Math.max(1, mapped.length);

                      return (
                        <g
                          key={lz.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedLithId(lz.id);
                            setSelectedTraceId(null);
                            setSelectedWaterId(null);
                            setShowRightInspector(true);
                            setInspectorTab('TRACES_AI');
                          }}
                          className="cursor-pointer"
                        >
                          <polygon
                            points={polyPts}
                            fill={
                              lz.isIntrusionBody
                                ? '#fbbf24'
                                : lz.isFracturedZone
                                ? 'url(#canvasFracturedPattern)'
                                : isLight
                                ? '#e2e8f0'
                                : '#1e293b'
                            }
                            fillOpacity={lz.isIntrusionBody ? 0.28 : 0.3}
                            stroke={
                              isLithSel
                                ? '#0284c7'
                                : lz.isIntrusionBody
                                ? '#d97706'
                                : '#64748b'
                            }
                            strokeWidth={isLithSel ? 2.4 : lz.isIntrusionBody ? 1.6 : 1.2}
                            strokeDasharray={lz.isIntrusionBody ? undefined : '6,4'}
                          />
                          <text
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            fontSize="9.5"
                            fontWeight="800"
                            fill={
                              lz.isIntrusionBody
                                ? isLight
                                  ? '#b45309'
                                  : '#fde68a'
                                : isLight
                                ? '#334155'
                                : '#cbd5e1'
                            }
                          >
                            {lz.isIntrusionBody ? '+  +  + (Quartz Vein)' : lz.codeSymbol || lz.rockType}
                          </text>
                          {/* Draggable Polygon Vertices when selected */}
                          {activeTool === 'SELECT' &&
                            lz.polygon.map((pt, vIdx) => {
                              const vSvg = mapRdPerimToSvg(pt.x, pt.y);
                              return (
                                <circle
                                  key={vIdx}
                                  cx={vSvg.x}
                                  cy={vSvg.y}
                                  r={isLithSel ? 4.5 : 3}
                                  fill={isLithSel ? '#0284c7' : '#f59e0b'}
                                  stroke="#fff"
                                  strokeWidth="1"
                                  onMouseDown={(ev) => {
                                    ev.stopPropagation();
                                    setSelectedLithId(lz.id);
                                    setDraggingLithVertex({
                                      lithId: lz.id,
                                      vertexIdx: vIdx,
                                    });
                                  }}
                                  className="cursor-move"
                                />
                              );
                            })}
                        </g>
                      );
                    })}

                  {/* ==========================================================
                      6. STRUCTURAL TRACES (BEFORE AI GHOST + AFTER AI ALIGNED)
                     ========================================================== */}
                  {cadLayers.traces &&
                    activeDataset.traces.map((tr) => {
                      const activePts = getDisplayedTracePoints(tr);
                      if (activePts.length < 2) return null;

                      const isSelected = tr.id === selectedTraceId;
                      const isShearOrFault =
                        tr.structureType === 'Shear Zone' ||
                        tr.structureType === 'Fault' ||
                        tr.structureType === 'Shear Joint (5-30mm)';

                      // Smoothly sample along each segment so traces bend smoothly with the tunnel ribbon!
                      const buildSmoothTraceSvgPoints = (pts: Point2D[]) => {
                        const sampled: Point2D[] = [];
                        for (let i = 0; i < pts.length - 1; i++) {
                          const a = pts[i];
                          const b = pts[i + 1];
                          const steps = Math.max(2, Math.ceil(Math.abs(b.x - a.x) * 2));
                          for (let s = 0; s < steps; s++) {
                            const t = s / steps;
                            sampled.push(
                              mapRdPerimToSvg(
                                a.x + (b.x - a.x) * t,
                                a.y + (b.y - a.y) * t
                              )
                            );
                          }
                        }
                        const last = pts[pts.length - 1];
                        sampled.push(mapRdPerimToSvg(last.x, last.y));
                        return sampled
                          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                          .join(' ');
                      };

                      const activePolyStr = buildSmoothTraceSvgPoints(activePts);
                      const rawPolyStr =
                        tr.rawPoints && tr.rawPoints.length >= 2
                          ? buildSmoothTraceSvgPoints(tr.rawPoints)
                          : null;

                      const midPt = activePts[Math.floor(activePts.length / 2)];
                      const midSvg = mapRdPerimToSvg(midPt.x, midPt.y);

                      const strokeColor = isSelected
                        ? '#0284c7'
                        : isShearOrFault
                        ? '#ef4444'
                        : aiViewMode === 'BEFORE_AI'
                        ? '#f43f5e'
                        : isLight
                        ? '#059669'
                        : '#34d399';

                      return (
                        <g
                          key={tr.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedTraceId(tr.id);
                            setSelectedLithId(null);
                            setSelectedWaterId(null);
                            setShowRightInspector(true);
                            setInspectorTab('TRACES_AI');
                          }}
                          className="cursor-pointer"
                        >
                          {/* Ghost Raw Photo Trace when enabled in CAD Layers */}
                          {cadLayers.aiRawGhost &&
                            aiViewMode !== 'BEFORE_AI' &&
                            rawPolyStr && (
                              <polyline
                                points={rawPolyStr}
                                fill="none"
                                stroke="#f43f5e"
                                strokeWidth="1.5"
                                strokeDasharray="4,4"
                                opacity={0.85}
                              />
                            )}

                          {/* Shear Zone Halo */}
                          {isShearOrFault && (
                            <polyline
                              points={activePolyStr}
                              fill="none"
                              stroke="#ef4444"
                              strokeWidth="6"
                              strokeOpacity="0.22"
                            />
                          )}

                          {/* Main Trace Polyline */}
                          <polyline
                            points={activePolyStr}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={isSelected ? 3.0 : isShearOrFault ? 2.4 : 1.8}
                          />

                          {/* Strike / Dip Orientation Callout */}
                          <g transform={`translate(${midSvg.x}, ${midSvg.y})`}>
                            <rect
                              x="-28"
                              y="-18"
                              width="56"
                              height="14"
                              rx="3"
                              fill={isLight ? '#ffffff' : '#090D16'}
                              stroke={strokeColor}
                              strokeWidth="1"
                            />
                            <text
                              x="0"
                              y="-8"
                              textAnchor="middle"
                              fontSize="8"
                              fontWeight="800"
                              fill={isLight ? '#0f172a' : '#fff'}
                            >
                              {tr.setId} {tr.orientationLabel}
                            </text>
                          </g>

                          {/* Draggable CAD Vertices when in SELECT mode */}
                          {activeTool === 'SELECT' &&
                            activePts.map((pt, vIdx) => {
                              const vSvg = mapRdPerimToSvg(pt.x, pt.y);
                              return (
                                <circle
                                  key={vIdx}
                                  cx={vSvg.x}
                                  cy={vSvg.y}
                                  r={isSelected ? 5 : 3.5}
                                  fill={isSelected ? '#0284c7' : '#10b981'}
                                  stroke="#ffffff"
                                  strokeWidth="1.2"
                                  onMouseDown={(ev) => {
                                    ev.stopPropagation();
                                    setSelectedTraceId(tr.id);
                                    setDraggingVertex({ traceId: tr.id, vertexIdx: vIdx });
                                  }}
                                  className="cursor-move"
                                />
                              );
                            })}
                        </g>
                      );
                    })}

                  {/* ==========================================================
                      7. WATER INFLOW SYMBOLS (CLICK TO SELECT & DRAG TO MOVE)
                     ========================================================== */}
                  {cadLayers.waterInflows &&
                    activeDataset.waterSymbols.map((ws) => {
                    const pt = mapRdPerimToSvg(ws.position.x, ws.position.y);
                    const isWaterSel = ws.id === selectedWaterId;
                    return (
                      <g
                        key={ws.id}
                        transform={`translate(${pt.x}, ${pt.y})`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedWaterId(ws.id);
                          setSelectedTraceId(null);
                          setSelectedLithId(null);
                          setShowRightInspector(true);
                          setInspectorTab('TRACES_AI');
                        }}
                        onMouseDown={(ev) => {
                          if (activeTool === 'SELECT') {
                            ev.stopPropagation();
                            setSelectedWaterId(ws.id);
                            setDraggingWaterId(ws.id);
                          }
                        }}
                        className="cursor-move"
                      >
                        <circle
                          cx="0"
                          cy="0"
                          r={isWaterSel ? 7.5 : 6}
                          fill={isWaterSel ? '#0284c7' : '#1d4ed8'}
                          stroke="#93c5fd"
                          strokeWidth={isWaterSel ? 2.2 : 1.4}
                        />
                        <text
                          x="10"
                          y="3"
                          fontSize="8.5"
                          fontWeight="800"
                          fill={isLight ? '#1d4ed8' : '#93c5fd'}
                        >
                          {ws.condition}
                        </text>
                      </g>
                    );
                  })}

                  {/* ==========================================================
                      8. ACTIVE DRAFT POLYLINE / SPLINE & OSNAP MARKER
                     ========================================================== */}
                  {draftPoints.length > 0 && (
                    <g>
                      <polyline
                        points={(activeTool === 'DRAW_SPLINE'
                          ? interpolateCatmullRomSpline(
                              [...draftPoints, ...(cursorRdPerim ? [cursorRdPerim] : [])],
                              6
                            )
                          : [...draftPoints, ...(cursorRdPerim ? [cursorRdPerim] : [])]
                        )
                          .map((p) => {
                            const s = mapRdPerimToSvg(p.x, p.y);
                            return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
                          })
                          .join(' ')}
                        fill={
                          activeTool === 'DRAW_LITHOLOGY'
                            ? 'rgba(16, 185, 129, 0.2)'
                            : 'none'
                        }
                        stroke={activeTool === 'DRAW_SPLINE' ? '#d946ef' : '#f59e0b'}
                        strokeWidth="2.2"
                        strokeDasharray="4,3"
                      />
                      {draftPoints.map((p, idx) => {
                        const s = mapRdPerimToSvg(p.x, p.y);
                        return (
                          <circle
                            key={idx}
                            cx={s.x}
                            cy={s.y}
                            r="4"
                            fill={activeTool === 'DRAW_SPLINE' ? '#e879f9' : '#fbbf24'}
                            stroke="#000"
                          />
                        );
                      })}
                    </g>
                  )}

                  {osnapCandidate && (
                    <g
                      transform={`translate(${
                        mapRdPerimToSvg(osnapCandidate.pt.x, osnapCandidate.pt.y).x
                      }, ${
                        mapRdPerimToSvg(osnapCandidate.pt.x, osnapCandidate.pt.y).y
                      })`}
                    >
                      <rect
                        x="-6"
                        y="-6"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth="2"
                      />
                      <text x="10" y="-6" fontSize="8.5" fontWeight="800" fill="#16a34a">
                        {osnapCandidate.label}
                      </text>
                    </g>
                  )}

                  {/* ==========================================================
                      9. INTERSECTING BRANCH TUNNEL PORTAL CUTOUTS ON THIS STRIP
                     ========================================================== */}
                  {cadLayers.junctions &&
                    locationsForActiveProject
                      .filter(
                        (b) =>
                          b.intersectionConfig &&
                          b.intersectionConfig.parentDatasetId === activeDataset.id
                      )
                      .map((branchDs) => {
                        const ic = branchDs.intersectionConfig!;
                        if (
                          ic.parentJunctionRd < viewStartRd ||
                          ic.parentJunctionRd > viewEndRd
                        ) {
                          return null;
                        }
                        const halfSpan = (ic.portalWidthM || branchDs.tunnelDiameterWidthM || 6) / 2;
                        const r1 = Math.max(viewStartRd, ic.parentJunctionRd - halfSpan);
                        const r2 = Math.min(viewEndRd, ic.parentJunctionRd + halfSpan);
                        const p1 =
                          ic.attachWall === 'LEFT_WALL'
                            ? 0.4
                            : ic.attachWall === 'PARALLEL_SEAM'
                            ? totalPerimM * 0.35
                            : totalPerimM * 0.62;
                        const p2 =
                          ic.attachWall === 'LEFT_WALL'
                            ? totalPerimM * 0.38
                            : ic.attachWall === 'PARALLEL_SEAM'
                            ? totalPerimM * 0.65
                            : totalPerimM - 0.4;
                        const c1 = mapRdPerimToSvg(r1, p1);
                        const c2 = mapRdPerimToSvg(r2, p1);
                        const c3 = mapRdPerimToSvg(r2, p2);
                        const c4 = mapRdPerimToSvg(r1, p2);
                        const center = mapRdPerimToSvg(
                          ic.parentJunctionRd,
                          (p1 + p2) / 2
                        );
                        return (
                          <g
                            key={branchDs.id}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setActiveDatasetId(branchDs.id);
                            }}
                            className="cursor-pointer"
                          >
                            <polygon
                              points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y} ${c4.x},${c4.y}`}
                              fill="#f59e0b"
                              fillOpacity="0.24"
                              stroke="#d97706"
                              strokeWidth="2"
                              strokeDasharray="5,3"
                            />
                            <text
                              x={center.x}
                              y={center.y - 4}
                              textAnchor="middle"
                              fontSize="8.5"
                              fontWeight="800"
                              fill={isLight ? '#92400e' : '#fde68a'}
                            >
                              ⊕ PORTAL: {branchDs.tunnelLocationName}
                            </text>
                            <text
                              x={center.x}
                              y={center.y + 8}
                              textAnchor="middle"
                              fontSize="7.5"
                              fontWeight="700"
                              fill={isLight ? '#b45309' : '#fbbf24'}
                            >
                              Ch. {ic.parentJunctionRd}m ({ic.portalWidthM || 5.2}m{' '}
                              {ic.attachWall.replace('_', ' ')}) — Click to Enter
                            </text>
                          </g>
                        );
                      })}

                  {/* ==========================================================
                      10. AUTOCAD DIST MEASUREMENT OVERLAY
                     ========================================================== */}
                  {measurePts.length > 0 && (
                    <g>
                      {measurePts.map((pt, idx) => {
                        const s = mapRdPerimToSvg(pt.x, pt.y);
                        return (
                          <circle
                            key={idx}
                            cx={s.x}
                            cy={s.y}
                            r="4.5"
                            fill="#f59e0b"
                            stroke="#000"
                            strokeWidth="1.2"
                          />
                        );
                      })}
                      {measurePts.length === 2 &&
                        (() => {
                          const s1 = mapRdPerimToSvg(measurePts[0].x, measurePts[0].y);
                          const s2 = mapRdPerimToSvg(measurePts[1].x, measurePts[1].y);
                          const dRd = measurePts[1].x - measurePts[0].x;
                          const dPerim = measurePts[1].y - measurePts[0].y;
                          const dist = Math.hypot(dRd, dPerim);
                          return (
                            <g>
                              <line
                                x1={s1.x}
                                y1={s1.y}
                                x2={s2.x}
                                y2={s2.y}
                                stroke="#d97706"
                                strokeWidth="2"
                                strokeDasharray="6,3"
                              />
                              <g
                                transform={`translate(${(s1.x + s2.x) / 2}, ${
                                  (s1.y + s2.y) / 2 - 12
                                })`}
                              >
                                <rect
                                  x="-95"
                                  y="-12"
                                  width="190"
                                  height="18"
                                  rx="3"
                                  fill="#451a03"
                                  stroke="#fbbf24"
                                />
                                <text
                                  x="0"
                                  y="0"
                                  textAnchor="middle"
                                  fontSize="8.5"
                                  fontWeight="800"
                                  fill="#fde68a"
                                >
                                  DIST = {dist.toFixed(2)}m (ΔRD {dRd.toFixed(2)}m, ΔP{' '}
                                  {dPerim.toFixed(2)}m)
                                </text>
                              </g>
                            </g>
                          );
                        })()}
                    </g>
                  )}

                  {/* ==========================================================
                      11. AUTOCAD DYNAMIC INPUT (DYN) FLOATING CURSOR HUD
                     ========================================================== */}
                  {dynEnabled && cursorRdPerim && cursorSvgPt && (
                    <g
                      transform={`translate(${cursorSvgPt.x + 14}, ${
                        cursorSvgPt.y + 18
                      })`}
                    >
                      <rect
                        x="0"
                        y="0"
                        width="168"
                        height="22"
                        rx="3"
                        fill={isLight ? '#0f172a' : '#090D16'}
                        fillOpacity="0.92"
                        stroke="#38bdf8"
                        strokeWidth="0.9"
                      />
                      <text
                        x="6"
                        y="14"
                        fontSize="8.5"
                        fontWeight="800"
                        fill="#7dd3fc"
                      >
                        RD: {cursorRdPerim.x.toFixed(2)}m | Perim:{' '}
                        {cursorRdPerim.y.toFixed(2)}m
                      </text>
                    </g>
                  )}

                  {/* ==========================================================
                      12. AUTOCAD UCS ORIGIN ICON (BOTTOM-LEFT)
                     ========================================================== */}
                  <g transform="translate(26, 585)">
                    <line x1="0" y1="0" x2="42" y2="0" stroke="#16a34a" strokeWidth="2" />
                    <line x1="0" y1="0" x2="0" y2="-42" stroke="#dc2626" strokeWidth="2" />
                    <rect
                      x="-3.5"
                      y="-3.5"
                      width="7"
                      height="7"
                      fill="none"
                      stroke={isLight ? '#0f172a' : '#fff'}
                    />
                    <text x="46" y="3" fontSize="8" fontWeight="800" fill="#16a34a">
                      X: CHAINAGE RD (1m)
                    </text>
                    <text x="-6" y="-46" fontSize="8" fontWeight="800" fill="#dc2626">
                      Y: PERIMETER (m)
                    </text>
                  </g>
                </svg>
              </div>
              )}
            </div>

            {/* ================================================================
                COLLAPSIBLE RIGHT INSPECTOR DRAWER (AI Traces, Pulls & Location)
               ================================================================ */}
            {showRightInspector && (
              <aside
                className={`w-88 border-l flex flex-col shrink-0 overflow-hidden transition-colors ${
                  isLight
                    ? 'bg-white border-slate-200 text-slate-800'
                    : 'bg-[#0E1628] border-[#253655] text-slate-100'
                }`}
              >
                {/* Drawer Tabs */}
                <div
                  className={`grid grid-cols-4 border-b text-[10px] font-bold ${
                    isLight
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-[#090F1C] border-[#253655]'
                  }`}
                >
                  <button
                    onClick={() => setInspectorTab('TRACES_AI')}
                    className={`py-2 text-center border-b-2 cursor-pointer ${
                      inspectorTab === 'TRACES_AI'
                        ? isLight
                          ? 'border-cyan-600 text-cyan-700 bg-white'
                          : 'border-cyan-400 text-cyan-300 bg-[#111C33]'
                        : 'border-transparent text-slate-400 hover:text-cyan-500'
                    }`}
                  >
                    Traces &amp; AI
                  </button>
                  <button
                    onClick={() => setInspectorTab('PULLS_DRIVE')}
                    className={`py-2 text-center border-b-2 cursor-pointer ${
                      inspectorTab === 'PULLS_DRIVE'
                        ? isLight
                          ? 'border-amber-600 text-amber-700 bg-white'
                          : 'border-amber-400 text-amber-300 bg-[#111C33]'
                        : 'border-transparent text-slate-400 hover:text-amber-500'
                    }`}
                  >
                    Pulls &amp; °N
                  </button>
                  <button
                    onClick={() => setInspectorTab('INTERSECTIONS')}
                    className={`py-2 text-center border-b-2 cursor-pointer ${
                      inspectorTab === 'INTERSECTIONS'
                        ? isLight
                          ? 'border-fuchsia-600 text-fuchsia-700 bg-white'
                          : 'border-fuchsia-400 text-fuchsia-300 bg-[#111C33]'
                        : 'border-transparent text-slate-400 hover:text-fuchsia-500'
                    }`}
                  >
                    Junctions
                  </button>
                  <button
                    onClick={() => setInspectorTab('NEW_LOCATION')}
                    className={`py-2 text-center border-b-2 cursor-pointer ${
                      inspectorTab === 'NEW_LOCATION'
                        ? isLight
                          ? 'border-emerald-600 text-emerald-700 bg-white'
                          : 'border-emerald-400 text-emerald-300 bg-[#111C33]'
                        : 'border-transparent text-slate-400 hover:text-emerald-500'
                    }`}
                  >
                    + Location
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                  {/* TAB 1: TRACES & AI ALIGNMENT */}
                  {inspectorTab === 'TRACES_AI' && (
                    <>
                      {/* AI Alignment Control Card */}
                      <div
                        className={`border rounded-lg p-2.5 space-y-2 ${
                          isLight
                            ? 'bg-purple-50/70 border-purple-200'
                            : 'bg-purple-950/30 border-purple-500/40'
                        }`}
                      >
                        <div
                          className={`font-bold flex items-center justify-between ${
                            isLight ? 'text-purple-900' : 'text-purple-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            AI Photo-Trace Trend Alignment
                          </span>
                        </div>
                        <p
                          className={`text-[10px] leading-relaxed ${
                            isLight ? 'text-slate-600' : 'text-slate-300'
                          }`}
                        >
                          Aligns joint traces mapped from separate round photos along their
                          true strike/dip trend and stitches pull seam offsets.
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleRunAiTrendAlignment}
                            className="flex-1 py-1.5 px-2 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            Align All by Trend
                          </button>
                          <button
                            onClick={handleRestoreRawPhotoTraces}
                            className={`py-1.5 px-2 rounded-md border font-bold text-[10px] flex items-center gap-1 cursor-pointer ${
                              isLight
                                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
                            }`}
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset Raw
                          </button>
                        </div>
                      </div>

                      {/* SELF-LEARNING GEOTECHNICAL AI BRAIN CARD */}
                      <div
                        className={`border rounded-lg p-2.5 space-y-2 ${
                          isLight
                            ? 'bg-amber-50/70 border-amber-200'
                            : 'bg-amber-950/25 border-amber-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-bold text-[11px] flex items-center gap-1.5 ${
                              isLight ? 'text-amber-900' : 'text-amber-300'
                            }`}
                          >
                            <span>🧠 Continuous Self-Learning AI</span>
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-black ${
                              isLight
                                ? 'bg-amber-200 text-amber-950'
                                : 'bg-amber-500/30 text-amber-200'
                            }`}
                          >
                            Gen #{aiBrain.generation} · {aiBrain.predictionConfidencePct}%
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-[9.5px] text-center">
                          <div
                            className={`p-1 rounded border ${
                              isLight
                                ? 'bg-white border-amber-200 text-slate-700'
                                : 'bg-[#090E1A] border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="font-black text-amber-500">
                              {aiBrain.learnedSamplesCount}
                            </div>
                            <div className="text-[8.5px] text-slate-400">Patterns Eaten</div>
                          </div>
                          <div
                            className={`p-1 rounded border ${
                              isLight
                                ? 'bg-white border-amber-200 text-slate-700'
                                : 'bg-[#090E1A] border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="font-black text-cyan-500">
                              {aiBrain.userCorrectionsCount}
                            </div>
                            <div className="text-[8.5px] text-slate-400">User Edits</div>
                          </div>
                          <div
                            className={`p-1 rounded border ${
                              isLight
                                ? 'bg-white border-amber-200 text-slate-700'
                                : 'bg-[#090E1A] border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="font-black text-emerald-500">
                              {aiBrain.seamToleranceM}m
                            </div>
                            <div className="text-[8.5px] text-slate-400">Seam Tol.</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={aiBrain.autoLearnEnabled}
                              onChange={(e) =>
                                setAiBrain((prev) => ({
                                  ...prev,
                                  autoLearnEnabled: e.target.checked,
                                }))
                              }
                            />
                            <span>Auto-Eat &amp; Learn</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={aiBrain.autoPredictNewTrace}
                              onChange={(e) =>
                                setAiBrain((prev) => ({
                                  ...prev,
                                  autoPredictNewTrace: e.target.checked,
                                }))
                              }
                            />
                            <span>Auto-Classify Drawn Trace</span>
                          </label>
                        </div>

                        {/* Learned Structural Set Clusters (Click to apply to new trace defaults) */}
                        <div className="space-y-1">
                          <div className="text-[9.5px] font-bold text-slate-400 uppercase">
                            Learned Joint Clusters (Click to Use):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {aiBrain.learnedClusters.map((cl) => {
                              const orient = `${String(cl.meanDipDir).padStart(
                                3,
                                '0'
                              )}/${String(cl.meanDip).padStart(2, '0')}`;
                              return (
                                <button
                                  key={cl.setId}
                                  type="button"
                                  onClick={() => {
                                    setNewTraceSetId(cl.setId);
                                    setNewTraceStructure(cl.structureType);
                                    setNewTraceOrientation(orient);
                                  }}
                                  className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold cursor-pointer ${
                                    newTraceSetId === cl.setId
                                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                                      : isLight
                                      ? 'bg-white hover:bg-amber-100 text-slate-700 border-amber-200'
                                      : 'bg-[#090E1A] hover:bg-slate-800 text-amber-200 border-slate-700'
                                  }`}
                                >
                                  {cl.setId}: {orient} ({cl.sampleCount})
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleAiEatAndLearnProject(false)}
                            className="flex-1 py-1 px-2 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] cursor-pointer"
                          >
                            Feed All Tunnels (+1 Gen)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAiEatAndLearnProject(true)}
                            className={`py-1 px-2 rounded-md border font-bold text-[10px] cursor-pointer ${
                              isLight
                                ? 'bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border-emerald-500/40'
                            }`}
                          >
                            + Predict Trace
                          </button>
                        </div>

                        {/* Recent Self-Learning Feed */}
                        <div
                          className={`p-1.5 rounded border text-[9px] space-y-0.5 max-h-20 overflow-y-auto ${
                            isLight
                              ? 'bg-white/90 border-amber-200 text-slate-600'
                              : 'bg-[#060A12] border-slate-800 text-slate-300'
                          }`}
                        >
                          {aiBrain.recentLearnLog.slice(0, 4).map((item, idx) => (
                            <div key={idx} className="truncate">
                              • {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* New Trace / Lithology / Water Defaults */}
                      <div
                        className={`border rounded-lg p-2.5 space-y-2 ${
                          isLight
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-[#131E36] border-[#283B60]'
                        }`}
                      >
                        <div
                          className={`font-bold text-[11px] uppercase ${
                            isLight ? 'text-cyan-700' : 'text-cyan-300'
                          }`}
                        >
                          New Drawing Defaults
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[10px] text-slate-400">Structure Type</span>
                            <select
                              value={newTraceStructure}
                              onChange={(e) =>
                                setNewTraceStructure(
                                  e.target.value as StripStructureTypeId
                                )
                              }
                              className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            >
                              <option value="JS1 - Foliation">JS1 - Foliation</option>
                              <option value="JS2 - Main Joint">JS2 - Main Joint</option>
                              <option value="JS3 - Main Joint">JS3 - Main Joint</option>
                              <option value="Secondary Joint">Secondary Joint</option>
                              <option value="Shear Joint (5-30mm)">
                                Shear Joint (5-30mm)
                              </option>
                              <option value="Shear Zone">Shear Zone</option>
                              <option value="Fault">Fault</option>
                              <option value="Gouge/Clay Seam">Gouge/Clay Seam</option>
                              <option value="Geological Boundary">
                                Geological Boundary
                              </option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[10px] text-slate-400">
                              Set &amp; Dip (Dir/Dip)
                            </span>
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={newTraceSetId}
                                onChange={(e) => setNewTraceSetId(e.target.value)}
                                className={`w-12 px-1.5 py-1 border rounded-md font-bold text-[11px] ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-amber-700'
                                    : 'bg-[#090E1A] border-slate-700 text-amber-300'
                                }`}
                                placeholder="JS1"
                              />
                              <input
                                type="text"
                                value={newTraceOrientation}
                                onChange={(e) => setNewTraceOrientation(e.target.value)}
                                className={`flex-1 px-1.5 py-1 border rounded-md text-[11px] ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-slate-900'
                                    : 'bg-[#090E1A] border-slate-700 text-white'
                                }`}
                                placeholder="055/50"
                              />
                            </div>
                          </label>
                          <label className="block">
                            <span className="text-[10px] text-slate-400">Lithology Type</span>
                            <select
                              value={newLithRockType}
                              onChange={(e) =>
                                setNewLithRockType(e.target.value as StripRockTypeId)
                              }
                              className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            >
                              <option value="Quartz veins">Quartz veins (+ + +)</option>
                              <option value="Quartzite">Quartzite (Qtz)</option>
                              <option value="Phyllite">Phyllite (Phy)</option>
                              <option value="Metasandstone">Metasandstone (Mss)</option>
                              <option value="Gneiss">Gneiss (Gns)</option>
                              <option value="Amphibolite">Amphibolite (Amp)</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[10px] text-slate-400">Water Inflow</span>
                            <select
                              value={newWaterCondition}
                              onChange={(e) =>
                                setNewWaterCondition(e.target.value as StripGroundwaterId)
                              }
                              className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            >
                              <option value="Damp">Damp</option>
                              <option value="Wet">Wet</option>
                              <option value="Dripping">Dripping</option>
                              <option value="Flowing">Flowing</option>
                            </select>
                          </label>
                        </div>
                      </div>

                      {/* Selected Trace Inspector */}
                      {selectedTrace && (
                        <div
                          className={`border rounded-lg p-2.5 space-y-2 ${
                            isLight
                              ? 'bg-cyan-50/70 border-cyan-300'
                              : 'bg-[#16233E] border-cyan-500/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`font-bold text-[11px] ${
                                isLight ? 'text-cyan-800' : 'text-cyan-300'
                              }`}
                            >
                              Selected: {selectedTrace.setId} (
                              {selectedTrace.structureType})
                            </span>
                            <button
                              onClick={() => {
                                updateActiveDataset((prev) => ({
                                  ...prev,
                                  traces: prev.traces.filter(
                                    (t) => t.id !== selectedTrace.id
                                  ),
                                }));
                                setSelectedTraceId(null);
                              }}
                              className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="text-[10px] text-slate-400">
                                Orientation (Dir/Dip)
                              </span>
                              <input
                                type="text"
                                value={selectedTrace.orientationLabel}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    traces: prev.traces.map((t) =>
                                      t.id === selectedTrace.id
                                        ? { ...t, orientationLabel: val }
                                        : t
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-slate-900'
                                    : 'bg-[#090E1A] border-slate-700 text-white'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-400">Set ID</span>
                              <input
                                type="text"
                                value={selectedTrace.setId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    traces: prev.traces.map((t) =>
                                      t.id === selectedTrace.id
                                        ? { ...t, setId: val }
                                        : t
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold text-[11px] ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-amber-700'
                                    : 'bg-[#090E1A] border-slate-700 text-amber-300'
                                }`}
                              />
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Selected Lithology Inspector */}
                      {selectedLith && (
                        <div
                          className={`border rounded-lg p-2.5 space-y-2 ${
                            isLight
                              ? 'bg-amber-50/70 border-amber-300'
                              : 'bg-amber-950/30 border-amber-500/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`font-bold text-[11px] ${
                                isLight ? 'text-amber-800' : 'text-amber-300'
                              }`}
                            >
                              Lithology: {selectedLith.rockType}
                            </span>
                            <button
                              onClick={() => {
                                updateActiveDataset((prev) => ({
                                  ...prev,
                                  lithologyZones: prev.lithologyZones.filter(
                                    (l) => l.id !== selectedLith.id
                                  ),
                                }));
                                setSelectedLithId(null);
                              }}
                              className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <label className="block">
                            <span className="text-[10px] text-slate-400">Zone Label</span>
                            <input
                              type="text"
                              value={selectedLith.label}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateActiveDataset((prev) => ({
                                  ...prev,
                                  lithologyZones: prev.lithologyZones.map((l) =>
                                    l.id === selectedLith.id
                                      ? { ...l, label: val, codeSymbol: val }
                                      : l
                                  ),
                                }));
                              }}
                              className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            />
                          </label>
                        </div>
                      )}

                      {/* Selected Water Symbol Inspector */}
                      {selectedWater && (
                        <div
                          className={`border rounded-lg p-2.5 space-y-2 ${
                            isLight
                              ? 'bg-blue-50/70 border-blue-300'
                              : 'bg-blue-950/30 border-blue-500/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`font-bold text-[11px] ${
                                isLight ? 'text-blue-800' : 'text-blue-300'
                              }`}
                            >
                              Groundwater: {selectedWater.condition}
                            </span>
                            <button
                              onClick={() => {
                                updateActiveDataset((prev) => ({
                                  ...prev,
                                  waterSymbols: prev.waterSymbols.filter(
                                    (w) => w.id !== selectedWater.id
                                  ),
                                }));
                                setSelectedWaterId(null);
                              }}
                              className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <select
                            value={selectedWater.condition}
                            onChange={(e) => {
                              const cond = e.target.value as StripGroundwaterId;
                              updateActiveDataset((prev) => ({
                                ...prev,
                                waterSymbols: prev.waterSymbols.map((w) =>
                                  w.id === selectedWater.id
                                    ? { ...w, condition: cond, label: cond }
                                    : w
                                ),
                              }));
                            }}
                            className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-900'
                                : 'bg-[#090E1A] border-slate-700 text-white'
                            }`}
                          >
                            <option value="Damp">Damp</option>
                            <option value="Wet">Wet</option>
                            <option value="Dripping">Dripping</option>
                            <option value="Flowing">Flowing</option>
                          </select>
                        </div>
                      )}

                      {/* List of All Traces */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">
                          Mapped Structural Traces ({activeDataset.traces.length})
                        </div>
                        {activeDataset.traces.map((tr) => (
                          <div
                            key={tr.id}
                            onClick={() => setSelectedTraceId(tr.id)}
                            className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between cursor-pointer ${
                              tr.id === selectedTraceId
                                ? isLight
                                  ? 'bg-cyan-50 border-cyan-500 text-slate-900'
                                  : 'bg-cyan-950/70 border-cyan-400 text-white'
                                : isLight
                                ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                                : 'bg-[#090F1C] border-slate-800 text-slate-300 hover:border-slate-600'
                            }`}
                          >
                            <div>
                              <span
                                className={`font-bold mr-1.5 ${
                                  isLight ? 'text-amber-700' : 'text-amber-300'
                                }`}
                              >
                                {tr.setId}
                              </span>
                              <span>{tr.structureType}</span>
                            </div>
                            <span
                              className={`text-[10px] font-bold ${
                                isLight ? 'text-cyan-700' : 'text-cyan-300'
                              }`}
                            >
                              {tr.orientationLabel}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* TAB 2: PULL SCHEDULE & DRIVE AZIMUTH CURVATURE */}
                  {inspectorTab === 'PULLS_DRIVE' && (
                    <>
                      {/* Add Pull Interval Card */}
                      <div
                        className={`border rounded-lg p-2.5 space-y-2 ${
                          isLight
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-[#131E36] border-[#283B60]'
                        }`}
                      >
                        <div
                          className={`font-bold text-[11px] uppercase ${
                            isLight ? 'text-amber-700' : 'text-amber-300'
                          }`}
                        >
                          + Add / Insert Pull Interval
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <label className="block">
                            <span className="text-[9px] text-slate-400">From Ch.(m)</span>
                            <input
                              type="number"
                              value={newPullFrom}
                              onChange={(e) => setNewPullFrom(e.target.value)}
                              className={`w-full px-1.5 py-1 border rounded-md ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[9px] text-slate-400">To Ch.(m)</span>
                            <input
                              type="number"
                              value={newPullTo}
                              onChange={(e) => setNewPullTo(e.target.value)}
                              className={`w-full px-1.5 py-1 border rounded-md ${
                                isLight
                                  ? 'bg-white border-slate-300 text-slate-900'
                                  : 'bg-[#090E1A] border-slate-700 text-white'
                              }`}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[9px] text-slate-400">Azimuth (°N)</span>
                            <input
                              type="number"
                              value={newPullAzimuth}
                              onChange={(e) => setNewPullAzimuth(e.target.value)}
                              className={`w-full px-1.5 py-1 border rounded-md font-bold ${
                                isLight
                                  ? 'bg-white border-slate-300 text-amber-700'
                                  : 'bg-[#090E1A] border-slate-700 text-amber-300'
                              }`}
                            />
                          </label>
                        </div>
                        <button
                          onClick={handleAddPullInterval}
                          className="w-full py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] cursor-pointer"
                        >
                          + Add Pull (Auto-Syncs 1m Scale &amp; Smooth Curve)
                        </button>
                      </div>

                      {/* Selected Pull Editor */}
                      {selectedPull && (
                        <div
                          className={`border rounded-lg p-2.5 space-y-2 ${
                            isLight
                              ? 'bg-amber-50/70 border-amber-300'
                              : 'bg-[#16233E] border-amber-500/50'
                          }`}
                        >
                          <div
                            className={`font-bold text-[11px] ${
                              isLight ? 'text-amber-800' : 'text-amber-300'
                            }`}
                          >
                            Edit Pull Ch. {selectedPull.fromRd}–{selectedPull.toRd}m
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="text-[10px] text-slate-400">
                                Drive Azimuth (°N)
                              </span>
                              <input
                                type="number"
                                step="0.5"
                                value={selectedPull.driveAzimuthDeg}
                                onChange={(e) => {
                                  const az = parseFloat(e.target.value) || 160;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    pulls: prev.pulls.map((p) =>
                                      p.id === selectedPull.id
                                        ? { ...p, driveAzimuthDeg: az }
                                        : p
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-amber-700'
                                    : 'bg-[#090E1A] border-slate-700 text-amber-300'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-400">
                                Overbreak (m³)
                              </span>
                              <input
                                type="number"
                                step="0.05"
                                value={selectedPull.overbreakVolumeM3 ?? 0}
                                onChange={(e) => {
                                  const ob = parseFloat(e.target.value) || 0;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    pulls: prev.pulls.map((p) =>
                                      p.id === selectedPull.id
                                        ? { ...p, overbreakVolumeM3: ob }
                                        : p
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-slate-900'
                                    : 'bg-[#090E1A] border-slate-700 text-white'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-400">RMR (0-100)</span>
                              <input
                                type="number"
                                value={selectedPull.rmrValue ?? 60}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10) || 60;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    pulls: prev.pulls.map((p) =>
                                      p.id === selectedPull.id
                                        ? { ...p, rmrValue: v }
                                        : p
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-cyan-700'
                                    : 'bg-[#090E1A] border-slate-700 text-cyan-300'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-400">RQD (0-100)</span>
                              <input
                                type="number"
                                value={selectedPull.rqdValue ?? 70}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10) || 70;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    pulls: prev.pulls.map((p) =>
                                      p.id === selectedPull.id
                                        ? { ...p, rqdValue: v }
                                        : p
                                    ),
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-emerald-700'
                                    : 'bg-[#090E1A] border-slate-700 text-emerald-300'
                                }`}
                              />
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Pull List */}
                      <div className="space-y-1">
                        {activeDataset.pulls.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => setSelectedPullId(p.id)}
                            className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between cursor-pointer ${
                              p.id === selectedPullId
                                ? isLight
                                  ? 'bg-amber-50 border-amber-500 text-slate-900'
                                  : 'bg-amber-950/60 border-amber-400 text-white'
                                : isLight
                                ? 'bg-white border-slate-200 text-slate-700'
                                : 'bg-[#090F1C] border-slate-800 text-slate-300'
                            }`}
                          >
                            <span className="font-bold">
                              Ch. {p.fromRd}–{p.toRd}m
                            </span>
                            <span
                              className={`font-bold ${
                                isLight ? 'text-amber-700' : 'text-amber-300'
                              }`}
                            >
                              Az: N {p.driveAzimuthDeg}° | RMR {p.rmrValue ?? 60}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* TAB 3: TUNNEL INTERSECTIONS & NETWORK JUNCTIONS */}
                  {inspectorTab === 'INTERSECTIONS' && (
                    <div className="space-y-3">
                      <div
                        className={`border rounded-lg p-2.5 space-y-2 ${
                          isLight
                            ? 'bg-amber-50/50 border-amber-300'
                            : 'bg-[#131E36] border-amber-500/40'
                        }`}
                      >
                        <div
                          className={`font-bold text-[11px] uppercase flex items-center justify-between ${
                            isLight ? 'text-amber-800' : 'text-amber-300'
                          }`}
                        >
                          <span>Location Intersection Setup</span>
                          <button
                            onClick={() => setCanvasScope('PROJECT_NETWORK')}
                            className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black rounded-md text-[10px] cursor-pointer"
                          >
                            View Network Canvas
                          </button>
                        </div>
                        <p
                          className={`text-[10px] ${
                            isLight ? 'text-slate-600' : 'text-slate-300'
                          }`}
                        >
                          Connect <strong>{activeDataset.tunnelLocationName}</strong> as an
                          intersecting branch/adit/cross-passage to a parent tunnel in{' '}
                          <strong>{activeDataset.projectName}</strong>:
                        </p>

                        <label className="block space-y-1">
                          <span className="text-[10px] text-slate-400">
                            Parent / Main Tunnel in Project
                          </span>
                          <select
                            value={activeDataset.intersectionConfig?.parentDatasetId || ''}
                            onChange={(e) => {
                              const parentId = e.target.value;
                              if (!parentId) {
                                updateActiveDataset((prev) => ({
                                  ...prev,
                                  intersectionConfig: undefined,
                                }));
                                return;
                              }
                              const parentDs = locationsForActiveProject.find(
                                (d) => d.id === parentId
                              );
                              const defaultRd = parentDs
                                ? Math.round((parentDs.viewFromRd + parentDs.viewToRd) / 2)
                                : 275;
                              const nextCfg: TunnelIntersectionConfig = {
                                parentDatasetId: parentId,
                                parentJunctionRd:
                                  activeDataset.intersectionConfig?.parentJunctionRd ??
                                  defaultRd,
                                attachWall:
                                  activeDataset.intersectionConfig?.attachWall ??
                                  'RIGHT_WALL',
                                ownJunctionRd: 0,
                                portalWidthM:
                                  activeDataset.intersectionConfig?.portalWidthM ?? 5.2,
                                junctionLabel: `${activeDataset.tunnelLocationName} JUNCTION @ Ch. ${defaultRd}m`,
                              };
                              updateActiveDataset((prev) => ({
                                ...prev,
                                intersectionConfig: nextCfg,
                              }));
                            }}
                            className={`w-full px-2 py-1 border rounded-md text-[11px] ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-900'
                                : 'bg-[#090E1A] border-slate-700 text-white'
                            }`}
                          >
                            <option value="">
                              — Primary Trunk Tunnel (No Parent) —
                            </option>
                            {locationsForActiveProject
                              .filter((d) => d.id !== activeDataset.id)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.tunnelLocationName} (Ch. {d.viewFromRd}–{d.viewToRd}m)
                                </option>
                              ))}
                          </select>
                        </label>

                        {activeDataset.intersectionConfig && (
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <label className="block">
                              <span className="text-[10px] text-slate-400">
                                Junction Chainage (m)
                              </span>
                              <input
                                type="number"
                                value={activeDataset.intersectionConfig.parentJunctionRd}
                                onChange={(e) => {
                                  const rd = parseFloat(e.target.value) || 0;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    intersectionConfig: prev.intersectionConfig
                                      ? {
                                          ...prev.intersectionConfig,
                                          parentJunctionRd: rd,
                                          junctionLabel: `${prev.tunnelLocationName} JUNCTION @ Ch. ${rd}m`,
                                        }
                                      : undefined,
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-amber-700'
                                    : 'bg-[#090E1A] border-slate-700 text-amber-300'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-400">
                                Portal Collar Width (m)
                              </span>
                              <input
                                type="number"
                                step="0.2"
                                value={activeDataset.intersectionConfig.portalWidthM}
                                onChange={(e) => {
                                  const pw = parseFloat(e.target.value) || 5.2;
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    intersectionConfig: prev.intersectionConfig
                                      ? {
                                          ...prev.intersectionConfig,
                                          portalWidthM: pw,
                                        }
                                      : undefined,
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md font-bold ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-cyan-700'
                                    : 'bg-[#090E1A] border-slate-700 text-cyan-300'
                                }`}
                              />
                            </label>
                            <label className="col-span-2 block">
                              <span className="text-[10px] text-slate-400">
                                Parent Tunnel Wall Side
                              </span>
                              <select
                                value={activeDataset.intersectionConfig.attachWall}
                                onChange={(e) => {
                                  const wall = e.target
                                    .value as TunnelIntersectionConfig['attachWall'];
                                  updateActiveDataset((prev) => ({
                                    ...prev,
                                    intersectionConfig: prev.intersectionConfig
                                      ? {
                                          ...prev.intersectionConfig,
                                          attachWall: wall,
                                        }
                                      : undefined,
                                  }));
                                }}
                                className={`w-full px-2 py-1 border rounded-md ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-slate-900'
                                    : 'bg-[#090E1A] border-slate-700 text-white'
                                }`}
                              >
                                <option value="RIGHT_WALL">
                                  Right Wall (Crown to Right Spring Line)
                                </option>
                                <option value="LEFT_WALL">
                                  Left Wall (Left Spring Line to Crown)
                                </option>
                                <option value="PARALLEL_SEAM">
                                  Parallel Seam / Slashing Bench
                                </option>
                              </select>
                            </label>
                          </div>
                        )}
                      </div>

                      {/* List of AI 3D Cross-Tunnel Projections */}
                      <div
                        className={`border rounded-lg p-2.5 space-y-1.5 ${
                          isLight
                            ? 'bg-fuchsia-50/70 border-fuchsia-300'
                            : 'bg-fuchsia-950/30 border-fuchsia-500/40'
                        }`}
                      >
                        <div
                          className={`font-bold text-[11px] uppercase ${
                            isLight ? 'text-fuchsia-800' : 'text-fuchsia-300'
                          }`}
                        >
                          AI 3D Cross-Tunnel Structural Projections (
                          {projectNetworkLayout.aiCrossProjections.length})
                        </div>
                        {projectNetworkLayout.aiCrossProjections.map((cp) => (
                          <div
                            key={cp.id}
                            className={`p-2 border rounded-md text-[10px] ${
                              isLight
                                ? 'bg-white border-fuchsia-200 text-fuchsia-900'
                                : 'bg-[#090E1A] border-fuchsia-500/30 text-fuchsia-100'
                            }`}
                          >
                            <strong>{cp.setId}</strong> ({cp.orientationLabel}) —{' '}
                            {cp.fromTunnelName} → {cp.toTunnelName}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: CREATE NEW PROJECT / TUNNEL LOCATION */}
                  {inspectorTab === 'NEW_LOCATION' && (
                    <div
                      className={`border rounded-lg p-3 space-y-2.5 ${
                        isLight
                          ? 'bg-emerald-50/50 border-emerald-300'
                          : 'bg-[#131E36] border-emerald-500/40'
                      }`}
                    >
                      <div
                        className={`font-bold uppercase text-[11px] ${
                          isLight ? 'text-emerald-800' : 'text-emerald-300'
                        }`}
                      >
                        Create New Project / Tunnel Location
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-slate-400">Project Name</span>
                        <input
                          type="text"
                          value={newProjNameInput}
                          onChange={(e) => setNewProjNameInput(e.target.value)}
                          className={`w-full px-2 py-1 border rounded-md ${
                            isLight
                              ? 'bg-white border-slate-300 text-slate-900'
                              : 'bg-[#090E1A] border-slate-700 text-white'
                          }`}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-slate-400">
                          Tunnel Location Name
                        </span>
                        <input
                          type="text"
                          value={newLocNameInput}
                          onChange={(e) => setNewLocNameInput(e.target.value)}
                          className={`w-full px-2 py-1 border rounded-md ${
                            isLight
                              ? 'bg-white border-slate-300 text-slate-900'
                              : 'bg-[#090E1A] border-slate-700 text-white'
                          }`}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-slate-400">
                          Initial Drive Azimuth (°N)
                        </span>
                        <input
                          type="number"
                          value={newLocAzimuthInput}
                          onChange={(e) => setNewLocAzimuthInput(e.target.value)}
                          className={`w-full px-2 py-1 border rounded-md font-bold ${
                            isLight
                              ? 'bg-white border-slate-300 text-amber-700'
                              : 'bg-[#090E1A] border-slate-700 text-amber-300'
                          }`}
                        />
                      </label>
                      <button
                        onClick={handleCreateNewLocationDataset}
                        className="w-full py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer"
                      >
                        Create Location &amp; Open Strip Canvas
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>

          {/* ==================================================================
              BOTTOM AUTOCAD COMMAND LINE & STATUS BAR
             ================================================================== */}
          <div
            className={`border-t px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 transition-colors ${
              isLight
                ? 'bg-white border-slate-200 text-slate-700'
                : 'bg-[#090E1A] border-[#243656] text-slate-200'
            }`}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExecuteCadCommand(cadCmdInput);
              }}
              className="flex-1 flex items-center gap-2 max-w-3xl"
            >
              <span
                className={`px-2 py-0.5 border font-black text-[11px] rounded-md ${
                  isLight
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-800'
                    : 'bg-cyan-950 border-cyan-500/40 text-cyan-300'
                }`}
              >
                ESWACAD Command:
              </span>
              <input
                type="text"
                value={cadCmdInput}
                onChange={(e) => setCadCmdInput(e.target.value)}
                placeholder="Type PLINE, SPLINE, HATCH, OFFSET 2.5, EXTEND, TRIM, DIST, AIALIGN, NETWORK, ZOOM, or PLOT and press Enter..."
                className={`flex-1 px-2.5 py-1 border rounded-md font-mono text-xs outline-none focus:border-cyan-500 ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-900'
                    : 'bg-[#050811] border-[#2A3F66] text-amber-200'
                }`}
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] rounded-md cursor-pointer"
              >
                Execute
              </button>
            </form>
            <div
              className={`text-[11px] font-bold truncate max-w-xl ${
                isLight ? 'text-slate-600' : 'text-slate-300'
              }`}
            >
              {cadCmdStatus}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
