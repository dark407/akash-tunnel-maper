import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggleButton, useTheme } from '../context/ThemeContext';
import {
  triggerGlobalLayoutRecalculation,
  useContainerResizeObserver,
  useResponsiveLayout,
} from '../hooks/useResponsiveLayout';
import {
  ConnectedSurveyProfile,
  GeologicalFeatureType,
  GeologicalSymbolType,
  Joint,
  JointSet,
  LithologyRegion,
  MappingWorkspaceMode,
  OutputSheetMode,
  OverbreakUndercutAnalysis,
  PhotoSurface,
  PlacedGeologicalSymbol,
  PlaneSurfaceConfig,
  Point2D,
  QIndexParameters,
  QSystemParamKey,
  RmrParameters,
  RockMassClassificationMethodId,
  RockMassSummaryTable,
  SavedProjectRecord,
  GsiParameters,
  ParameterInputStatus,
  SessionLearningMemory,
  SurfaceTransform,
  SurfaceType,
  SurveyControlPoint,
  TraceContinuityStatus,
  TraceFitMode,
  TraceTerminationType,
  TunnelGeometry,
  TunnelSettings,
  VectorLayerVisibility,
} from '../types/tunnel';
import {
   computeNonOverlappingLabelPlacement,
  DipDirectionSymbolGlyph,
  getGeologicalFeatureStrokeStyle,
  getStructuralSymbolMeta,
  LabelObstacleBox,
  LabelObstacleSegment,
  LithologyPatternDefs,
  STRUCTURAL_GEOLOGICAL_SYMBOLS,
  StructuralGeologicalSymbolGlyph,
} from '../engine/geologicalSymbolLibrary';
import {
  calculateBieniawskiRmr,
  calculateHoekGsi,
  evaluateQSystemWithValidation,
} from '../engine/rockMassClassificationEngine';
import {
  clipPolylineToSurface,
  createDefaultSurfaceTransform,
  getDisplayedJointGeometry,
  imageUVToSurfaceMeters,
  isPointInsidePolygon,
  pointToSegmentDistance,
  solveProjectiveHomography3x3,
  surfaceMetersToImageUV,
} from '../engine/geometryEngine';
import {
  autoPropagateFractureFromSeedUV,
  buildPhotoRidgeField,
  PhotoRidgeField,
  snapWorldPolylineToPhotoRidge,
  traceGeodesicPathBetweenUVPoints,
} from '../engine/cvPipeline';
import {
  CanvasCoordinateManager,
  CanvasViewportState,
  computeCanvasStageMetrics,
  DEFAULT_PAD_PX,
  DEFAULT_VIEW_H,
  DEFAULT_VIEW_W,
  evaluateCatmullRomSplineThroughPoints,
} from '../engine/canvasTransform';
import {
  calculateJointOrientation3D,
  JOINT_SET_PALETTE,
  runQualityControlValidation,
} from '../engine/orientationEngine';
import {
  calculateBartonQSystem,
  createDefaultMeshControlPoints,
  evaluateForwardWarpedUV,
  generatePiecewiseWarpedPhotoDataUrl,
} from '../engine/photoWarpEngine';
import { PhotoEditorSubTab, PhotoFittingPanel } from './PhotoFittingPanel';
import { GeologyAndQIndexDrawer } from './GeologyAndQIndexDrawer';
import { LithologyPanel } from './LithologyPanel';
import { OverbreakAnalysisPanel } from './OverbreakAndProjectMemoryPanel';
import { PhotogrammetryStructuralModal } from './PhotogrammetryStructuralModal';
import {
  CadSheetSetManagerModal,
  computeRockSupportPatternOverlay,
  createDefaultRockSupportConfig,
  RockSupportDesignConfig,
  RockSupportPatternModal,
  UnfoldedTunnelRolloutModal,
} from './CadAdvancedEngineeringModals';
import {
  computeBartonJRCProfileForPoints,
  computeTerzaghiWeight,
} from '../engine/photogrammetryAndStructuralEngine';
import {
  addVertexToLithologyRegion,
  createLithologyRegionFromPolygon,
  getPolygonCentroid,
  removeVertexFromLithologyRegion,
} from '../engine/lithologyEngine';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  Compass,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Hand,
  Layers,
  Lock,
  Maximize2,
  MousePointer,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
  Box,
} from 'lucide-react';
import { EswaTunnelLogo } from './EswaBrandIdentity';

interface MappingWorkspaceProps {
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  photos: Record<SurfaceType, PhotoSurface>;
  activeSurface: SurfaceType;
  onSelectSurface: (s: SurfaceType) => void;
  onUpdatePhotoSurface: (
    surface: SurfaceType,
    updater: (prev: PhotoSurface) => PhotoSurface
  ) => void;
  onUploadPhotoFile: (surface: SurfaceType, file: File) => void;
  onUploadStereoPhotoFile: (surface: SurfaceType, file: File, replacePhotoId?: string) => void;
  onRemoveSupportingPhoto?: (surface: SurfaceType, photoId: string) => void;
  onLoadSamplePhoto: (surface: SurfaceType) => void;
  onAutoFitCurrentPhoto: () => Promise<void>;
  onRunAITrace: () => Promise<void>;
  onRunAITraceAllSurfaces: () => Promise<void>;
  isTracingAI: boolean;
  traceFitMode: TraceFitMode;
  onChangeTraceFitMode: (mode: TraceFitMode) => void;
  statusMessage: string;
  joints: Joint[];
  jointSets: JointSet[];
  onUpdateJointsWithHistory: (nextJoints: Joint[]) => void;
  onUpdateJointSetAttribute: (setId: string, field: keyof JointSet, value: string) => void;
  onMergeJointSets: (fromSetId: string, toSetId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onBackToSetup: () => void;
  onOpenExportSheet: (mode?: OutputSheetMode) => void;
  onSaveOfflineDraft: () => void;
  sessionMemory: SessionLearningMemory;
  onRecordRejectedJoint: (joint: Joint) => void;
  onRecordConfirmedJoint: (
    joint: Joint,
    customCorrection?: {
      correctionType?:
        | 'accept_joint'
        | 'reject_false_trace'
        | 'reshape_trace'
        | 'reclassify_type'
        | 'recalculate_orientation';
      aiSummary?: string;
      approvedSummary?: string;
    }
  ) => void;
  onTrainAndUpdateAIModel?: () => void;
  onResetAILearningFilters?: () => void;
  qIndexParams: QIndexParameters;
  onUpdateQIndexParams: (next: QIndexParameters) => void;
  qParamStatus: Record<QSystemParamKey, ParameterInputStatus>;
  onUpdateQParamStatus: (next: Record<QSystemParamKey, ParameterInputStatus>) => void;
  selectedClassificationMethod: RockMassClassificationMethodId;
  onChangeSelectedClassificationMethod: (method: RockMassClassificationMethodId) => void;
  rmrParams: RmrParameters;
  onUpdateRmrParams: (next: RmrParameters) => void;
  gsiParams: GsiParameters;
  onUpdateGsiParams: (next: GsiParameters) => void;
  rockMassSummary: RockMassSummaryTable;
  onUpdateRockMassSummary: (next: RockMassSummaryTable) => void;
  lithologyRegions: LithologyRegion[];
  onUpdateLithologyRegions: (next: LithologyRegion[]) => void;
  controlPoints: SurveyControlPoint[];
  onUpdateControlPoints: React.Dispatch<React.SetStateAction<SurveyControlPoint[]>>;
  placedSymbols: PlacedGeologicalSymbol[];
  onUpdatePlacedSymbols: React.Dispatch<React.SetStateAction<PlacedGeologicalSymbol[]>>;
  onUpdateStatusMessage?: (msg: string) => void;
  surveyProfile: ConnectedSurveyProfile;
  onUpdateSurveyProfile: React.Dispatch<React.SetStateAction<ConnectedSurveyProfile>>;
  overbreakAnalysis: OverbreakUndercutAnalysis;
  onGenerateSampleAsBuiltProfile: () => void;
  onOpenProjectMemoryModal: (
    tab?: 'projects' | 'sheet_settings' | 'volumes' | 'geometries' | 'continuous_3d_log'
  ) => void;
  onOpenCustomProfileEditor?: () => void;
  savedProjects?: SavedProjectRecord[];
  onLoadProjectRecord?: (rec: SavedProjectRecord) => void;
}

type ActiveTool =
  | 'select'
  | 'pan'
  | 'add_joint'
  | 'redraw_joint'
  | 'append_joint'
  | 'measure'
  | 'dip_probe'
  | 'photo_fit'
  | 'lithology'
  | 'control_point'
  | 'overbreak'
  | 'geological_symbol';

type JointDrawMode =
  | 'magnetic_livewire'
  | 'seed_autotrace'
  | 'polyline'
  | 'freehand'
  | 'smooth_curve';

export const MappingWorkspace: React.FC<MappingWorkspaceProps> = ({
  geometry,
  settings,
  photos,
  activeSurface,
  onSelectSurface,
  onUpdatePhotoSurface,
  onUploadPhotoFile,
  onUploadStereoPhotoFile,
  onRemoveSupportingPhoto,
  onLoadSamplePhoto,
  onAutoFitCurrentPhoto,
  onRunAITrace,
  onRunAITraceAllSurfaces,
  isTracingAI,
  traceFitMode,
  onChangeTraceFitMode,
  statusMessage,
  joints,
  jointSets,
  onUpdateJointsWithHistory,
  onUpdateJointSetAttribute,
  onMergeJointSets,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onBackToSetup,
  onOpenExportSheet,
  onSaveOfflineDraft,
  sessionMemory,
  onRecordRejectedJoint,
  onRecordConfirmedJoint,
  onTrainAndUpdateAIModel,
  onResetAILearningFilters,
  qIndexParams,
  onUpdateQIndexParams,
  qParamStatus,
  onUpdateQParamStatus,
  selectedClassificationMethod,
  onChangeSelectedClassificationMethod,
  rmrParams,
  onUpdateRmrParams,
  gsiParams,
  onUpdateGsiParams,
  rockMassSummary,
  onUpdateRockMassSummary,
  lithologyRegions,
  onUpdateLithologyRegions,
  controlPoints,
  onUpdateControlPoints,
  placedSymbols,
  onUpdatePlacedSymbols,
  onUpdateStatusMessage,
  surveyProfile,
  onUpdateSurveyProfile,
  overbreakAnalysis,
  onGenerateSampleAsBuiltProfile,
  onOpenProjectMemoryModal,
  onOpenCustomProfileEditor,
  savedProjects = [],
  onLoadProjectRecord,
}) => {
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  const [selectedJointVertexIdx, setSelectedJointVertexIdx] = useState<number | null>(null);
  const [joinTargetMode, setJoinTargetMode] = useState<boolean>(false);

  // Extendable Left/Right Inspector Aside State (Dock Left or Right + Drag-Resize Width)
  const [inspectorDockSide, setInspectorDockSide] = useState<'left' | 'right'>('right');
  const [inspectorWidthPx, setInspectorWidthPx] = useState<number>(330);
  const [resizingInspector, setResizingInspector] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const [showLeftClickShortcutsBar, setShowLeftClickShortcutsBar] = useState<boolean>(true);

  // Industrial-Grade AutoCAD 2026 Workspace State
  const [cadRibbonTab, setCadRibbonTab] = useState<
    'HOME' | 'TUNNEL_PHOTO' | 'GEOLOGY_3D' | 'SURVEY_OVERBREAK' | 'CLASSIFICATION_SHEET'
  >('HOME');
  const [cadRibbonCollapsed, setCadRibbonCollapsed] = useState<boolean>(false);
  const [cadCommandInput, setCadCommandInput] = useState<string>('');
  const [showCadPropertiesAlways, setShowCadPropertiesAlways] = useState<boolean>(true);
  const [showCadGrid, setShowCadGrid] = useState<boolean>(true);
  const [showCadViewCube, setShowCadViewCube] = useState<boolean>(true);
  const [cadOsnapEnabled, setCadOsnapEnabled] = useState<boolean>(true);
  const [cadDynInputEnabled, setCadDynInputEnabled] = useState<boolean>(true);
  const [showRockSupportModal, setShowRockSupportModal] = useState<boolean>(false);
  const [showUnfoldedRolloutModal, setShowUnfoldedRolloutModal] = useState<boolean>(false);
  const [showSheetSetModal, setShowSheetSetModal] = useState<boolean>(false);
  const [supportConfig, setSupportConfig] = useState<RockSupportDesignConfig>(() =>
    createDefaultRockSupportConfig(geometry, 6.5)
  );

  useEffect(() => {
    if (!resizingInspector) return;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - resizingInspector.startX;
      const delta = inspectorDockSide === 'right' ? -dx : dx;
      setInspectorWidthPx(
        Math.max(260, Math.min(660, Math.round(resizingInspector.startWidth + delta)))
      );
    };
    const onUp = () => setResizingInspector(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingInspector, inspectorDockSide]);

  // Canvas Viewport Zoom & Pan State (Sections 1, 2, 3, 4, 5, 15)
  // Never resets when switching tools!
  const [viewport, setViewport] = useState<CanvasViewportState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const [isSpacePanning, setIsSpacePanning] = useState<boolean>(false);
  const [draggingCanvasPan, setDraggingCanvasPan] = useState<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [layoutVersion, setLayoutVersion] = useState<number>(0);

  // Touch Pinch-to-Zoom & Two-Finger Pan State (Section 15)
  const touchGestureRef = useRef<{
    isMultiTouch: boolean;
    startDist: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // Lithology Region Selection, Polygon Drawing, Undo/Redo & Reshaping State (Sections 7, 8, 11–14)
  const [selectedLithologyRegionId, setSelectedLithologyRegionId] = useState<string | null>(null);
  const [isDrawingLithologyPolygon, setIsDrawingLithologyPolygon] = useState<boolean>(false);
  const [draftLithologyPoints, setDraftLithologyPoints] = useState<Point2D[]>([]);
  const [reopenedLithologyRegionId, setReopenedLithologyRegionId] = useState<string | null>(null);
  const [lithologyPast, setLithologyPast] = useState<LithologyRegion[][]>([]);
  const [lithologyFuture, setLithologyFuture] = useState<LithologyRegion[][]>([]);
  const [draggingLithologyVertex, setDraggingLithologyVertex] = useState<{
    regionId: string;
    vertexIndex: number;
  } | null>(null);
  const [draggingDraftLithologyIdx, setDraggingDraftLithologyIdx] = useState<number | null>(null);
  const [draggingWholeLithology, setDraggingWholeLithology] = useState<{
    regionId: string;
    startMeters: Point2D;
    origPolygon: Point2D[];
  } | null>(null);
  const [resizingLithologyRegion, setResizingLithologyRegion] = useState<{
    regionId: string;
    centroid: Point2D;
    startDistX: number;
    startDistY: number;
    origPolygon: Point2D[];
  } | null>(null);

  // Dedicated Survey / Geological Control Point Tool State (Sections 5, 6, 7, 8)
  const [selectedControlPointId, setSelectedControlPointId] = useState<string | null>(null);
  const [draggingControlPointId, setDraggingControlPointId] = useState<string | null>(null);
  const [controlPointPast, setControlPointPast] = useState<SurveyControlPoint[][]>([]);
  const [controlPointFuture, setControlPointFuture] = useState<SurveyControlPoint[][]>([]);
  const [cpDraftLabel, setCpDraftLabel] = useState<string>('');
  const [cpDraftX, setCpDraftX] = useState<string>('0.00');
  const [cpDraftY, setCpDraftY] = useState<string>('0.00');

  // Professional Geological Symbol Library & Editor State (Sections 9, 10, 12, 15)
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [activeSymbolTypeToPlace, setActiveSymbolTypeToPlace] =
    useState<GeologicalSymbolType>('joint');
  const [symbolPast, setSymbolPast] = useState<PlacedGeologicalSymbol[][]>([]);
  const [symbolFuture, setSymbolFuture] = useState<PlacedGeologicalSymbol[][]>([]);
  const [draggingSymbolId, setDraggingSymbolId] = useState<string | null>(null);
  const [rotatingSymbolState, setRotatingSymbolState] = useState<{
    symbolId: string;
    centerPx: { cx: number; cy: number };
  } | null>(null);
  const [scalingSymbolState, setScalingSymbolState] = useState<{
    symbolId: string;
    centerPx: { cx: number; cy: number };
    initialDistPx: number;
    initialScale: number;
  } | null>(null);

  // Drawing new or re-drawn joint polyline points in real-world meters (Sections 9, 10, 11, 12)
  const [jointDrawMode, setJointDrawMode] = useState<JointDrawMode>('magnetic_livewire');
  const [isFreehandDrawingJoint, setIsFreehandDrawingJoint] = useState<boolean>(false);
  const [draftJointPoints, setDraftJointPoints] = useState<Point2D[]>([]);
  const [draggingDraftJointIdx, setDraggingDraftJointIdx] = useState<number | null>(null);
  const [draftFeatureType, setDraftFeatureType] = useState<GeologicalFeatureType>('joint');
  const [draftSetId, setDraftSetId] = useState<string>('J1');
  const [syncFeaturesWithPhotoTransform, setSyncFeaturesWithPhotoTransform] =
    useState<boolean>(true);
  const [activePhotoRidgeField, setActivePhotoRidgeField] = useState<PhotoRidgeField | null>(null);
  const [showCrackXRayOverlay, setShowCrackXRayOverlay] = useState<boolean>(false);
  const [showDepthReliefOverlay, setShowDepthReliefOverlay] = useState<boolean>(false);
  const [showPhotogrammetryModal, setShowPhotogrammetryModal] = useState<boolean>(false);

  // Measure tool points in real-world meters
  const [measurePts, setMeasurePts] = useState<Point2D[]>([]);

  // Live cursor coordinates in real-world meters & canvas pixels
  const [cursorMeters, setCursorMeters] = useState<Point2D | null>(null);
  const [cursorCanvasPx, setCursorCanvasPx] = useState<{ cx: number; cy: number } | null>(null);

  // Dragging vertex state
  const [draggingVertex, setDraggingVertex] = useState<{
    jointId: string;
    vertexIndex: number;
  } | null>(null);

  // Dragging entire joint state
  const [draggingWholeJoint, setDraggingWholeJoint] = useState<{
    jointId: string;
    startMeters: Point2D;
    origPoints: Point2D[];
  } | null>(null);

  // Dragging photo offset, perspective corner, edge midpoint, mesh control point, or custom mask vertex
  const [draggingPhotoHandle, setDraggingPhotoHandle] = useState<{
    type: 'move' | 'corner' | 'edge' | 'mesh_cp' | 'mask_vertex';
    cornerIndex?: number;
    edgeIndex?: number;
    cpId?: string;
    maskVertexIndex?: number;
    startClientX: number;
    startClientY: number;
    initialTransform: SurfaceTransform;
  } | null>(null);

  // Full Photo Fitting Editor state & Undo/Redo stack
  const [photoEditSubTab, setPhotoEditSubTab] = useState<PhotoEditorSubTab>('basic');
  const [showMeshGrid, setShowMeshGrid] = useState<boolean>(true);
  const [addingControlPointMode, setAddingControlPointMode] = useState<boolean>(false);
  const [drawingCustomMaskMode, setDrawingCustomMaskMode] = useState<boolean>(false);
  const [transformPast, setTransformPast] = useState<SurfaceTransform[]>([]);
  const [transformFuture, setTransformFuture] = useState<SurfaceTransform[]>([]);
  const [initialTransformSnapshot, setInitialTransformSnapshot] =
    useState<SurfaceTransform | null>(null);
  const [liveWarpedImageUrl, setLiveWarpedImageUrl] = useState<string | null>(null);

  // Collapsible bottom Geological Tables & Barton Q-Index drawer & AI Learning drawer
  const [showSetTableDrawer, setShowSetTableDrawer] = useState<boolean>(false);
  const [geologyDrawerTab, setGeologyDrawerTab] = useState<'geology_tables' | 'q_index'>(
    'geology_tables'
  );
  const [showAILearningDrawer, setShowAILearningDrawer] = useState<boolean>(false);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [layerVisibility, setLayerVisibility] = useState<VectorLayerVisibility>({
    photo: true,
    overbreakUndercut: false,
    controlPoints: true,
    joints: true,
    fractures: true,
    faults: true,
    bedding: true,
    foliation: true,
    lithology: true,
    otherStructures: true,
    annotations: true,
  });

  const svgCanvasRef = useRef<SVGSVGElement | null>(null);
  const worldGroupRef = useRef<SVGGElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stereoFileInputRef = useRef<HTMLInputElement | null>(null);

  const currentPhoto = photos[activeSurface];
  const responsive = useResponsiveLayout();
  const canvasStageSize = useContainerResizeObserver(
    canvasContainerRef,
    DEFAULT_VIEW_W,
    DEFAULT_VIEW_H,
    true
  );

  // Unified Master Canvas Stage Metrics (Section 1) — Dynamically adapts to live container aspect ratio
  const viewH = DEFAULT_VIEW_H;
  const viewW = useMemo(() => {
    const ratio = canvasStageSize.width / Math.max(1, canvasStageSize.height);
    const clampedRatio = Math.max(1.05, Math.min(2.65, ratio));
    return Math.round(viewH * clampedRatio);
  }, [canvasStageSize.width, canvasStageSize.height, viewH]);

  const padPx = useMemo(
    () => (responsive.isCompactScreen ? 36 : DEFAULT_PAD_PX),
    [responsive.isCompactScreen]
  );

  const stageMetrics = useMemo(
    () => computeCanvasStageMetrics(activeSurface, geometry, settings, viewW, viewH, padPx),
    [
      activeSurface,
      geometry,
      settings,
      viewW,
      viewH,
      padPx,
      canvasStageSize.revision,
      responsive.layoutRevision,
    ]
  );
  const surfaceBounds = stageMetrics.surfaceBounds;
  const pxPerMeter = stageMetrics.pxPerMeter;
  const surfaceRectPx = stageMetrics.surfaceRectPx;

  // Trigger synchronous layout recalculation whenever ResizeObserver or side panels/drawers change
  useLayoutEffect(() => {
    canvasStageSize.recalculate();
    triggerGlobalLayoutRecalculation();
    setLayoutVersion((v) => v + 1);
  }, [
    activeTool,
     Boolean(selectedJointId),
    showSetTableDrawer,
    showAILearningDrawer,
    activeSurface,
    canvasStageSize.recalculate,
  ]);

  useLayoutEffect(() => {
    setLayoutVersion((v) => v + 1);
  }, [
    canvasStageSize.width,
    canvasStageSize.height,
    canvasStageSize.dpr,
    canvasStageSize.revision,
    responsive.layoutRevision,
  ]);

  // Spacebar hold for instant Canvas Pan & Keyboard Shortcuts (Undo/Redo/Escape/Enter/Backspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && !isSpacePanning) {
        e.preventDefault();
        setIsSpacePanning(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
      } else if (e.key === 'Escape') {
        if (isDrawingLithologyPolygon) {
          setDraftLithologyPoints([]);
          setIsDrawingLithologyPolygon(false);
          setReopenedLithologyRegionId(null);
        } else if (draftJointPoints.length > 0) {
          setDraftJointPoints([]);
        }
      } else if (e.key === 'Backspace') {
        if (isDrawingLithologyPolygon && draftLithologyPoints.length > 0) {
          e.preventDefault();
          setDraftLithologyPoints((prev) => prev.slice(0, -1));
        } else if (
          (activeTool === 'add_joint' || activeTool === 'redraw_joint') &&
          draftJointPoints.length > 0
        ) {
          e.preventDefault();
          setDraftJointPoints((prev) => prev.slice(0, -1));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePanning(false);
        setDraggingCanvasPan(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    isSpacePanning,
    isDrawingLithologyPolygon,
    draftLithologyPoints.length,
    activeTool,
    draftJointPoints.length,
    onUndo,
    onRedo,
  ]);

  // Lithology, Control Points & Geological Symbols update wrappers with Undo/Redo history tracking (Sections 5, 13, 15)
  const handleUpdateLithologyWithHistory = useCallback(
    (nextRegions: LithologyRegion[]) => {
      setLithologyPast((prev) => [...prev.slice(-24), lithologyRegions]);
      setLithologyFuture([]);
      onUpdateLithologyRegions(nextRegions);
    },
    [lithologyRegions, onUpdateLithologyRegions]
  );

  const handleUpdateControlPointsWithHistory = useCallback(
    (
      updater:
        | SurveyControlPoint[]
        | ((prev: SurveyControlPoint[]) => SurveyControlPoint[])
    ) => {
      const next = typeof updater === 'function' ? updater(controlPoints) : updater;
      setControlPointPast((p) => [...p.slice(-24), controlPoints]);
      setControlPointFuture([]);
      onUpdateControlPoints(next);
    },
    [controlPoints, onUpdateControlPoints]
  );

  const handleUpdatePlacedSymbolsWithHistory = useCallback(
    (
      updater:
        | PlacedGeologicalSymbol[]
        | ((prev: PlacedGeologicalSymbol[]) => PlacedGeologicalSymbol[])
    ) => {
      const next = typeof updater === 'function' ? updater(placedSymbols) : updater;
      setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
      setSymbolFuture([]);
      onUpdatePlacedSymbols(next);
    },
    [placedSymbols, onUpdatePlacedSymbols]
  );

  const handleUndoLithology = useCallback(() => {
    if (activeTool === 'control_point' || selectedControlPointId) {
      if (controlPointPast.length > 0) {
        const previous = controlPointPast[controlPointPast.length - 1];
        setControlPointPast((prev) => prev.slice(0, -1));
        setControlPointFuture((prev) => [controlPoints, ...prev]);
        onUpdateControlPoints(previous);
        return;
      }
    }
    if (activeTool === 'geological_symbol' || selectedSymbolId) {
      if (symbolPast.length > 0) {
        const previous = symbolPast[symbolPast.length - 1];
        setSymbolPast((prev) => prev.slice(0, -1));
        setSymbolFuture((prev) => [placedSymbols, ...prev]);
        onUpdatePlacedSymbols(previous);
        return;
      }
    }
    if (lithologyPast.length > 0) {
      const previous = lithologyPast[lithologyPast.length - 1];
      setLithologyPast((prev) => prev.slice(0, -1));
      setLithologyFuture((prev) => [lithologyRegions, ...prev]);
      onUpdateLithologyRegions(previous);
      return;
    }
    if (controlPointPast.length > 0) {
      const previous = controlPointPast[controlPointPast.length - 1];
      setControlPointPast((prev) => prev.slice(0, -1));
      setControlPointFuture((prev) => [controlPoints, ...prev]);
      onUpdateControlPoints(previous);
      return;
    }
    if (symbolPast.length > 0) {
      const previous = symbolPast[symbolPast.length - 1];
      setSymbolPast((prev) => prev.slice(0, -1));
      setSymbolFuture((prev) => [placedSymbols, ...prev]);
      onUpdatePlacedSymbols(previous);
      return;
    }
    if (canUndo) onUndo();
  }, [
    activeTool,
    selectedControlPointId,
    controlPointPast,
    controlPoints,
    onUpdateControlPoints,
    selectedSymbolId,
    symbolPast,
    placedSymbols,
    onUpdatePlacedSymbols,
    lithologyPast,
    lithologyRegions,
    onUpdateLithologyRegions,
    canUndo,
    onUndo,
  ]);

  const handleRedoLithology = useCallback(() => {
    if (activeTool === 'control_point' || selectedControlPointId) {
      if (controlPointFuture.length > 0) {
        const next = controlPointFuture[0];
        setControlPointFuture((prev) => prev.slice(1));
        setControlPointPast((prev) => [...prev, controlPoints]);
        onUpdateControlPoints(next);
        return;
      }
    }
    if (activeTool === 'geological_symbol' || selectedSymbolId) {
      if (symbolFuture.length > 0) {
        const next = symbolFuture[0];
        setSymbolFuture((prev) => prev.slice(1));
        setSymbolPast((prev) => [...prev, placedSymbols]);
        onUpdatePlacedSymbols(next);
        return;
      }
    }
    if (lithologyFuture.length > 0) {
      const next = lithologyFuture[0];
      setLithologyFuture((prev) => prev.slice(1));
      setLithologyPast((prev) => [...prev, lithologyRegions]);
      onUpdateLithologyRegions(next);
      return;
    }
    if (controlPointFuture.length > 0) {
      const next = controlPointFuture[0];
      setControlPointFuture((prev) => prev.slice(1));
      setControlPointPast((prev) => [...prev, controlPoints]);
      onUpdateControlPoints(next);
      return;
    }
    if (symbolFuture.length > 0) {
      const next = symbolFuture[0];
      setSymbolFuture((prev) => prev.slice(1));
      setSymbolPast((prev) => [...prev, placedSymbols]);
      onUpdatePlacedSymbols(next);
      return;
    }
    if (canRedo) onRedo();
  }, [
    activeTool,
    selectedControlPointId,
    controlPointFuture,
    controlPoints,
    onUpdateControlPoints,
    selectedSymbolId,
    symbolFuture,
    placedSymbols,
    onUpdatePlacedSymbols,
    lithologyFuture,
    lithologyRegions,
    onUpdateLithologyRegions,
    canRedo,
    onRedo,
  ]);

  const surfaceJoints = useMemo(
    () =>
      joints.filter((j) => {
        if (j.surface !== activeSurface) return false;
        if (j.featureType === 'joint' && !layerVisibility.joints) return false;
        if (j.featureType === 'fracture' && !layerVisibility.fractures) return false;
        if ((j.featureType === 'fault' || j.featureType === 'shear') && !layerVisibility.faults)
          return false;
        if (
          (j.featureType === 'bedding' || j.featureType === 'shale_band') &&
          !layerVisibility.bedding
        )
          return false;
        if (
          (j.featureType === 'foliation' || j.featureType === 'lineation') &&
          !layerVisibility.foliation
        )
          return false;
        if (
          (j.featureType === 'lithological_contact' || j.featureType === 'dolerite') &&
          !layerVisibility.lithology
        )
          return false;
        if (
          (j.featureType === 'fold' ||
            j.featureType === 'infilling' ||
            j.featureType === 'vein' ||
            j.featureType === 'clay_band' ||
            j.featureType === 'seam' ||
            j.featureType === 'water_seepage') &&
          !layerVisibility.otherStructures
        )
          return false;
        return true;
      }),
    [joints, activeSurface, layerVisibility]
  );

  const selectedJoint = useMemo(
    () => joints.find((j) => j.id === selectedJointId) || null,
    [joints, selectedJointId]
  );

  const surfaceControlPoints = useMemo(
    () => controlPoints.filter((cp) => cp.surface === activeSurface),
    [controlPoints, activeSurface]
  );

  const selectedControlPoint = useMemo(
    () => surfaceControlPoints.find((cp) => cp.id === selectedControlPointId) || null,
    [surfaceControlPoints, selectedControlPointId]
  );

  // Keep the Control Point edit panel inputs synchronized whenever selectedControlPoint changes or is dragged (Section 8)
  useEffect(() => {
    if (selectedControlPoint) {
      setCpDraftLabel(selectedControlPoint.label);
      setCpDraftX(selectedControlPoint.point.x.toFixed(2));
      setCpDraftY(selectedControlPoint.point.y.toFixed(2));
    }
  }, [
    selectedControlPoint?.id,
    selectedControlPoint?.label,
    selectedControlPoint?.point.x,
    selectedControlPoint?.point.y,
  ]);

  const surfacePlacedSymbols = useMemo(
    () => placedSymbols.filter((s) => s.surface === activeSurface),
    [placedSymbols, activeSurface]
  );

  const selectedSymbol = useMemo(
    () => surfacePlacedSymbols.find((s) => s.id === selectedSymbolId) || null,
    [surfacePlacedSymbols, selectedSymbolId]
  );

  const handleDeleteControlPoint = useCallback(
    (cpId: string) => {
      handleUpdateControlPointsWithHistory((prev) => prev.filter((cp) => cp.id !== cpId));
      setSelectedControlPointId((prev) => (prev === cpId ? null : prev));
    },
    [handleUpdateControlPointsWithHistory]
  );

  const handleDeletePlacedSymbol = useCallback(
    (symId: string) => {
      handleUpdatePlacedSymbolsWithHistory((prev) => prev.filter((s) => s.id !== symId));
      setSelectedSymbolId((prev) => (prev === symId ? null : prev));
    },
    [handleUpdatePlacedSymbolsWithHistory]
  );

  // Live Quality Control check summary (Section 19 & 31)
  const qcReport = useMemo(() => {
    const uploadedCount = Object.values(photos).filter((p) => Boolean(p.image)).length;
    return runQualityControlValidation(
      geometry,
      settings,
      joints,
      uploadedCount,
      currentPhoto.stereoBaselineWarning
    );
  }, [geometry, settings, joints, photos, currentPhoto.stereoBaselineWarning]);

  // ============================================================================
  // CENTRALIZED CANVAS COORDINATE MANAGER (src/engine/canvasTransform.ts)
  // Exclusively handles all screenToWorld and worldToScreen transformations
  // ============================================================================
  const coordManager = useMemo(
    () =>
      new CanvasCoordinateManager({
        svgElement: svgCanvasRef,
        worldGroupElement: worldGroupRef,
        viewport,
        stageMetrics,
        photoTransform: currentPhoto.transform,
      }),
    [
      viewport,
      stageMetrics,
      currentPhoto.transform,
      layoutVersion,
      canvasStageSize.revision,
      responsive.layoutRevision,
    ]
  );

  // Viewport Pan & Zoom SVG transform string
  const viewportSvgTransform = useMemo(
    () => coordManager.getViewportSvgTransform(),
    [coordManager]
  );

  // Zoom around a specific screen point (or canvas center) without shifting the point under cursor
  const zoomViewportAtScreenPoint = useCallback(
    (nextZoomRaw: number, clientX?: number, clientY?: number) => {
      setViewport((prev) => {
        const mgr = new CanvasCoordinateManager({
          svgElement: svgCanvasRef,
          worldGroupElement: worldGroupRef,
          viewport: prev,
          stageMetrics,
          photoTransform: currentPhoto.transform,
        });
        return mgr.zoomAtScreenPoint(nextZoomRaw, clientX, clientY);
      });
    },
    [stageMetrics, currentPhoto.transform]
  );

  // Master boundary polygon path on the SVG canvas
  const surfaceBoundaryPath = useMemo(() => {
    if (activeSurface === 'face') {
      return (
        geometry.crossSectionPoints
          .map((pt, idx) => {
            const { cx, cy } = coordManager.worldToScreen(pt);
            return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
          })
          .join(' ') + ' Z'
      );
    }
    const tl = coordManager.worldToScreen({ x: surfaceBounds.minX, y: surfaceBounds.maxY });
    const br = coordManager.worldToScreen({ x: surfaceBounds.maxX, y: surfaceBounds.minY });
    return `M ${tl.cx} ${tl.cy} L ${br.cx} ${tl.cy} L ${br.cx} ${br.cy} L ${tl.cx} ${br.cy} Z`;
  }, [activeSurface, geometry.crossSectionPoints, surfaceBounds, coordManager]);

  // Custom polygon mask path (P1, P2, P3, P4, P5, P6, P7...) on the SVG canvas
  const customMaskPolygonPath = useMemo(() => {
    const pts = currentPhoto.transform.customMaskPoints;
    if (!pts || pts.length < 3) return surfaceBoundaryPath;
    return (
      pts
        .map((pt, idx) => {
          const { cx, cy } = coordManager.worldToScreen(pt);
          return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
        })
        .join(' ') + ' Z'
    );
  }, [currentPhoto.transform.customMaskPoints, surfaceBoundaryPath, coordManager]);

  // Real-time piecewise mesh & perspective canvas rasterization for exact tunnel shape fitting
  useEffect(() => {
    let cancelled = false;
    if (!currentPhoto.image) {
      setLiveWarpedImageUrl(null);
      return;
    }
    const timer = setTimeout(async () => {
      const warpedUrl = await generatePiecewiseWarpedPhotoDataUrl(
        currentPhoto.image!,
        currentPhoto.transform
      );
      if (!cancelled) {
        setLiveWarpedImageUrl(warpedUrl);
        if (warpedUrl && currentPhoto.warpedImage !== warpedUrl) {
          onUpdatePhotoSurface(activeSurface, (prev) =>
            prev.warpedImage === warpedUrl ? prev : { ...prev, warpedImage: warpedUrl }
          );
        }
      }
    }, 55);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentPhoto.image, currentPhoto.transform, currentPhoto.warpedImage, activeSurface, onUpdatePhotoSurface]);

  // Precompute Multi-Scale Frangi/Steger Hessian Ridge & Geodesic Cost Field on active warped photo
  // Enables <2ms interactive Magnetic Live-Wire pathfinding, 1-Click Seed Auto-Track, and Crack X-Ray Vision
  useEffect(() => {
    let cancelled = false;
    const displayImg = liveWarpedImageUrl || currentPhoto.warpedImage || currentPhoto.image;
    if (!displayImg) {
      setActivePhotoRidgeField(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const supImg = currentPhoto.supportingPhotos?.[0]?.image || currentPhoto.stereoImage || undefined;
        const field = await buildPhotoRidgeField(displayImg, 520, supImg);
        if (!cancelled) {
          setActivePhotoRidgeField(field);
        }
      } catch {
        if (!cancelled) {
          setActivePhotoRidgeField(null);
        }
      }
    }, 90);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    liveWarpedImageUrl,
    currentPhoto.warpedImage,
    currentPhoto.image,
    currentPhoto.supportingPhotos,
    currentPhoto.stereoImage,
    activeSurface,
  ]);

  // Compute live Magnetic Live-Wire geodesic segment from last clicked vertex to current cursor
  const livewirePreviewSegment = useMemo<Point2D[]>(() => {
    if (
      jointDrawMode !== 'magnetic_livewire' ||
      !activePhotoRidgeField ||
      draftJointPoints.length === 0 ||
      !cursorMeters ||
      isFreehandDrawingJoint
    ) {
      return [];
    }
    const lastPt = draftJointPoints[draftJointPoints.length - 1];
    const startUV = surfaceMetersToImageUV(
      lastPt,
      activeSurface,
      geometry,
      settings,
      currentPhoto.transform
    );
    const endUV = surfaceMetersToImageUV(
      cursorMeters,
      activeSurface,
      geometry,
      settings,
      currentPhoto.transform
    );
    const uvPath = traceGeodesicPathBetweenUVPoints(
      activePhotoRidgeField,
      { x: startUV.u, y: startUV.v },
      { x: endUV.u, y: endUV.v },
      7
    );
    return uvPath.map((uv) =>
      imageUVToSurfaceMeters(
        uv.x,
        uv.y,
        activeSurface,
        geometry,
        settings,
        currentPhoto.transform,
        currentPhoto.calibration,
        true
      )
    );
  }, [
    jointDrawMode,
    activePhotoRidgeField,
    draftJointPoints,
    cursorMeters,
    isFreehandDrawingJoint,
    activeSurface,
    geometry,
    settings,
    currentPhoto.transform,
    currentPhoto.calibration,
  ]);

  // Synchronize mapped geological features on activeSurface when photo is rotated/scaled/moved (Section 6)
  const syncSurfaceFeaturesToPhotoTransform = useCallback(
    (prevT: SurfaceTransform, nextT: SurfaceTransform) => {
      if (!syncFeaturesWithPhotoTransform) return;
      const affineChanged =
        prevT.offsetX !== nextT.offsetX ||
        prevT.offsetY !== nextT.offsetY ||
        prevT.scaleX !== nextT.scaleX ||
        prevT.scaleY !== nextT.scaleY ||
        (prevT.zoom ?? 1) !== (nextT.zoom ?? 1) ||
        prevT.rotation !== nextT.rotation;
      if (!affineChanged) return;

      const hasSurfaceJoints = joints.some((j) => j.surface === activeSurface);
      if (hasSurfaceJoints) {
        const nextJoints = joints.map((j) => {
          if (j.surface !== activeSurface) return j;
          const nextGeom = j.geometry.map((pt) =>
            coordManager.transformWorldPointForPhotoChange(pt, prevT, nextT)
          );
          return {
            ...j,
            geometry: nextGeom,
          };
        });
        onUpdateJointsWithHistory(nextJoints);
      }

      const hasSurfaceLith = lithologyRegions.some((r) => r.surface === activeSurface);
      if (hasSurfaceLith) {
        const nextLith = lithologyRegions.map((r) => {
          if (r.surface !== activeSurface) return r;
          const nextPoly = r.polygon.map((pt) =>
            coordManager.transformWorldPointForPhotoChange(pt, prevT, nextT)
          );
          return {
            ...r,
            polygon: nextPoly,
            polygonPoints: nextPoly,
          };
        });
        onUpdateLithologyRegions(nextLith);
      }

      onUpdateControlPoints((prevCPs) =>
        prevCPs.map((cp) => {
          if (cp.surface !== activeSurface) return cp;
          const nextPt = coordManager.transformWorldPointForPhotoChange(
            cp.point,
            prevT,
            nextT
          );
          return {
            ...cp,
            point: nextPt,
            imageUV: coordManager.worldToPhotoUV(nextPt, nextT),
          };
        })
      );

      onUpdatePlacedSymbols((prevSyms) =>
        prevSyms.map((sym) => {
          if (sym.surface !== activeSurface) return sym;
          const nextPt = coordManager.transformWorldPointForPhotoChange(
            sym.point,
            prevT,
            nextT
          );
          return {
            ...sym,
            point: nextPt,
          };
        })
      );
    },
    [
      syncFeaturesWithPhotoTransform,
      joints,
      activeSurface,
      coordManager,
      onUpdateJointsWithHistory,
      lithologyRegions,
      onUpdateLithologyRegions,
      onUpdateControlPoints,
      onUpdatePlacedSymbols,
    ]
  );

  // Update active surface transform with Undo/Redo history tracking
  const handleUpdateTransformWithHistory = useCallback(
    (updater: (prev: SurfaceTransform) => SurfaceTransform) => {
      const prevT = currentPhoto.transform;
      const nextT = updater(prevT);
      setTransformPast((prev) => [...prev.slice(-18), prevT]);
      setTransformFuture([]);
      onUpdatePhotoSurface(activeSurface, (prev) => ({
        ...prev,
        transform: nextT,
      }));
      syncSurfaceFeaturesToPhotoTransform(prevT, nextT);
    },
    [
      currentPhoto.transform,
      activeSurface,
      onUpdatePhotoSurface,
      syncSurfaceFeaturesToPhotoTransform,
    ]
  );

  const handleUndoTransform = useCallback(() => {
    if (transformPast.length === 0) return;
    const previous = transformPast[transformPast.length - 1];
    const prevT = currentPhoto.transform;
    setTransformPast((prev) => prev.slice(0, -1));
    setTransformFuture((prev) => [prevT, ...prev]);
    onUpdatePhotoSurface(activeSurface, (prev) => ({
      ...prev,
      transform: previous,
    }));
    syncSurfaceFeaturesToPhotoTransform(prevT, previous);
  }, [
    transformPast,
    currentPhoto.transform,
    activeSurface,
    onUpdatePhotoSurface,
    syncSurfaceFeaturesToPhotoTransform,
  ]);

  const handleRedoTransform = useCallback(() => {
    if (transformFuture.length === 0) return;
    const next = transformFuture[0];
    const prevT = currentPhoto.transform;
    setTransformFuture((prev) => prev.slice(1));
    setTransformPast((prev) => [...prev, prevT]);
    onUpdatePhotoSurface(activeSurface, (prev) => ({
      ...prev,
      transform: next,
    }));
    syncSurfaceFeaturesToPhotoTransform(prevT, next);
  }, [
    transformFuture,
    currentPhoto.transform,
    activeSurface,
    onUpdatePhotoSurface,
    syncSurfaceFeaturesToPhotoTransform,
  ]);

  const qComputed = useMemo(
    () => calculateBartonQSystem(qIndexParams, geometry.width),
    [qIndexParams, geometry.width]
  );

  // Commit draft lithology polygon (new or reopened)
  const commitDraftLithologyPolygon = useCallback(
    (pointsToCommit?: Point2D[]) => {
      const pts = pointsToCommit || draftLithologyPoints;
      if (pts.length < 3) {
        onUpdateStatusMessage?.('Please place at least 3 boundary points to close a lithology region.');
        return;
      }
      const cleanPoly = pts.map((p) => ({
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
      }));

      if (reopenedLithologyRegionId) {
        const nextRegions = lithologyRegions.map((r) =>
          r.id === reopenedLithologyRegionId
            ? {
                ...r,
                polygon: cleanPoly,
                polygonPoints: cleanPoly,
              }
            : r
        );
        handleUpdateLithologyWithHistory(nextRegions);
        setSelectedLithologyRegionId(reopenedLithologyRegionId);
        setReopenedLithologyRegionId(null);
        setDraftLithologyPoints([]);
        setIsDrawingLithologyPolygon(false);
        onUpdateStatusMessage?.(
          `Updated lithology region boundary (${cleanPoly.length} vertices).`
        );
        return;
      }

      const newReg = createLithologyRegionFromPolygon(
        activeSurface,
        cleanPoly,
        'quartzite',
        undefined,
        joints,
        currentPhoto
      );
      handleUpdateLithologyWithHistory([...lithologyRegions, newReg]);
      setSelectedLithologyRegionId(newReg.id);
      setDraftLithologyPoints([]);
      setIsDrawingLithologyPolygon(false);
      onUpdateStatusMessage?.(
        `Created lithology region (${cleanPoly.length} vertices). Select lithology type & review AI description.`
      );
    },
    [
      draftLithologyPoints,
      reopenedLithologyRegionId,
      lithologyRegions,
      handleUpdateLithologyWithHistory,
      activeSurface,
      joints,
      currentPhoto,
      onUpdateStatusMessage,
    ]
  );

  // Finalize drawing a manual, freehand, spline, appended, or re-drawn joint trace (Sections 9, 10, 11, 12)
  const finishDraftJoint = useCallback(
    (pointsToCommit?: Point2D[]) => {
      const rawPts = pointsToCommit || draftJointPoints;
      if (rawPts.length < 2 && activeTool !== 'append_joint') {
        setDraftJointPoints([]);
        setIsFreehandDrawingJoint(false);
        return;
      }

      // Preserve exact clicked geometry (NEVER shift or straighten user-clicked points!)
      let finalPts: Point2D[] = rawPts.map((p) => ({
        x: Number(p.x.toFixed(4)),
        y: Number(p.y.toFixed(4)),
      }));

      if (jointDrawMode === 'smooth_curve' && finalPts.length >= 3) {
        finalPts = evaluateCatmullRomSplineThroughPoints(finalPts, 3);
      }

      // If appending points to an existing selected joint ("Continue Editing")
      if (activeTool === 'append_joint' && selectedJoint && rawPts.length >= 1) {
        const existing = selectedJoint.geometry;
        const firstNew = finalPts[0];
        const distToStart = Math.hypot(
          firstNew.x - existing[0].x,
          firstNew.y - existing[0].y
        );
        const distToEnd = Math.hypot(
          firstNew.x - existing[existing.length - 1].x,
          firstNew.y - existing[existing.length - 1].y
        );
        const combined =
          distToStart < distToEnd
            ? [...finalPts.slice().reverse(), ...existing]
            : [...existing, ...finalPts];

        const orient = calculateJointOrientation3D(
          combined,
          activeSurface,
          geometry,
          settings,
          'DIRECTLY_MEASURED',
          currentPhoto.calibration,
          1.0,
          1.0
        );
        const updated = joints.map((j) =>
          j.id === selectedJoint.id
            ? {
                ...j,
                geometry: combined,
                points3D: orient.points3D,
                traceAngle: orient.traceAngle,
                localAnglesDeg: orient.localAnglesDeg,
                wavinessAngleDeg: orient.wavinessAngleDeg,
                persistenceMeters: orient.persistenceMeters,
                isCurved: orient.isCurved,
              }
            : j
        );
        onUpdateJointsWithHistory(updated);
        setDraftJointPoints([]);
        setIsFreehandDrawingJoint(false);
        setActiveTool('select');
        return;
      }

      const orient = calculateJointOrientation3D(
        finalPts,
        activeSurface,
        geometry,
        settings,
        'DIRECTLY_MEASURED',
        currentPhoto.calibration,
        1.0,
        1.0
      );

      if (activeTool === 'redraw_joint' && selectedJoint) {
        const updated = joints.map((j) =>
          j.id === selectedJoint.id
            ? {
                ...j,
                geometry: finalPts,
                points3D: orient.points3D,
                traceAngle: orient.traceAngle,
                localAnglesDeg: orient.localAnglesDeg,
                wavinessAngleDeg: orient.wavinessAngleDeg,
                terminationStart: orient.terminationStart,
                terminationEnd: orient.terminationEnd,
                apparentDip: orient.apparentDip,
                strike: orient.strike,
                dip: orient.dip,
                dipDirection: orient.dipDirection,
                persistenceMeters: orient.persistenceMeters,
                isCurved: orient.isCurved,
                confidence: 'High' as const,
                confidenceScore: 0.98,
                confidenceBreakdown: orient.confidenceBreakdown,
                accepted: true,
              }
            : j
        );
        onUpdateJointsWithHistory(updated);
        setDraftJointPoints([]);
        setIsFreehandDrawingJoint(false);
        setActiveTool('select');
        return;
      }

      const newJoint: Joint = {
        id: `jt-man-${activeSurface}-${Date.now()}`,
        surface: activeSurface,
        geometry: finalPts,
        points3D: orient.points3D,
        vertexWidths: finalPts.map((_, idx) =>
          Number(
            (
              0.45 +
              0.22 * Math.sin((idx / Math.max(1, finalPts.length - 1)) * Math.PI)
            ).toFixed(2)
          )
        ),
        traceAngle: orient.traceAngle,
        localAnglesDeg: orient.localAnglesDeg,
        wavinessAngleDeg: orient.wavinessAngleDeg,
        terminationStart: orient.terminationStart,
        terminationEnd: orient.terminationEnd,
        apparentDip: orient.apparentDip,
        strike: orient.strike,
        dip: orient.dip,
        dipDirection: orient.dipDirection,
        orientationStatus: orient.orientationStatus,
        set:
          draftFeatureType === 'bedding' || draftFeatureType === 'foliation'
            ? 'J0'
            : draftFeatureType === 'fault' ||
              draftFeatureType === 'shear' ||
              draftFeatureType === 'seam'
            ? 'F1'
            : draftSetId,
        featureType: draftFeatureType,
        confidence: 'High',
        confidenceScore: 0.98,
        confidenceBreakdown: orient.confidenceBreakdown,
        source: 'MANUAL',
        accepted: true,
        persistenceMeters: orient.persistenceMeters,
        isCurved: orient.isCurved,
        roughness: 'Undulating / Rough',
        infilling:
          draftFeatureType === 'vein' || draftFeatureType === 'infilling'
            ? 'Quartz / Calcite Vein'
            : draftFeatureType === 'clay_band' || draftFeatureType === 'seam'
            ? 'Soft Clay Gouge'
            : 'Not determined',
        apertureMm: 'Variable (0.5–3 mm)',
        waterCondition: 'Dry',
      };

      onUpdateJointsWithHistory([...joints, newJoint]);
      setSelectedJointId(newJoint.id);
      setSelectedJointVertexIdx(null);
      setDraftJointPoints([]);
      setIsFreehandDrawingJoint(false);
      setActiveTool('select');
    },
    [
      draftJointPoints,
      activeTool,
      jointDrawMode,
      selectedJoint,
      activeSurface,
      geometry,
      settings,
      currentPhoto.calibration,
      joints,
      onUpdateJointsWithHistory,
      draftFeatureType,
      draftSetId,
    ]
  );

  // Mouse Wheel Zoom centered at cursor (Sections 2 & 5)
  const handleCanvasWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomViewportAtScreenPoint(viewport.zoom * zoomFactor, e.clientX, e.clientY);
  };

  // Touch Start / Move / End for Stylus, Single-Finger Tap/Draw, and Two-Finger Pinch/Pan (Section 15)
  const handleCanvasTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.max(10, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      touchGestureRef.current = {
        isMultiTouch: true,
        startDist: dist,
        startZoom: viewport.zoom,
        startMidX: midX,
        startMidY: midY,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
      };
      // Cancel any accidental single-finger freehand draw started milliseconds before 2nd finger touched
      if (isFreehandDrawingJoint) {
        setIsFreehandDrawingJoint(false);
        setDraftJointPoints([]);
      }
      return;
    }

    if (e.touches.length === 1) {
      touchGestureRef.current = null;
      const t = e.touches[0];
      const worldProj = coordManager.screenToWorld(t.clientX, t.clientY);
      const pt: Point2D = { x: worldProj.x, y: worldProj.y };
      setCursorMeters(pt);

      if (activeTool === 'pan') {
        setDraggingCanvasPan({
          startClientX: t.clientX,
          startClientY: t.clientY,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
        });
        return;
      }

      if (activeTool === 'control_point') {
        const newCp: SurveyControlPoint = {
          id: `cp-survey-${Date.now()}`,
          label: `CP${controlPoints.filter((c) => c.surface === activeSurface).length + 1}`,
          surface: activeSurface,
          point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
          imageUV: { u: worldProj.u, v: worldProj.v },
          color: '#22D3EE',
          visible: true,
          locked: false,
        };
        handleUpdateControlPointsWithHistory((prev) => [...prev, newCp]);
        setSelectedControlPointId(newCp.id);
        return;
      }

      if (activeTool === 'geological_symbol') {
        const meta = getStructuralSymbolMeta(activeSymbolTypeToPlace);
        const nextIdx =
          placedSymbols.filter((s) => s.surface === activeSurface).length + 1;
        const newSym: PlacedGeologicalSymbol = {
          id: `sym-${activeSurface}-${Date.now()}`,
          surface: activeSurface,
          symbolType: activeSymbolTypeToPlace,
          point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
          rotationDeg: 0,
          scale: 1.0,
          dipDirectionDeg: 135,
          dipDeg: 60,
          strikeDeg: 45,
          uncertainOrientation: false,
          label: `${meta.shortCode}-${nextIdx}`,
          color: meta.defaultColor,
          visible: true,
          locked: false,
        };
        handleUpdatePlacedSymbolsWithHistory((prev) => [...prev, newSym]);
        setSelectedSymbolId(newSym.id);
        return;
      }

      if (
        (activeTool === 'add_joint' || activeTool === 'redraw_joint' || activeTool === 'append_joint') &&
        jointDrawMode === 'freehand'
      ) {
        setIsFreehandDrawingJoint(true);
        setDraftJointPoints([pt]);
      }
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length >= 2 && touchGestureRef.current && svgCanvasRef.current) {
      e.preventDefault();
      const g = touchGestureRef.current;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.max(10, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      setViewport(
        coordManager.pinchZoomAndPan({
          startDist: g.startDist,
          currDist: dist,
          startZoom: g.startZoom,
          startMidX: g.startMidX,
          startMidY: g.startMidY,
          currMidX: midX,
          currMidY: midY,
          startPanX: g.startPanX,
          startPanY: g.startPanY,
        })
      );
      return;
    }

    if (e.touches.length === 1 && !touchGestureRef.current?.isMultiTouch) {
      const t = e.touches[0];
      handleCanvasMouseMove({
        clientX: t.clientX,
        clientY: t.clientY,
      } as unknown as React.MouseEvent<SVGSVGElement>);
    }
  };

  const handleCanvasTouchEnd = () => {
    if (touchGestureRef.current?.isMultiTouch) {
      touchGestureRef.current = null;
      return;
    }
    handleCanvasMouseUp();
  };

  // Canvas Mouse Down (Unified Coordinate Pipeline via coordManager.screenToWorld)
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // 1. Middle-mouse button OR Spacebar+drag OR Pan tool => Pan Canvas Viewport
    if (e.button === 1 || isSpacePanning || activeTool === 'pan') {
      e.preventDefault();
      setDraggingCanvasPan({
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
      });
      return;
    }

    if (e.button !== 0) return;

    const worldProj = coordManager.screenToWorld(e.clientX, e.clientY);
    const pt: Point2D = { x: worldProj.x, y: worldProj.y };

    // 2. Dedicated Control Point Tool or Overbreak Profile Tool (Sections 5, 6, 7, 8 & Overbreak/Undercut)
    if (activeTool === 'control_point' || activeTool === 'overbreak') {
      const hitTolMeters = coordManager.getHitToleranceMeters(12);
      const existingHit = surfaceControlPoints.find(
        (c) =>
          c.visible !== false &&
          Math.hypot(c.point.x - pt.x, c.point.y - pt.y) <= hitTolMeters
      );
      if (existingHit) {
        setSelectedControlPointId(existingHit.id);
        if (!existingHit.locked && !surveyProfile.locked) {
          setControlPointPast((p) => [...p.slice(-24), controlPoints]);
          setControlPointFuture([]);
          setDraggingControlPointId(existingHit.id);
        }
        return;
      }
      if (activeTool === 'overbreak' && surveyProfile.locked) {
        onUpdateStatusMessage?.('Surveyed profile is currently locked. Unlock it to add points.');
        return;
      }
      const nextIndex =
        controlPoints.filter((c) => c.surface === activeSurface).length + 1;
      const newCp: SurveyControlPoint = {
        id: `cp-survey-${Date.now()}`,
        label: `CP${nextIndex}`,
        surface: activeSurface,
        point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
        imageUV: { u: worldProj.u, v: worldProj.v },
        color: '#22D3EE',
        visible: true,
        locked: false,
      };
      handleUpdateControlPointsWithHistory((prev) => [...prev, newCp]);
      if (activeTool === 'overbreak') {
        onUpdateSurveyProfile((prev) => ({
          ...prev,
          surface: activeSurface,
          orderedControlPointIds: [...prev.orderedControlPointIds, newCp.id],
          visible: true,
        }));
      }
      setSelectedControlPointId(newCp.id);
      onUpdateStatusMessage?.(
        activeTool === 'overbreak'
          ? `Placed & connected ${newCp.label} at X=${pt.x.toFixed(2)}m, Y=${pt.y.toFixed(2)}m.`
          : `Placed control point ${newCp.label} at X=${pt.x.toFixed(2)}m, Y=${pt.y.toFixed(2)}m.`
      );
      return;
    }

    // 2b. Dedicated Geological Symbol Tool (Sections 9, 10, 12, 15)
    if (activeTool === 'geological_symbol') {
      const hitTolMeters = coordManager.getHitToleranceMeters(16);
      const existingSym = surfacePlacedSymbols.find(
        (s) =>
          s.visible !== false &&
          Math.hypot(s.point.x - pt.x, s.point.y - pt.y) <= hitTolMeters
      );
      if (existingSym) {
        setSelectedSymbolId(existingSym.id);
        if (!existingSym.locked) {
          setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
          setSymbolFuture([]);
          setDraggingSymbolId(existingSym.id);
        }
        return;
      }
      const meta = getStructuralSymbolMeta(activeSymbolTypeToPlace);
      const nextIdx =
        placedSymbols.filter((s) => s.surface === activeSurface).length + 1;
      const newSym: PlacedGeologicalSymbol = {
        id: `sym-${activeSurface}-${Date.now()}`,
        surface: activeSurface,
        symbolType: activeSymbolTypeToPlace,
        point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
        rotationDeg: 0,
        scale: 1.0,
        dipDirectionDeg: 135,
        dipDeg: 60,
        strikeDeg: 45,
        uncertainOrientation: false,
        label: `${meta.shortCode}-${nextIdx}`,
        color: meta.defaultColor,
        visible: true,
        locked: false,
      };
      handleUpdatePlacedSymbolsWithHistory((prev) => [...prev, newSym]);
      setSelectedSymbolId(newSym.id);
      onUpdateStatusMessage?.(
        `Placed ${meta.label} symbol (${newSym.label}) at X=${pt.x.toFixed(2)}m, Y=${pt.y.toFixed(2)}m.`
      );
      return;
    }

    // 3. Lithology Tool (Sections 7, 8, 11, 13)
    if (activeTool === 'lithology') {
      if (isDrawingLithologyPolygon) {
        // Check if user clicked on the first point L1 to close the polygon
        if (draftLithologyPoints.length >= 3) {
          const firstPt = draftLithologyPoints[0];
          const hitTol = coordManager.getHitToleranceMeters(14);
          if (Math.hypot(pt.x - firstPt.x, pt.y - firstPt.y) <= hitTol) {
            commitDraftLithologyPolygon(draftLithologyPoints);
            return;
          }
        }
        setDraftLithologyPoints((prev) => [...prev, pt]);
        return;
      }

      // If no region exists on this surface yet, start drawing immediately on click!
      const surfRegs = lithologyRegions.filter((r) => r.surface === activeSurface);
      if (surfRegs.length === 0) {
        setIsDrawingLithologyPolygon(true);
        setDraftLithologyPoints([pt]);
        return;
      }

      // Check if user clicked inside an existing lithology polygon to select & drag it
      const clickedReg = surfRegs.find((r) => isPointInsidePolygon(pt, r.polygon));
      if (clickedReg) {
        setSelectedLithologyRegionId(clickedReg.id);
        setLithologyPast((prev) => [...prev.slice(-24), lithologyRegions]);
        setLithologyFuture([]);
        setDraggingWholeLithology({
          regionId: clickedReg.id,
          startMeters: pt,
          origPolygon: clickedReg.polygon.map((p) => ({ ...p })),
        });
        return;
      }
      return;
    }

    // 4. Joint / Geological Feature Tool (Sections 9, 10, 11, 12)
    if (
      activeTool === 'add_joint' ||
      activeTool === 'redraw_joint' ||
      activeTool === 'append_joint'
    ) {
      if (jointDrawMode === 'freehand') {
        setIsFreehandDrawingJoint(true);
        setDraftJointPoints([pt]);
        return;
      }

      // 1-Click Seed Auto-Follow Mode: Automatically propagates forward & backward along the rock fracture
      if (jointDrawMode === 'seed_autotrace' && activePhotoRidgeField) {
        const seedUV = surfaceMetersToImageUV(
          pt,
          activeSurface,
          geometry,
          settings,
          currentPhoto.transform
        );
        const propagated = autoPropagateFractureFromSeedUV(activePhotoRidgeField, {
          x: seedUV.u,
          y: seedUV.v,
        });
        if (propagated && propagated.uvPoints.length >= 2) {
          const meterPts = propagated.uvPoints.map((uv) =>
            imageUVToSurfaceMeters(
              uv.x,
              uv.y,
              activeSurface,
              geometry,
              settings,
              currentPhoto.transform,
              currentPhoto.calibration,
              true
            )
          );
          const clipped = clipPolylineToSurface(meterPts, activeSurface, geometry, settings);
          if (clipped.length >= 2) {
            finishDraftJoint(clipped);
            onUpdateStatusMessage?.(
              `1-Click Auto-Follow tracked ${clipped.length} vertices along rock discontinuity (Conf ${Math.round(
                propagated.confidenceScore * 100
              )}%).`
            );
            return;
          }
        }
        onUpdateStatusMessage?.(
          'No strong fracture ridge directly under click — placed anchor vertex. Click second point to finish.'
        );
      }

      // Magnetic Live-Wire Mode: Append the full Dijkstra geodesic path along the rock fracture
      if (
        jointDrawMode === 'magnetic_livewire' &&
        activePhotoRidgeField &&
        draftJointPoints.length > 0 &&
        livewirePreviewSegment.length >= 2
      ) {
        setDraftJointPoints((prev) => [...prev, ...livewirePreviewSegment.slice(1)]);
        return;
      }

      setDraftJointPoints((prev) => [...prev, pt]);
      return;
    }

    // 5. Measure Tool
    if (activeTool === 'measure') {
      setMeasurePts((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }

    // 6. Photo Fitting Tool (Sections 6 & 13)
    if (activeTool === 'photo_fit' && currentPhoto.image) {
      // 6a. "Click Canvas to Add Custom Mask Vertex P_n"
      if (drawingCustomMaskMode) {
        handleUpdateTransformWithHistory((prev) => ({
          ...prev,
          useCustomMask: true,
          cropToGeometry: true,
          customMaskPoints: [...(prev.customMaskPoints || []), pt],
        }));
        return;
      }

      // 6b. "Click Photo to Add Mesh Control Point C_n" (accounting for photo rotation/zoom/pan/scale!)
      if (addingControlPointMode) {
        const normU = Math.max(-0.15, Math.min(1.15, worldProj.u));
        const normV = Math.max(-0.15, Math.min(1.15, worldProj.v));
        handleUpdateTransformWithHistory((prev) => {
          const existing = prev.meshControlPoints || createDefaultMeshControlPoints(3, 3);
          return {
            ...prev,
            meshControlPoints: [
              ...existing,
              {
                id: `cp-user-${Date.now()}`,
                label: `C${existing.length + 1}`,
                srcU: Number(normU.toFixed(4)),
                srcV: Number(normV.toFixed(4)),
                dstU: Number(normU.toFixed(4)),
                dstV: Number(normV.toFixed(4)),
              },
            ],
          };
        });
        setAddingControlPointMode(false);
        return;
      }

      setTransformPast((prev) => [...prev.slice(-18), currentPhoto.transform]);
      setTransformFuture([]);
      setDraggingPhotoHandle({
        type: 'move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialTransform: {
          ...currentPhoto.transform,
          perspectiveCorners: [
            { ...currentPhoto.transform.perspectiveCorners[0] },
            { ...currentPhoto.transform.perspectiveCorners[1] },
            { ...currentPhoto.transform.perspectiveCorners[2] },
            { ...currentPhoto.transform.perspectiveCorners[3] },
          ],
        },
      });
      return;
    }

    // 7. Select Tool Hit-Testing in World Coordinates (Section 14)
    if (activeTool === 'select' || activeTool === 'dip_probe') {
      const hitTolMeters = coordManager.getHitToleranceMeters(10);

      // Check survey control points first
      const hitCp = controlPoints.find(
        (c) =>
          c.surface === activeSurface &&
          c.visible !== false &&
          Math.hypot(c.point.x - pt.x, c.point.y - pt.y) <= hitTolMeters * 1.2
      );
      if (hitCp) {
        setSelectedControlPointId(hitCp.id);
        if (!hitCp.locked) {
          setControlPointPast((p) => [...p.slice(-24), controlPoints]);
          setControlPointFuture([]);
          setDraggingControlPointId(hitCp.id);
        }
        return;
      }

      // Check placed geological symbols
      const hitSym = surfacePlacedSymbols.find(
        (s) =>
          s.visible !== false &&
          Math.hypot(s.point.x - pt.x, s.point.y - pt.y) <= hitTolMeters * 1.4
      );
      if (hitSym) {
        setSelectedSymbolId(hitSym.id);
        if (!hitSym.locked) {
          setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
          setSymbolFuture([]);
          setDraggingSymbolId(hitSym.id);
        }
        return;
      }

      // Check joints in world coordinates
      let closestJoint: Joint | null = null;
      let minDist = hitTolMeters;
      for (const j of surfaceJoints) {
        const geom = getDisplayedJointGeometry(j, traceFitMode);
        for (let i = 0; i < geom.length - 1; i++) {
          const d = pointToSegmentDistance(pt, geom[i], geom[i + 1]);
          if (d < minDist) {
            minDist = d;
            closestJoint = j;
          }
        }
      }

      if (closestJoint) {
        if (joinTargetMode && selectedJoint && selectedJoint.id !== closestJoint.id) {
          handleJoinWithJoint(closestJoint);
          return;
        }
        setSelectedJointId(closestJoint.id);
        setSelectedJointVertexIdx(null);
      } else {
        setSelectedJointId(null);
        setSelectedJointVertexIdx(null);
        setSelectedControlPointId(null);
        setSelectedSymbolId(null);
        setJoinTargetMode(false);
      }
    }
  };

  // Canvas Mouse Move (Unified Coordinate Pipeline via coordManager.screenToWorld)
  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // 1. Handle Canvas Viewport Panning
    if (draggingCanvasPan && svgCanvasRef.current) {
      setViewport(
        coordManager.panByScreenDelta(
          draggingCanvasPan.startClientX,
          draggingCanvasPan.startClientY,
          e.clientX,
          e.clientY,
          draggingCanvasPan.startPanX,
          draggingCanvasPan.startPanY
        )
      );
      return;
    }

    const worldProj = coordManager.screenToWorld(e.clientX, e.clientY);
    const pt: Point2D = { x: worldProj.x, y: worldProj.y };
    setCursorMeters(pt);
    setCursorCanvasPx({
      cx: Number(worldProj.cx.toFixed(1)),
      cy: Number(worldProj.cy.toFixed(1)),
    });

    // 2. Dragging Survey Control Point (Sections 5, 6, 8 — exact 1:1 cursor tracking)
    if (draggingControlPointId) {
      onUpdateControlPoints((prev) =>
        prev.map((cp) =>
          cp.id === draggingControlPointId && !cp.locked
            ? {
                ...cp,
                point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
                imageUV: { u: worldProj.u, v: worldProj.v },
              }
            : cp
        )
      );
      return;
    }

    // 2b. Dragging, Rotating, or Scaling a Placed Geological Symbol (Section 15)
    if (rotatingSymbolState) {
      const dx = worldProj.cx - rotatingSymbolState.centerPx.cx;
      const dy = worldProj.cy - rotatingSymbolState.centerPx.cy;
      const deg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360);
      onUpdatePlacedSymbols((prev) =>
        prev.map((s) =>
          s.id === rotatingSymbolState.symbolId && !s.locked
            ? {
                ...s,
                rotationDeg: deg,
                dipDirectionDeg: deg,
                strikeDeg: (deg - 90 + 360) % 360,
              }
            : s
        )
      );
      return;
    }

    if (scalingSymbolState) {
      const currDist = Math.max(
        6,
        Math.hypot(
          worldProj.cx - scalingSymbolState.centerPx.cx,
          worldProj.cy - scalingSymbolState.centerPx.cy
        )
      );
      const ratio = currDist / Math.max(8, scalingSymbolState.initialDistPx);
      const nextScale = Number(
        Math.max(0.45, Math.min(2.8, scalingSymbolState.initialScale * ratio)).toFixed(2)
      );
      onUpdatePlacedSymbols((prev) =>
        prev.map((s) =>
          s.id === scalingSymbolState.symbolId && !s.locked
            ? { ...s, scale: nextScale }
            : s
        )
      );
      return;
    }

    if (draggingSymbolId) {
      onUpdatePlacedSymbols((prev) =>
        prev.map((s) =>
          s.id === draggingSymbolId && !s.locked
            ? {
                ...s,
                point: { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) },
              }
            : s
        )
      );
      return;
    }

    // 3. Freehand Joint Drawing (Section 9)
    if (isFreehandDrawingJoint) {
      setDraftJointPoints((prev) => {
        if (prev.length === 0) return [pt];
        const last = prev[prev.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.035) {
          return [...prev, pt];
        }
        return prev;
      });
      return;
    }

    // 4. Dragging a Draft Joint Vertex before finishing
    if (draggingDraftJointIdx !== null) {
      setDraftJointPoints((prev) =>
        prev.map((p, idx) => (idx === draggingDraftJointIdx ? pt : p))
      );
      return;
    }

    // 5. Dragging a Draft Lithology Vertex before closing
    if (draggingDraftLithologyIdx !== null) {
      setDraftLithologyPoints((prev) =>
        prev.map((p, idx) => (idx === draggingDraftLithologyIdx ? pt : p))
      );
      return;
    }

    // 6. Dragging Saved Lithology Vertex (Sections 7, 8, 13)
    if (draggingLithologyVertex) {
      const nextRegions = lithologyRegions.map((reg) => {
        if (reg.id !== draggingLithologyVertex.regionId) return reg;
        const nextPoly = reg.polygon.map((v, idx) =>
          idx === draggingLithologyVertex.vertexIndex
            ? { x: Number(pt.x.toFixed(3)), y: Number(pt.y.toFixed(3)) }
            : v
        );
        return {
          ...reg,
          polygon: nextPoly,
          polygonPoints: nextPoly,
        };
      });
      onUpdateLithologyRegions(nextRegions);
      return;
    }

    // 7. Dragging Whole Lithology Polygon on Canvas (Section 7)
    if (draggingWholeLithology) {
      const dx = pt.x - draggingWholeLithology.startMeters.x;
      const dy = pt.y - draggingWholeLithology.startMeters.y;
      const nextRegions = lithologyRegions.map((reg) => {
        if (reg.id !== draggingWholeLithology.regionId) return reg;
        const nextPoly = draggingWholeLithology.origPolygon.map((p) => ({
          x: Number((p.x + dx).toFixed(3)),
          y: Number((p.y + dy).toFixed(3)),
        }));
        return {
          ...reg,
          polygon: nextPoly,
          polygonPoints: nextPoly,
        };
      });
      onUpdateLithologyRegions(nextRegions);
      return;
    }

    // 8. Resizing Lithology Polygon via Bounding Box Handle on Canvas (Section 7)
    if (resizingLithologyRegion) {
      const { regionId, centroid, startDistX, startDistY, origPolygon } =
        resizingLithologyRegion;
      const curDistX = pt.x - centroid.x;
      const curDistY = pt.y - centroid.y;
      const sx =
        Math.abs(startDistX) > 0.05
          ? Math.max(0.2, Math.min(4.0, curDistX / startDistX))
          : 1;
      const sy =
        Math.abs(startDistY) > 0.05
          ? Math.max(0.2, Math.min(4.0, curDistY / startDistY))
          : 1;
      const nextRegions = lithologyRegions.map((reg) => {
        if (reg.id !== regionId) return reg;
        const nextPoly = origPolygon.map((p) => ({
          x: Number((centroid.x + (p.x - centroid.x) * sx).toFixed(3)),
          y: Number((centroid.y + (p.y - centroid.y) * sy).toFixed(3)),
        }));
        return {
          ...reg,
          polygon: nextPoly,
          polygonPoints: nextPoly,
        };
      });
      onUpdateLithologyRegions(nextRegions);
      return;
    }

    // 9. Dragging Joint Control Point (Sections 10 & 11)
    if (draggingVertex) {
      const updated = joints.map((j) => {
        if (j.id !== draggingVertex.jointId) return j;
        const nextGeom = j.geometry.map((v, idx) =>
          idx === draggingVertex.vertexIndex ? pt : v
        );
        const orient = calculateJointOrientation3D(
          nextGeom,
          j.surface,
          geometry,
          settings,
          j.orientationStatus,
          currentPhoto.calibration
        );
        return {
          ...j,
          geometry: nextGeom,
          points3D: orient.points3D,
          traceAngle: orient.traceAngle,
          localAnglesDeg: orient.localAnglesDeg,
          wavinessAngleDeg: orient.wavinessAngleDeg,
          terminationStart: orient.terminationStart,
          terminationEnd: orient.terminationEnd,
          apparentDip: orient.apparentDip,
          strike: orient.strike,
          dip: orient.dip,
          dipDirection: orient.dipDirection,
          persistenceMeters: orient.persistenceMeters,
          isCurved: orient.isCurved,
        };
      });
      onUpdateJointsWithHistory(updated);
      return;
    }

    // 10. Dragging Whole Joint on Canvas (Section 11)
    if (draggingWholeJoint) {
      const dx = pt.x - draggingWholeJoint.startMeters.x;
      const dy = pt.y - draggingWholeJoint.startMeters.y;
      const updated = joints.map((j) => {
        if (j.id !== draggingWholeJoint.jointId) return j;
        const shifted = draggingWholeJoint.origPoints.map((p) => ({
          x: Number((p.x + dx).toFixed(4)),
          y: Number((p.y + dy).toFixed(4)),
        }));
        const orient = calculateJointOrientation3D(
          shifted,
          j.surface,
          geometry,
          settings,
          j.orientationStatus,
          currentPhoto.calibration
        );
        return {
          ...j,
          geometry: shifted,
          points3D: orient.points3D,
        };
      });
      onUpdateJointsWithHistory(updated);
      return;
    }

    // 11. Dragging Photo Handles using Unified Coordinate System (Section 6)
    if (draggingPhotoHandle && svgCanvasRef.current) {
      const startProj = coordManager.screenToWorld(
        draggingPhotoHandle.startClientX,
        draggingPhotoHandle.startClientY
      );
      const dSvgX = worldProj.cx - startProj.cx;
      const dSvgY = worldProj.cy - startProj.cy;

      // Also compute delta in rotated/scaled photo UV space so handles track 1:1 under rotation/zoom!
      const startPhotoUV = coordManager.canvasToPhotoUV(
        startProj.cx,
        startProj.cy,
        draggingPhotoHandle.initialTransform
      );
      const currPhotoUV = coordManager.canvasToPhotoUV(
        worldProj.cx,
        worldProj.cy,
        draggingPhotoHandle.initialTransform
      );
      const dNormU = currPhotoUV.u - startPhotoUV.u;
      const dNormV = currPhotoUV.v - startPhotoUV.v;

      if (draggingPhotoHandle.type === 'move') {
        const dMetersX = dSvgX / pxPerMeter;
        const dMetersY = -dSvgY / pxPerMeter;
        const prevT = currentPhoto.transform;
        const nextT: SurfaceTransform = {
          ...prevT,
          offsetX: Number((draggingPhotoHandle.initialTransform.offsetX + dMetersX).toFixed(3)),
          offsetY: Number((draggingPhotoHandle.initialTransform.offsetY + dMetersY).toFixed(3)),
        };
        onUpdatePhotoSurface(activeSurface, (prev) => ({
          ...prev,
          transform: nextT,
        }));
        syncSurfaceFeaturesToPhotoTransform(prevT, nextT);
      } else if (
        draggingPhotoHandle.type === 'corner' &&
        typeof draggingPhotoHandle.cornerIndex === 'number'
      ) {
        const cIdx = draggingPhotoHandle.cornerIndex;
        onUpdatePhotoSurface(activeSurface, (prev) => {
          const nextCorners = [...draggingPhotoHandle.initialTransform.perspectiveCorners] as [
            Point2D,
            Point2D,
            Point2D,
            Point2D
          ];
          nextCorners[cIdx] = {
            x: Number(
              Math.max(-0.45, Math.min(0.45, nextCorners[cIdx].x + dNormU)).toFixed(3)
            ),
            y: Number(
              Math.max(-0.45, Math.min(0.45, nextCorners[cIdx].y + dNormV)).toFixed(3)
            ),
          };
          return {
            ...prev,
            transform: {
              ...prev.transform,
              perspectiveCorners: nextCorners,
              homographyMatrix: solveProjectiveHomography3x3(nextCorners),
            },
          };
        });
      } else if (
        draggingPhotoHandle.type === 'edge' &&
        typeof draggingPhotoHandle.edgeIndex === 'number'
      ) {
        const eIdx = draggingPhotoHandle.edgeIndex;
        onUpdatePhotoSurface(activeSurface, (prev) => {
          const baseEdges = draggingPhotoHandle.initialTransform.edgeOffsets || [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ];
          const nextEdges = [
            { ...baseEdges[0] },
            { ...baseEdges[1] },
            { ...baseEdges[2] },
            { ...baseEdges[3] },
          ] as [Point2D, Point2D, Point2D, Point2D];
          nextEdges[eIdx] = {
            x: Number(Math.max(-0.35, Math.min(0.35, nextEdges[eIdx].x + dNormU)).toFixed(3)),
            y: Number(Math.max(-0.35, Math.min(0.35, nextEdges[eIdx].y + dNormV)).toFixed(3)),
          };
          return {
            ...prev,
            transform: {
              ...prev.transform,
              edgeOffsets: nextEdges,
            },
          };
        });
      } else if (draggingPhotoHandle.type === 'mesh_cp' && draggingPhotoHandle.cpId) {
        const targetId = draggingPhotoHandle.cpId;
        onUpdatePhotoSurface(activeSurface, (prev) => {
          const baseMesh =
            draggingPhotoHandle.initialTransform.meshControlPoints ||
            createDefaultMeshControlPoints(3, 3);
          const nextMesh = baseMesh.map((cp) =>
            cp.id === targetId
              ? {
                  ...cp,
                  dstU: Number(Math.max(-0.25, Math.min(1.25, cp.dstU + dNormU)).toFixed(4)),
                  dstV: Number(Math.max(-0.25, Math.min(1.25, cp.dstV + dNormV)).toFixed(4)),
                }
              : cp
          );
          return {
            ...prev,
            transform: {
              ...prev.transform,
              meshControlPoints: nextMesh,
            },
          };
        });
      } else if (
        draggingPhotoHandle.type === 'mask_vertex' &&
        typeof draggingPhotoHandle.maskVertexIndex === 'number'
      ) {
        const vIdx = draggingPhotoHandle.maskVertexIndex;
        onUpdatePhotoSurface(activeSurface, (prev) => {
          const basePts = prev.transform.customMaskPoints || [];
          const nextPts = basePts.map((p, idx) => (idx === vIdx ? pt : p));
          return {
            ...prev,
            transform: {
              ...prev.transform,
              useCustomMask: true,
              customMaskPoints: nextPts,
            },
          };
        });
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (isFreehandDrawingJoint) {
      setIsFreehandDrawingJoint(false);
      if (draftJointPoints.length >= 2) {
        finishDraftJoint(draftJointPoints);
      } else {
        setDraftJointPoints([]);
      }
    }
    setDraggingCanvasPan(null);
    setDraggingControlPointId(null);
    setDraggingSymbolId(null);
    setRotatingSymbolState(null);
    setScalingSymbolState(null);
    setDraggingDraftJointIdx(null);
    setDraggingDraftLithologyIdx(null);
    setDraggingVertex(null);
    setDraggingWholeJoint(null);
    setDraggingPhotoHandle(null);
    setDraggingLithologyVertex(null);
    setDraggingWholeLithology(null);
    setResizingLithologyRegion(null);
  };

  // Global window mouseup safety so dragging never gets stuck if user releases outside SVG
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setDraggingCanvasPan(null);
      setDraggingControlPointId(null);
      setDraggingSymbolId(null);
      setRotatingSymbolState(null);
      setScalingSymbolState(null);
      setDraggingDraftJointIdx(null);
      setDraggingDraftLithologyIdx(null);
      setDraggingVertex(null);
      setDraggingWholeJoint(null);
      setDraggingPhotoHandle(null);
      setDraggingLithologyVertex(null);
      setDraggingWholeLithology(null);
      setResizingLithologyRegion(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Vector Trace Operations (Sections 10 & 11):
  // Delete, Extend, Shorten, Add Vertex, Delete Vertex, Smooth Curve, Re-draw, Split, Join, Accept/Confirm
  const handleDeleteSelectedJoint = () => {
    if (!selectedJoint) return;
    onRecordRejectedJoint(selectedJoint);
    onUpdateJointsWithHistory(joints.filter((j) => j.id !== selectedJoint.id));
    setSelectedJointId(null);
    setSelectedJointVertexIdx(null);
  };

  const handleDeleteSelectedJointVertex = (vertexIdxToDelete?: number) => {
    if (!selectedJoint || selectedJoint.geometry.length <= 2) return;
    const targetIdx =
      vertexIdxToDelete !== undefined
        ? vertexIdxToDelete
        : selectedJointVertexIdx !== null
        ? selectedJointVertexIdx
        : selectedJoint.geometry.length - 1;
    const nextGeom = selectedJoint.geometry.filter((_, idx) => idx !== targetIdx);
    const orient = calculateJointOrientation3D(
      nextGeom,
      selectedJoint.surface,
      geometry,
      settings,
      selectedJoint.orientationStatus,
      currentPhoto.calibration
    );
    onUpdateJointsWithHistory(
      joints.map((j) =>
        j.id === selectedJoint.id
          ? {
              ...j,
              geometry: nextGeom,
              points3D: orient.points3D,
              traceAngle: orient.traceAngle,
              localAnglesDeg: orient.localAnglesDeg,
              wavinessAngleDeg: orient.wavinessAngleDeg,
              persistenceMeters: orient.persistenceMeters,
            }
          : j
      )
    );
    setSelectedJointVertexIdx(null);
  };

  const handleSmoothSelectedJointCurve = () => {
    if (!selectedJoint || selectedJoint.geometry.length < 3) return;
    const smoothed = evaluateCatmullRomSplineThroughPoints(selectedJoint.geometry, 2);
    const orient = calculateJointOrientation3D(
      smoothed,
      selectedJoint.surface,
      geometry,
      settings,
      selectedJoint.orientationStatus,
      currentPhoto.calibration
    );
    onUpdateJointsWithHistory(
      joints.map((j) =>
        j.id === selectedJoint.id
          ? {
              ...j,
              geometry: smoothed,
              points3D: orient.points3D,
              localAnglesDeg: orient.localAnglesDeg,
              wavinessAngleDeg: orient.wavinessAngleDeg,
              persistenceMeters: orient.persistenceMeters,
              isCurved: true,
            }
          : j
      )
    );
  };

  // Snap selected joint polyline directly onto the strongest local rock fracture valley via Dijkstra Geodesic Ridge Snapping
  const handleSnapSelectedJointToRockRidge = () => {
    if (!selectedJoint || !activePhotoRidgeField) return;
    const snapped = snapWorldPolylineToPhotoRidge(
      selectedJoint.geometry,
      activePhotoRidgeField,
      selectedJoint.surface,
      geometry,
      settings,
      currentPhoto.transform
    );
    const clipped = clipPolylineToSurface(
      snapped.snappedWorldPoints,
      selectedJoint.surface,
      geometry,
      settings
    );
    if (clipped.length < 2) return;

    const hasStereo =
      Boolean(currentPhoto.stereoImage) || (currentPhoto.supportingPhotos?.length || 0) > 0;
    const orient = calculateJointOrientation3D(
      clipped,
      selectedJoint.surface,
      geometry,
      settings,
      selectedJoint.orientationStatus,
      currentPhoto.calibration,
      0.95,
      0.94,
      undefined,
      hasStereo,
      snapped.reliefDepthMeters.slice(0, clipped.length)
    );

    const bartonProfile = computeBartonJRCProfileForPoints(
      clipped,
      snapped.reliefDepthMeters.slice(0, clipped.length),
      selectedJoint.featureType,
      orient.wavinessAngleDeg
    );
    const terzaghiWeight = computeTerzaghiWeight(
      orient.dip,
      orient.dipDirection,
      selectedJoint.surface,
      settings.driveDirection,
      geometry
    );

    onUpdateJointsWithHistory(
      joints.map((j) =>
        j.id === selectedJoint.id
          ? {
              ...j,
              geometry: clipped,
              vertexWidths: snapped.vertexWidths.slice(0, clipped.length),
              reliefDepthMeters: snapped.reliefDepthMeters.slice(0, clipped.length),
              jrcValue: bartonProfile.jrcNFieldScale,
              z2RootMeanSquare: bartonProfile.z2RmsDerivative,
              roughnessProfileIndexRp: bartonProfile.rpRoughnessIndex,
              subPixelResidualPx: 0.12,
              terzaghiWeight,
              jcsStrengthMPa: bartonProfile.jcsMPa,
              roughness: bartonProfile.isrmRoughnessClass,
              points3D: orient.points3D,
              traceAngle: orient.traceAngle,
              localAnglesDeg: orient.localAnglesDeg,
              wavinessAngleDeg: orient.wavinessAngleDeg,
              apparentDip: orient.apparentDip,
              strike: orient.strike,
              dip: orient.dip,
              dipDirection: orient.dipDirection,
              persistenceMeters: orient.persistenceMeters,
              isCurved: orient.isCurved,
              confidenceBreakdown: orient.confidenceBreakdown,
            }
          : j
      )
    );
    onUpdateStatusMessage?.(
      `Snapped ${selectedJoint.jointNumber || selectedJoint.set} (${clipped.length} pts) to sub-pixel Steger ridge (JRCn=${bartonProfile.jrcNFieldScale}, Z2=${bartonProfile.z2RmsDerivative}).`
    );
  };

  const handleRefineAllActiveSurfaceTraces = () => {
    if (!activePhotoRidgeField) return;
    const hasStereo =
      Boolean(currentPhoto.stereoImage) || (currentPhoto.supportingPhotos?.length || 0) > 0;
    let refinedCount = 0;

    const updatedJoints = joints.map((j) => {
      if (j.surface !== activeSurface || j.geometry.length < 2) return j;
      const snapped = snapWorldPolylineToPhotoRidge(
        j.geometry,
        activePhotoRidgeField,
        activeSurface,
        geometry,
        settings,
        currentPhoto.transform
      );
      const clipped = clipPolylineToSurface(
        snapped.snappedWorldPoints,
        activeSurface,
        geometry,
        settings
      );
      if (clipped.length < 2) return j;

      const orient = calculateJointOrientation3D(
        clipped,
        activeSurface,
        geometry,
        settings,
        j.orientationStatus,
        currentPhoto.calibration,
        0.96,
        0.95,
        undefined,
        hasStereo,
        snapped.reliefDepthMeters.slice(0, clipped.length)
      );
      const barton = computeBartonJRCProfileForPoints(
        clipped,
        snapped.reliefDepthMeters.slice(0, clipped.length),
        j.featureType,
        orient.wavinessAngleDeg
      );
      const wT = computeTerzaghiWeight(
        orient.dip,
        orient.dipDirection,
        activeSurface,
        settings.driveDirection,
        geometry
      );
      refinedCount++;
      return {
        ...j,
        geometry: clipped,
        vertexWidths: snapped.vertexWidths.slice(0, clipped.length),
        reliefDepthMeters: snapped.reliefDepthMeters.slice(0, clipped.length),
        jrcValue: barton.jrcNFieldScale,
        z2RootMeanSquare: barton.z2RmsDerivative,
        roughnessProfileIndexRp: barton.rpRoughnessIndex,
        subPixelResidualPx: 0.12,
        terzaghiWeight: wT,
        jcsStrengthMPa: barton.jcsMPa,
        roughness: barton.isrmRoughnessClass,
        points3D: orient.points3D,
        traceAngle: orient.traceAngle,
        localAnglesDeg: orient.localAnglesDeg,
        wavinessAngleDeg: orient.wavinessAngleDeg,
        apparentDip: orient.apparentDip,
        strike: orient.strike,
        dip: orient.dip,
        dipDirection: orient.dipDirection,
        persistenceMeters: orient.persistenceMeters,
        isCurved: orient.isCurved,
        confidenceBreakdown: orient.confidenceBreakdown,
      };
    });

    if (refinedCount > 0) {
      onUpdateJointsWithHistory(updatedJoints);
      onUpdateStatusMessage?.(
        `Photogrammetric Sub-Pixel Refinement: Locked ${refinedCount} traces on ${activeSurface} via Steger parabolic ridge + 3D SVD + Barton JRC.`
      );
    }
  };

  const handleAddVertexToSelectedJoint = (insertAfterSegIdx?: number, customPt?: Point2D) => {
    if (!selectedJoint || selectedJoint.geometry.length < 2) return;
    const pts = selectedJoint.geometry;
    let targetSegIdx = insertAfterSegIdx ?? 0;
    if (insertAfterSegIdx === undefined) {
      let maxLen = -1;
      for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (len > maxLen) {
          maxLen = len;
          targetSegIdx = i;
        }
      }
    }
    const midPt: Point2D = customPt || {
      x: Number(((pts[targetSegIdx].x + pts[targetSegIdx + 1].x) / 2).toFixed(4)),
      y: Number(((pts[targetSegIdx].y + pts[targetSegIdx + 1].y) / 2).toFixed(4)),
    };
    const nextGeom = [
      ...pts.slice(0, targetSegIdx + 1),
      midPt,
      ...pts.slice(targetSegIdx + 1),
    ];
    onUpdateJointsWithHistory(
      joints.map((j) => (j.id === selectedJoint.id ? { ...j, geometry: nextGeom } : j))
    );
    setSelectedJointVertexIdx(targetSegIdx + 1);
  };

  const handleScaleSelectedJointLength = (factor: number) => {
    if (!selectedJoint || selectedJoint.geometry.length < 2) return;
    const pts = selectedJoint.geometry;
    const mid = pts[Math.floor(pts.length / 2)];
    const scaledPts = pts.map((p) => ({
      x: Number((mid.x + (p.x - mid.x) * factor).toFixed(3)),
      y: Number((mid.y + (p.y - mid.y) * factor).toFixed(3)),
    }));
    const clipped = clipPolylineToSurface(scaledPts, activeSurface, geometry, settings);
    if (clipped.length < 2) return;
    const orient = calculateJointOrientation3D(
      clipped,
      activeSurface,
      geometry,
      settings,
      selectedJoint.orientationStatus,
      currentPhoto.calibration
    );
    onUpdateJointsWithHistory(
      joints.map((j) =>
        j.id === selectedJoint.id
          ? {
              ...j,
              geometry: clipped,
              points3D: orient.points3D,
              persistenceMeters: orient.persistenceMeters,
            }
          : j
      )
    );
  };

  const handleSplitSelectedJoint = () => {
    if (!selectedJoint || selectedJoint.geometry.length < 2) return;
    const pts = selectedJoint.geometry;
    let part1: Point2D[] = [];
    let part2: Point2D[] = [];

    if (pts.length === 2) {
      const mid = {
        x: Number(((pts[0].x + pts[1].x) / 2).toFixed(3)),
        y: Number(((pts[0].y + pts[1].y) / 2).toFixed(3)),
      };
      part1 = [
        pts[0],
        {
          x: Number((pts[0].x + (mid.x - pts[0].x) * 0.92).toFixed(3)),
          y: Number((pts[0].y + (mid.y - pts[0].y) * 0.92).toFixed(3)),
        },
      ];
      part2 = [
        {
          x: Number((mid.x + (pts[1].x - mid.x) * 0.08).toFixed(3)),
          y: Number((mid.y + (pts[1].y - mid.y) * 0.08).toFixed(3)),
        },
        pts[1],
      ];
    } else {
      const splitIdx = Math.floor(pts.length / 2);
      part1 = pts.slice(0, splitIdx + 1);
      part2 = pts.slice(splitIdx);
    }

    const o1 = calculateJointOrientation3D(part1, activeSurface, geometry, settings);
    const o2 = calculateJointOrientation3D(part2, activeSurface, geometry, settings);

    const j1: Joint = {
      ...selectedJoint,
      id: `${selectedJoint.id}-a`,
      geometry: part1,
      points3D: o1.points3D,
      persistenceMeters: o1.persistenceMeters,
    };
    const j2: Joint = {
      ...selectedJoint,
      id: `${selectedJoint.id}-b`,
      geometry: part2,
      points3D: o2.points3D,
      persistenceMeters: o2.persistenceMeters,
    };

    onUpdateJointsWithHistory(
      joints.flatMap((j) => (j.id === selectedJoint.id ? [j1, j2] : [j]))
    );
    setSelectedJointId(j1.id);
  };

  const handleJoinWithJoint = (otherJoint: Joint) => {
    if (!selectedJoint || selectedJoint.id === otherJoint.id) return;
    const mergedPts = [...selectedJoint.geometry, ...otherJoint.geometry];
    const orient = calculateJointOrientation3D(mergedPts, activeSurface, geometry, settings);

    const merged: Joint = {
      ...selectedJoint,
      geometry: mergedPts,
      points3D: orient.points3D,
      traceAngle: orient.traceAngle,
      apparentDip: orient.apparentDip,
      strike: orient.strike,
      dip: orient.dip,
      dipDirection: orient.dipDirection,
      persistenceMeters: orient.persistenceMeters,
    };

    onUpdateJointsWithHistory(
      joints
        .filter((j) => j.id !== otherJoint.id)
        .map((j) => (j.id === selectedJoint.id ? merged : j))
    );
    setJoinTargetMode(false);
  };

  const handleConfirmSelectedJoint = () => {
    if (!selectedJoint) return;
    const confirmed: Joint = {
      ...selectedJoint,
      accepted: true,
      orientationStatus: 'DIRECTLY_MEASURED',
      confidence: 'High',
      confidenceScore: 0.98,
    };
    onRecordConfirmedJoint(confirmed);

    // Session Learning (Section 10): also update nearby traces of similar orientation on this surface
    const updated = joints.map((j) => {
      if (j.id === confirmed.id) return confirmed;
      if (
        j.surface === confirmed.surface &&
        Math.min(
          Math.abs(j.traceAngle - confirmed.traceAngle),
          180 - Math.abs(j.traceAngle - confirmed.traceAngle)
        ) <= 12
      ) {
        return {
          ...j,
          set: confirmed.set,
          dip: confirmed.dip,
          dipDirection: confirmed.dipDirection,
          strike: confirmed.strike,
          orientationStatus: 'DIRECTLY_MEASURED' as const,
        };
      }
      return j;
    });
    onUpdateJointsWithHistory(updated);
  };

  // Compute CSS/SVG transform for the active photograph inside the tunnel geometry
  const photoSvgTransform = useMemo(
    () => coordManager.getPhotoSvgTransform(),
    [coordManager]
  );

  // Measure tool distance & angle
  const measurementInfo = useMemo(() => {
    if (measurePts.length < 2) return null;
    const [p1, p2] = measurePts;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    let ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    if (ang < 0) ang += 180;
    return {
      distMeters: dist.toFixed(2),
      angleDeg: ang.toFixed(1),
    };
  }, [measurePts]);

  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Compute Rock Support Pattern Overlay (Radial Bolts + SFRS Ring + BOQ)
  const rockSupportOverlay = useMemo(() => {
    const qVal = Number(
      (
        ((qIndexParams.rqd || 70) / Math.max(0.5, qIndexParams.jn || 9)) *
        ((qIndexParams.jr || 1.5) / Math.max(0.5, qIndexParams.ja || 2)) *
        ((qIndexParams.jw || 1.0) / Math.max(0.5, qIndexParams.srf || 1.0))
      ).toFixed(2)
    );
    return computeRockSupportPatternOverlay(
      geometry,
      supportConfig,
      settings.roundLength || 3.5,
      qVal
    );
  }, [geometry, supportConfig, settings.roundLength, qIndexParams]);

  // Compute AutoCAD Object Snap (OSNAP - F3) Candidate near Cursor (Endpoint □ / Midpoint △)
  const activeOsnapCandidate = useMemo<{
    point: Point2D;
    cx: number;
    cy: number;
    type: 'ENDPOINT' | 'MIDPOINT';
    dist: number;
  } | null>(() => {
    if (!cadOsnapEnabled || !cursorMeters) return null;
    const snapTolMeters = Math.max(0.18, 12 / Math.max(20, pxPerMeter * viewport.zoom));
    let best: {
      point: Point2D;
      cx: number;
      cy: number;
      type: 'ENDPOINT' | 'MIDPOINT';
      dist: number;
    } | null = null;

    const checkPoint = (pt: Point2D, type: 'ENDPOINT' | 'MIDPOINT') => {
      const d = Math.hypot(pt.x - cursorMeters.x, pt.y - cursorMeters.y);
      if (d <= snapTolMeters && (!best || d < best.dist)) {
        const scr = coordManager.worldToScreen(pt);
        best = { point: pt, cx: scr.cx, cy: scr.cy, type, dist: d };
      }
    };

    // 1. Tunnel Boundary Vertices & Midpoints on Face
    if (activeSurface === 'face') {
      const bPts = geometry.crossSectionPoints || [];
      for (let i = 0; i < bPts.length; i++) {
        const a = bPts[i];
        const b = bPts[(i + 1) % bPts.length];
        checkPoint(a, 'ENDPOINT');
        checkPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'MIDPOINT');
      }
    }

    // 2. Active Surface Joint Trace Endpoints & Midpoints
    for (const j of surfaceJoints) {
      if (j.geometry.length >= 2) {
        const first = j.geometry[0];
        const last = j.geometry[j.geometry.length - 1];
        const mid = j.geometry[Math.floor(j.geometry.length / 2)];
        checkPoint(first, 'ENDPOINT');
        checkPoint(last, 'ENDPOINT');
        checkPoint(mid, 'MIDPOINT');
      }
    }

    // 3. Survey Control Points
    for (const cp of surfaceControlPoints) {
      checkPoint(cp.point, 'ENDPOINT');
    }

    return best;
  }, [
    cadOsnapEnabled,
    cursorMeters,
    pxPerMeter,
    viewport.zoom,
    activeSurface,
    geometry.crossSectionPoints,
    surfaceJoints,
    surfaceControlPoints,
    coordManager,
  ]);

  // Compute AutoCAD Dynamic Input (DYN - F12) Length & Angle Readout while Drawing / Measuring
  const dynamicInputReadout = useMemo(() => {
    if (!cadDynInputEnabled || !cursorMeters || !cursorCanvasPx) return null;
    let refPt: Point2D | null = null;
    if (
      (activeTool === 'add_joint' ||
        activeTool === 'redraw_joint' ||
        activeTool === 'append_joint') &&
      draftJointPoints.length > 0
    ) {
      refPt = draftJointPoints[draftJointPoints.length - 1];
    } else if (activeTool === 'lithology' && draftLithologyPoints.length > 0) {
      refPt = draftLithologyPoints[draftLithologyPoints.length - 1];
    } else if (activeTool === 'measure' && measurePts.length === 1) {
      refPt = measurePts[0];
    }
    if (!refPt) return null;
    const dx = cursorMeters.x - refPt.x;
    const dy = cursorMeters.y - refPt.y;
    const len = Math.hypot(dx, dy);
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const refScreen = coordManager.worldToScreen(refPt);
    return {
      lenMeters: len.toFixed(2),
      angleDeg: ang.toFixed(1),
      refCx: refScreen.cx,
      refCy: refScreen.cy,
    };
  }, [
    cadDynInputEnabled,
    cursorMeters,
    cursorCanvasPx,
    activeTool,
    draftJointPoints,
    draftLithologyPoints,
    measurePts,
    coordManager,
  ]);

  // Execute ESWACAD command from Command Line or Shortcut
  const handleExecuteCadCommand = (rawCmd: string) => {
    const cmd = rawCmd.trim().toUpperCase();
    if (!cmd) return;
    if (cmd === 'JOINT' || cmd === 'LINE' || cmd === 'PLINE' || cmd === 'PL' || cmd === 'J') {
      setDraftJointPoints([]);
      setJointDrawMode('magnetic_livewire');
      setActiveTool('add_joint');
      onUpdateStatusMessage?.('ESWACAD Command: JOINT (Magnetic Live-Wire Crack Tracer active).');
    } else if (cmd === '1CLICK' || cmd === 'SEED' || cmd === 'CRACK') {
      setDraftJointPoints([]);
      setJointDrawMode('seed_autotrace');
      setActiveTool('add_joint');
      onUpdateStatusMessage?.('ESWACAD Command: 1CLICK (1-Click Seed Crack Auto-Trace active).');
    } else if (cmd === 'SPLINE' || cmd === 'SPL') {
      setDraftJointPoints([]);
      setJointDrawMode('smooth_curve');
      setActiveTool('add_joint');
      onUpdateStatusMessage?.('ESWACAD Command: SPLINE (Smooth Catmull-Rom Spline Tracer active).');
    } else if (cmd === 'AITRACE' || cmd === 'AI') {
      onRunAITrace();
    } else if (cmd === 'FIT' || cmd === 'WARP' || cmd === 'PHOTOFIT') {
      setInitialTransformSnapshot(currentPhoto.transform);
      setTransformPast([]);
      setTransformFuture([]);
      setActiveTool('photo_fit');
      onUpdateStatusMessage?.('ESWACAD Command: PHOTOFIT (Perspective & Mesh Warp active).');
    } else if (cmd === 'XRAY') {
      setShowCrackXRayOverlay((prev) => {
        const next = !prev;
        if (next) setShowDepthReliefOverlay(false);
        return next;
      });
    } else if (cmd === 'RELIEF' || cmd === '3DRELIEF') {
      setShowDepthReliefOverlay((prev) => {
        const next = !prev;
        if (next) setShowCrackXRayOverlay(false);
        return next;
      });
    } else if (cmd === 'LITH' || cmd === 'LITHOLOGY' || cmd === 'HATCH') {
      setActiveTool('lithology');
    } else if (cmd === 'CP' || cmd === 'POINT') {
      setActiveTool('control_point');
    } else if (cmd === 'OVERBREAK' || cmd === 'OB' || cmd === 'AREA') {
      setActiveTool('overbreak');
      setLayerVisibility((prev) => ({ ...prev, overbreakUndercut: true }));
    } else if (cmd === 'SYMBOL' || cmd === 'SYM' || cmd === 'INSERT') {
      setActiveTool('geological_symbol');
    } else if (cmd === 'DIST' || cmd === 'MEASURE' || cmd === 'DI') {
      setMeasurePts([]);
      setActiveTool('measure');
    } else if (cmd === 'DIP' || cmd === 'STRIKE') {
      setActiveTool('dip_probe');
    } else if (cmd === '3D' || cmd === 'WEDGE' || cmd === 'KINEMATICS' || cmd === 'STEREONET') {
      setShowPhotogrammetryModal(true);
    } else if (cmd === 'TABLE' || cmd === 'TABLES') {
      setGeologyDrawerTab('geology_tables');
      setShowSetTableDrawer(true);
      setShowAILearningDrawer(false);
    } else if (cmd === 'Q' || cmd === 'RMR' || cmd === 'GSI' || cmd === 'CLASS') {
      setGeologyDrawerTab('q_index');
      setShowSetTableDrawer(true);
      setShowAILearningDrawer(false);
    } else if (cmd === 'PLOT' || cmd === 'SHEET' || cmd === 'EXPORT') {
      onOpenExportSheet('FINAL_ENGINEERING_SHEET');
    } else if (cmd === 'PROFILE' || cmd === 'TUNNEL') {
      onOpenCustomProfileEditor?.();
    } else if (cmd === 'ZOOM' || cmd === 'ZE' || cmd === '1:1') {
      setViewport({ zoom: 1, panX: 0, panY: 0 });
    } else if (cmd === 'PAN' || cmd === 'P') {
      setIsSpacePanning((prev) => !prev);
    } else if (cmd === 'U' || cmd === 'UNDO') {
      handleUndoLithology();
    } else if (cmd === 'REDO') {
      handleRedoLithology();
    } else if (cmd === 'ERASE' || cmd === 'DEL' || cmd === 'DELETE' || cmd === 'E') {
      if (selectedControlPointId) handleDeleteControlPoint(selectedControlPointId);
      else if (selectedSymbolId) handleDeletePlacedSymbol(selectedSymbolId);
      else if (selectedJoint) handleDeleteSelectedJoint();
    } else if (cmd === 'PROPS' || cmd === 'PR' || cmd === 'PROPERTIES') {
      setShowCadPropertiesAlways((p) => !p);
    } else if (cmd === 'SUPPORT' || cmd === 'BOLT' || cmd === 'BOLTS' || cmd === 'SFRS') {
      setShowRockSupportModal(true);
    } else if (cmd === 'UNFOLD' || cmd === 'ROLLOUT' || cmd === 'DEVELOPED') {
      setShowUnfoldedRolloutModal(true);
    } else if (cmd === 'SHEETSET' || cmd === 'SSM' || cmd === 'BATCH') {
      setShowSheetSetModal(true);
    } else if (cmd === 'OSNAP' || cmd === 'F3') {
      setCadOsnapEnabled((prev) => !prev);
    } else if (cmd === 'DYN' || cmd === 'F12') {
      setCadDynInputEnabled((prev) => !prev);
    } else {
      onUpdateStatusMessage?.(
        `Unknown ESWACAD command "${cmd}". Try: JOINT, SPLINE, 1CLICK, AITRACE, PHOTOFIT, LITH, CP, OVERBREAK, SUPPORT, UNFOLD, SHEETSET, 3D, Q, PLOT, OSNAP.`
      );
    }
    setCadCommandInput('');
  };

  return (
    <div
      className={`flex flex-col h-dvh w-full max-w-full max-h-dvh overflow-hidden select-none ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0B0E14] text-slate-100'
      }`}
    >
      {/* ====================================================================
          SLEEK ARCHITECTURAL CAD HEADER & CONTEXTUAL SINGLE-LINE TOOL STRIP
         ==================================================================== */}
      <header className="flex flex-col bg-[#0D121C] border-b border-slate-800/90 shrink-0">
        {/* TOP ROW: Brand Identity + Quick Access + Clean Category Tabs + Workspace Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#0A0E17] border-b border-slate-800/80">
          {/* Left: Back + Brand Emblem + Quick Access */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onBackToSetup}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 font-mono text-[11px] font-medium rounded-lg border border-slate-700/80 transition-colors cursor-pointer"
              title="Return to Project & Tunnel Geometry Setup"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Setup</span>
            </button>

            <EswaTunnelLogo size="xs" variant="inline" showBadge={false} />

            {/* Compact Quick Access Bar */}
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-900/90 border border-slate-800 rounded-lg">
              <button
                onClick={onSaveOfflineDraft}
                title="Save Field Draft Locally"
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:text-white hover:bg-slate-800 rounded-md cursor-pointer"
              >
                <Save className="w-3 h-3 text-cyan-400" />
                <span className="hidden md:inline">Save</span>
              </button>
              <button
                onClick={() => onOpenProjectMemoryModal('projects')}
                title="Project & Chainage Database"
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono text-cyan-300 hover:text-white hover:bg-slate-800 rounded-md cursor-pointer"
              >
                <Database className="w-3 h-3 text-cyan-400" />
                <span className="hidden md:inline">Projects</span>
              </button>
              <div className="h-3 w-px bg-slate-800 mx-0.5" />
              <button
                onClick={handleUndoLithology}
                disabled={
                  lithologyPast.length === 0 &&
                  controlPointPast.length === 0 &&
                  symbolPast.length === 0 &&
                  !canUndo
                }
                className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 rounded-md cursor-pointer"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRedoLithology}
                disabled={
                  lithologyFuture.length === 0 &&
                  controlPointFuture.length === 0 &&
                  symbolFuture.length === 0 &&
                  !canRedo
                }
                className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 rounded-md cursor-pointer"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (selectedControlPointId) handleDeleteControlPoint(selectedControlPointId);
                  else if (selectedSymbolId) handleDeletePlacedSymbol(selectedSymbolId);
                  else if (selectedJoint) handleDeleteSelectedJoint();
                }}
                disabled={!selectedJoint && !selectedControlPointId && !selectedSymbolId}
                className="p-1 text-slate-300 hover:text-rose-300 hover:bg-rose-950/60 disabled:opacity-30 rounded-md cursor-pointer"
                title="Delete Selected Object (Del)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Clean Segmented Ribbon Category Tabs (Each tab shows ONLY its own focused tools) */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/90 border border-slate-800 rounded-lg">
              {(
                [
                  { id: 'HOME', label: '1. Core Mapping' },
                  { id: 'TUNNEL_PHOTO', label: '2. Photo & Profile' },
                  { id: 'GEOLOGY_3D', label: '3. Geology & 3D' },
                  { id: 'SURVEY_OVERBREAK', label: '4. Survey & Support' },
                  { id: 'CLASSIFICATION_SHEET', label: '5. Tables & Output' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setCadRibbonTab(tab.id);
                    setCadRibbonCollapsed(false);
                  }}
                  className={`px-2.5 py-1 text-[10px] font-mono font-semibold rounded-md transition-all cursor-pointer ${
                    cadRibbonTab === tab.id && !cadRibbonCollapsed
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCadRibbonCollapsed((p) => !p)}
                className="px-1.5 py-1 text-[10px] font-mono text-slate-400 hover:text-white rounded-md cursor-pointer"
                title="Collapse / Expand Toolbar"
              >
                {cadRibbonCollapsed ? '▼' : '▲'}
              </button>
            </div>
          </div>

          {/* Right: Primary 3D Strip Workspace Button + Active DWG Info + Layers + Props + Theme */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenProjectMemoryModal('continuous_3d_log')}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[11px] font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
              title="Open 3D Strip Workspace & Entire Project Multi-Tunnel Network CAD"
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Strip CAD</span>
            </button>

            <span className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg font-mono text-[10px] text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <strong className="text-cyan-300">
                {settings.locationName || settings.tunnelName || 'Tunnel'} · {settings.chainage || 'CH 0+000'}
              </strong>
              <span className="text-slate-600">|</span>
              <span>
                {geometry.width.toFixed(1)}×{geometry.height.toFixed(1)}m
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-amber-300">
                N{String(Math.round(settings.driveDirection)).padStart(3, '0')}°E
              </span>
            </span>

            {/* Vector Layer Manager Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowLayerMenu((prev) => !prev)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded-lg border transition-colors cursor-pointer ${
                  showLayerMenu
                    ? 'bg-cyan-600 text-white border-cyan-400'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
                title="Layer Visibility Manager"
              >
                <Layers className="w-3 h-3 text-cyan-400" />
                <span className="hidden sm:inline">Layers</span>
              </button>
              {showLayerMenu && (
                <div className="absolute right-0 mt-1.5 w-60 p-2.5 bg-[#121824] border border-cyan-500/50 rounded-lg shadow-2xl z-50 text-xs font-mono space-y-1.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1 text-[10px] text-cyan-400 font-bold">
                    <span>ESWACAD LAYER MANAGER</span>
                    <button
                      onClick={() => setShowLayerMenu(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  {(
                    [
                      { key: 'photo', label: '0_PHOTO_BASE' },
                      { key: 'lithology', label: 'G_LITHOLOGY_HATCH' },
                      { key: 'overbreakUndercut', label: 'S_OVERBREAK_ASBUILT' },
                      { key: 'controlPoints', label: 'S_SURVEY_CTRL_PTS' },
                      { key: 'joints', label: 'G_JOINTS_J1_J5' },
                      { key: 'fractures', label: 'G_FRACTURES' },
                      { key: 'faults', label: 'G_FAULTS_SHEARS_F1' },
                      { key: 'bedding', label: 'G_BEDDING_J0' },
                      { key: 'foliation', label: 'G_FOLIATION' },
                      { key: 'otherStructures', label: 'G_VEINS_WATER' },
                      { key: 'annotations', label: 'A_DIP_LABELS' },
                    ] as { key: keyof VectorLayerVisibility; label: string }[]
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between py-0.5 text-[10px] text-slate-200 cursor-pointer hover:text-cyan-300"
                    >
                      <span>{item.label}</span>
                      <input
                        type="checkbox"
                        checked={layerVisibility[item.key]}
                        onChange={(e) =>
                          setLayerVisibility((prev) => ({
                            ...prev,
                            [item.key]: e.target.checked,
                          }))
                        }
                        className="rounded-xs border-slate-700 bg-slate-800 text-cyan-500"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCadPropertiesAlways((p) => !p)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded-lg border cursor-pointer ${
                showCadPropertiesAlways
                  ? 'bg-cyan-950/90 text-cyan-200 border-cyan-500/60 font-semibold'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
              title="Toggle Properties Inspector Dock"
            >
              <Sliders className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Inspector</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setInspectorDockSide((s) => (s === 'right' ? 'left' : 'right'))
              }
              className="hidden md:flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg cursor-pointer"
              title="Dock Inspector Left or Right"
            >
              {inspectorDockSide === 'right' ? (
                <PanelLeft className="w-3 h-3 text-amber-400" />
              ) : (
                <PanelRight className="w-3 h-3 text-amber-400" />
              )}
            </button>

            <ThemeToggleButton compact />
          </div>
        </div>

        {/* ====================================================================
            CLEAN SINGLE-LINE CONTEXTUAL TOOLBAR (Shows ONLY active tab's tools)
           ==================================================================== */}
        {!cadRibbonCollapsed && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-[#111724] text-[11px]">
            {/* TAB 1: HOME (Essential Everyday Workflow Only — Clean & Uncluttered) */}
            {cadRibbonTab === 'HOME' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/90 hover:bg-slate-700 text-cyan-200 rounded-md border border-slate-700 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  {currentPhoto.image ? 'Replace Photo' : 'Upload Photo'}
                </button>

                <button
                  onClick={() => {
                    if (activeTool !== 'photo_fit') {
                      setInitialTransformSnapshot(currentPhoto.transform);
                      setTransformPast([]);
                      setTransformFuture([]);
                      setActiveTool('photo_fit');
                    } else {
                      setActiveTool('select');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'photo_fit'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Fit Photo
                </button>

                <div className="h-4 w-px bg-slate-800 mx-0.5" />

                <button
                  onClick={onRunAITrace}
                  disabled={isTracingAI}
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono font-bold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white rounded-md shadow-xs transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isTracingAI ? 'Tracing...' : 'AI Trace Joints'}
                </button>

                <button
                  onClick={() => {
                    if (activeTool === 'add_joint' && jointDrawMode !== 'smooth_curve') {
                      setActiveTool('select');
                    } else {
                      setJointDrawMode('magnetic_livewire');
                      setActiveTool('add_joint');
                    }
                    setDraftJointPoints([]);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'add_joint' && jointDrawMode !== 'smooth_curve'
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Draw Joint
                </button>

                <button
                  onClick={() => {
                    if (activeTool === 'add_joint' && jointDrawMode === 'smooth_curve') {
                      setActiveTool('select');
                    } else {
                      setJointDrawMode('smooth_curve');
                      setActiveTool('add_joint');
                    }
                    setDraftJointPoints([]);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'add_joint' && jointDrawMode === 'smooth_curve'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                  title="ESWACAD SPLINE: Draw smooth Catmull-Rom spline curve through clicked control points"
                >
                  <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                  + Spline
                </button>

                <button
                  onClick={() => {
                    if (activeTool === 'lithology') {
                      setActiveTool('select');
                      setIsDrawingLithologyPolygon(false);
                      setDraftLithologyPoints([]);
                    } else {
                      setActiveTool('lithology');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'lithology'
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Lithology ({lithologyRegions.filter((r) => r.surface === activeSurface).length})
                </button>

                <button
                  onClick={() =>
                    setActiveTool(
                      activeTool === 'geological_symbol' ? 'select' : 'geological_symbol'
                    )
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'geological_symbol'
                      ? 'bg-purple-600 text-white border-purple-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 text-purple-400" />
                  Symbols ({surfacePlacedSymbols.length})
                </button>

                <div className="h-4 w-px bg-slate-800 mx-0.5" />

                <button
                  onClick={() =>
                    onOpenExportSheet(
                      activeTool === 'overbreak'
                        ? 'ENGINEERING_QUANTITY_SHEET'
                        : 'FINAL_ENGINEERING_SHEET'
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Plot Sheet
                </button>
              </div>
            )}

            {/* TAB 2: TUNNEL & PHOTO CALIBRATION */}
            {cadRibbonTab === 'TUNNEL_PHOTO' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {onOpenCustomProfileEditor && (
                  <button
                    onClick={onOpenCustomProfileEditor}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-semibold bg-cyan-950/90 hover:bg-cyan-900 text-cyan-200 rounded-md border border-cyan-600/70 cursor-pointer"
                  >
                    <Ruler className="w-3.5 h-3.5 text-cyan-400" />
                    Edit Tunnel Profile (W×H)
                  </button>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/90 hover:bg-slate-700 text-cyan-200 rounded-md border border-slate-700 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  {currentPhoto.image ? 'Replace Primary Photo' : 'Upload Photo'}
                </button>

                {currentPhoto.image && (currentPhoto.supportingPhotos?.length || 0) < 5 && (
                  <button
                    onClick={() => stereoFileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/80 hover:bg-slate-700 text-emerald-300 rounded-md border border-slate-700 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-400" />
                    +Stereo Photo ({currentPhoto.supportingPhotos?.length || 0}/5)
                  </button>
                )}

                <button
                  onClick={() => {
                    if (activeTool !== 'photo_fit') {
                      setInitialTransformSnapshot(currentPhoto.transform);
                      setTransformPast([]);
                      setTransformFuture([]);
                      setActiveTool('photo_fit');
                    } else {
                      setActiveTool('select');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                    activeTool === 'photo_fit'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Perspective &amp; Mesh Warp
                </button>

                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-900 rounded-md border border-slate-700">
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-mono text-slate-400">Opacity</span>
                  <select
                    value={currentPhoto.opacity}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onUpdatePhotoSurface(activeSurface, (prev) => ({ ...prev, opacity: val }));
                    }}
                    className="bg-slate-950 text-slate-200 font-mono text-[10px] px-1.5 py-0.5 rounded border border-slate-800"
                  >
                    {[100, 75, 50, 25, 0].map((val) => (
                      <option key={val} value={val}>
                        {val}%
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => {
                    setShowCrackXRayOverlay((prev) => {
                      const next = !prev;
                      if (next) setShowDepthReliefOverlay(false);
                      return next;
                    });
                  }}
                  disabled={!currentPhoto.image}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors disabled:opacity-40 cursor-pointer ${
                    showCrackXRayOverlay
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'bg-slate-800/80 text-emerald-300 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Crack X-Ray Filter
                </button>

                <button
                  onClick={() => {
                    setShowDepthReliefOverlay((prev) => {
                      const next = !prev;
                      if (next) setShowCrackXRayOverlay(false);
                      return next;
                    });
                  }}
                  disabled={!currentPhoto.image}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors disabled:opacity-40 cursor-pointer ${
                    showDepthReliefOverlay
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-cyan-300 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  3D Depth Relief
                </button>
              </div>
            )}

            {/* TAB 3: GEOLOGY & 3D */}
            {cadRibbonTab === 'GEOLOGY_3D' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={onRunAITrace}
                  disabled={isTracingAI}
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono font-bold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white rounded-md cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isTracingAI ? 'Tracing...' : 'AI Trace'}
                </button>

                <button
                  onClick={() => {
                    if (activeTool === 'add_joint' && jointDrawMode !== 'smooth_curve') {
                      setActiveTool('select');
                    } else {
                      setJointDrawMode('magnetic_livewire');
                      setActiveTool('add_joint');
                    }
                    setDraftJointPoints([]);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'add_joint' && jointDrawMode !== 'smooth_curve'
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Draw Joint
                </button>

                <button
                  onClick={() => {
                    if (activeTool === 'add_joint' && jointDrawMode === 'smooth_curve') {
                      setActiveTool('select');
                    } else {
                      setJointDrawMode('smooth_curve');
                      setActiveTool('add_joint');
                    }
                    setDraftJointPoints([]);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'add_joint' && jointDrawMode === 'smooth_curve'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                  title="ESWACAD SPLINE: Draw smooth Catmull-Rom spline curve through clicked control points"
                >
                  <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                  + Spline
                </button>

                <div className="flex items-center gap-0.5 p-0.5 bg-slate-900 rounded-md border border-slate-700">
                  <button
                    onClick={() => onChangeTraceFitMode('smart_fit')}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded cursor-pointer ${
                      traceFitMode === 'smart_fit'
                        ? 'bg-cyan-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Smart Curve
                  </button>
                  <button
                    onClick={() => onChangeTraceFitMode('linear')}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded cursor-pointer ${
                      traceFitMode === 'linear'
                        ? 'bg-amber-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Linear
                  </button>
                </div>

                <button
                  onClick={() => {
                    if (activeTool === 'lithology') {
                      setActiveTool('select');
                      setIsDrawingLithologyPolygon(false);
                      setDraftLithologyPoints([]);
                    } else {
                      setActiveTool('lithology');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'lithology'
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Lithology ({lithologyRegions.filter((r) => r.surface === activeSurface).length})
                </button>

                <button
                  onClick={() =>
                    setActiveTool(
                      activeTool === 'geological_symbol' ? 'select' : 'geological_symbol'
                    )
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'geological_symbol'
                      ? 'bg-purple-600 text-white border-purple-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 text-purple-400" />
                  ISRM Symbols ({surfacePlacedSymbols.length})
                </button>

                <button
                  onClick={() => setShowPhotogrammetryModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-amber-950/60 hover:bg-amber-900/70 text-amber-200 border border-amber-700/60 rounded-md cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5 text-amber-400" />
                  3D Stereonet &amp; Wedges
                </button>

                <button
                  onClick={() => onOpenProjectMemoryModal('continuous_3d_log')}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-semibold bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-600/60 rounded-md cursor-pointer"
                >
                  <Box className="w-3.5 h-3.5 text-emerald-400" />
                  3D Strip Workspace &amp; Network
                </button>

                <button
                  onClick={() => setShowUnfoldedRolloutModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/80 hover:bg-slate-700 text-cyan-200 border border-slate-700 rounded-md cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Unfolded Rollout
                </button>
              </div>
            )}

            {/* TAB 4: SURVEY, OVERBREAK & SUPPORT */}
            {cadRibbonTab === 'SURVEY_OVERBREAK' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() =>
                    setActiveTool(activeTool === 'control_point' ? 'select' : 'control_point')
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'control_point'
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                  Control Points ({surfaceControlPoints.length})
                </button>

                <button
                  onClick={() => {
                    const nextTool = activeTool === 'overbreak' ? 'select' : 'overbreak';
                    setActiveTool(nextTool);
                    if (nextTool === 'overbreak') {
                      setLayerVisibility((prev) => ({ ...prev, overbreakUndercut: true }));
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'overbreak'
                      ? 'bg-rose-600 text-white border-rose-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-rose-400" />
                  Overbreak Analysis
                  {overbreakAnalysis.hasValidSurveyProfile && (
                    <span className="px-1 py-0.2 bg-rose-950/80 text-rose-200 rounded text-[9px] font-mono">
                      +{overbreakAnalysis.overbreakAreaSqMeters.toFixed(1)}m²
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    setActiveTool(activeTool === 'measure' ? 'select' : 'measure');
                    setMeasurePts([]);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'measure'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  Measure Distance
                </button>

                <button
                  onClick={() =>
                    setActiveTool(activeTool === 'dip_probe' ? 'select' : 'dip_probe')
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border cursor-pointer ${
                    activeTool === 'dip_probe'
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  3D Dip Probe
                </button>

                <button
                  onClick={() => setShowRockSupportModal(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-md border cursor-pointer ${
                    supportConfig.enabledOnCanvas
                      ? 'bg-emerald-700 text-white border-emerald-400 font-bold'
                      : 'bg-slate-800/80 text-emerald-300 border-emerald-700/60 hover:bg-slate-700'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Rock Support ({rockSupportOverlay.boltsPerRing} Bolts)
                </button>
              </div>
            )}

            {/* TAB 5: CLASSIFICATION, TABLES & OUTPUT */}
            {cadRibbonTab === 'CLASSIFICATION_SHEET' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => {
                    if (showSetTableDrawer && geologyDrawerTab === 'geology_tables') {
                      setShowSetTableDrawer(false);
                    } else {
                      setGeologyDrawerTab('geology_tables');
                      setShowSetTableDrawer(true);
                      setShowAILearningDrawer(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-md border cursor-pointer ${
                    showSetTableDrawer && geologyDrawerTab === 'geology_tables'
                      ? 'bg-cyan-700 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-cyan-200 border-cyan-700/60 hover:bg-slate-700'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
                  1. Discontinuity Set Tables ({jointSets.length})
                </button>

                <button
                  onClick={() => setShowPhotogrammetryModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-amber-950/60 hover:bg-amber-900/70 text-amber-200 border border-amber-700/60 rounded-md cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5 text-amber-400" />
                  2. 3D Kinematics
                </button>

                <div className="flex items-center bg-slate-900/90 border border-indigo-600/60 rounded-md overflow-hidden">
                  <select
                    value={selectedClassificationMethod}
                    onChange={(e) => {
                      onChangeSelectedClassificationMethod(
                        e.target.value as RockMassClassificationMethodId
                      );
                      setGeologyDrawerTab('q_index');
                      setShowSetTableDrawer(true);
                      setShowAILearningDrawer(false);
                    }}
                    className="bg-slate-950 text-indigo-300 text-[10px] font-mono font-bold px-2 py-1 border-r border-slate-700/80 outline-none cursor-pointer"
                  >
                    <option value="RMR">RMR</option>
                    <option value="Q_SYSTEM">Q-Sys</option>
                    <option value="BOTH_RMR_AND_Q">RMR+Q</option>
                    <option value="GSI">GSI</option>
                  </select>
                  <button
                    onClick={() => {
                      if (showSetTableDrawer && geologyDrawerTab === 'q_index') {
                        setShowSetTableDrawer(false);
                      } else {
                        setGeologyDrawerTab('q_index');
                        setShowSetTableDrawer(true);
                        setShowAILearningDrawer(false);
                      }
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                      showSetTableDrawer && geologyDrawerTab === 'q_index'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                    <span>3.</span>
                    {(() => {
                      const rmrEval = calculateBieniawskiRmr(rmrParams);
                      const qEval = evaluateQSystemWithValidation(
                        qIndexParams,
                        geometry.width,
                        qParamStatus
                      );
                      const gsiEval = calculateHoekGsi(gsiParams);
                      if (selectedClassificationMethod === 'RMR') {
                        return rmrEval.isComplete && rmrEval.finalRmr !== null
                          ? `RMR=${rmrEval.finalRmr}`
                          : 'RMR';
                      }
                      if (selectedClassificationMethod === 'Q_SYSTEM') {
                        return qEval.isComplete ? `Q=${qEval.qValue.toFixed(1)}` : 'Q-System';
                      }
                      if (selectedClassificationMethod === 'BOTH_RMR_AND_Q') {
                        return `RMR=${rmrEval.finalRmr ?? 'N/A'}|Q=${
                          qEval.isComplete ? qEval.qValue.toFixed(1) : 'N/A'
                        }`;
                      }
                      return `GSI=${gsiEval.gsiValue ?? 'N/A'}`;
                    })()}
                  </button>
                </div>

                <button
                  onClick={() => onOpenProjectMemoryModal('sheet_settings')}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/80 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded-md cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Page Setup
                </button>

                <button
                  onClick={() => setShowSheetSetModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-800/80 hover:bg-slate-700 text-amber-200 border border-amber-700/60 rounded-md cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Batch Sheet Set ({savedProjects.length})
                </button>

                <button
                  onClick={() => {
                    setShowAILearningDrawer((prev) => !prev);
                    setShowSetTableDrawer(false);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-md border cursor-pointer ${
                    showAILearningDrawer
                      ? 'bg-cyan-700 text-white border-cyan-400'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  AI Loop ({sessionMemory.correctionsLearnedCount ?? 0})
                </button>

                <button
                  onClick={() =>
                    onOpenExportSheet(
                      activeTool === 'overbreak'
                        ? 'ENGINEERING_QUANTITY_SHEET'
                        : 'FINAL_ENGINEERING_SHEET'
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  4. Plot Engineering Sheet
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Hidden File Inputs for Main & Supporting Photos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadPhotoFile(activeSurface, f);
          e.target.value = '';
        }}
      />
      <input
        ref={stereoFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadStereoPhotoFile(activeSurface, f);
          e.target.value = '';
        }}
      />

      {/* ====================================================================
          MAIN MAPPING CANVAS STAGE (Occupies ~85-90% of viewport)
         ==================================================================== */}
      <div className="relative flex-1 flex min-w-0 min-h-0 overflow-hidden">
        <div
          ref={canvasContainerRef}
          className={`relative flex-1 flex items-center justify-center min-w-0 min-h-0 overflow-hidden ${
            isLight ? 'bg-[#E2E8F0]' : 'bg-[#090C12]'
          }`}
        >
          <svg
            ref={svgCanvasRef}
            viewBox={`0 0 ${viewW} ${viewH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              touchAction: 'none',
              backgroundColor: isLight ? '#E2E8F0' : '#090C12',
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onWheel={handleCanvasWheel}
            onTouchStart={handleCanvasTouchStart}
            onTouchMove={handleCanvasTouchMove}
            onTouchEnd={handleCanvasTouchEnd}
            onDoubleClick={() => {
              if (
                (activeTool === 'add_joint' ||
                  activeTool === 'redraw_joint' ||
                  activeTool === 'append_joint') &&
                draftJointPoints.length >= 2
              ) {
                finishDraftJoint();
              } else if (
                activeTool === 'lithology' &&
                isDrawingLithologyPolygon &&
                draftLithologyPoints.length >= 3
              ) {
                const newReg = createLithologyRegionFromPolygon(
                  activeSurface,
                  draftLithologyPoints,
                  'quartzite',
                  undefined,
                  joints,
                  currentPhoto
                );
                handleUpdateLithologyWithHistory([...lithologyRegions, newReg]);
                setSelectedLithologyRegionId(newReg.id);
                setDraftLithologyPoints([]);
                setIsDrawingLithologyPolygon(false);
              }
            }}
            className={`w-full h-full max-w-full max-h-full ${
              isSpacePanning || Boolean(draggingCanvasPan)
                ? 'cursor-grab active:cursor-grabbing'
                : activeTool === 'add_joint' ||
                  activeTool === 'redraw_joint' ||
                  activeTool === 'append_joint' ||
                  activeTool === 'measure' ||
                  activeTool === 'dip_probe' ||
                  activeTool === 'control_point' ||
                  (activeTool === 'lithology' && isDrawingLithologyPolygon)
                ? 'cursor-crosshair'
                : activeTool === 'photo_fit'
                ? 'cursor-move'
                : 'cursor-default'
            }`}
          >
            <defs>
              {/* Master Tunnel Surface Clip Path */}
              <clipPath id="active-surface-master-clip">
                <path d={surfaceBoundaryPath} />
              </clipPath>

              {/* Custom Polygon Boundary Mask Clip Path (P1, P2, P3, P4, P5, P6, P7...) */}
              <clipPath id="active-surface-custom-clip">
                <path d={customMaskPolygonPath} />
              </clipPath>

              {/* Subtle 1-meter Engineering Grid */}
              <pattern
                id="canvas-meter-grid"
                width={pxPerMeter}
                height={pxPerMeter}
                patternUnits="userSpaceOnUse"
                x={viewW / 2}
                y={viewH / 2}
              >
                <path
                  d={`M ${pxPerMeter} 0 L 0 0 0 ${pxPerMeter}`}
                  fill="none"
                  stroke={
                    !showCadGrid
                      ? 'transparent'
                      : isLight
                      ? 'rgba(71, 85, 105, 0.25)'
                      : 'rgba(56, 189, 248, 0.16)'
                  }
                  strokeWidth="0.8"
                />
              </pattern>

              {/* Professional Geological & Lithological Hatch Patterns (Section 13: All 22 Lithologies) */}
              <LithologyPatternDefs prefix="lith-pat-" />

              {/* Overbreak & Undercut Engineering Hatch Patterns */}
              <pattern
                id="overbreak-hatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="8"
                  stroke="#F43F5E"
                  strokeWidth="1.35"
                  strokeOpacity="0.65"
                />
                <line
                  x1="0"
                  y1="4"
                  x2="8"
                  y2="4"
                  stroke="#F43F5E"
                  strokeWidth="0.9"
                  strokeOpacity="0.4"
                />
              </pattern>
              <pattern
                id="undercut-hatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(-45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="8"
                  stroke="#F59E0B"
                  strokeWidth="1.35"
                  strokeOpacity="0.7"
                />
              </pattern>
            </defs>

            {/* ====================================================================
                MASTER VIEWPORT PAN & ZOOM STAGE (Sections 1, 2, 3, 4, 5)
                All 8 geological layers & interactive handles share this exact coordinate transform
               ==================================================================== */}
            <g id="master-viewport-stage" transform={viewportSvgTransform}>
            {/* Background Meter Grid */}
            <rect x="0" y="0" width={viewW} height={viewH} fill="url(#canvas-meter-grid)" />

            {/* Master Tunnel Surface Interior Background */}
            <path d={surfaceBoundaryPath} fill={isLight ? '#FFFFFF' : '#111722'} />

            {/* Registered, Perspective & Piecewise-Mesh-Warped MAIN PHOTO */}
            {layerVisibility.photo && currentPhoto.image && currentPhoto.opacity > 0 && (
              <g
                clipPath={
                  currentPhoto.transform.cropToGeometry
                    ? currentPhoto.transform.useCustomMask &&
                      (currentPhoto.transform.customMaskPoints?.length || 0) >= 3
                      ? 'url(#active-surface-custom-clip)'
                      : 'url(#active-surface-master-clip)'
                    : undefined
                }
              >
                <g transform={photoSvgTransform}>
                  <image
                    href={
                      showCrackXRayOverlay && activePhotoRidgeField?.xrayOverlayDataUrl
                        ? activePhotoRidgeField.xrayOverlayDataUrl
                        : showDepthReliefOverlay && activePhotoRidgeField?.depthReliefOverlayDataUrl
                        ? activePhotoRidgeField.depthReliefOverlayDataUrl
                        : liveWarpedImageUrl || currentPhoto.warpedImage || currentPhoto.image
                    }
                    x={surfaceRectPx.x}
                    y={surfaceRectPx.y}
                    width={surfaceRectPx.width}
                    height={surfaceRectPx.height}
                    preserveAspectRatio="none"
                    opacity={currentPhoto.opacity / 100}
                  />
                </g>
              </g>
            )}

            {/* ====================================================================
                LAYER 2: SUBTLE LITHOLOGY BACKGROUND (Sections 11 & 12)
                Strictly rendered ABOVE Layer 1 (Photo) and BELOW Layer 3–8 (Features, Joints, Symbols, Labels)
               ==================================================================== */}
            {layerVisibility.lithology && (
              <g clipPath="url(#active-surface-master-clip)">
                {lithologyRegions
                  .filter((reg) => reg.surface === activeSurface && reg.polygon.length >= 3)
                  .map((reg) => {
                    const polyPath =
                      reg.polygon
                        .map((pt, idx) => {
                          const { cx, cy } = coordManager.worldToScreen(pt);
                          return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
                        })
                        .join(' ') + ' Z';
                    const centroid = getPolygonCentroid(reg.polygon);
                    const { cx: centX, cy: centY } = coordManager.worldToScreen(centroid);
                    const isSelectedReg = selectedLithologyRegionId === reg.id;

                    return (
                      <g
                        key={reg.id}
                        onClick={(e) => {
                          if (
                            (activeTool === 'lithology' || activeTool === 'select') &&
                            !isDrawingLithologyPolygon
                          ) {
                            e.stopPropagation();
                            setSelectedLithologyRegionId(reg.id);
                          }
                        }}
                        onMouseDown={(e) => {
                          if (
                            activeTool === 'lithology' &&
                            !isDrawingLithologyPolygon &&
                            isSelectedReg
                          ) {
                            e.stopPropagation();
                            const startProj = coordManager.screenToWorld(e.clientX, e.clientY);
                            setDraggingWholeLithology({
                              regionId: reg.id,
                              startMeters: { x: startProj.x, y: startProj.y },
                              origPolygon: reg.polygon.map((p) => ({ ...p })),
                            });
                          }
                        }}
                        className={
                          activeTool === 'lithology'
                            ? isSelectedReg
                              ? 'cursor-move'
                              : 'cursor-pointer'
                            : 'pointer-events-none'
                        }
                      >
                        {/* Subtle Geological Color Tint */}
                        <path
                          d={polyPath}
                          fill={reg.colorHex}
                          fillOpacity={Math.min(0.4, Math.max(0.04, reg.opacity * 0.55))}
                        />
                        {/* Subtle Geological Hatch Pattern */}
                        <path
                          d={polyPath}
                          fill={`url(#lith-pat-${reg.patternType})`}
                          fillOpacity={Math.min(0.85, Math.max(0.15, reg.opacity * 2.2))}
                          stroke={reg.colorHex}
                          strokeOpacity={isSelectedReg ? 0.9 : 0.45}
                          strokeWidth={isSelectedReg ? '1.8' : '1'}
                          strokeDasharray={isSelectedReg ? '6,3' : '4,4'}
                        />
                        {/* Subtle Lithology Region Label */}
                        <text
                          x={centX}
                          y={centY}
                          textAnchor="middle"
                          fontSize="10"
                          fontFamily="IBM Plex Mono, monospace"
                          fontWeight="600"
                          fill={reg.colorHex}
                          fillOpacity="0.8"
                          className="pointer-events-none"
                        >
                          {reg.lithologyName.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
              </g>
            )}

            {/* ====================================================================
                LAYER 2.5: OVERBREAK / UNDERCUT VECTOR ANALYSIS LAYER & CONNECTED SURVEY PROFILE
                Layer order: PHOTO -> LITHOLOGY -> OVERBREAK / UNDERCUT -> GEOLOGICAL FEATURES -> JOINTS -> SYMBOLS -> LABELS -> DIMENSIONS
               ==================================================================== */}
            {layerVisibility.overbreakUndercut !== false &&
              surveyProfile.visible &&
              overbreakAnalysis.surface === activeSurface && (
                <g>
                  {/* 1. Overbreak Regions (Surveyed outside Design Boundary) */}
                  {overbreakAnalysis.overbreakRegions.map((reg) => {
                    if (reg.polygon.length < 3) return null;
                    const polyPath =
                      reg.polygon
                        .map((pt, idx) => {
                          const { cx, cy } = coordManager.worldToScreen(pt);
                          return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
                        })
                        .join(' ') + ' Z';
                    const maxPtScreen = coordManager.worldToScreen(reg.maxRadialPoint);
                    return (
                      <g key={reg.id} className="pointer-events-none">
                        <path
                          d={polyPath}
                          fill="rgba(244, 63, 94, 0.16)"
                          stroke="#F43F5E"
                          strokeWidth="1.2"
                          strokeOpacity="0.8"
                        />
                        <path d={polyPath} fill="url(#overbreak-hatch)" />
                        {layerVisibility.annotations && reg.areaSqMeters >= 0.02 && (
                          <g>
                            <rect
                              x={maxPtScreen.cx - 46}
                              y={maxPtScreen.cy - 22}
                              width="92"
                              height="15"
                              rx="2"
                              fill={isLight ? '#FFF1F2' : '#0B0E14'}
                              fillOpacity="0.92"
                              stroke="#F43F5E"
                              strokeWidth="0.9"
                            />
                            <text
                              x={maxPtScreen.cx}
                              y={maxPtScreen.cy - 11.5}
                              textAnchor="middle"
                              fontSize="8.5"
                              fontWeight="700"
                              fontFamily="IBM Plex Mono, monospace"
                              fill={isLight ? '#BE123C' : '#FDA4AF'}
                            >
                              {reg.id}: +{reg.areaSqMeters.toFixed(2)}m² (Max +{reg.maxRadialMeters.toFixed(2)}m)
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* 2. Undercut Regions (Surveyed inside Design Boundary) */}
                  {overbreakAnalysis.undercutRegions.map((reg) => {
                    if (reg.polygon.length < 3) return null;
                    const polyPath =
                      reg.polygon
                        .map((pt, idx) => {
                          const { cx, cy } = coordManager.worldToScreen(pt);
                          return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
                        })
                        .join(' ') + ' Z';
                    const maxPtScreen = coordManager.worldToScreen(reg.maxRadialPoint);
                    return (
                      <g key={reg.id} className="pointer-events-none">
                        <path
                          d={polyPath}
                          fill="rgba(245, 158, 11, 0.18)"
                          stroke="#F59E0B"
                          strokeWidth="1.2"
                          strokeOpacity="0.85"
                        />
                        <path d={polyPath} fill="url(#undercut-hatch)" />
                        {layerVisibility.annotations && reg.areaSqMeters >= 0.02 && (
                          <g>
                            <rect
                              x={maxPtScreen.cx - 46}
                              y={maxPtScreen.cy + 6}
                              width="92"
                              height="15"
                              rx="2"
                              fill={isLight ? '#FFFBEB' : '#0B0E14'}
                              fillOpacity="0.92"
                              stroke="#F59E0B"
                              strokeWidth="0.9"
                            />
                            <text
                              x={maxPtScreen.cx}
                              y={maxPtScreen.cy + 16.5}
                              textAnchor="middle"
                              fontSize="8.5"
                              fontWeight="700"
                              fontFamily="IBM Plex Mono, monospace"
                              fill={isLight ? '#B45309' : '#FDE68A'}
                            >
                              {reg.id}: -{reg.areaSqMeters.toFixed(2)}m² (Max -{reg.maxRadialMeters.toFixed(2)}m)
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* 3. Connected Surveyed / As-Built Profile Polyline (CP1 -> CP2 -> CP3 -> ...) */}
                  {overbreakAnalysis.surveyedPolygon.length >= 2 && (
                    <g>
                      {(() => {
                        const sPts = overbreakAnalysis.surveyedPolygon.map((pt) =>
                          coordManager.worldToScreen(pt)
                        );
                        const dSurvey =
                          sPts
                            .map(
                              (p, idx) =>
                                `${idx === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`
                            )
                            .join(' ') + (surveyProfile.isClosed && sPts.length >= 3 ? ' Z' : '');
                        return (
                          <path
                            d={dSurvey}
                            fill="none"
                            stroke="#10B981"
                            strokeWidth="2.3"
                            strokeDasharray="7,4"
                            className="pointer-events-none"
                          />
                        );
                      })()}

                      {/* Midpoint '+' Handles on Connected Survey Segments to Insert Point */}
                      {(activeTool === 'overbreak' || activeTool === 'control_point') &&
                        !surveyProfile.locked &&
                        surveyProfile.orderedControlPointIds.length >= 2 &&
                        surveyProfile.orderedControlPointIds.map((cpIdA, segIdx) => {
                          const isLast =
                            segIdx === surveyProfile.orderedControlPointIds.length - 1;
                          if (isLast && !surveyProfile.isClosed) return null;
                          const cpIdB =
                            surveyProfile.orderedControlPointIds[
                              (segIdx + 1) % surveyProfile.orderedControlPointIds.length
                            ];
                          const cpA = surfaceControlPoints.find((c) => c.id === cpIdA);
                          const cpB = surfaceControlPoints.find((c) => c.id === cpIdB);
                          if (!cpA || !cpB) return null;
                          const sA = coordManager.worldToScreen(cpA.point);
                          const sB = coordManager.worldToScreen(cpB.point);
                          const mx = (sA.cx + sB.cx) / 2;
                          const my = (sA.cy + sB.cy) / 2;
                          const midPtMeters: Point2D = {
                            x: Number(((cpA.point.x + cpB.point.x) / 2).toFixed(3)),
                            y: Number(((cpA.point.y + cpB.point.y) / 2).toFixed(3)),
                          };
                          return (
                            <g
                              key={`survey-mid-${cpIdA}-${cpIdB}`}
                              className="cursor-pointer opacity-80 hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextNum =
                                  controlPoints.filter((c) => c.surface === activeSurface).length +
                                  1;
                                const newCp: SurveyControlPoint = {
                                  id: `cp-survey-ins-${Date.now()}`,
                                  label: `CP${nextNum}`,
                                  surface: activeSurface,
                                  point: midPtMeters,
                                  color: '#22D3EE',
                                  visible: true,
                                  locked: false,
                                };
                                handleUpdateControlPointsWithHistory((prev) => [...prev, newCp]);
                                onUpdateSurveyProfile((prev) => {
                                  const nextOrder = [...prev.orderedControlPointIds];
                                  nextOrder.splice(segIdx + 1, 0, newCp.id);
                                  return {
                                    ...prev,
                                    orderedControlPointIds: nextOrder,
                                  };
                                });
                                setSelectedControlPointId(newCp.id);
                                onUpdateStatusMessage?.(
                                  `Inserted ${newCp.label} between ${cpA.label} and ${cpB.label}.`
                                );
                              }}
                            >
                              <circle
                                cx={mx}
                                cy={my}
                                r="5"
                                fill="#0F172A"
                                stroke="#10B981"
                                strokeWidth="1.5"
                              />
                              <text
                                x={mx}
                                y={my + 3}
                                textAnchor="middle"
                                fontSize="9"
                                fontWeight="700"
                                fontFamily="IBM Plex Mono, monospace"
                                fill="#34D399"
                                className="pointer-events-none"
                              >
                                +
                              </text>
                            </g>
                          );
                        })}
                    </g>
                  )}
                </g>
              )}

            {/* Engineering Reference Lines (Centerline & Springline) */}
            {activeSurface === 'face' && (
              <g clipPath="url(#active-surface-master-clip)">
                {/* Vertical Centerline X = 0 */}
                {(() => {
                  const top = coordManager.worldToScreen({ x: 0, y: geometry.height });
                  const bot = coordManager.worldToScreen({ x: 0, y: 0 });
                  return (
                    <line
                      x1={top.cx}
                      y1={top.cy}
                      x2={bot.cx}
                      y2={bot.cy}
                      stroke="rgba(148, 163, 184, 0.32)"
                      strokeWidth="1"
                      strokeDasharray="6,5"
                    />
                  );
                })()}
                {/* Horizontal Springline Y = wallHeight */}
                {(() => {
                  const left = coordManager.worldToScreen({
                    x: -geometry.width / 2,
                    y: geometry.wallHeight,
                  });
                  const right = coordManager.worldToScreen({
                    x: geometry.width / 2,
                    y: geometry.wallHeight,
                  });
                  return (
                    <line
                      x1={left.cx}
                      y1={left.cy}
                      x2={right.cx}
                      y2={right.cy}
                      stroke="rgba(148, 163, 184, 0.32)"
                      strokeWidth="1"
                      strokeDasharray="6,5"
                    />
                  );
                })()}
              </g>
            )}

            {/* Authoritative Master Tunnel Geometry Outline */}
            <path
              d={surfaceBoundaryPath}
              fill="none"
              stroke={isLight ? '#0284C7' : '#38BDF8'}
              strokeWidth="2.2"
            />

            {/* Real-World Master Dimension Annotations on Canvas */}
            <g className="pointer-events-none">
              <text
                x={surfaceRectPx.centerX}
                y={surfaceRectPx.y + surfaceRectPx.height + 24}
                textAnchor="middle"
                fill={isLight ? '#334155' : '#94A3B8'}
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
              >
                {activeSurface === 'face'
                  ? `TUNNEL WIDTH = ${geometry.width.toFixed(2)} m (CENTERLINE 0.00m)`
                  : activeSurface === 'crown'
                  ? `DEVELOPED CROWN ARCH WIDTH = ${surfaceBounds.width.toFixed(2)} m`
                  : `ROUND LENGTH (PULL) = ${settings.roundLength.toFixed(2)} m`}
              </text>

              <text
                x={surfaceRectPx.x - 16}
                y={surfaceRectPx.centerY}
                textAnchor="middle"
                fill={isLight ? '#334155' : '#94A3B8'}
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                transform={`rotate(-90, ${surfaceRectPx.x - 16}, ${surfaceRectPx.centerY})`}
              >
                {activeSurface === 'face'
                  ? `HEIGHT = ${geometry.height.toFixed(2)} m (WALL = ${geometry.wallHeight.toFixed(2)} m)`
                  : activeSurface === 'crown'
                  ? `PULL = ${settings.roundLength.toFixed(2)} m (DRIVE N${String(
                      Math.round(settings.driveDirection)
                    ).padStart(3, '0')}°)`
                  : `WALL HEIGHT = ${geometry.wallHeight.toFixed(2)} m`}
              </text>
            </g>

            {/* ==============================================================
                VECTOR GEOLOGICAL DISCONTINUITY TRACES + DIP/DIP-DIRECTION SYMBOLS (Sections 10, 11, 12, 21)
               ============================================================== */}
            {(() => {
              const canvasObstacles: LabelObstacleBox[] = [
                {
                  x: surfaceRectPx.centerX - 160,
                  y: surfaceRectPx.y + surfaceRectPx.height + 8,
                  width: 320,
                  height: 22,
                },
                {
                  x: surfaceRectPx.x - 28,
                  y: surfaceRectPx.centerY - 110,
                  width: 24,
                  height: 220,
                },
              ];
              const canvasSegments: LabelObstacleSegment[] = [];

              return (
                <>
                  {surfaceJoints.map((joint, jIdx) => {
                    const displayedGeom = getDisplayedJointGeometry(joint, traceFitMode);
                    if (displayedGeom.length < 2) return null;
                    const canvasPts = displayedGeom.map((pt) => coordManager.worldToScreen(pt));
                    for (let k = 0; k < canvasPts.length - 1; k++) {
                      canvasSegments.push({
                        x1: canvasPts[k].cx,
                        y1: canvasPts[k].cy,
                        x2: canvasPts[k + 1].cx,
                        y2: canvasPts[k + 1].cy,
                      });
                    }
                    const dPath = canvasPts
                      .map(
                        (p, idx) =>
                          `${idx === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`
                      )
                      .join(' ');

                    const isSelected = joint.id === selectedJointId;
                    const palette = JOINT_SET_PALETTE[joint.set] || { color: '#38BDF8' };
                    const isLowConf =
                      joint.confidence === 'Low' &&
                      joint.orientationStatus !== 'DIRECTLY_MEASURED' &&
                      joint.orientationStatus !== 'CONFIRMED';

                    const strokeSpec = getGeologicalFeatureStrokeStyle(
                      joint.featureType,
                      isLowConf
                    );
                    const color = palette.color;
                    const isShear = Boolean(strokeSpec.isBand);

                    // Midpoint for strike & dip symbol
                    const midIdx = Math.floor(canvasPts.length / 2);
                    const midPt =
                      canvasPts.length % 2 === 1
                        ? canvasPts[midIdx]
                        : {
                            cx: (canvasPts[midIdx - 1].cx + canvasPts[midIdx].cx) / 2,
                            cy: (canvasPts[midIdx - 1].cy + canvasPts[midIdx].cy) / 2,
                          };
                    const pStart = canvasPts[0];
                    const pEnd = canvasPts[canvasPts.length - 1];
                    const tangentAngleRad = Math.atan2(pEnd.cy - pStart.cy, pEnd.cx - pStart.cx);

                    canvasObstacles.push({
                      x: midPt.cx - 12,
                      y: midPt.cy - 12,
                      width: 24,
                      height: 24,
                    });

                    const jNumLabel = joint.jointNumber || `J-${jIdx + 1}`;
                    const labelText = `${jNumLabel} (${joint.set}) ${String(
                      Math.round(joint.dipDirection)
                    ).padStart(3, '0')}°/${String(Math.round(joint.dip)).padStart(2, '0')}°${
                      joint.orientationStatus === 'REQUIRES_CONFIRMATION'
                        ? '?'
                        : joint.orientationStatus === 'ESTIMATED' ||
                          joint.orientationStatus === 'APPARENT_ORIENTATION'
                        ? '*'
                        : joint.orientationStatus === 'GEOMETRICALLY_CALCULATED'
                        ? '✓'
                        : ''
                    }`;

                    const labelW = Math.max(96, labelText.length * 5.8 + 10);
                    const labelH = 16;
                    const labelPlacement = computeNonOverlappingLabelPlacement({
                      anchorX: midPt.cx,
                      anchorY: midPt.cy,
                      boxW: labelW,
                      boxH: labelH,
                      occupiedBoxes: canvasObstacles,
                      obstacleSegments: canvasSegments,
                      bounds: {
                        minX: 10,
                        minY: 10,
                        maxX: viewW - 10,
                        maxY: viewH - 10,
                      },
                    });
                    canvasObstacles.push({
                      x: labelPlacement.boxX,
                      y: labelPlacement.boxY,
                      width: labelW,
                      height: labelH,
                    });

                    const baseStrokeW = isSelected ? 3.2 : isShear ? 2.8 : 2.1;

                    return (
                      <g key={joint.id}>
                        {/* Invisible wider hit target for easy field selection */}
                        <path
                          d={dPath}
                          fill="none"
                          stroke="transparent"
                          strokeWidth="14"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              joinTargetMode &&
                              selectedJoint &&
                              selectedJoint.id !== joint.id
                            ) {
                              handleJoinWithJoint(joint);
                              return;
                            }
                            setSelectedJointId(joint.id);
                          }}
                          onMouseDown={(e) => {
                            if (activeTool === 'select' && isSelected) {
                              e.stopPropagation();
                              const startProj = coordManager.screenToWorld(
                                e.clientX,
                                e.clientY
                              );
                              setDraggingWholeJoint({
                                jointId: joint.id,
                                startMeters: { x: startProj.x, y: startProj.y },
                                origPoints: joint.geometry.map((p) => ({ ...p })),
                              });
                            }
                          }}
                        />

                        {/* Selection halo or Shear/Breccia/Weathered zone band */}
                        {(isSelected || strokeSpec.isBand) && (
                          <path
                            d={dPath}
                            fill="none"
                            stroke={isSelected ? '#22D3EE' : color}
                            strokeOpacity={isSelected ? 0.35 : strokeSpec.bandOpacity ?? 0.22}
                            strokeWidth={isSelected ? 9 : 8}
                            strokeLinecap="round"
                            className="pointer-events-none"
                          />
                        )}

                        {/* Main Vector Trace Line / Variable-Aperture Polyline */}
                        {joint.vertexWidths && joint.vertexWidths.length === canvasPts.length ? (
                          canvasPts.slice(0, -1).map((ptA, segIdx) => {
                            const ptB = canvasPts[segIdx + 1];
                            const wNorm =
                              ((joint.vertexWidths![segIdx] ?? 0.5) +
                                (joint.vertexWidths![segIdx + 1] ?? 0.5)) /
                              2;
                            const segStrokeW = Number(
                              (baseStrokeW + (wNorm - 0.5) * (isShear ? 2.4 : 1.6)).toFixed(2)
                            );
                            return (
                              <line
                                key={`${joint.id}-seg-${segIdx}`}
                                x1={ptA.cx}
                                y1={ptA.cy}
                                x2={ptB.cx}
                                y2={ptB.cy}
                                stroke={color}
                                strokeWidth={Math.max(1.2, segStrokeW)}
                                strokeDasharray={strokeSpec.dashArray}
                                strokeLinecap="round"
                                className="pointer-events-none"
                              />
                            );
                          })
                        ) : (
                          <path
                            d={dPath}
                            fill="none"
                            stroke={color}
                            strokeWidth={baseStrokeW}
                            strokeDasharray={strokeSpec.dashArray}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="pointer-events-none"
                          />
                        )}

                        {/* Genuine Rock Termination T-Bar Ticks (when trace ends inside exposed rock) */}
                        {joint.terminationStart === 'ROCK_TERMINATION' &&
                          canvasPts.length >= 2 &&
                          (() => {
                            const a = canvasPts[0];
                            const b = canvasPts[1];
                            const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx) + Math.PI / 2;
                            const dx = Math.cos(ang) * 5.5;
                            const dy = Math.sin(ang) * 5.5;
                            return (
                              <line
                                x1={a.cx - dx}
                                y1={a.cy - dy}
                                x2={a.cx + dx}
                                y2={a.cy + dy}
                                stroke={color}
                                strokeWidth="1.8"
                                className="pointer-events-none"
                              />
                            );
                          })()}
                        {joint.terminationEnd === 'ROCK_TERMINATION' &&
                          canvasPts.length >= 2 &&
                          (() => {
                            const a = canvasPts[canvasPts.length - 2];
                            const b = canvasPts[canvasPts.length - 1];
                            const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx) + Math.PI / 2;
                            const dx = Math.cos(ang) * 5.5;
                            const dy = Math.sin(ang) * 5.5;
                            return (
                              <line
                                x1={b.cx - dx}
                                y1={b.cy - dy}
                                x2={b.cx + dx}
                                y2={b.cy + dy}
                                stroke={color}
                                strokeWidth="1.8"
                                className="pointer-events-none"
                              />
                            );
                          })()}

                        {/* Local Angle Variation Callouts along segments when Selected */}
                        {isSelected &&
                          joint.localAnglesDeg &&
                          joint.localAnglesDeg.length > 1 &&
                          canvasPts.slice(0, -1).map((ptA, sIdx) => {
                            if (sIdx % 2 !== 0 && canvasPts.length > 5) return null;
                            const ptB = canvasPts[sIdx + 1];
                            const mx = (ptA.cx + ptB.cx) / 2;
                            const my = (ptA.cy + ptB.cy) / 2;
                            const locAng = joint.localAnglesDeg![sIdx];
                            if (locAng === undefined) return null;
                            return (
                              <text
                                key={`${joint.id}-locang-${sIdx}`}
                                x={mx}
                                y={my - 8}
                                textAnchor="middle"
                                fontSize="8.5"
                                fontFamily="IBM Plex Mono, monospace"
                                fill="#67E8F9"
                                className="pointer-events-none"
                              >
                                {Math.round(locAng)}°
                              </text>
                            );
                          })}

                        {/* Proper Structural Dip / Dip-Direction Orientation Symbol at Joint Midpoint (Section 12) */}
                        <DipDirectionSymbolGlyph
                          midX={midPt.cx}
                          midY={midPt.cy}
                          tangentAngleRad={tangentAngleRad}
                          dipDirectionDeg={joint.dipDirection}
                          dipDeg={joint.dip}
                          featureType={joint.featureType}
                          orientationStatus={joint.orientationStatus}
                          color={color}
                          scale={joint.symbolScale || 1.0}
                        />

                        {/* Non-Overlapping Joint Orientation Callout Box + Automatic Leader Line (Sections 11, 21) */}
                        {layerVisibility.annotations && (
                          <g className="pointer-events-none">
                            {labelPlacement.needsLeader && (
                              <line
                                x1={midPt.cx}
                                y1={midPt.cy}
                                x2={labelPlacement.leaderTargetX}
                                y2={labelPlacement.leaderTargetY}
                                stroke={color}
                                strokeWidth="0.9"
                                strokeDasharray="2,2"
                                opacity="0.8"
                              />
                            )}
                            <rect
                              x={labelPlacement.boxX}
                              y={labelPlacement.boxY}
                              width={labelW}
                              height={labelH}
                              rx="2"
                              fill={isLight ? '#FFFFFF' : '#0B0E14'}
                              fillOpacity="0.92"
                              stroke={isSelected ? '#0284C7' : color}
                              strokeWidth={isSelected ? '1.3' : '0.9'}
                            />
                            <text
                              x={labelPlacement.boxX + 4}
                              y={labelPlacement.boxY + 11.5}
                              fontSize="9.5"
                              fontWeight="600"
                              fontFamily="IBM Plex Mono, monospace"
                              fill={isLight ? '#0F172A' : '#F8FAFC'}
                            >
                              {labelText}
                            </text>
                          </g>
                        )}

                  {/* Interactive Control Point Handles & Midpoint Insertion when Selected (Sections 9, 10, 11) */}
                  {isSelected &&
                    (() => {
                      const rawCtrlPts = joint.geometry.map((pt) => coordManager.worldToScreen(pt));
                      return (
                        <g>
                          {/* Midpoint '+' Handles to Insert Control Points */}
                          {rawCtrlPts.length <= 24 &&
                            rawCtrlPts.slice(0, -1).map((ptA, sIdx) => {
                              const ptB = rawCtrlPts[sIdx + 1];
                              const mx = (ptA.cx + ptB.cx) / 2;
                              const my = (ptA.cy + ptB.cy) / 2;
                              return (
                                <g
                                  key={`${joint.id}-mid-${sIdx}`}
                                  className="cursor-pointer opacity-75 hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddVertexToSelectedJoint(sIdx);
                                  }}
                                >
                                  <circle
                                    cx={mx}
                                    cy={my}
                                    r="4.5"
                                    fill="#0F172A"
                                    stroke="#38BDF8"
                                    strokeWidth="1.4"
                                  />
                                  <text
                                    x={mx}
                                    y={my + 3}
                                    textAnchor="middle"
                                    fontSize="9"
                                    fontFamily="IBM Plex Mono, monospace"
                                    fill="#38BDF8"
                                    className="pointer-events-none"
                                  >
                                    +
                                  </text>
                                </g>
                              );
                            })}

                          {/* Actual Control Points (Start, Intermediate, End) */}
                          {rawCtrlPts.map((pt, vIdx) => {
                            const isStart = vIdx === 0;
                            const isEnd = vIdx === rawCtrlPts.length - 1;
                            const isSelVertex = selectedJointVertexIdx === vIdx;
                            return (
                              <g key={`${joint.id}-v-${vIdx}`}>
                                <circle
                                  cx={pt.cx}
                                  cy={pt.cy}
                                  r={isSelVertex ? '7' : isStart || isEnd ? '6.2' : '5.5'}
                                  fill={
                                    isSelVertex
                                      ? '#F59E0B'
                                      : isStart
                                      ? '#10B981'
                                      : isEnd
                                      ? '#F43F5E'
                                      : '#0B0E14'
                                  }
                                  stroke="#22D3EE"
                                  strokeWidth="2.2"
                                  className="cursor-grab active:cursor-grabbing"
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    if (e.shiftKey && joint.geometry.length > 2) {
                                      handleDeleteSelectedJointVertex(vIdx);
                                      return;
                                    }
                                    setSelectedJointVertexIdx(vIdx);
                                    setDraggingVertex({
                                      jointId: joint.id,
                                      vertexIndex: vIdx,
                                    });
                                  }}
                                />
                                {(isStart || isEnd || isSelVertex) && (
                                  <text
                                    x={pt.cx}
                                    y={pt.cy - 9}
                                    textAnchor="middle"
                                    fontSize="8.5"
                                    fontWeight="700"
                                    fontFamily="IBM Plex Mono, monospace"
                                    fill={isStart ? '#34D399' : isEnd ? '#FDA4AF' : '#FDE68A'}
                                    className="pointer-events-none"
                                  >
                                    {isStart
                                      ? 'START (P1)'
                                      : isEnd
                                      ? `END (P${rawCtrlPts.length})`
                                      : `P${vIdx + 1}`}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      );
                    })()}
                </g>
              );
            })}

            {/* ====================================================================
                LAYER 7: PLACED STRUCTURAL GEOLOGICAL SYMBOLS (Sections 9, 10, 12, 15)
                Interactive select, drag-to-move, drag-to-rotate, drag-to-scale & non-overlapping labels
               ==================================================================== */}
            {surfacePlacedSymbols
              .filter((sym) => sym.visible !== false)
              .map((sym) => {
                const { cx, cy } = coordManager.worldToScreen(sym.point);
                const isSelSym = selectedSymbolId === sym.id;
                const meta = getStructuralSymbolMeta(sym.symbolType);
                const symScale = sym.scale || 1.0;
                const symRadiusPx = 15 * symScale;

                canvasObstacles.push({
                  x: cx - symRadiusPx,
                  y: cy - symRadiusPx,
                  width: symRadiusPx * 2,
                  height: symRadiusPx * 2,
                });

                const orientSuffix = ` ${String(Math.round(sym.dipDirectionDeg)).padStart(
                  3,
                  '0'
                )}°/${String(Math.round(sym.dipDeg)).padStart(2, '0')}°${
                  sym.uncertainOrientation ? '?' : ''
                }`;
                const symLabelText = `${sym.label || meta.shortCode}${orientSuffix}`;
                const sBoxW = Math.max(58, symLabelText.length * 5.8 + 10);
                const sBoxH = 15;

                const symLabelPlacement = computeNonOverlappingLabelPlacement({
                  anchorX: cx,
                  anchorY: cy,
                  boxW: sBoxW,
                  boxH: sBoxH,
                  occupiedBoxes: canvasObstacles,
                  obstacleSegments: canvasSegments,
                  bounds: {
                    minX: 10,
                    minY: 10,
                    maxX: viewW - 10,
                    maxY: viewH - 10,
                  },
                });
                canvasObstacles.push({
                  x: symLabelPlacement.boxX,
                  y: symLabelPlacement.boxY,
                  width: sBoxW,
                  height: sBoxH,
                });

                const symColor = sym.color || meta.defaultColor;

                return (
                  <g
                    key={sym.id}
                    className={
                      sym.locked
                        ? 'cursor-not-allowed'
                        : 'cursor-grab active:cursor-grabbing'
                    }
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey && !sym.locked) {
                        handleDeletePlacedSymbol(sym.id);
                        return;
                      }
                      setSelectedSymbolId(sym.id);
                      if (!sym.locked) {
                        setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
                        setSymbolFuture([]);
                        setDraggingSymbolId(sym.id);
                      }
                    }}
                  >
                    {isSelSym && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={symRadiusPx + 3}
                        fill="rgba(34, 211, 238, 0.14)"
                        stroke="#22D3EE"
                        strokeWidth="1.2"
                        strokeDasharray="3,2"
                      />
                    )}
                    <g transform={`translate(${cx}, ${cy}) rotate(${sym.rotationDeg})`}>
                      <StructuralGeologicalSymbolGlyph
                        symbolType={sym.symbolType}
                        scale={symScale}
                        color={symColor}
                        dipDeg={sym.dipDeg}
                        uncertainOrientation={sym.uncertainOrientation}
                      />
                    </g>

                    {/* Interactive On-Canvas Rotation & Scale Handles when Selected (Section 15) */}
                    {isSelSym && !sym.locked && (
                      <g>
                        {/* Rotation Handle (Top Stem + Circle) */}
                        <line
                          x1={cx}
                          y1={cy - symRadiusPx}
                          x2={cx}
                          y2={cy - symRadiusPx - 14}
                          stroke="#22D3EE"
                          strokeWidth="1.3"
                          strokeDasharray="2,2"
                        />
                        <circle
                          cx={cx}
                          cy={cy - symRadiusPx - 14}
                          r="5"
                          fill="#06B6D4"
                          stroke="#0B0E14"
                          strokeWidth="1.5"
                          className="cursor-crosshair"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
                            setSymbolFuture([]);
                            setRotatingSymbolState({
                              symbolId: sym.id,
                              centerPx: { cx, cy },
                            });
                          }}
                        />
                        {/* Scale Handle (Bottom-Right Corner Square) */}
                        <rect
                          x={cx + symRadiusPx - 3}
                          y={cy + symRadiusPx - 3}
                          width="8"
                          height="8"
                          rx="1.5"
                          fill="#F59E0B"
                          stroke="#0B0E14"
                          strokeWidth="1.4"
                          className="cursor-nwse-resize"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSymbolPast((p) => [...p.slice(-24), placedSymbols]);
                            setSymbolFuture([]);
                            setScalingSymbolState({
                              symbolId: sym.id,
                              centerPx: { cx, cy },
                              initialDistPx: Math.max(8, Math.hypot(symRadiusPx, symRadiusPx)),
                              initialScale: symScale,
                            });
                          }}
                        />
                      </g>
                    )}

                    {/* Non-Overlapping Geological Symbol Label + Leader Line */}
                    {layerVisibility.annotations && (
                      <g className="pointer-events-none">
                        {symLabelPlacement.needsLeader && (
                          <line
                            x1={cx}
                            y1={cy}
                            x2={symLabelPlacement.leaderTargetX}
                            y2={symLabelPlacement.leaderTargetY}
                            stroke={symColor}
                            strokeWidth="0.9"
                            strokeDasharray="2,2"
                          />
                        )}
                        <rect
                          x={symLabelPlacement.boxX}
                          y={symLabelPlacement.boxY}
                          width={sBoxW}
                          height={sBoxH}
                          rx="2"
                          fill={isLight ? '#FFFFFF' : '#0B0E14'}
                          fillOpacity="0.92"
                          stroke={isSelSym ? '#0284C7' : symColor}
                          strokeWidth={isSelSym ? '1.2' : '0.8'}
                        />
                        <text
                          x={symLabelPlacement.boxX + 4}
                          y={symLabelPlacement.boxY + 10.5}
                          fontSize="9"
                          fontWeight="600"
                          fontFamily="IBM Plex Mono, monospace"
                          fill={isLight ? '#0F172A' : '#E2E8F0'}
                        >
                          {symLabelText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* ====================================================================
                LAYER 8: SURVEY CONTROL POINTS WITH NON-OVERLAPPING CALLOUTS (Sections 5, 6, 7, 8)
                Placed, dragged, and rendered using the unified master coordinate system
               ==================================================================== */}
            {layerVisibility.controlPoints !== false &&
              surfaceControlPoints
                .filter((cp) => cp.visible !== false)
                .map((cp) => {
                const { cx, cy } = coordManager.worldToScreen(cp.point);
                const isSelCp = selectedControlPointId === cp.id;

                canvasObstacles.push({
                  x: cx - 10,
                  y: cy - 10,
                  width: 20,
                  height: 20,
                });

                const cpBoxW = 92;
                const cpBoxH = 34;
                const cpPlacement = computeNonOverlappingLabelPlacement({
                  anchorX: cx,
                  anchorY: cy,
                  boxW: cpBoxW,
                  boxH: cpBoxH,
                  occupiedBoxes: canvasObstacles,
                  obstacleSegments: canvasSegments,
                  bounds: {
                    minX: 10,
                    minY: 10,
                    maxX: viewW - 10,
                    maxY: viewH - 10,
                  },
                });
                canvasObstacles.push({
                  x: cpPlacement.boxX,
                  y: cpPlacement.boxY,
                  width: cpBoxW,
                  height: cpBoxH,
                });

                return (
                  <g
                    key={cp.id}
                    className={
                      cp.locked
                        ? 'cursor-not-allowed'
                        : 'cursor-grab active:cursor-grabbing'
                    }
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey && !cp.locked) {
                        handleDeleteControlPoint(cp.id);
                        return;
                      }
                      setSelectedControlPointId(cp.id);
                      if (!cp.locked) {
                        setControlPointPast((p) => [...p.slice(-24), controlPoints]);
                        setControlPointFuture([]);
                        setDraggingControlPointId(cp.id);
                      }
                    }}
                  >
                    {/* Leader Line when label box is displaced to avoid overlapping joints/boundaries */}
                    {cpPlacement.needsLeader && (
                      <line
                        x1={cx}
                        y1={cy}
                        x2={cpPlacement.leaderTargetX}
                        y2={cpPlacement.leaderTargetY}
                        stroke="#10B981"
                        strokeWidth="1.1"
                        strokeDasharray="3,2"
                        className="pointer-events-none"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelCp ? '8' : '6.5'}
                      fill={isSelCp ? 'rgba(16, 185, 129, 0.32)' : isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.8)'}
                      stroke={cp.locked ? '#F59E0B' : isSelCp ? '#10B981' : '#059669'}
                      strokeWidth={isSelCp ? '2.2' : '1.6'}
                    />
                    <line
                      x1={cx - 9}
                      y1={cy}
                      x2={cx + 9}
                      y2={cy}
                      stroke={cp.locked ? '#F59E0B' : '#10B981'}
                      strokeWidth="1.5"
                      className="pointer-events-none"
                    />
                    <line
                      x1={cx}
                      y1={cy - 9}
                      x2={cx}
                      y2={cy + 9}
                      stroke={cp.locked ? '#F59E0B' : '#10B981'}
                      strokeWidth="1.5"
                      className="pointer-events-none"
                    />
                    <rect
                      x={cpPlacement.boxX}
                      y={cpPlacement.boxY}
                      width={cpBoxW}
                      height={cpBoxH}
                      rx="2.5"
                      fill={isLight ? '#FFFFFF' : '#0B0E14'}
                      fillOpacity="0.94"
                      stroke={isSelCp ? '#10B981' : '#059669'}
                      strokeWidth={isSelCp ? '1.3' : '0.85'}
                      className="pointer-events-none"
                    />
                    <text
                      x={cpPlacement.boxX + 5}
                      y={cpPlacement.boxY + 10.5}
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="IBM Plex Mono, monospace"
                      fill={isLight ? '#047857' : '#6EE7B7'}
                      className="pointer-events-none"
                    >
                      {cp.label} {cp.locked ? '[LOCK]' : ''}
                    </text>
                    <text
                      x={cpPlacement.boxX + 5}
                      y={cpPlacement.boxY + 20.5}
                      fontSize="8.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fill={isLight ? '#0F172A' : '#E2E8F0'}
                      className="pointer-events-none"
                    >
                      X: {cp.point.x.toFixed(2)} m
                    </text>
                    <text
                      x={cpPlacement.boxX + 5}
                      y={cpPlacement.boxY + 30}
                      fontSize="8.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fill={isLight ? '#0F172A' : '#E2E8F0'}
                      className="pointer-events-none"
                    >
                      Y: {cp.point.y.toFixed(2)} m
                    </text>
                  </g>
                );
              })}
                </>
              );
            })()}

            {/* Draft Joint Polyline / Freehand / Smooth Spline while using "Add Joint", "Re-draw" or "Append" Tool */}
            {(activeTool === 'add_joint' ||
              activeTool === 'redraw_joint' ||
              activeTool === 'append_joint') &&
              draftJointPoints.length > 0 && (
                <g>
                  {(() => {
                    const allPts =
                      cursorMeters && !isFreehandDrawingJoint
                        ? jointDrawMode === 'magnetic_livewire' && livewirePreviewSegment.length >= 2
                          ? [...draftJointPoints, ...livewirePreviewSegment.slice(1)]
                          : [...draftJointPoints, cursorMeters]
                        : draftJointPoints;
                    const displayPts =
                      jointDrawMode === 'smooth_curve' && allPts.length >= 3
                        ? evaluateCatmullRomSplineThroughPoints(allPts, 4)
                        : allPts;
                    const cPts = displayPts.map((p) => coordManager.worldToScreen(p));
                    const ctrlCanvasPts = draftJointPoints.map((p) =>
                      coordManager.worldToScreen(p)
                    );
                    const d = cPts
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`)
                      .join(' ');
                    return (
                      <>
                        <path
                          d={d}
                          fill="none"
                          stroke={jointDrawMode === 'magnetic_livewire' ? '#22D3EE' : '#F59E0B'}
                          strokeWidth="2.5"
                          strokeDasharray={
                            jointDrawMode === 'freehand' || jointDrawMode === 'magnetic_livewire'
                              ? undefined
                              : '6,4'
                          }
                          className="pointer-events-none"
                        />
                        {ctrlCanvasPts.map((p, idx) => (
                          <circle
                            key={idx}
                            cx={p.cx}
                            cy={p.cy}
                            r={idx === 0 ? '5.5' : '4.5'}
                            fill={idx === 0 ? '#10B981' : '#F59E0B'}
                            stroke="#0B0E14"
                            strokeWidth="1.5"
                            className="cursor-grab active:cursor-grabbing"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setDraggingDraftJointIdx(idx);
                            }}
                          />
                        ))}
                      </>
                    );
                  })()}
                </g>
              )}

            {/* Measure Tool Overlay */}
            {activeTool === 'measure' && measurePts.length > 0 && (
              <g className="pointer-events-none">
                {(() => {
                  const pts =
                    measurePts.length === 1 && cursorMeters
                      ? [measurePts[0], cursorMeters]
                      : measurePts;
                  if (pts.length < 2) return null;
                  const p1 = coordManager.worldToScreen(pts[0]);
                  const p2 = coordManager.worldToScreen(pts[1]);
                  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                  return (
                    <>
                      <line
                        x1={p1.cx}
                        y1={p1.cy}
                        x2={p2.cx}
                        y2={p2.cy}
                        stroke="#22D3EE"
                        strokeWidth="2"
                        strokeDasharray="4,3"
                      />
                      <circle cx={p1.cx} cy={p1.cy} r="4.5" fill="#22D3EE" />
                      <circle cx={p2.cx} cy={p2.cy} r="4.5" fill="#22D3EE" />
                      <rect
                        x={(p1.cx + p2.cx) / 2 - 48}
                        y={(p1.cy + p2.cy) / 2 - 22}
                        width="96"
                        height="18"
                        rx="3"
                        fill={isLight ? '#FFFFFF' : '#0B0E14'}
                        stroke={isLight ? '#0284C7' : '#22D3EE'}
                        strokeWidth="1"
                      />
                      <text
                        x={(p1.cx + p2.cx) / 2}
                        y={(p1.cy + p2.cy) / 2 - 9}
                        textAnchor="middle"
                        fontSize="11"
                        fontFamily="IBM Plex Mono, monospace"
                        fill={isLight ? '#0369A1' : '#22D3EE'}
                      >
                        {dist.toFixed(2)} m
                      </text>
                    </>
                  );
                })()}
              </g>
            )}

            {/* Interactive Photo Fitting Handles: 4 Corners, 4 Edges, Piecewise Mesh Control Points C1..Cn, & Custom Polygon P1..Pn */}
            {activeTool === 'photo_fit' && currentPhoto.image && (
              <g>
                {/* 1. Piecewise Deformation Mesh Grid Overlay */}
                {showMeshGrid && (
                  <g transform={photoSvgTransform} className="pointer-events-none">
                    {[0, 0.25, 0.5, 0.75, 1].map((gridVal, gIdx) => {
                      const rowPts: { x: number; y: number }[] = [];
                      const colPts: { x: number; y: number }[] = [];
                      for (let s = 0; s <= 12; s++) {
                        const tStep = s / 12;
                        const wRow = evaluateForwardWarpedUV(
                          tStep,
                          gridVal,
                          currentPhoto.transform
                        );
                        rowPts.push({
                          x: surfaceRectPx.x + wRow.u * surfaceRectPx.width,
                          y: surfaceRectPx.y + wRow.v * surfaceRectPx.height,
                        });
                        const wCol = evaluateForwardWarpedUV(
                          gridVal,
                          tStep,
                          currentPhoto.transform
                        );
                        colPts.push({
                          x: surfaceRectPx.x + wCol.u * surfaceRectPx.width,
                          y: surfaceRectPx.y + wCol.v * surfaceRectPx.height,
                        });
                      }
                      const dRow = rowPts
                        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                        .join(' ');
                      const dCol = colPts
                        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                        .join(' ');
                      return (
                        <g key={`mesh-grid-${gIdx}`}>
                          <path
                            d={dRow}
                            fill="none"
                            stroke="rgba(34, 211, 238, 0.38)"
                            strokeWidth="1"
                            strokeDasharray="3,3"
                          />
                          <path
                            d={dCol}
                            fill="none"
                            stroke="rgba(34, 211, 238, 0.38)"
                            strokeWidth="1"
                            strokeDasharray="3,3"
                          />
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* 2. 4-Corner Projective Perspective Handles (TL, TR, BR, BL) inside photoSvgTransform */}
                <g transform={photoSvgTransform}>
                {[
                  { idx: 0, baseX: surfaceRectPx.x, baseY: surfaceRectPx.y, label: 'TL' },
                  {
                    idx: 1,
                    baseX: surfaceRectPx.x + surfaceRectPx.width,
                    baseY: surfaceRectPx.y,
                    label: 'TR',
                  },
                  {
                    idx: 2,
                    baseX: surfaceRectPx.x + surfaceRectPx.width,
                    baseY: surfaceRectPx.y + surfaceRectPx.height,
                    label: 'BR',
                  },
                  {
                    idx: 3,
                    baseX: surfaceRectPx.x,
                    baseY: surfaceRectPx.y + surfaceRectPx.height,
                    label: 'BL',
                  },
                ].map((corner) => {
                  const offset = currentPhoto.transform.perspectiveCorners[corner.idx];
                  const hx = corner.baseX + offset.x * surfaceRectPx.width;
                  const hy = corner.baseY + offset.y * surfaceRectPx.height;
                  return (
                    <g key={corner.label}>
                      <circle
                        cx={hx}
                        cy={hy}
                        r="8"
                        fill="#06B6D4"
                        stroke="#FFFFFF"
                        strokeWidth="2"
                        className="cursor-pointer"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setTransformPast((prev) => [...prev.slice(-18), currentPhoto.transform]);
                          setTransformFuture([]);
                          setDraggingPhotoHandle({
                            type: 'corner',
                            cornerIndex: corner.idx,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            initialTransform: {
                              ...currentPhoto.transform,
                              perspectiveCorners: [
                                { ...currentPhoto.transform.perspectiveCorners[0] },
                                { ...currentPhoto.transform.perspectiveCorners[1] },
                                { ...currentPhoto.transform.perspectiveCorners[2] },
                                { ...currentPhoto.transform.perspectiveCorners[3] },
                              ],
                            },
                          });
                        }}
                      />
                      <text
                        x={hx}
                        y={hy - 12}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="IBM Plex Mono, monospace"
                        fill="#22D3EE"
                      >
                        {corner.label}
                      </text>
                    </g>
                  );
                })}

                {/* 3. 4-Edge Midpoint Handles (TOP, RIGHT, BOTTOM, LEFT) */}
                {[
                  {
                    idx: 0,
                    baseX: surfaceRectPx.centerX,
                    baseY: surfaceRectPx.y,
                    label: 'TOP',
                  },
                  {
                    idx: 1,
                    baseX: surfaceRectPx.x + surfaceRectPx.width,
                    baseY: surfaceRectPx.centerY,
                    label: 'RIGHT',
                  },
                  {
                    idx: 2,
                    baseX: surfaceRectPx.centerX,
                    baseY: surfaceRectPx.y + surfaceRectPx.height,
                    label: 'BOT',
                  },
                  {
                    idx: 3,
                    baseX: surfaceRectPx.x,
                    baseY: surfaceRectPx.centerY,
                    label: 'LEFT',
                  },
                ].map((edge) => {
                  const eOff =
                    currentPhoto.transform.edgeOffsets?.[edge.idx] || { x: 0, y: 0 };
                  const ex = edge.baseX + eOff.x * surfaceRectPx.width;
                  const ey = edge.baseY + eOff.y * surfaceRectPx.height;
                  return (
                    <g key={edge.label}>
                      <rect
                        x={ex - 6}
                        y={ey - 6}
                        width="12"
                        height="12"
                        rx="2"
                        fill="#F59E0B"
                        stroke="#FFFFFF"
                        strokeWidth="1.6"
                        className="cursor-pointer"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setTransformPast((prev) => [...prev.slice(-18), currentPhoto.transform]);
                          setTransformFuture([]);
                          setDraggingPhotoHandle({
                            type: 'edge',
                            edgeIndex: edge.idx,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            initialTransform: { ...currentPhoto.transform },
                          });
                        }}
                      />
                      <text
                        x={ex}
                        y={ey - 10}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fill="#FBBF24"
                      >
                        {edge.label}
                      </text>
                    </g>
                  );
                })}

                {/* 4. Piecewise Mesh Control Point Handles (C1..Cn) */}
                {(photoEditSubTab === 'mesh_warp' || showMeshGrid) &&
                  (
                    currentPhoto.transform.meshControlPoints ||
                    createDefaultMeshControlPoints(3, 3)
                  ).map((cp) => {
                    const cpx = surfaceRectPx.x + cp.dstU * surfaceRectPx.width;
                    const cpy = surfaceRectPx.y + cp.dstV * surfaceRectPx.height;
                    return (
                      <g key={cp.id}>
                        <circle
                          cx={cpx}
                          cy={cpy}
                          r="6"
                          fill="#10B981"
                          stroke="#0B0E14"
                          strokeWidth="1.8"
                          className="cursor-grab active:cursor-grabbing"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setTransformPast((prev) => [
                              ...prev.slice(-18),
                              currentPhoto.transform,
                            ]);
                            setTransformFuture([]);
                            setDraggingPhotoHandle({
                              type: 'mesh_cp',
                              cpId: cp.id,
                              startClientX: e.clientX,
                              startClientY: e.clientY,
                              initialTransform: { ...currentPhoto.transform },
                            });
                          }}
                        />
                        <text
                          x={cpx + 8}
                          y={cpy + 3}
                          fontSize="8.5"
                          fontFamily="IBM Plex Mono, monospace"
                          fill="#34D399"
                          className="pointer-events-none"
                        >
                          {cp.label}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* 5. Custom Polygon Shape Boundary Handles (P1, P2, P3, P4, P5, P6, P7...) */}
                {(photoEditSubTab === 'custom_mask' || currentPhoto.transform.useCustomMask) &&
                  (currentPhoto.transform.customMaskPoints || []).length > 0 && (
                    <g>
                      {(currentPhoto.transform.customMaskPoints || []).length >= 2 && (
                        <path
                          d={customMaskPolygonPath}
                          fill="rgba(245, 158, 11, 0.08)"
                          stroke="#F59E0B"
                          strokeWidth="2"
                          strokeDasharray="6,4"
                          className="pointer-events-none"
                        />
                      )}
                      {(currentPhoto.transform.customMaskPoints || []).map((pt, vIdx) => {
                        const { cx, cy } = coordManager.worldToScreen(pt);
                        return (
                          <g key={`mask-p-${vIdx}`}>
                            <circle
                              cx={cx}
                              cy={cy}
                              r="6.5"
                              fill="#F59E0B"
                              stroke="#0B0E14"
                              strokeWidth="2"
                              className="cursor-grab active:cursor-grabbing"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setTransformPast((prev) => [
                                  ...prev.slice(-18),
                                  currentPhoto.transform,
                                ]);
                                setTransformFuture([]);
                                setDraggingPhotoHandle({
                                  type: 'mask_vertex',
                                  maskVertexIndex: vIdx,
                                  startClientX: e.clientX,
                                  startClientY: e.clientY,
                                  initialTransform: { ...currentPhoto.transform },
                                });
                              }}
                            />
                            <text
                              x={cx}
                              y={cy - 10}
                              textAnchor="middle"
                              fontSize="9.5"
                              fontWeight="700"
                              fontFamily="IBM Plex Mono, monospace"
                              fill="#FDE68A"
                              className="pointer-events-none"
                            >
                              P{vIdx + 1}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  )}
              </g>
            )}

            {/* ====================================================================
                INTERACTIVE LITHOLOGY REGION HANDLES & DRAFT POLYGON (Sections 7, 8, 11, 13)
               ==================================================================== */}
            {activeTool === 'lithology' && (
              <g>
                {/* Draft Polygon Currently Being Drawn by User */}
                {isDrawingLithologyPolygon && draftLithologyPoints.length > 0 && (
                  <g>
                    {(() => {
                      const previewPts = cursorMeters
                        ? [...draftLithologyPoints, cursorMeters]
                        : draftLithologyPoints;
                      if (previewPts.length < 2) return null;
                      const dPath =
                        previewPts
                          .map((pt, idx) => {
                            const { cx, cy } = coordManager.worldToScreen(pt);
                            return `${idx === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
                          })
                          .join(' ') + (draftLithologyPoints.length >= 3 ? ' Z' : '');
                      return (
                        <path
                          d={dPath}
                          fill="rgba(245, 158, 11, 0.14)"
                          stroke="#F59E0B"
                          strokeWidth="2"
                          strokeDasharray="5,4"
                          className="pointer-events-none"
                        />
                      );
                    })()}
                    {draftLithologyPoints.map((pt, idx) => {
                      const { cx, cy } = coordManager.worldToScreen(pt);
                      const isFirst = idx === 0 && draftLithologyPoints.length >= 3;
                      return (
                        <g key={`draft-lith-${idx}`}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isFirst ? '7' : '5.5'}
                            fill={isFirst ? '#10B981' : '#F59E0B'}
                            stroke="#0B0E14"
                            strokeWidth="1.8"
                            className="cursor-pointer"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              if (isFirst) {
                                const newReg = createLithologyRegionFromPolygon(
                                  activeSurface,
                                  draftLithologyPoints,
                                  'quartzite',
                                  undefined,
                                  joints,
                                  currentPhoto
                                );
                                handleUpdateLithologyWithHistory([...lithologyRegions, newReg]);
                                setSelectedLithologyRegionId(newReg.id);
                                setDraftLithologyPoints([]);
                                setIsDrawingLithologyPolygon(false);
                                return;
                              }
                              setDraggingDraftLithologyIdx(idx);
                            }}
                          />
                          {isFirst && (
                            <text
                              x={cx}
                              y={cy - 10}
                              textAnchor="middle"
                              fontSize="8.5"
                              fontWeight="700"
                              fontFamily="IBM Plex Mono, monospace"
                              fill="#34D399"
                              className="pointer-events-none"
                            >
                              CLICK TO CLOSE
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* Draggable Reshaping Vertices (L1..Ln) & Midpoint '+' Insertion for Selected Lithology Region */}
                {!isDrawingLithologyPolygon &&
                  lithologyRegions
                    .filter((r) => r.surface === activeSurface)
                    .map((reg) => {
                      const isSel =
                        selectedLithologyRegionId === reg.id ||
                        (!selectedLithologyRegionId &&
                          lithologyRegions.filter((x) => x.surface === activeSurface)[0]?.id ===
                            reg.id);
                      if (!isSel) return null;
                      return (
                        <g key={`handles-${reg.id}`}>
                          {/* Midpoint '+' Handles on Polygon Edges to Insert Boundary Points */}
                          {reg.polygon.map((ptA, vIdx) => {
                            const ptB = reg.polygon[(vIdx + 1) % reg.polygon.length];
                            const cA = coordManager.worldToScreen(ptA);
                            const cB = coordManager.worldToScreen(ptB);
                            const mx = (cA.cx + cB.cx) / 2;
                            const my = (cA.cy + cB.cy) / 2;
                            const midMeters = {
                              x: Number(((ptA.x + ptB.x) / 2).toFixed(3)),
                              y: Number(((ptA.y + ptB.y) / 2).toFixed(3)),
                            };
                            return (
                              <g
                                key={`lith-mid-${vIdx}`}
                                className="cursor-pointer opacity-75 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updated = addVertexToLithologyRegion(
                                    reg,
                                    vIdx,
                                    midMeters
                                  );
                                  handleUpdateLithologyWithHistory(
                                    lithologyRegions.map((r) => (r.id === reg.id ? updated : r))
                                  );
                                }}
                              >
                                <circle
                                  cx={mx}
                                  cy={my}
                                  r="4.5"
                                  fill="#0F172A"
                                  stroke="#F59E0B"
                                  strokeWidth="1.4"
                                />
                                <text
                                  x={mx}
                                  y={my + 3}
                                  textAnchor="middle"
                                  fontSize="9"
                                  fontFamily="IBM Plex Mono, monospace"
                                  fill="#F59E0B"
                                  className="pointer-events-none"
                                >
                                  +
                                </text>
                              </g>
                            );
                          })}

                          {/* Boundary Vertex Handles */}
                          {reg.polygon.map((pt, vIdx) => {
                            const { cx, cy } = coordManager.worldToScreen(pt);
                            return (
                              <g key={`lith-v-${vIdx}`}>
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r="6"
                                  fill="#F59E0B"
                                  stroke="#0B0E14"
                                  strokeWidth="1.8"
                                  className="cursor-grab active:cursor-grabbing"
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    if (e.shiftKey && reg.polygon.length > 3) {
                                      const updated = removeVertexFromLithologyRegion(reg, vIdx);
                                      handleUpdateLithologyWithHistory(
                                        lithologyRegions.map((r) =>
                                          r.id === reg.id ? updated : r
                                        )
                                      );
                                      return;
                                    }
                                    setSelectedLithologyRegionId(reg.id);
                                    setDraggingLithologyVertex({
                                      regionId: reg.id,
                                      vertexIndex: vIdx,
                                    });
                                  }}
                                />
                                <text
                                  x={cx}
                                  y={cy - 9}
                                  textAnchor="middle"
                                  fontSize="9"
                                  fontWeight="700"
                                  fontFamily="IBM Plex Mono, monospace"
                                  fill="#FDE68A"
                                  className="pointer-events-none"
                                >
                                  L{vIdx + 1}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
              </g>
            )}

            {/* ==============================================================
                LAYER: AUTOMATED ROCK SUPPORT PATTERN (BOLTS + SFRS RING)
               ============================================================== */}
            {activeSurface === 'face' && supportConfig.enabledOnCanvas && (
              <g className="pointer-events-none">
                {supportConfig.sfrsThicknessMm > 0 &&
                  rockSupportOverlay.sfrsInnerPolygon.length > 2 && (
                    <polyline
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth={Math.max(
                        3 / viewport.zoom,
                        (supportConfig.sfrsThicknessMm / 1000) * pxPerMeter
                      )}
                      strokeOpacity={0.45}
                      points={rockSupportOverlay.sfrsInnerPolygon
                        .map((pt) => {
                          const s = coordManager.worldToScreen(pt);
                          return `${s.cx.toFixed(1)},${s.cy.toFixed(1)}`;
                        })
                        .join(' ')}
                    />
                  )}
                {rockSupportOverlay.bolts.map((b) => {
                  const col = coordManager.worldToScreen(b.collar);
                  const toe = coordManager.worldToScreen(b.toe);
                  return (
                    <g key={b.id}>
                      <line
                        x1={col.cx}
                        y1={col.cy}
                        x2={toe.cx}
                        y2={toe.cy}
                        stroke="#10B981"
                        strokeWidth={2.2 / viewport.zoom}
                        strokeDasharray={`${5 / viewport.zoom} ${2 / viewport.zoom}`}
                      />
                      <circle
                        cx={col.cx}
                        cy={col.cy}
                        r={3.5 / viewport.zoom}
                        fill="#059669"
                        stroke="#A7F3D0"
                        strokeWidth={1.2 / viewport.zoom}
                      />
                      <text
                        x={toe.cx + 4 / viewport.zoom}
                        y={toe.cy - 3 / viewport.zoom}
                        fontSize={9.5 / viewport.zoom}
                        fontWeight="700"
                        fontFamily="IBM Plex Mono, monospace"
                        fill="#6EE7B7"
                      >
                        {b.label} ({b.lengthMeters}m)
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* ==============================================================
                AUTOCAD OBJECT SNAP (OSNAP - F3) & DYNAMIC INPUT (DYN - F12)
               ============================================================== */}
            {activeOsnapCandidate && (
              <g className="pointer-events-none">
                {activeOsnapCandidate.type === 'ENDPOINT' ? (
                  <rect
                    x={activeOsnapCandidate.cx - 6 / viewport.zoom}
                    y={activeOsnapCandidate.cy - 6 / viewport.zoom}
                    width={12 / viewport.zoom}
                    height={12 / viewport.zoom}
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth={2 / viewport.zoom}
                  />
                ) : (
                  <polygon
                    points={`${activeOsnapCandidate.cx},${
                      activeOsnapCandidate.cy - 7 / viewport.zoom
                    } ${activeOsnapCandidate.cx - 6.5 / viewport.zoom},${
                      activeOsnapCandidate.cy + 5.5 / viewport.zoom
                    } ${activeOsnapCandidate.cx + 6.5 / viewport.zoom},${
                      activeOsnapCandidate.cy + 5.5 / viewport.zoom
                    }`}
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth={2 / viewport.zoom}
                  />
                )}
                <text
                  x={activeOsnapCandidate.cx + 9 / viewport.zoom}
                  y={activeOsnapCandidate.cy - 7 / viewport.zoom}
                  fontSize={9.5 / viewport.zoom}
                  fontWeight="700"
                  fontFamily="IBM Plex Mono, monospace"
                  fill="#4ADE80"
                >
                  {activeOsnapCandidate.type}
                </text>
              </g>
            )}

            {dynamicInputReadout && cursorCanvasPx && (
              <g className="pointer-events-none">
                <line
                  x1={dynamicInputReadout.refCx}
                  y1={dynamicInputReadout.refCy}
                  x2={cursorCanvasPx.cx}
                  y2={cursorCanvasPx.cy}
                  stroke="#38BDF8"
                  strokeWidth={1.3 / viewport.zoom}
                  strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
                />
                <rect
                  x={cursorCanvasPx.cx + 12 / viewport.zoom}
                  y={cursorCanvasPx.cy + 10 / viewport.zoom}
                  width={128 / viewport.zoom}
                  height={20 / viewport.zoom}
                  rx={2 / viewport.zoom}
                  fill={isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(9, 13, 22, 0.92)'}
                  stroke={isLight ? '#0284C7' : '#38BDF8'}
                  strokeWidth={1 / viewport.zoom}
                />
                <text
                  x={cursorCanvasPx.cx + 17 / viewport.zoom}
                  y={cursorCanvasPx.cy + 23.5 / viewport.zoom}
                  fontSize={9.5 / viewport.zoom}
                  fontWeight="700"
                  fontFamily="IBM Plex Mono, monospace"
                  fill={isLight ? '#0F172A' : '#E0F2FE'}
                >
                  L={dynamicInputReadout.lenMeters}m ∠{dynamicInputReadout.angleDeg}°
                </text>
              </g>
            )}

            {/* Legacy Layer 8 placeholder removed: rendered in unified obstacle-aware pass above */}
            {cursorCanvasPx && (
              <g className="pointer-events-none" opacity="0.88">
                <line
                  x1={cursorCanvasPx.cx - 10 / viewport.zoom}
                  y1={cursorCanvasPx.cy}
                  x2={cursorCanvasPx.cx + 10 / viewport.zoom}
                  y2={cursorCanvasPx.cy}
                  stroke={isLight ? '#000000' : '#FFFFFF'}
                  strokeWidth={1.4 / viewport.zoom}
                />
                <line
                  x1={cursorCanvasPx.cx}
                  y1={cursorCanvasPx.cy - 10 / viewport.zoom}
                  x2={cursorCanvasPx.cx}
                  y2={cursorCanvasPx.cy + 10 / viewport.zoom}
                  stroke={isLight ? '#000000' : '#FFFFFF'}
                  strokeWidth={1.4 / viewport.zoom}
                />
                <circle
                  cx={cursorCanvasPx.cx}
                  cy={cursorCanvasPx.cy}
                  r={2.5 / viewport.zoom}
                  fill="none"
                  stroke={isLight ? '#000000' : '#FFFFFF'}
                  strokeWidth={1.2 / viewport.zoom}
                />
              </g>
            )}
            </g>
          </svg>

          {/* Floating Add Joint / Re-draw / Append Joint Completion Prompt (Sections 9, 10, 11, 12) */}
          {(activeTool === 'add_joint' ||
            activeTool === 'redraw_joint' ||
            activeTool === 'append_joint') && (
            <div className="absolute top-2.5 left-2.5 max-w-[calc(100%-1.25rem)] flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 bg-slate-900/95 border border-amber-500/50 rounded shadow-lg text-xs z-20">
              <span className="font-mono text-amber-300">
                {activeTool === 'redraw_joint'
                  ? `RE-DRAW TRACE ${selectedJoint?.set || ''}: (${draftJointPoints.length} pts)`
                  : activeTool === 'append_joint'
                  ? `CONTINUE / APPEND ${selectedJoint?.set || ''}: (${draftJointPoints.length} pts)`
                  : `DRAW FEATURE (${draftJointPoints.length} pts)`}
              </span>

              {/* Drawing Mode Selector: Magnetic Live-Wire | 1-Click Auto-Follow | Polyline | Freehand | Smooth Spline */}
              <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 rounded border border-slate-700">
                {(
                  [
                    { id: 'magnetic_livewire', label: '⚡ Magnetic Crack' },
                    { id: 'seed_autotrace', label: '🎯 1-Click Auto' },
                    { id: 'polyline', label: 'Polyline' },
                    { id: 'freehand', label: 'Freehand' },
                    { id: 'smooth_curve', label: 'Smooth Spline' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setJointDrawMode(mode.id)}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                      jointDrawMode === mode.id
                        ? 'bg-amber-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {activeTool === 'add_joint' && (
                <>
                  <select
                    value={draftFeatureType}
                    onChange={(e) =>
                      setDraftFeatureType(e.target.value as GeologicalFeatureType)
                    }
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200"
                  >
                    <option value="joint">Joint</option>
                    <option value="open_joint">Open Joint</option>
                    <option value="closed_joint">Closed Joint</option>
                    <option value="fracture">Fracture</option>
                    <option value="discontinuity">Discontinuity</option>
                    <option value="fault">Fault (F1)</option>
                    <option value="shear">Shear Surface (F1)</option>
                    <option value="shear_zone">Shear Zone (F1)</option>
                    <option value="shear_plane">Shear Plane (F1)</option>
                    <option value="slickenside">Slickenside</option>
                    <option value="bedding">Bedding (J0)</option>
                    <option value="foliation">Foliation (J0)</option>
                    <option value="schistosity">Schistosity (J0)</option>
                    <option value="cleavage">Cleavage</option>
                    <option value="lineation">Lineation</option>
                    <option value="fold">Fold Axis</option>
                    <option value="anticline">Anticline</option>
                    <option value="syncline">Syncline</option>
                    <option value="vein">Vein</option>
                    <option value="dyke">Dyke / Intrusive</option>
                    <option value="contact">Contact</option>
                    <option value="lithological_contact">Lithological Contact</option>
                    <option value="clay_infill">Clay Infill</option>
                    <option value="clay_band">Clay Band</option>
                    <option value="seam">Weak Seam</option>
                    <option value="weathered_zone">Weathered Zone</option>
                    <option value="breccia_zone">Breccia Zone</option>
                    <option value="crushed_zone">Crushed Zone</option>
                    <option value="water_seepage">Water Seepage</option>
                    <option value="water_flow">Water Flow</option>
                  </select>
                  <select
                    value={draftSetId}
                    onChange={(e) => setDraftSetId(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-200"
                  >
                    {['J0', 'J1', 'J2', 'J3', 'J4', 'J5', 'F1'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {draftJointPoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftJointPoints((prev) => prev.slice(0, -1))}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-mono text-[11px]"
                  title="Undo last draft vertex"
                >
                  Undo Pt
                </button>
              )}
              {draftJointPoints.length >= 2 && (
                <button
                  type="button"
                  onClick={() => finishDraftJoint()}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
                >
                  Finish Trace
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraftJointPoints([]);
                  setActiveTool('select');
                }}
                className="px-2 py-1 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Floating Survey Control Point Editable Panel (Sections 5, 6, 7, 8) */}
          {(activeTool === 'control_point' || selectedControlPointId) && (
            <div className="absolute top-2.5 left-2.5 w-[var(--eswa-floating-panel-w,310px)] max-w-[calc(100%-1.25rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto bg-slate-900/95 border border-emerald-500/50 rounded shadow-xl p-2.5 text-xs font-mono z-20 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span className="text-emerald-300 font-semibold flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5" />
                  SURVEY CONTROL POINTS ({surfaceControlPoints.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndoLithology}
                    disabled={controlPointPast.length === 0}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300"
                    title="Undo Control Point Change"
                  >
                    <Undo2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedoLithology}
                    disabled={controlPointFuture.length === 0}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300"
                    title="Redo Control Point Change"
                  >
                    <Redo2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedControlPointId(null);
                      if (activeTool === 'control_point') setActiveTool('select');
                    }}
                    className="text-slate-400 hover:text-white px-1"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {selectedControlPoint ? (
                <div className="space-y-2 bg-slate-950/80 p-2.5 rounded border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-bold">
                      {selectedControlPoint.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateControlPointsWithHistory((prev) =>
                            prev.map((c) =>
                              c.id === selectedControlPoint.id
                                ? { ...c, visible: c.visible === false ? true : false }
                                : c
                            )
                          )
                        }
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300 flex items-center gap-1"
                        title="Hide / Show Control Point"
                      >
                        {selectedControlPoint.visible === false ? (
                          <>
                            <EyeOff className="w-3 h-3 text-amber-400" /> Hidden
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3 text-emerald-400" /> Visible
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateControlPointsWithHistory((prev) =>
                            prev.map((c) =>
                              c.id === selectedControlPoint.id
                                ? { ...c, locked: !c.locked }
                                : c
                            )
                          )
                        }
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300 flex items-center gap-1"
                        title="Lock / Unlock Control Point"
                      >
                        {selectedControlPoint.locked ? (
                          <>
                            <Lock className="w-3 h-3 text-amber-400" /> Locked
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3 h-3 text-slate-400" /> Unlocked
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Name</span>
                      <input
                        type="text"
                        value={cpDraftLabel}
                        disabled={selectedControlPoint.locked}
                        onChange={(e) => setCpDraftLabel(e.target.value)}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-200 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">X (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={cpDraftX}
                        disabled={selectedControlPoint.locked}
                        onChange={(e) => setCpDraftX(e.target.value)}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Y (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={cpDraftY}
                        disabled={selectedControlPoint.locked}
                        onChange={(e) => setCpDraftY(e.target.value)}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={selectedControlPoint.locked}
                      onClick={() => {
                        const nx = parseFloat(cpDraftX);
                        const ny = parseFloat(cpDraftY);
                        if (Number.isNaN(nx) || Number.isNaN(ny)) return;
                        const nextPt = {
                          x: Number(nx.toFixed(3)),
                          y: Number(ny.toFixed(3)),
                        };
                        const proj = coordManager.worldToScreen(nextPt);
                        handleUpdateControlPointsWithHistory((prev) =>
                          prev.map((c) =>
                            c.id === selectedControlPoint.id
                              ? {
                                  ...c,
                                  label: cpDraftLabel.trim() || c.label,
                                  point: nextPt,
                                  imageUV: { u: proj.u, v: proj.v },
                                }
                              : c
                          )
                        );
                        onUpdateStatusMessage?.(
                          `Updated ${cpDraftLabel || selectedControlPoint.label} to X: ${nextPt.x.toFixed(
                            2
                          )} m, Y: ${nextPt.y.toFixed(2)} m.`
                        );
                      }}
                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded text-[11px]"
                    >
                      [Apply]
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteControlPoint(selectedControlPoint.id)}
                      className="flex-1 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded text-[11px]"
                    >
                      [Delete]
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-300 leading-relaxed">
                  Click anywhere on the tunnel surface to create a survey control point, or select/drag an existing point.
                </div>
              )}

              {surfaceControlPoints.length > 0 && (
                <div className="max-h-28 overflow-y-auto space-y-1 pt-1 border-t border-slate-800">
                  {surfaceControlPoints.map((cp) => (
                    <div
                      key={cp.id}
                      onClick={() => setSelectedControlPointId(cp.id)}
                      className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-[10px] ${
                        selectedControlPointId === cp.id
                          ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-200'
                          : 'bg-slate-950/60 hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <span>
                        <strong>{cp.label}</strong> · X: {cp.point.x.toFixed(2)}m, Y:{' '}
                        {cp.point.y.toFixed(2)}m
                      </span>
                      <div className="flex items-center gap-1">
                        {cp.locked && <Lock className="w-2.5 h-2.5 text-amber-400" />}
                        {cp.visible === false && (
                          <EyeOff className="w-2.5 h-2.5 text-slate-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Floating Professional Geological Symbol Library & Interactive Editor (Sections 9, 10, 12, 15) */}
          {(activeTool === 'geological_symbol' || selectedSymbol) && (
            <div className="absolute top-2.5 left-2.5 w-[var(--eswa-floating-panel-w,330px)] max-w-[calc(100%-1.25rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto bg-slate-900/95 border border-purple-500/50 rounded shadow-xl p-2.5 text-xs font-mono z-20 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span className="text-purple-300 font-semibold flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5" />
                  GEOLOGICAL SYMBOL LIBRARY ({surfacePlacedSymbols.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndoLithology}
                    disabled={symbolPast.length === 0}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300"
                    title="Undo Symbol Action"
                  >
                    <Undo2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedoLithology}
                    disabled={symbolFuture.length === 0}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300"
                    title="Redo Symbol Action"
                  >
                    <Redo2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSymbolId(null);
                      if (activeTool === 'geological_symbol') setActiveTool('select');
                    }}
                    className="text-slate-400 hover:text-white px-1"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Symbol Type Selector for Placing New Symbols */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400">
                  Select Standard Engineering Geology Symbol (Click canvas to place):
                </span>
                <select
                  value={
                    selectedSymbol ? selectedSymbol.symbolType : activeSymbolTypeToPlace
                  }
                  onChange={(e) => {
                    const nextType = e.target.value as GeologicalSymbolType;
                    setActiveSymbolTypeToPlace(nextType);
                    if (selectedSymbol && !selectedSymbol.locked) {
                      const nextMeta = getStructuralSymbolMeta(nextType);
                      handleUpdatePlacedSymbolsWithHistory((prev) =>
                        prev.map((s) =>
                          s.id === selectedSymbol.id
                            ? {
                                ...s,
                                symbolType: nextType,
                                color: nextMeta.defaultColor,
                              }
                            : s
                        )
                      );
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100 text-[11px]"
                >
                  {STRUCTURAL_GEOLOGICAL_SYMBOLS.map((item) => (
                    <option key={item.type} value={item.type}>
                      [{item.shortCode}] {item.label} — {item.category}
                    </option>
                  ))}
                </select>
              </div>

              {selectedSymbol ? (
                <div className="space-y-2 bg-slate-950/90 p-2.5 rounded border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300 font-bold">
                      EDIT SYMBOL: {selectedSymbol.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? { ...s, locked: !s.locked }
                                : s
                            )
                          )
                        }
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300"
                      >
                        {selectedSymbol.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePlacedSymbol(selectedSymbol.id)}
                        className="px-1.5 py-0.5 bg-rose-950/80 hover:bg-rose-900 text-rose-200 rounded text-[10px]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Label</span>
                      <input
                        type="text"
                        value={selectedSymbol.label}
                        disabled={selectedSymbol.locked}
                        onChange={(e) =>
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? { ...s, label: e.target.value }
                                : s
                            )
                          )
                        }
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">X (m)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={selectedSymbol.point.x}
                        disabled={selectedSymbol.locked}
                        onChange={(e) => {
                          const nx = parseFloat(e.target.value);
                          if (Number.isNaN(nx)) return;
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? { ...s, point: { x: nx, y: s.point.y } }
                                : s
                            )
                          );
                        }}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Y (m)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={selectedSymbol.point.y}
                        disabled={selectedSymbol.locked}
                        onChange={(e) => {
                          const ny = parseFloat(e.target.value);
                          if (Number.isNaN(ny)) return;
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? { ...s, point: { x: s.point.x, y: ny } }
                                : s
                            )
                          );
                        }}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Rotate (°)</span>
                      <input
                        type="number"
                        min="0"
                        max="360"
                        value={Math.round(selectedSymbol.rotationDeg)}
                        disabled={selectedSymbol.locked}
                        onChange={(e) => {
                          const deg =
                            ((Number(e.target.value) || 0) % 360 + 360) % 360;
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? {
                                    ...s,
                                    rotationDeg: deg,
                                    dipDirectionDeg: deg,
                                    strikeDeg: (deg - 90 + 360) % 360,
                                  }
                                : s
                            )
                          );
                        }}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Dip (0-90°)</span>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        value={selectedSymbol.dipDeg ?? 60}
                        disabled={selectedSymbol.locked}
                        onChange={(e) => {
                          const d = Math.max(
                            0,
                            Math.min(90, Number(e.target.value) || 0)
                          );
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? {
                                    ...s,
                                    dipDeg: d,
                                    dipDirectionDeg:
                                      s.dipDirectionDeg ?? s.rotationDeg,
                                  }
                                : s
                            )
                          );
                        }}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Size Scale</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="2.5"
                        value={selectedSymbol.scale}
                        disabled={selectedSymbol.locked}
                        onChange={(e) => {
                          const sc = Math.max(
                            0.5,
                            Math.min(2.5, Number(e.target.value) || 1)
                          );
                          handleUpdatePlacedSymbolsWithHistory((prev) =>
                            prev.map((s) =>
                              s.id === selectedSymbol.id
                                ? { ...s, scale: sc }
                                : s
                            )
                          );
                        }}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100 text-[11px]"
                      />
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-[10px] text-slate-300 pt-0.5">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedSymbol.uncertainOrientation)}
                      onChange={(e) =>
                        handleUpdatePlacedSymbolsWithHistory((prev) =>
                          prev.map((s) =>
                            s.id === selectedSymbol.id
                              ? { ...s, uncertainOrientation: e.target.checked }
                              : s
                          )
                        )
                      }
                    />
                    Orientation Uncertain (Show &apos;?&apos; rather than false precision)
                  </label>
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">
                  Click on the tunnel canvas to place a{' '}
                  <strong className="text-purple-300">
                    {getStructuralSymbolMeta(activeSymbolTypeToPlace).label}
                  </strong>{' '}
                  symbol, or click an existing symbol to move, rotate, resize, or edit it.
                </div>
              )}
            </div>
          )}

          {/* Complete Photo Fitting, Perspective, Piecewise Mesh Warp & Custom Polygon Mask Editor (Sections 1-5) */}
          {activeTool === 'photo_fit' && (
            <PhotoFittingPanel
              activeSurface={activeSurface}
              currentPhoto={currentPhoto}
              geometry={geometry}
              settings={settings}
              subTab={photoEditSubTab}
              onChangeSubTab={setPhotoEditSubTab}
              showMeshGrid={showMeshGrid}
              onToggleMeshGrid={setShowMeshGrid}
              addingControlPointMode={addingControlPointMode}
              onToggleAddingControlPointMode={setAddingControlPointMode}
              drawingCustomMaskMode={drawingCustomMaskMode}
              onToggleDrawingCustomMaskMode={setDrawingCustomMaskMode}
              onUpdateTransform={handleUpdateTransformWithHistory}
              onUpdateOpacity={(opacityVal) =>
                onUpdatePhotoSurface(activeSurface, (prev) => ({
                  ...prev,
                  opacity: opacityVal,
                }))
              }
              onUpdateCalibration={(focalMm, k1Val) =>
                onUpdatePhotoSurface(activeSurface, (prev) => ({
                  ...prev,
                  calibration: prev.calibration
                    ? {
                        ...prev.calibration,
                        focalLengthMm: focalMm,
                        radialDistortionK1: k1Val,
                      }
                    : undefined,
                }))
              }
              onFitToTunnel={onAutoFitCurrentPhoto}
              onUndoTransform={handleUndoTransform}
              onRedoTransform={handleRedoTransform}
              canUndoTransform={transformPast.length > 0}
              canRedoTransform={transformFuture.length > 0}
              onApply={async () => {
                if (currentPhoto.image) {
                  const finalWarped = await generatePiecewiseWarpedPhotoDataUrl(
                    currentPhoto.image,
                    currentPhoto.transform
                  );
                  onUpdatePhotoSurface(activeSurface, (prev) => ({
                    ...prev,
                    warpedImage: finalWarped,
                  }));
                }
                setAddingControlPointMode(false);
                setDrawingCustomMaskMode(false);
                setActiveTool('select');
              }}
              onCancel={() => {
                if (initialTransformSnapshot) {
                  onUpdatePhotoSurface(activeSurface, (prev) => ({
                    ...prev,
                    transform: initialTransformSnapshot,
                  }));
                }
                setAddingControlPointMode(false);
                setDrawingCustomMaskMode(false);
                setActiveTool('select');
              }}
            />
          )}

          {/* Measure Tool Readout */}
          {activeTool === 'measure' && (
            <div className="absolute top-10 left-3 px-3 py-2 bg-slate-900/95 border border-cyan-500/40 rounded-xs text-xs font-mono z-20">
              {measurementInfo ? (
                <span>
                  DIST = <strong className="text-cyan-300">{measurementInfo.distMeters} m</strong> ·
                  ANGLE = <strong className="text-cyan-300">{measurementInfo.angleDeg}°</strong>
                </span>
              ) : (
                <span className="text-slate-300">
                  DIST: Specify first and second point on tunnel surface (meters &amp; angle).
                </span>
              )}
            </div>
          )}

          {/* ==================================================================
              AUTOCAD IN-CANVAS VIEWPORT CONTROLS (TOP-LEFT: [-][Top][2D Wireframe])
             ================================================================== */}
          <div className="absolute top-2 left-2.5 flex flex-wrap items-center gap-1 font-mono text-[10px] z-10 pointer-events-auto">
            <button
              type="button"
              onClick={() => setShowCadViewCube((v) => !v)}
              className="px-1.5 py-0.5 bg-[#0D131F]/90 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 rounded-xs cursor-pointer"
              title="Toggle ESWACAD ViewCube & Navigation Bar"
            >
              [-]
            </button>
            <button
              type="button"
              onClick={() => {
                const order: SurfaceType[] = ['face', 'crown', 'leftWall', 'rightWall'];
                const next = order[(order.indexOf(activeSurface) + 1) % order.length];
                onSelectSurface(next);
              }}
              className="px-2 py-0.5 bg-[#0D131F]/90 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 rounded-xs font-semibold cursor-pointer"
              title="Click to cycle Model Space Surface Viewport"
            >
              [{activeSurface === 'face'
                ? '1. TUNNEL FACE'
                : activeSurface === 'crown'
                ? '2. CROWN ARCH'
                : activeSurface === 'leftWall'
                ? '3. LEFT WALL'
                : '4. RIGHT WALL'}]
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCrackXRayOverlay((prev) => {
                  const next = !prev;
                  if (next) setShowDepthReliefOverlay(false);
                  return next;
                });
              }}
              className="px-2 py-0.5 bg-[#0D131F]/90 hover:bg-slate-800 text-emerald-300 border border-slate-700/80 rounded-xs cursor-pointer"
              title="Click to cycle Visual Style (2D Photo + Vector / Crack X-Ray / 3D Relief)"
            >
              [
              {showCrackXRayOverlay
                ? 'X-Ray Fracture Style'
                : showDepthReliefOverlay
                ? '3D Relief Style'
                : '2D Wireframe + Photo'}
              ]
            </button>
            <span className="hidden md:inline-block px-2 py-0.5 bg-[#0D131F]/80 text-slate-400 border border-slate-800 rounded-xs pointer-events-none">
              {geometry.customProfile?.name || 'Master'}: {geometry.width.toFixed(2)}m×
              {geometry.height.toFixed(2)}m · Drive N
              {String(Math.round(settings.driveDirection)).padStart(3, '0')}°E
            </span>
          </div>

          {/* ==================================================================
              AUTOCAD 3D VIEWCUBE & VERTICAL NAVIGATION BAR (TOP-RIGHT)
             ================================================================== */}
          {showCadViewCube && (
            <div className="hidden sm:flex flex-col items-end gap-2 absolute top-2.5 right-2.5 z-10 pointer-events-auto">
              {/* AutoCAD ViewCube with Compass Ring */}
              <div className="w-24 bg-[#0E1420]/92 border border-[#28354E] rounded-xs p-1.5 shadow-xl flex flex-col items-center">
                <div className="text-[8px] font-mono text-cyan-400 font-bold tracking-widest mb-1">
                  N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                </div>
                <div className="grid grid-cols-2 gap-1 w-full text-[9px] font-mono">
                  {(
                    [
                      { id: 'face', short: 'FACE' },
                      { id: 'crown', short: 'CROWN' },
                      { id: 'leftWall', short: 'L-WALL' },
                      { id: 'rightWall', short: 'R-WALL' },
                    ] as { id: SurfaceType; short: string }[]
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelectSurface(s.id)}
                      className={`py-1 rounded-xs border text-center font-bold transition-colors cursor-pointer ${
                        activeSurface === s.id
                          ? 'bg-cyan-600 text-white border-cyan-300'
                          : 'bg-[#161F30] text-slate-300 border-slate-700 hover:text-white hover:border-cyan-500/50'
                      }`}
                      title={`Switch Model Space to ${s.short}`}
                    >
                      {s.short}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowPhotogrammetryModal(true)}
                  className="mt-1 w-full py-0.5 bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-500/50 rounded-xs text-[8px] font-mono font-bold cursor-pointer"
                  title="Open 3D Isometric Wedge & Stereonet View"
                >
                  3D WEDGE VIEW
                </button>
              </div>

              {/* Vertical AutoCAD Floating Navigation Bar */}
              <div className="flex flex-col items-center gap-1 p-1 bg-[#0E1420]/92 border border-[#28354E] rounded-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => setIsSpacePanning((p) => !p)}
                  className={`p-1.5 rounded-xs cursor-pointer ${
                    isSpacePanning
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                  title="PAN (Spacebar or Middle-Mouse Drag)"
                >
                  <Hand className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => zoomViewportAtScreenPoint(viewport.zoom * 1.25)}
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xs cursor-pointer"
                  title="ZOOM IN (+)"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => zoomViewportAtScreenPoint(viewport.zoom / 1.25)}
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xs cursor-pointer"
                  title="ZOOM OUT (-)"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
                  className="px-1 py-0.5 text-[9px] font-mono font-bold text-amber-300 hover:text-white hover:bg-slate-800 rounded-xs cursor-pointer"
                  title="ZOOM EXTENTS (1:1 Reset)"
                >
                  1:1
                </button>
                <div className="w-4 h-px bg-slate-800 my-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool(activeTool === 'measure' ? 'select' : 'measure');
                    setMeasurePts([]);
                  }}
                  className={`p-1.5 rounded-xs cursor-pointer ${
                    activeTool === 'measure'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                  title="DIST — Measure Real-World Distance"
                >
                  <Ruler className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActiveTool(activeTool === 'dip_probe' ? 'select' : 'dip_probe')
                  }
                  className={`p-1.5 rounded-xs cursor-pointer ${
                    activeTool === 'dip_probe'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                  title="DIP — 3D Orientation Probe"
                >
                  <Compass className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* ==================================================================
              AUTOCAD UCS (USER COORDINATE SYSTEM) ICON (BOTTOM-LEFT)
             ================================================================== */}
          <div className="hidden sm:flex items-end absolute bottom-12 left-3 pointer-events-none z-10 opacity-85">
            <svg width="54" height="54" viewBox="0 0 54 54">
              {/* Origin Square */}
              <rect
                x="8"
                y="38"
                width="8"
                height="8"
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.5"
              />
              {/* Y Axis (Up / Elevation) */}
              <line x1="12" y1="42" x2="12" y2="10" stroke="#10B981" strokeWidth="2" />
              <polygon points="12,5 8.5,12 15.5,12" fill="#10B981" />
              <text
                x="17"
                y="13"
                fontSize="10"
                fontWeight="700"
                fontFamily="IBM Plex Mono, monospace"
                fill="#10B981"
              >
                Y
              </text>
              {/* X Axis (Right / Offset) */}
              <line x1="12" y1="42" x2="44" y2="42" stroke="#F43F5E" strokeWidth="2" />
              <polygon points="49,42 42,38.5 42,45.5" fill="#F43F5E" />
              <text
                x="41"
                y="35"
                fontSize="10"
                fontWeight="700"
                fontFamily="IBM Plex Mono, monospace"
                fill="#F43F5E"
              >
                X
              </text>
            </svg>
          </div>

          {/* ==================================================================
              CLEAN AUTOCAD COMMAND LINE DOCK (NO LEFT-CLICK OPTIONS BAR)
             ================================================================== */}
          <div className="absolute bottom-2 left-3 right-3 flex flex-col items-center gap-1 pointer-events-none z-20">
            {showLeftClickShortcutsBar ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecuteCadCommand(cadCommandInput);
                }}
                className="pointer-events-auto flex items-center justify-between gap-2 px-3 py-1 rounded-xs bg-[#0B0F17]/95 border border-[#2C3A55] shadow-2xl text-[11px] font-mono w-full max-w-xl"
              >
                <span className="text-[10px] font-bold text-amber-400 shrink-0">ESWACAD Command:</span>
                <input
                  type="text"
                  value={cadCommandInput}
                  onChange={(e) => setCadCommandInput(e.target.value)}
                  placeholder={
                    statusMessage
                      ? statusMessage.slice(0, 56)
                      : 'Type JOINT, SPLINE, AITRACE, SUPPORT, UNFOLD, SHEETSET, LITH, CP, 3D, PLOT...'
                  }
                  className="w-full bg-transparent text-[10px] font-mono text-white placeholder-slate-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowLeftClickShortcutsBar(false)}
                  className="text-slate-400 hover:text-white text-[10px] cursor-pointer"
                  title="Minimize ESWACAD Command Line"
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowLeftClickShortcutsBar(true)}
                className="pointer-events-auto px-3 py-0.5 rounded-xs bg-[#0B0F17]/95 hover:bg-slate-900 text-amber-300 border border-slate-700 text-[10px] font-mono shadow-lg cursor-pointer"
              >
                ESWACAD Command: _
              </button>
            )}
          </div>
        </div>

        {/* ====================================================================
            OVERBREAK & UNDERCUT ENGINEERING ANALYSIS PANEL
           ==================================================================== */}
        {activeTool === 'overbreak' && (
          <OverbreakAnalysisPanel
            activeSurface={activeSurface}
            geometry={geometry}
            settings={settings}
            controlPoints={controlPoints}
            surveyProfile={surveyProfile}
            analysis={overbreakAnalysis}
            selectedControlPointId={selectedControlPointId}
            onSelectControlPointId={setSelectedControlPointId}
            onUpdateControlPoints={(next) => handleUpdateControlPointsWithHistory(() => next)}
            onUpdateSurveyProfile={onUpdateSurveyProfile}
            onGenerateSampleAsBuiltProfile={onGenerateSampleAsBuiltProfile}
            onOpenProjectMemoryModal={() => onOpenProjectMemoryModal('volumes')}
            onOpenExportSheet={onOpenExportSheet}
            onClose={() => setActiveTool('select')}
            onStatusMessage={onUpdateStatusMessage}
          />
        )}

        {/* ====================================================================
            LITHOLOGY SELECTION, EDITING & AI DESCRIPTION PANEL (Sections 11–14)
           ==================================================================== */}
        {activeTool === 'lithology' && (
          <LithologyPanel
            activeSurface={activeSurface}
            geometry={geometry}
            settings={settings}
            photoSurface={currentPhoto}
            joints={joints}
            lithologyRegions={lithologyRegions}
            selectedRegionId={selectedLithologyRegionId}
            onSelectRegionId={setSelectedLithologyRegionId}
            onUpdateLithologyRegions={handleUpdateLithologyWithHistory}
            isDrawingLithologyPolygon={isDrawingLithologyPolygon}
            draftLithologyPoints={draftLithologyPoints}
            onStartDrawingLithologyPolygon={() => {
              setDraftLithologyPoints([]);
              setIsDrawingLithologyPolygon(true);
            }}
            onUndoLastDraftPoint={() => {
              setDraftLithologyPoints((prev) => prev.slice(0, -1));
            }}
            onReopenRegionAsDraft={(region) => {
              setDraftLithologyPoints(region.polygon.map((p: Point2D) => ({ ...p })));
              setReopenedLithologyRegionId(region.id);
              setSelectedLithologyRegionId(region.id);
              setIsDrawingLithologyPolygon(true);
              onUpdateStatusMessage?.(
                `Reopened "${region.lithologyName}" polygon (${region.polygon.length} pts) for interactive boundary editing.`
              );
            }}
            onFinishDrawingLithologyPolygon={() => {
              commitDraftLithologyPolygon();
            }}
            onCancelDrawingLithologyPolygon={() => {
              setDraftLithologyPoints([]);
              setReopenedLithologyRegionId(null);
              setIsDrawingLithologyPolygon(false);
            }}
            canUndo={lithologyPast.length > 0 || canUndo}
            canRedo={lithologyFuture.length > 0 || canRedo}
            onUndo={handleUndoLithology}
            onRedo={handleRedoLithology}
            onClose={() => {
              setIsDrawingLithologyPolygon(false);
              setDraftLithologyPoints([]);
              setReopenedLithologyRegionId(null);
              setActiveTool('select');
            }}
            onStatusMessage={onUpdateStatusMessage}
          />
        )}

        {/* ====================================================================
            AUTOCAD PROPERTIES & STRUCTURAL INSPECTOR PALETTE (EXTENDABLE LEFT / RIGHT)
           ==================================================================== */}
        {(selectedJoint ||
          activeTool === 'dip_probe' ||
          (showCadPropertiesAlways &&
            activeTool !== 'overbreak' &&
            activeTool !== 'lithology')) && (
          <aside
            style={{ width: `${inspectorWidthPx}px` }}
            className={`relative max-w-[52vw] bg-[#101520] ${
              inspectorDockSide === 'left' ? 'order-first border-r' : 'order-last border-l'
            } border-[#263147] p-2.5 overflow-y-auto text-xs space-y-2 shrink-0 z-20 transition-[width] duration-75`}
          >
            {/* Interactive Drag-to-Resize Handle (Extend Left or Right) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setResizingInspector({
                  startX: e.clientX,
                  startWidth: inspectorWidthPx,
                });
              }}
              title="Drag Left or Right to Extend / Resize ESWACAD Properties Palette"
              className={`flex items-center justify-center absolute top-0 bottom-0 w-2.5 cursor-col-resize z-30 group ${
                inspectorDockSide === 'left' ? '-right-1.5' : '-left-1.5'
              }`}
            >
              <div className="h-16 w-1 rounded-full bg-slate-700 group-hover:bg-cyan-400 transition-colors" />
            </div>

            {/* AutoCAD Properties Title Bar (Move Left/Right & Resize Width) */}
            <div className="flex items-center justify-between gap-1 px-2 py-1 bg-[#182132] border border-[#2B3854] rounded-xs text-[10px] font-mono">
              <span className="text-cyan-300 font-bold tracking-wider uppercase flex items-center gap-1">
                <Sliders className="w-3 h-3 text-cyan-400" />
                PROPERTIES PALETTE
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setInspectorDockSide((s) => (s === 'right' ? 'left' : 'right'))
                  }
                  className="px-1.5 py-0.5 rounded-xs bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 flex items-center gap-0.5 cursor-pointer"
                  title="Dock Properties Palette on Left or Right Side"
                >
                  {inspectorDockSide === 'right' ? (
                    <>
                      <PanelLeft className="w-3 h-3" /> L
                    </>
                  ) : (
                    <>
                      <PanelRight className="w-3 h-3" /> R
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorWidthPx((w) => Math.max(260, w - 45))}
                  className="px-1 py-0.5 rounded-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  title="Narrow Palette"
                >
                  −W
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorWidthPx((w) => Math.min(660, w + 45))}
                  className="px-1 py-0.5 rounded-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 cursor-pointer"
                  title="Extend Palette Width"
                >
                  +W
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJointId(null);
                    setShowCadPropertiesAlways(false);
                    if (activeTool === 'dip_probe') setActiveTool('select');
                  }}
                  className="px-1 text-slate-400 hover:text-white cursor-pointer"
                  title="Close Properties Palette"
                >
                  ✕
                </button>
              </div>
            </div>

            {selectedJoint ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <span className="font-mono font-bold text-slate-100">
                      TRACE {selectedJoint.set} ({selectedJoint.surface.toUpperCase()})
                    </span>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Source: {selectedJoint.source} · Conf: {selectedJoint.confidence} (
                      {Math.round(selectedJoint.confidenceScore * 100)}%)
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedJointId(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                {/* 4-Component Confidence Breakdown (Section 9) */}
                {selectedJoint.confidenceBreakdown && (
                  <div className="p-2 bg-slate-950/80 border border-slate-800/90 rounded font-mono text-[10px] space-y-1">
                    <div className="text-slate-400 font-semibold">
                      ACCURACY CONFIDENCE BREAKDOWN
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-300">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Detection:</span>
                        <span>{selectedJoint.confidenceBreakdown.detection}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Continuity:</span>
                        <span>{selectedJoint.confidenceBreakdown.trace}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Geom Fit:</span>
                        <span>{selectedJoint.confidenceBreakdown.geometric}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">3D Orient:</span>
                        <span>{selectedJoint.confidenceBreakdown.orientation}%</span>
                      </div>
                    </div>
                  </div>
                )}

                 {/* Orientation, Triangulation & Error Propagation Box (Sections 7, 8, 21, 22, 24, 25, 29) */}
                 <div className="p-2.5 bg-slate-900/90 rounded border border-slate-800 space-y-2 font-mono">
                   <div className="flex items-center justify-between text-[10px]">
                     <span className="text-slate-500">A. Image Trace Angle:</span>
                     <span className="text-slate-300">
                       {selectedJoint.imageTraceAngleDeg ?? selectedJoint.traceAngle}°
                     </span>
                   </div>
                   <div className="flex items-center justify-between text-[11px]">
                     <span className="text-slate-400">B. Surface Trace Angle:</span>
                     <span className="text-slate-200 font-semibold">
                       {selectedJoint.traceAngle}°
                     </span>
                   </div>
                   <div className="flex items-center justify-between text-[11px]">
                     <span className="text-slate-400">Trace Length (Persist.):</span>
                     <span className="text-slate-200 font-semibold">
                       {selectedJoint.persistenceMeters.toFixed(2)} m ({selectedJoint.geometry.length} pts)
                     </span>
                   </div>

                   {/* Triangulation Residual, Reprojection Error & Geometric Confidence Level */}
                   <div className="p-1.5 bg-slate-950/90 border border-slate-800/90 rounded space-y-1 text-[10px]">
                     <div className="flex items-center justify-between">
                       <span className="text-slate-500">Geom. Confidence:</span>
                       <span
                         className={
                           selectedJoint.geometricConfidenceLevel === 'HIGH_GEOMETRIC_CONFIDENCE'
                             ? 'text-emerald-400 font-semibold'
                             : selectedJoint.geometricConfidenceLevel === 'LOW_GEOMETRIC_CONFIDENCE'
                             ? 'text-rose-400 font-semibold'
                             : 'text-amber-300 font-semibold'
                         }
                       >
                         {(selectedJoint.geometricConfidenceLevel || 'MEDIUM_GEOMETRIC_CONFIDENCE').replace(/_/g, ' ')}
                       </span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-slate-500">Triangulation Residual:</span>
                       <span className="text-slate-300">
                         {(selectedJoint.triangulationResidualMeters ?? 0.012).toFixed(3)} m ({selectedJoint.numObservingViews ?? 1} view{(selectedJoint.numObservingViews ?? 1) > 1 ? 's' : ''})
                       </span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-slate-500">Reprojection Error:</span>
                       <span
                         className={
                           (selectedJoint.reprojectionErrorPx ?? 1.2) > 3.2
                             ? 'text-amber-300 font-semibold'
                             : 'text-slate-300'
                         }
                       >
                         {selectedJoint.reprojectionErrorByView &&
                         selectedJoint.reprojectionErrorByView.length > 0
                           ? selectedJoint.reprojectionErrorByView
                               .map((v) => `${v.viewLabel}: ${v.errorPx}px`)
                               .join(' · ')
                           : `${(selectedJoint.reprojectionErrorPx ?? 1.2).toFixed(2)} px`}
                       </span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-slate-500">Supporting Photos:</span>
                       <span className="text-emerald-300">
                         {selectedJoint.supportingPhotosCorroborated ?? 0} corroborated (Main Photo Anchor)
                       </span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-slate-500">Continuity State:</span>
                       <select
                         value={selectedJoint.continuityStatus || 'OBSERVED'}
                         onChange={(e) =>
                           onUpdateJointsWithHistory(
                             joints.map((j) =>
                               j.id === selectedJoint.id
                                 ? {
                                     ...j,
                                     continuityStatus: e.target.value as TraceContinuityStatus,
                                   }
                                 : j
                             )
                           )
                         }
                         className="bg-slate-900 border border-slate-700 rounded px-1 py-0.2 text-[10px] text-cyan-300"
                       >
                         <option value="OBSERVED">OBSERVED (Main Photo)</option>
                         <option value="SUPPORTED">SUPPORTED (Main + Supporting)</option>
                         <option value="INFERRED">INFERRED</option>
                         <option value="UNCERTAIN">UNCERTAIN</option>
                       </select>
                     </div>
                     {selectedJoint.topologyIntersections &&
                       selectedJoint.topologyIntersections.length > 0 && (
                         <div className="text-[10px] text-cyan-300 pt-0.5">
                           Topology: {selectedJoint.topologyIntersections.length} node(s) (
                           {selectedJoint.topologyIntersections.map((t) => t.type.replace('_', ' ')).join(', ')})
                         </div>
                       )}
                   </div>

                  {/* Multi-Vertex Local Angle Variation & Waviness Readout */}
                  {selectedJoint.localAnglesDeg && selectedJoint.localAnglesDeg.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-cyan-400 font-semibold">
                          LOCAL SEGMENT ANGLES (P1→P{selectedJoint.geometry.length})
                        </span>
                        <span className="text-amber-300">
                          Waviness ±{selectedJoint.wavinessAngleDeg ?? 0}°
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-300 bg-slate-950/90 px-2 py-1 rounded border border-slate-800/80 leading-relaxed break-words">
                        {selectedJoint.localAnglesDeg.map((a) => `${Math.round(a)}°`).join(' → ')}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[10px]">
                        <label className="space-y-0.5">
                          <span className="text-slate-500">Start Term.:</span>
                          <select
                            value={selectedJoint.terminationStart || 'ROCK_TERMINATION'}
                            onChange={(e) =>
                              onUpdateJointsWithHistory(
                                joints.map((j) =>
                                  j.id === selectedJoint.id
                                    ? {
                                        ...j,
                                        terminationStart: e.target.value as TraceTerminationType,
                                      }
                                    : j
                                )
                              )
                            }
                            className="w-full bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200"
                          >
                            <option value="ROCK_TERMINATION">In Rock (T-bar)</option>
                            <option value="JOINT_ABUTMENT">Against Joint</option>
                            <option value="BOUNDARY_EXIT">Excav. Boundary</option>
                            <option value="OCCLUDED">Obscured</option>
                          </select>
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-slate-500">End Term.:</span>
                          <select
                            value={selectedJoint.terminationEnd || 'ROCK_TERMINATION'}
                            onChange={(e) =>
                              onUpdateJointsWithHistory(
                                joints.map((j) =>
                                  j.id === selectedJoint.id
                                    ? {
                                        ...j,
                                        terminationEnd: e.target.value as TraceTerminationType,
                                      }
                                    : j
                                )
                              )
                            }
                            className="w-full bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200"
                          >
                            <option value="ROCK_TERMINATION">In Rock (T-bar)</option>
                            <option value="JOINT_ABUTMENT">Against Joint</option>
                            <option value="BOUNDARY_EXIT">Excav. Boundary</option>
                            <option value="OCCLUDED">Obscured</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-slate-800 pt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-cyan-400 font-semibold">
                        3D GEOLOGICAL ORIENTATION
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          selectedJoint.orientationStatus === 'DIRECTLY_MEASURED' ||
                          selectedJoint.orientationStatus === 'CONFIRMED' ||
                          selectedJoint.orientationStatus === 'GEOMETRICALLY_CALCULATED'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {selectedJoint.orientationStatus.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {selectedJoint.linkedJointIds &&
                      selectedJoint.linkedJointIds.length > 0 && (
                        <div className="text-[10px] text-emerald-400">
                          ✓ Multi-Surface 3D Plane Solved ({selectedJoint.linkedJointIds.length}{' '}
                          linked trace)
                        </div>
                      )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Dip Dir (0-360°)</span>
                        <input
                          type="number"
                          min="0"
                          max="360"
                          value={Math.round(selectedJoint.dipDirection)}
                          onChange={(e) => {
                            const dd = Math.max(0, Math.min(360, Number(e.target.value) || 0));
                            const st = (dd - 90 + 360) % 360;
                            const updatedJoint: Joint = {
                              ...selectedJoint,
                              dipDirection: dd,
                              strike: st,
                              orientationStatus: 'DIRECTLY_MEASURED',
                            };
                            onUpdateJointsWithHistory(
                              joints.map((j) => (j.id === selectedJoint.id ? updatedJoint : j))
                            );
                            onRecordConfirmedJoint(updatedJoint, {
                              correctionType: 'recalculate_orientation',
                              aiSummary: `Estimated ${Math.round(selectedJoint.dipDirection)}°/${Math.round(selectedJoint.dip)}°`,
                              approvedSummary: `Measured ${Math.round(dd)}°/${Math.round(selectedJoint.dip)}°`,
                            });
                          }}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Dip (0-90°)</span>
                        <input
                          type="number"
                          min="0"
                          max="90"
                          value={Math.round(selectedJoint.dip)}
                          onChange={(e) => {
                            const d = Math.max(0, Math.min(90, Number(e.target.value) || 0));
                            onUpdateJointsWithHistory(
                              joints.map((j) =>
                                j.id === selectedJoint.id
                                  ? { ...j, dip: d, orientationStatus: 'DIRECTLY_MEASURED' }
                                  : j
                              )
                            );
                          }}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100"
                        />
                      </label>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Strike (RHR): {String(Math.round(selectedJoint.strike)).padStart(3, '0')}° ·
                      Truthful 3D:{' '}
                      <strong className="text-slate-200">
                        {String(Math.round(selectedJoint.dipDirection)).padStart(3, '0')}° /{' '}
                        {String(Math.round(selectedJoint.dip)).padStart(2, '0')}° ±
                        {selectedJoint.dipUncertaintyDeg ?? 3}°
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Joint Number, Discontinuity Set, Feature Type & Engineering Attributes (Sections 10 & 11) */}
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Joint No.</span>
                      <input
                        type="text"
                        value={selectedJoint.jointNumber || ''}
                        placeholder="e.g. J-1"
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? { ...j, jointNumber: e.target.value }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded font-mono text-xs text-slate-100"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Joint Set</span>
                      <select
                        value={selectedJoint.set}
                        onChange={(e) => {
                          const nextSet = e.target.value;
                          const updatedJoint: Joint = { ...selectedJoint, set: nextSet };
                          onUpdateJointsWithHistory(
                            joints.map((j) => (j.id === selectedJoint.id ? updatedJoint : j))
                          );
                          onRecordConfirmedJoint(updatedJoint, {
                            correctionType: 'reclassify_type',
                            aiSummary: `Set ${selectedJoint.set} (${Math.round(selectedJoint.dipDirection)}°/${Math.round(selectedJoint.dip)}°)`,
                            approvedSummary: `Reclassified to Set ${nextSet}`,
                          });
                        }}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded font-mono text-xs text-slate-100"
                      >
                        {['J0', 'J1', 'J2', 'J3', 'J4', 'J5', 'F1'].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Confidence</span>
                      <select
                        value={selectedJoint.confidence}
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? {
                                    ...j,
                                    confidence: e.target.value as 'High' | 'Medium' | 'Low',
                                  }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded font-mono text-xs text-slate-100"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[10px] text-slate-400">
                      Structural Geological Feature Type
                    </span>
                    <select
                      value={selectedJoint.featureType}
                      onChange={(e) => {
                        const nextType = e.target.value as GeologicalFeatureType;
                        const updatedJoint: Joint = { ...selectedJoint, featureType: nextType };
                        onUpdateJointsWithHistory(
                          joints.map((j) => (j.id === selectedJoint.id ? updatedJoint : j))
                        );
                        onRecordConfirmedJoint(updatedJoint, {
                          correctionType: 'reclassify_type',
                          aiSummary: `${selectedJoint.featureType} (${selectedJoint.set})`,
                          approvedSummary: `Verified as ${nextType} (${selectedJoint.set})`,
                        });
                      }}
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-100"
                    >
                      <option value="joint">Joint</option>
                      <option value="open_joint">Open Joint</option>
                      <option value="closed_joint">Closed Joint</option>
                      <option value="fracture">Fracture</option>
                      <option value="discontinuity">Discontinuity</option>
                      <option value="fault">Fault</option>
                      <option value="shear">Shear Surface</option>
                      <option value="shear_zone">Shear Zone</option>
                      <option value="shear_plane">Shear Plane</option>
                      <option value="slickenside">Slickenside</option>
                      <option value="bedding">Bedding</option>
                      <option value="foliation">Foliation</option>
                      <option value="schistosity">Schistosity</option>
                      <option value="cleavage">Cleavage</option>
                      <option value="lineation">Lineation</option>
                      <option value="fold">Fold Axis</option>
                      <option value="anticline">Anticline</option>
                      <option value="syncline">Syncline</option>
                      <option value="vein">Vein</option>
                      <option value="dyke">Dyke / Intrusive</option>
                      <option value="contact">Contact</option>
                      <option value="lithological_contact">Lithological Contact</option>
                      <option value="clay_infill">Clay Infill</option>
                      <option value="clay_band">Clay Band</option>
                      <option value="seam">Weak Seam</option>
                      <option value="weathered_zone">Weathered Zone</option>
                      <option value="breccia_zone">Breccia Zone</option>
                      <option value="crushed_zone">Crushed Zone</option>
                      <option value="water_seepage">Water Seepage</option>
                      <option value="water_flow">Water Flow</option>
                      <option value="shale_band">Shale/Siltstone</option>
                      <option value="dolerite">Dolerite</option>
                      <option value="infilling">Infilling Vein</option>
                    </select>
                  </label>

                  {/* Editable Joint Engineering Attributes: Aperture, Roughness, Infill, Weathering (Section 11) */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Aperture</span>
                      <input
                        type="text"
                        value={selectedJoint.apertureMm || ''}
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? { ...j, apertureMm: e.target.value }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Roughness</span>
                      <input
                        type="text"
                        value={selectedJoint.roughness || ''}
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? { ...j, roughness: e.target.value }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Infilling</span>
                      <input
                        type="text"
                        value={selectedJoint.infilling || ''}
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? { ...j, infilling: e.target.value }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Weathering</span>
                      <input
                        type="text"
                        value={selectedJoint.weathering || 'Slightly Weathered (W2)'}
                        onChange={(e) =>
                          onUpdateJointsWithHistory(
                            joints.map((j) =>
                              j.id === selectedJoint.id
                                ? { ...j, weathering: e.target.value }
                                : j
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100"
                      />
                    </label>
                  </div>

                  {/* Quantitative Photogrammetric & Barton-Bandis JRC Telemetry Box */}
                  {(() => {
                    const liveJrc = computeBartonJRCProfileForPoints(
                      selectedJoint.geometry,
                      selectedJoint.reliefDepthMeters,
                      selectedJoint.featureType,
                      selectedJoint.wavinessAngleDeg
                    );
                    const liveWT =
                      selectedJoint.terzaghiWeight ??
                      computeTerzaghiWeight(
                        selectedJoint.dip,
                        selectedJoint.dipDirection,
                        selectedJoint.surface,
                        settings.driveDirection,
                        geometry
                      );
                    return (
                      <div className="mt-2 p-2 bg-slate-950/80 border border-cyan-900/60 rounded space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                            Photogrammetry &amp; Barton JRC (Z₂)
                          </span>
                          <button
                            onClick={() => setShowPhotogrammetryModal(true)}
                            className="text-[10px] font-mono text-indigo-300 hover:text-white underline"
                          >
                            3D Wedge &amp; PLY →
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                          <div className="bg-slate-900/90 px-1.5 py-1 rounded border border-slate-800">
                            <div className="text-slate-400">Field JRCₙ</div>
                            <div className="text-emerald-300 font-bold">
                              {(selectedJoint.jrcValue ?? liveJrc.jrcNFieldScale).toFixed(1)}
                            </div>
                          </div>
                          <div className="bg-slate-900/90 px-1.5 py-1 rounded border border-slate-800">
                            <div className="text-slate-400">Z₂ / Rp</div>
                            <div className="text-cyan-300 font-bold">
                              {(selectedJoint.z2RootMeanSquare ?? liveJrc.z2RmsDerivative).toFixed(3)} / {(selectedJoint.roughnessProfileIndexRp ?? liveJrc.rpRoughnessIndex).toFixed(3)}
                            </div>
                          </div>
                          <div className="bg-slate-900/90 px-1.5 py-1 rounded border border-slate-800">
                            <div className="text-slate-400">Terzaghi W_T</div>
                            <div className="text-amber-300 font-bold">{liveWT.toFixed(2)}×</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Manual Correction Actions (Accept, Extend, Shorten, Add Vertex, Delete Vertex, Smooth Spline, Continue/Append, Re-draw, Split, Join, Delete) */}
                <div className="space-y-1.5 pt-1 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      Control Points &amp; Curve Actions ({selectedJoint.geometry.length} pts)
                    </span>
                    {selectedJointVertexIdx !== null && (
                      <span className="text-[10px] font-mono text-amber-300">
                        Selected P{selectedJointVertexIdx + 1}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleConfirmSelectedJoint}
                      className="flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 rounded font-medium"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Accept / Confirm
                    </button>
                    <button
                      onClick={handleDeleteSelectedJoint}
                      className="flex items-center justify-center gap-1 px-2 py-1.5 bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border border-rose-700/50 rounded font-medium"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Trace
                    </button>
                    <button
                      onClick={() => handleAddVertexToSelectedJoint()}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                    >
                      + Add Control Pt
                    </button>
                    <button
                      onClick={() =>
                        handleDeleteSelectedJointVertex(
                          selectedJointVertexIdx ??
                            Math.max(1, Math.floor(selectedJoint.geometry.length / 2))
                        )
                      }
                      disabled={selectedJoint.geometry.length <= 2}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-rose-200 rounded border border-slate-700"
                    >
                      - Delete Control Pt
                    </button>
                    <button
                      onClick={handleSmoothSelectedJointCurve}
                      disabled={selectedJoint.geometry.length < 3}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-cyan-200 rounded border border-slate-700"
                      title="Fit smooth Catmull-Rom spline through control points"
                    >
                      Smooth Curve / Spline
                    </button>
                    <button
                      onClick={() => {
                        setDraftJointPoints([]);
                        setActiveTool('append_joint');
                      }}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-200 rounded border border-slate-700"
                      title="Continue drawing from the end of this joint trace"
                    >
                      Continue / Append
                    </button>
                    <button
                      onClick={() => handleScaleSelectedJointLength(1.18)}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                    >
                      Extend (+18%)
                    </button>
                    <button
                      onClick={() => handleScaleSelectedJointLength(0.82)}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                    >
                      Shorten (-18%)
                    </button>
                    <button
                      onClick={() => {
                        setDraftJointPoints([]);
                        setActiveTool('redraw_joint');
                      }}
                      className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-200 rounded border border-slate-700"
                    >
                      Re-draw Trace
                    </button>
                    <button
                      onClick={handleSplitSelectedJoint}
                      className="flex items-center justify-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                    >
                      <Scissors className="w-3 h-3" />
                      Split Trace
                    </button>
                    <button
                      onClick={handleSnapSelectedJointToRockRidge}
                      disabled={!activePhotoRidgeField}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-cyan-950/80 hover:bg-cyan-900/80 disabled:opacity-40 text-cyan-200 border border-cyan-500/50 rounded font-medium"
                      title="Snap all vertices of this trace onto the exact rock fracture valley using Dijkstra Geodesic Ridge Snapping"
                    >
                      <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                      Snap Trace to Rock Crack (Geodesic AI)
                    </button>
                    <button
                      onClick={() => setJoinTargetMode((prev) => !prev)}
                      className={`col-span-2 px-2 py-1.5 rounded border ${
                        joinTargetMode
                          ? 'bg-cyan-600 text-white border-cyan-400'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                    >
                      {joinTargetMode ? 'Click 2nd Trace to Join' : 'Join with Another Trace'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* AutoCAD 2-Column Property Grid when no specific joint is selected */
              <div className="space-y-2.5 font-mono text-[11px]">
                <div className="px-2 py-1 bg-[#161E2E] border border-[#28354E] rounded-xs text-slate-200 font-bold flex items-center justify-between">
                  <span>Object Type:</span>
                  <span className="text-cyan-300">
                    {activeSurface === 'face'
                      ? 'MODEL_SURFACE (1. FACE)'
                      : activeSurface === 'crown'
                      ? 'MODEL_SURFACE (2. CROWN)'
                      : activeSurface === 'leftWall'
                      ? 'MODEL_SURFACE (3. L-WALL)'
                      : 'MODEL_SURFACE (4. R-WALL)'}
                  </span>
                </div>

                {/* Section 1: Tunnel Geometry Properties */}
                <div className="border border-[#243047] rounded-xs overflow-hidden">
                  <div className="px-2 py-1 bg-[#182234] text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center justify-between">
                    <span>▾ 1. Tunnel Geometry</span>
                    {onOpenCustomProfileEditor && (
                      <button
                        type="button"
                        onClick={onOpenCustomProfileEditor}
                        className="text-[9px] px-1.5 py-0.2 bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-600/60 rounded-xs cursor-pointer"
                      >
                        Edit W×H →
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-slate-800/80 bg-[#0C1018] text-[10px]">
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Shape Profile</span>
                      <span className="text-slate-100 font-semibold text-right">
                        {geometry.customProfile?.name || geometry.crownGeometry.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Span Width (W)</span>
                      <span className="text-emerald-300 font-bold text-right">
                        {geometry.width.toFixed(2)} m
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Total Height (H)</span>
                      <span className="text-emerald-300 font-bold text-right">
                        {geometry.height.toFixed(2)} m
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Wall / Crown R</span>
                      <span className="text-slate-200 text-right">
                        {geometry.wallHeight.toFixed(2)}m / R={geometry.crownRadius.toFixed(2)}m
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Drive Azimuth</span>
                      <span className="text-cyan-300 font-bold text-right">
                        N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Chainage</span>
                      <span className="text-amber-300 font-semibold text-right">
                        {settings.chainage || 'CH 0+000'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Active Surface & Photo Calibration */}
                <div className="border border-[#243047] rounded-xs overflow-hidden">
                  <div className="px-2 py-1 bg-[#182234] text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center justify-between">
                    <span>▾ 2. Surface &amp; Photo</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[9px] px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xs cursor-pointer"
                    >
                      {currentPhoto.image ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                  <div className="divide-y divide-slate-800/80 bg-[#0C1018] text-[10px]">
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Primary Photo</span>
                      <span className="text-slate-200 truncate text-right">
                        {currentPhoto.fileName || (currentPhoto.image ? 'Loaded' : 'None')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Supporting Photos</span>
                      <span className="text-emerald-300 text-right">
                        {currentPhoto.supportingPhotos?.length || 0} / 5 stereo views
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Surface Traces</span>
                      <span className="text-cyan-300 font-bold text-right">
                        {joints.filter((j) => j.surface === activeSurface).length} active (
                        {joints.length} total)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-slate-400">Lithology / CPs</span>
                      <span className="text-amber-300 text-right">
                        {lithologyRegions.filter((r) => r.surface === activeSurface).length} zones ·{' '}
                        {surfaceControlPoints.length} CPs
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Discontinuity Sets Summary */}
                <div className="border border-[#243047] rounded-xs overflow-hidden">
                  <div className="px-2 py-1 bg-[#182234] text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center justify-between">
                    <span>▾ 3. Discontinuity Sets ({jointSets.length})</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGeologyDrawerTab('geology_tables');
                        setShowSetTableDrawer(true);
                      }}
                      className="text-[9px] px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xs cursor-pointer"
                    >
                      Tables →
                    </button>
                  </div>
                  <div className="divide-y divide-slate-800/80 bg-[#0C1018] text-[10px] max-h-36 overflow-y-auto">
                    {jointSets.length === 0 ? (
                      <div className="px-2 py-2 text-slate-500">
                        No joint traces mapped yet. Click &quot;AI Trace&quot; or &quot;Draw Joint&quot;.
                      </div>
                    ) : (
                      jointSets.map((js) => (
                        <div
                          key={js.id}
                          className="flex items-center justify-between px-2 py-1 hover:bg-slate-900/70"
                        >
                          <span className="font-bold text-cyan-300">{js.id}</span>
                          <span className="text-slate-200">
                            {String(Math.round(js.avgDipDirection ?? 0)).padStart(3, '0')}° /{' '}
                            {String(Math.round(js.avgDip ?? 0)).padStart(2, '0')}°
                          </span>
                          <span className="text-slate-400">
                            n={js.jointCount ?? joints.filter((j) => j.set === js.id).length}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Quick ESWACAD Command Buttons */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftJointPoints([]);
                      setJointDrawMode('magnetic_livewire');
                      setActiveTool('add_joint');
                    }}
                    className="px-2 py-1.5 bg-amber-600/25 hover:bg-amber-600/40 text-amber-200 border border-amber-500/50 rounded-xs text-[10px] font-bold cursor-pointer"
                  >
                    + Draw Joint (PLINE)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftJointPoints([]);
                      setJointDrawMode('smooth_curve');
                      setActiveTool('add_joint');
                    }}
                    className="px-2 py-1.5 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/50 rounded-xs text-[10px] font-bold cursor-pointer"
                  >
                    + Draw Spline (SPL)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPhotogrammetryModal(true)}
                    className="px-2 py-1.5 bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-500/50 rounded-xs text-[10px] font-bold cursor-pointer"
                  >
                    3D Wedges &amp; Stereo
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenExportSheet('FINAL_ENGINEERING_SHEET')}
                    className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50 rounded-xs text-[10px] font-bold cursor-pointer"
                  >
                    Plot Sheet (DWG/PDF)
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ====================================================================
          AUTOCAD BOTTOM MODEL / PAPER SPACE LAYOUT TABS + CAD STATUS BAR
         ==================================================================== */}
      <footer className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 bg-[#0C1018] border-t border-[#252F45] text-[10px] font-mono shrink-0 z-30">
        {/* Left: AutoCAD Model Space Surface Tabs & Paper Space Layout Tabs */}
        <div className="flex flex-wrap items-center gap-0.5">
          {(
            [
              { id: 'face', label: 'MODEL: 1. FACE' },
              { id: 'crown', label: 'MODEL: 2. CROWN' },
              { id: 'leftWall', label: 'MODEL: 3. L-WALL' },
              { id: 'rightWall', label: 'MODEL: 4. R-WALL' },
            ] as { id: SurfaceType; label: string }[]
          ).map((surf) => {
            const hasImg = Boolean(photos[surf.id].image);
            const count = joints.filter((j) => j.surface === surf.id).length;
            const isActive = activeSurface === surf.id;
            return (
              <button
                key={surf.id}
                type="button"
                onClick={() => {
                  onSelectSurface(surf.id);
                  setSelectedJointId(null);
                  setDraftJointPoints([]);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-t-xs border transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#1B2538] text-cyan-300 border-cyan-500/60 font-bold'
                    : 'bg-[#121824] text-slate-400 hover:text-slate-200 border-[#222C40]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasImg ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                <span>{surf.label}</span>
                <span className="text-[9px] text-slate-400">({count})</span>
              </button>
            );
          })}

          <div className="h-3.5 w-px bg-slate-800 mx-1" />

          {/* Paper Space Layout Tabs */}
          <button
            type="button"
            onClick={() => onOpenExportSheet('FINAL_ENGINEERING_SHEET')}
            className="px-2 py-0.5 bg-[#131B29] hover:bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 rounded-t-xs font-semibold cursor-pointer"
            title="Switch to Paper Space Layout 1: Final Geological Mapping & Engineering Sheet"
          >
            LAYOUT 1: ENGINEERING SHEET
          </button>
          <button
            type="button"
            onClick={() => onOpenExportSheet('ENGINEERING_QUANTITY_SHEET')}
            className="px-2 py-0.5 bg-[#131B29] hover:bg-rose-950/80 text-rose-300 border border-rose-700/50 rounded-t-xs font-semibold cursor-pointer"
            title="Switch to Paper Space Layout 2: Overbreak & Excavation Quantity Sheet"
          >
            LAYOUT 2: QUANTITY SHEET
          </button>
          {onOpenCustomProfileEditor && (
            <button
              type="button"
              onClick={onOpenCustomProfileEditor}
              className="px-2 py-0.5 bg-[#131B29] hover:bg-cyan-950/80 text-cyan-300 border border-cyan-700/50 rounded-t-xs font-semibold cursor-pointer"
              title="Open Tunnel Cross-Section CAD Graph Builder (W×H)"
            >
              BLOCK: TUNNEL PROFILE
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowUnfoldedRolloutModal(true)}
            className="px-2 py-0.5 bg-[#131B29] hover:bg-cyan-950/80 text-cyan-200 border border-cyan-700/50 rounded-t-xs font-semibold cursor-pointer"
            title="Open Unfolded 3D Tunnel Round Log (Left Wall + Crown + Right Wall + Face)"
          >
            UNFOLDED LOG
          </button>
          <button
            type="button"
            onClick={() => setShowSheetSetModal(true)}
            className="px-2 py-0.5 bg-[#131B29] hover:bg-amber-950/80 text-amber-300 border border-amber-700/50 rounded-t-xs font-semibold cursor-pointer"
            title="Open ESWACAD Sheet Set Manager (Multi-Chainage Batch DXF & CSV Export)"
          >
            SHEET SET ({savedProjects.length})
          </button>
        </div>

        {/* Right: Live ESWACAD Coordinates + CAD Drafting Status Toggles */}
        <div className="flex flex-wrap items-center gap-1">
          {/* Live X, Y, Z Coordinates Readout */}
          <span className="px-2 py-0.5 bg-[#070A0F] border border-slate-800 rounded-xs text-slate-300">
            {cursorMeters ? (
              <>
                X: <strong className="text-emerald-300">{cursorMeters.x.toFixed(2)}m</strong>, Y:{' '}
                <strong className="text-emerald-300">{cursorMeters.y.toFixed(2)}m</strong>, Z:{' '}
                <strong className="text-cyan-300">0.00m</strong>
              </>
            ) : (
              <>X: 0.00m, Y: 0.00m, Z: 0.00m</>
            )}
          </span>

          {/* ESWACAD Status Toggles (GRID, OSNAP, DYN, MAG-SNAP, SUPPORT, X-RAY, SMART, PROPS, ZOOM) */}
          <button
            type="button"
            onClick={() => setShowCadGrid((g) => !g)}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              showCadGrid
                ? 'bg-cyan-950 text-cyan-300 border-cyan-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle ESWACAD Reference Grid (GRID / F7)"
          >
            GRID
          </button>

          <button
            type="button"
            onClick={() => setCadOsnapEnabled((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              cadOsnapEnabled
                ? 'bg-emerald-950 text-emerald-300 border-emerald-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle ESWACAD Object Snap — Endpoint & Midpoint (OSNAP / F3)"
          >
            OSNAP
          </button>

          <button
            type="button"
            onClick={() => setCadDynInputEnabled((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              cadDynInputEnabled
                ? 'bg-cyan-950 text-cyan-300 border-cyan-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle ESWACAD Dynamic Input Length & Angle Tooltip (DYN / F12)"
          >
            DYN
          </button>

          <button
            type="button"
            onClick={() =>
              setSupportConfig((prev) => ({
                ...prev,
                enabledOnCanvas: !prev.enabledOnCanvas,
              }))
            }
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              supportConfig.enabledOnCanvas
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500/80'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle Rock Bolts & SFRS Support Pattern Overlay on Face Canvas"
          >
            BOLTS
          </button>

          <button
            type="button"
            onClick={() => {
              const nextMode =
                jointDrawMode === 'magnetic_livewire' ? 'polyline' : 'magnetic_livewire';
              setJointDrawMode(nextMode);
            }}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              jointDrawMode === 'magnetic_livewire'
                ? 'bg-amber-950 text-amber-300 border-amber-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle Magnetic Live-Wire Crack Snap (OSNAP)"
          >
            MAG-SNAP
          </button>

          <button
            type="button"
            onClick={() => {
              setShowCrackXRayOverlay((prev) => {
                const next = !prev;
                if (next) setShowDepthReliefOverlay(false);
                return next;
              });
            }}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              showCrackXRayOverlay
                ? 'bg-emerald-950 text-emerald-300 border-emerald-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle Crack X-Ray Vision Filter"
          >
            X-RAY
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeTraceFitMode(traceFitMode === 'smart_fit' ? 'linear' : 'smart_fit')
            }
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              traceFitMode === 'smart_fit'
                ? 'bg-cyan-950 text-cyan-300 border-cyan-600/70'
                : 'bg-[#121824] text-amber-300 border-slate-800'
            }`}
            title="Toggle Smart Curvature Fit vs Linear Polyline"
          >
            {traceFitMode === 'smart_fit' ? 'SMART-FIT' : 'ORTHO-LIN'}
          </button>

          <button
            type="button"
            onClick={() => setShowCadPropertiesAlways((p) => !p)}
            className={`px-1.5 py-0.5 rounded-xs border font-bold cursor-pointer ${
              showCadPropertiesAlways
                ? 'bg-cyan-950 text-cyan-300 border-cyan-600/70'
                : 'bg-[#121824] text-slate-500 border-slate-800'
            }`}
            title="Toggle AutoCAD Properties Palette (PROPS)"
          >
            PROPS
          </button>

          <button
            type="button"
            onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
            className="px-1.5 py-0.5 bg-[#121824] hover:bg-slate-800 text-white border border-slate-700 rounded-xs font-bold cursor-pointer"
            title="Click to Reset Zoom to 100% (1:1)"
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
        </div>
      </footer>

      {/* ====================================================================
          COLLAPSIBLE BOTTOM DRAWER: CONTINUOUS DAILY AI LEARNING LOOP (Section 26)
         ==================================================================== */}
      {showAILearningDrawer && (
        <div className="h-[clamp(185px,28dvh,250px)] bg-[#111621] border-t border-slate-800 p-2.5 overflow-y-auto shrink-0 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-3">
              <span className="font-display font-semibold text-cyan-300">
                CONTINUOUS DAILY AI LEARNING &amp; VERIFIED GEOLOGIST CORRECTIONS
              </span>
              <span className="px-2 py-0.5 bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 rounded text-[10px]">
                {sessionMemory.currentModelVersion || 'AKASH AI Model 1.3'} · Validation{' '}
                {sessionMemory.modelHistory?.[0]?.validationScorePct ?? 95.4}%
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-300">
              <span>
                Training Samples:{' '}
                <strong className="text-slate-100">{sessionMemory.trainingSamplesTotal ?? 0}</strong>
              </span>
              <span>
                Verified Traces:{' '}
                <strong className="text-emerald-400">
                  {sessionMemory.verifiedExamplesCount ?? 0}
                </strong>
              </span>
              <span>
                Corrections Learned:{' '}
                <strong className="text-amber-300">
                  {sessionMemory.correctionsLearnedCount ?? 0}
                </strong>
              </span>
              {onTrainAndUpdateAIModel && (
                <button
                  onClick={onTrainAndUpdateAIModel}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded text-[10px] transition-colors cursor-pointer"
                  title="Compile verified geologist corrections and promote a new calibrated AI model version"
                >
                  ⚡ Train &amp; Update AI Model Now
                </button>
              )}
              {onResetAILearningFilters &&
                (sessionMemory.rejectedAngleRanges.length > 0 ||
                  sessionMemory.confirmedOrientations.length > 0) && (
                  <button
                    onClick={onResetAILearningFilters}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px] transition-colors cursor-pointer"
                    title="Clear active orientation suppression/boost filters while preserving model version history"
                  >
                    Reset Filters ({sessionMemory.rejectedAngleRanges.length} suppressed /{' '}
                    {sessionMemory.confirmedOrientations.length} boosted)
                  </button>
                )}
              <button
                onClick={() => setShowAILearningDrawer(false)}
                className="text-slate-400 hover:text-white px-1"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Model Version History */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-slate-400 font-semibold">
                VERSIONED MODEL RELEASES (SAFE DAILY VALIDATION)
              </div>
              {(sessionMemory.modelHistory || []).map((m) => (
                <div
                  key={m.version}
                  className="p-2 bg-slate-900/90 border border-slate-800 rounded flex items-center justify-between text-[11px]"
                >
                  <div>
                    <div className="text-slate-100 font-semibold">
                      {m.version} <span className="text-slate-500">({m.updatedAt})</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{m.majorChanges}</div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-emerald-400 font-semibold">{m.validationScorePct}%</div>
                    <div className="text-[10px] text-slate-500">{m.trainingDataCount} samples</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Verified Geologist Corrections Log */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-slate-400 font-semibold">
                RECENT VERIFIED GEOLOGIST CORRECTIONS (AI PREDICTION VS USER APPROVED)
              </div>
              {(sessionMemory.verifiedRecords || []).length === 0 ? (
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded text-[11px] text-slate-400">
                  Accept/Confirm, Reclassify, Reshape, or Delete traces on the canvas to log verified
                  geologist training pairs for the daily model update cycle.
                </div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {(sessionMemory.verifiedRecords || []).map((rec) => (
                    <div
                      key={rec.id}
                      className="p-1.5 bg-slate-900/90 border border-slate-800 rounded flex items-center justify-between text-[10px]"
                    >
                      <div>
                        <span className="text-cyan-300 font-semibold">
                          [{rec.correctionType.replace(/_/g, ' ')}]
                        </span>{' '}
                        <span className="text-slate-400">{rec.aiPredictionSummary}</span> →{' '}
                        <span className="text-emerald-300">{rec.userApprovedSummary}</span>
                      </div>
                      <span className="text-slate-500 shrink-0 ml-2">{rec.scope}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          COLLAPSIBLE BOTTOM DRAWER: GEOLOGICAL TABLES & BARTON Q-INDEX CALCULATOR
         ==================================================================== */}
      {showSetTableDrawer && (
        <GeologyAndQIndexDrawer
          activeTab={geologyDrawerTab}
          onChangeTab={setGeologyDrawerTab}
          onClose={() => setShowSetTableDrawer(false)}
          geometry={geometry}
          settings={settings}
          activeSurface={activeSurface}
          joints={joints}
          jointSets={jointSets}
          onUpdateJoints={onUpdateJointsWithHistory}
          onUpdateJointSetAttribute={onUpdateJointSetAttribute}
          onMergeJointSets={onMergeJointSets}
          qIndexParams={qIndexParams}
          onUpdateQIndexParams={onUpdateQIndexParams}
          qParamStatus={qParamStatus}
          onUpdateQParamStatus={onUpdateQParamStatus}
          selectedMethod={selectedClassificationMethod}
          onChangeSelectedMethod={onChangeSelectedClassificationMethod}
          rmrParams={rmrParams}
          onUpdateRmrParams={onUpdateRmrParams}
          gsiParams={gsiParams}
          onUpdateGsiParams={onUpdateGsiParams}
          rockMassSummary={rockMassSummary}
          onUpdateRockMassSummary={onUpdateRockMassSummary}
          onOpenExportSheet={onOpenExportSheet}
          onOpenKinematics={() => setShowPhotogrammetryModal(true)}
          savedProjects={savedProjects}
        />
      )}

      <PhotogrammetryStructuralModal
        isOpen={showPhotogrammetryModal}
        onClose={() => setShowPhotogrammetryModal(false)}
        joints={joints}
        jointSets={jointSets}
        geometry={geometry}
        settings={settings}
        photos={photos}
        activeSurface={activeSurface}
        hasActiveRidgeField={Boolean(activePhotoRidgeField)}
        onRefineAllActiveSurfaceTraces={handleRefineAllActiveSurfaceTraces}
        onSelectJoint={(jId, surf) => {
          onSelectSurface(surf);
          setSelectedJointId(jId);
          setShowPhotogrammetryModal(false);
        }}
        onProceedToClassification={() => {
          setGeologyDrawerTab('q_index');
          setShowSetTableDrawer(true);
          setShowAILearningDrawer(false);
        }}
        onUpdateJoints={onUpdateJointsWithHistory}
        onApplyGroundwaterToClassification={(jw, jwDesc, rmrRating, inflowLMin, rmrDesc) => {
          onUpdateQIndexParams({
            ...qIndexParams,
            jw,
            jwDescription: jwDesc,
          });
          onUpdateQParamStatus({
            ...qParamStatus,
            jw: 'USER_ENTERED',
          });
          onUpdateRmrParams({
            ...rmrParams,
            groundwaterInflowLPerMin10m: inflowLMin,
            groundwaterRating: rmrRating,
            groundwaterDescription: rmrDesc,
            paramStatus: {
              ...rmrParams.paramStatus,
              groundwater: 'USER_ENTERED',
            },
          });
          onUpdateRockMassSummary({
            ...rockMassSummary,
            groundwaterCondition: `${rmrDesc} (~${inflowLMin.toFixed(1)} L/min, Jw=${jw})`,
          });
          onUpdateStatusMessage?.(
            `Applied Seepage Zone Groundwater to Classification: Q-System Jw = ${jw} & RMR89 Groundwater Rating = ${rmrRating}/15 (~${inflowLMin.toFixed(1)} L/min).`
          );
        }}
      />

      {/* ====================================================================
          NEW ADDITIVE AUTOCAD ENGINEERING MODALS (SUPPORT, UNFOLDED LOG, SHEET SET)
         ==================================================================== */}
      <RockSupportPatternModal
        isOpen={showRockSupportModal}
        onClose={() => setShowRockSupportModal(false)}
        geometry={geometry}
        settings={settings}
        qParams={qIndexParams}
        rmrParams={rmrParams}
        supportConfig={supportConfig}
        onUpdateSupportConfig={setSupportConfig}
      />

      <UnfoldedTunnelRolloutModal
        isOpen={showUnfoldedRolloutModal}
        onClose={() => setShowUnfoldedRolloutModal(false)}
        geometry={geometry}
        settings={settings}
        joints={joints}
        lithologyRegions={lithologyRegions}
        placedSymbols={placedSymbols}
        savedProjects={savedProjects}
        onSelectSurface={onSelectSurface}
        onLoadProjectRecord={onLoadProjectRecord}
      />

      <CadSheetSetManagerModal
        isOpen={showSheetSetModal}
        onClose={() => setShowSheetSetModal(false)}
        geometry={geometry}
        settings={settings}
        joints={joints}
        jointSets={jointSets}
        overbreakAnalysis={overbreakAnalysis}
        savedProjects={savedProjects}
        onLoadProjectRecord={(rec) => {
          if (onLoadProjectRecord) {
            onLoadProjectRecord(rec);
          } else {
            onOpenProjectMemoryModal('projects');
          }
        }}
        onOpenExportSheet={(mode) =>
          onOpenExportSheet(
            mode === 'GEOLOGICAL_MAPPING_SHEET'
              ? 'FINAL_ENGINEERING_SHEET'
              : 'ENGINEERING_QUANTITY_SHEET'
          )
        }
      />
    </div>
  );
};
