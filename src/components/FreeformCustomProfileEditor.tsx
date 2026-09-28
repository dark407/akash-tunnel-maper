import React, { useMemo, useRef, useState } from 'react';
import {
  BoundaryZoneRole,
  ChainageProfileSegmentRecord,
  CustomSegmentType,
  CustomTunnelProfileDefinition,
  Point2D,
  ProfileControlPoint,
  ProfileSegment,
  SavedDesignGeometryRecord,
  SurveyControlPoint,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  applyParametricOverallDimensions,
  applySegmentExactDimension,
  buildAuthoritativeCustomTunnelGeometry,
  computeBulgeFromMidpointHandle,
  computeProfileEditorStage,
  CUSTOM_PROFILE_PRESETS,
  evaluateCustomProfileGeometry,
  EvaluatedSegmentMetrics,
  interpolateTransitionTunnelGeometry,
  profileMetersToCanvasPx,
  resolveGeometryForChainageMeters,
  screenClientToProfileMeters,
} from '../engine/customProfileEngine';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCode,
  Grid,
  Image as ImageIcon,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Move,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type ProfileEditorMainTab =
  | 'freeform_canvas'
  | 'trace_image'
  | 'coordinates_table'
  | 'dxf_and_library'
  | 'chainage_schedule';

type CanvasEditorTool =
  | 'select_move'
  | 'add_line_pt'
  | 'add_arc_pt'
  | 'add_bezier_pt'
  | 'insert_on_segment'
  | 'calibrate_scale';

interface FreeformCustomProfileEditorProps {
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  onConfirmGeometry: (nextGeometry: TunnelGeometry, proceedToNextScreen?: boolean) => void;
  onUpdateSettings?: React.Dispatch<React.SetStateAction<TunnelSettings>>;
  onBack: () => void;
  onUploadCADFile: (file: File) => Promise<void>;
  onDownloadSampleDXF: () => void;
  cadStatus?: string;
  savedGeometries: SavedDesignGeometryRecord[];
  onSaveGeometryToLibrary: (name: string, geom: TunnelGeometry) => void;
  onLoadSavedGeometry: (rec: SavedDesignGeometryRecord) => void;
  onDeleteSavedGeometry: (id: string) => void;
  chainageSchedule: ChainageProfileSegmentRecord[];
  onUpdateChainageSchedule: (next: ChainageProfileSegmentRecord[]) => void;
  surveyControlPoints?: SurveyControlPoint[];
  onSyncProfileToSurveyControlPoints?: (profile: CustomTunnelProfileDefinition) => void;
  initialTab?: ProfileEditorMainTab;
}

export const FreeformCustomProfileEditor: React.FC<FreeformCustomProfileEditorProps> = ({
  geometry,
  settings,
  onConfirmGeometry,
  onUpdateSettings,
  onBack,
  onUploadCADFile,
  onDownloadSampleDXF,
  cadStatus,
  savedGeometries,
  onSaveGeometryToLibrary,
  onLoadSavedGeometry,
  onDeleteSavedGeometry,
  chainageSchedule,
  onUpdateChainageSchedule,
  surveyControlPoints = [],
  onSyncProfileToSurveyControlPoints,
  initialTab = 'freeform_canvas',
}) => {
  const [activeTab, setActiveTab] = useState<ProfileEditorMainTab>(initialTab);
  const [canvasTool, setCanvasTool] = useState<CanvasEditorTool>('select_move');

  // Initialize editable profile definition from current geometry or default asymmetric/regular profile
  const [profile, setProfile] = useState<CustomTunnelProfileDefinition>(() => {
    if (geometry.customProfile && geometry.customProfile.controlPoints.length >= 2) {
      return geometry.customProfile;
    }
    // Convert current crossSectionPoints into editable control points
    const rawPts = geometry.crossSectionPoints;
    const step = Math.max(1, Math.floor(rawPts.length / 8));
    const sampled: ProfileControlPoint[] = [];
    for (let i = 0; i < rawPts.length && sampled.length < 10; i += step) {
      sampled.push({
        id: `P${sampled.length + 1}`,
        label: `P${sampled.length + 1}`,
        x: Number(rawPts[i].x.toFixed(3)),
        y: Number(rawPts[i].y.toFixed(3)),
        role: 'corner',
      });
    }
    if (sampled.length < 4) {
      return CUSTOM_PROFILE_PRESETS[0].createProfile();
    }
    const segs: ProfileSegment[] = sampled.map((p, idx) => ({
      id: `S${idx + 1}`,
      fromPointId: p.id,
      toPointId: sampled[(idx + 1) % sampled.length].id,
      type: 'line',
    }));
    return {
      id: `prof-${Date.now()}`,
      name: geometry.profileName || `Custom Tunnel Profile (${geometry.width}m × ${geometry.height}m)`,
      category: 'freeform',
      controlPoints: sampled,
      segments: segs,
      isClosed: true,
      version: 'v1.0',
      updatedAt: new Date().toISOString(),
    };
  });

  // Selection & Dragging State
  const [selectedPointId, setSelectedPointId] = useState<string | null>(
    profile.controlPoints[0]?.id || null
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    profile.segments[0]?.id || null
  );
  const [draggingState, setDraggingState] = useState<{
    kind: 'point' | 'arc_handle' | 'bezier_cp1' | 'bezier_cp2' | 'pan';
    id: string;
    startClientX?: number;
    startClientY?: number;
    startPanX?: number;
    startPanY?: number;
  } | null>(null);

  // Canvas Viewport & Snapping State
  const [zoom, setZoom] = useState<number>(1.0);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [snapGridMeters, setSnapGridMeters] = useState<number>(0.05);
  const [enableGridSnap, setEnableGridSnap] = useState<boolean>(true);
  const [enableOrthoSnap, setEnableOrthoSnap] = useState<boolean>(false);
  const [cursorMeters, setCursorMeters] = useState<Point2D | null>(null);

  // Reference Image Tracing State (Section 5)
  const [scaleCalibStep, setScaleCalibStep] = useState<'idle' | 'pick_a' | 'pick_b'>('idle');
  const [knownScaleMetersInput, setKnownScaleMetersInput] = useState<string>('9.486');
  const refImageInputRef = useRef<HTMLInputElement | null>(null);
  const cadFileInputRef = useRef<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Parametric Dimension Inputs
  const evaluated = useMemo(() => evaluateCustomProfileGeometry(profile), [profile]);
  const [dimWidthInput, setDimWidthInput] = useState<string>(evaluated.width.toFixed(3));
  const [dimHeightInput, setDimHeightInput] = useState<string>(evaluated.height.toFixed(3));
  const [dimLeftWallInput, setDimLeftWallInput] = useState<string>(
    evaluated.leftWallHeight.toFixed(3)
  );
  const [dimRightWallInput, setDimRightWallInput] = useState<string>(
    evaluated.rightWallHeight.toFixed(3)
  );

  // Bulk XY Coordinate Paste Text
  const [bulkXYText, setBulkXYText] = useState<string>(
    '-4.743, 0.000\n-4.743, 4.200\n-2.950, 6.850\n0.350, 8.000\n4.743, 5.150\n4.380, 0.000'
  );

  // Chainage / RD Range Schedule & Transition Inspector State (Sections 7 & 8)
  const [testRdMeters, setTestRdMeters] = useState<number>(135);
  const [newRangeStart, setNewRangeStart] = useState<string>('230');
  const [newRangeEnd, setNewRangeEnd] = useState<string>('260');
  const [newRangeType, setNewRangeType] =
    useState<ChainageProfileSegmentRecord['sectionType']>('CUSTOM_IRREGULAR');
  const [newRangeIsTransition, setNewRangeIsTransition] = useState<boolean>(false);
  const [newRangeFromId, setNewRangeFromId] = useState<string>(
    chainageSchedule[0]?.id || ''
  );
  const [newRangeToId, setNewRangeToId] = useState<string>(
    chainageSchedule[2]?.id || ''
  );
  const [saveLibName, setSaveLibName] = useState<string>(profile.name);
  const [feedbackBanner, setFeedbackBanner] = useState<string>('');

  // Keep dimension input boxes synced when evaluated dimensions change from dragging
  const syncDimensionInputsFromEvaluated = (nextProf: CustomTunnelProfileDefinition) => {
    const ev = evaluateCustomProfileGeometry(nextProf);
    setDimWidthInput(ev.width.toFixed(3));
    setDimHeightInput(ev.height.toFixed(3));
    setDimLeftWallInput(ev.leftWallHeight.toFixed(3));
    setDimRightWallInput(ev.rightWallHeight.toFixed(3));
  };

  const stage = useMemo(
    () =>
      computeProfileEditorStage(
        evaluated.crossSectionPoints.length >= 2
          ? evaluated.crossSectionPoints
          : profile.controlPoints,
        zoom,
        panX,
        panY,
        860,
        580,
        68
      ),
    [evaluated.crossSectionPoints, profile.controlPoints, zoom, panX, panY]
  );

  const selectedPoint = useMemo(
    () => profile.controlPoints.find((p) => p.id === selectedPointId) || null,
    [profile.controlPoints, selectedPointId]
  );

  const selectedSegmentMetric = useMemo(
    () => evaluated.segmentMetrics.find((m) => m.segmentId === selectedSegmentId) || null,
    [evaluated.segmentMetrics, selectedSegmentId]
  );

  // Apply snapping rules to a candidate point in meters
  const applySnapping = (rawPt: Point2D, anchorPt?: Point2D): Point2D => {
    let x = rawPt.x;
    let y = rawPt.y;

    if (enableGridSnap && snapGridMeters > 0) {
      x = Math.round(x / snapGridMeters) * snapGridMeters;
      y = Math.round(y / snapGridMeters) * snapGridMeters;
    }

    if (enableOrthoSnap && anchorPt) {
      if (Math.abs(x - anchorPt.x) < Math.abs(y - anchorPt.y) * 0.35) {
        x = anchorPt.x;
      } else if (Math.abs(y - anchorPt.y) < Math.abs(x - anchorPt.x) * 0.35) {
        y = anchorPt.y;
      }
    }

    // Centerline X=0 or Invert Y=0 magnetic snap within 0.08m
    if (Math.abs(x) < 0.08) x = 0;
    if (Math.abs(y) < 0.08) y = 0;

    return {
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
    };
  };

  // Load a pre-built Cavern or Irregular Profile Preset
  const handleSelectPreset = (presetId: string) => {
    const found = CUSTOM_PROFILE_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    const nextProf = found.createProfile();
    setProfile(nextProf);
    setSelectedPointId(nextProf.controlPoints[0]?.id || null);
    setSelectedSegmentId(nextProf.segments[0]?.id || null);
    setSaveLibName(nextProf.name);
    syncDimensionInputsFromEvaluated(nextProf);
    setFeedbackBanner(
      `Loaded "${nextProf.name}" with ${nextProf.controlPoints.length} editable control points.`
    );
  };

  // Start a Blank Freeform Profile for manual drawing from scratch
  const handleStartBlankFreeform = () => {
    const blank: CustomTunnelProfileDefinition = {
      id: `prof-freeform-${Date.now()}`,
      name: 'Freeform Custom Excavation Profile',
      category: 'freeform',
      controlPoints: [
        { id: 'P1', label: 'P1', x: -4.5, y: 0.0, role: 'left_invert' },
        { id: 'P2', label: 'P2', x: -4.5, y: 4.5, role: 'left_wall_top' },
      ],
      segments: [
        { id: 'S1', fromPointId: 'P1', toPointId: 'P2', type: 'line', zoneRole: 'leftWall' },
      ],
      isClosed: false,
      version: 'v1.0',
      updatedAt: new Date().toISOString(),
    };
    setProfile(blank);
    setCanvasTool('add_line_pt');
    setSelectedPointId('P2');
    setSelectedSegmentId('S1');
    setFeedbackBanner(
      'Freeform Drawing Mode active: Click on the canvas to add Line, Arc, or Curve control points.'
    );
  };

  // Add a new control point on canvas click when in add_line_pt / add_arc_pt / add_bezier_pt mode
  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const worldPt = screenClientToProfileMeters(e.clientX, e.clientY, svgRef.current, stage);

    if (e.button === 1 || e.shiftKey) {
      setDraggingState({
        kind: 'pan',
        id: 'canvas-pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      });
      return;
    }

    // Reference image 2-point scale calibration
    if (canvasTool === 'calibrate_scale' && profile.referenceImage) {
      if (scaleCalibStep === 'pick_a' || scaleCalibStep === 'idle') {
        setProfile((prev) => ({
          ...prev,
          referenceImage: prev.referenceImage
            ? { ...prev.referenceImage, scalePointA: { x: worldPt.x, y: worldPt.y } }
            : null,
        }));
        setScaleCalibStep('pick_b');
        setFeedbackBanner(
          `Marked Scale Point A at (${worldPt.x.toFixed(2)}m, ${worldPt.y.toFixed(2)}m). Now click Scale Point B.`
        );
        return;
      }
      if (scaleCalibStep === 'pick_b' && profile.referenceImage.scalePointA) {
        const ptA = profile.referenceImage.scalePointA;
        const ptB = { x: worldPt.x, y: worldPt.y };
        const currentDist = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);
        const targetDist = Math.max(0.5, parseFloat(knownScaleMetersInput) || 9.486);
        const ratio = currentDist > 0.05 ? targetDist / currentDist : 1;

        setProfile((prev) => ({
          ...prev,
          referenceImage: prev.referenceImage
            ? {
                ...prev.referenceImage,
                scalePointB: ptB,
                knownDistanceMeters: targetDist,
                widthMeters: Number((prev.referenceImage.widthMeters * ratio).toFixed(3)),
                heightMeters: Number((prev.referenceImage.heightMeters * ratio).toFixed(3)),
              }
            : null,
        }));
        setScaleCalibStep('idle');
        setCanvasTool('select_move');
        setFeedbackBanner(
          `Calibrated Reference Image scale: Distance A–B set to exact ${targetDist.toFixed(3)} m.`
        );
        return;
      }
    }

    if (
      canvasTool === 'add_line_pt' ||
      canvasTool === 'add_arc_pt' ||
      canvasTool === 'add_bezier_pt'
    ) {
      const lastPt = profile.controlPoints[profile.controlPoints.length - 1];
      const snapped = applySnapping({ x: worldPt.x, y: worldPt.y }, lastPt);
      const newId = `P${profile.controlPoints.length + 1}`;
      const newPt: ProfileControlPoint = {
        id: newId,
        label: newId,
        x: snapped.x,
        y: snapped.y,
        role: canvasTool === 'add_bezier_pt' ? 'smooth_tangent' : 'corner',
      };

      const segType: CustomSegmentType =
        canvasTool === 'add_arc_pt'
          ? 'arc'
          : canvasTool === 'add_bezier_pt'
          ? 'bezier'
          : 'line';

      setProfile((prev) => {
        const nextPts = [...prev.controlPoints, newPt];
        const nonClosingSegs = prev.segments.filter(
          (s) =>
            !(
              prev.isClosed &&
              prev.controlPoints.length >= 2 &&
              s.fromPointId === prev.controlPoints[prev.controlPoints.length - 1].id &&
              s.toPointId === prev.controlPoints[0].id
            )
        );
        const prevTail = prev.controlPoints[prev.controlPoints.length - 1];
        const addedSeg: ProfileSegment | null = prevTail
          ? {
              id: `S${ Date.now().toString().slice(-4) }`,
              fromPointId: prevTail.id,
              toPointId: newPt.id,
              type: segType,
              arcBulge: segType === 'arc' ? 0.28 : undefined,
            }
          : null;

        const closingSeg: ProfileSegment | null =
          prev.isClosed && nextPts.length >= 3
            ? {
                id: `S-close-${Date.now().toString().slice(-4)}`,
                fromPointId: newPt.id,
                toPointId: nextPts[0].id,
                type: 'line',
                zoneRole: 'invert',
              }
            : null;

        const nextSegs = [
          ...nonClosingSegs,
          ...(addedSeg ? [addedSeg] : []),
          ...(closingSeg ? [closingSeg] : []),
        ];

        const updated = {
          ...prev,
          controlPoints: nextPts,
          segments: nextSegs,
          updatedAt: new Date().toISOString(),
        };
        syncDimensionInputsFromEvaluated(updated);
        return updated;
      });
      setSelectedPointId(newId);
      return;
    }

    if (canvasTool === 'insert_on_segment') {
      // Find closest segment to click point and split it
      let bestSeg: EvaluatedSegmentMetrics | null = null;
      let bestDist = Infinity;
      for (const m of evaluated.segmentMetrics) {
        for (const sp of m.sampledPoints) {
          const d = Math.hypot(sp.x - worldPt.x, sp.y - worldPt.y);
          if (d < bestDist) {
            bestDist = d;
            bestSeg = m;
          }
        }
      }
      if (bestSeg) {
        handleInsertPointAfter(bestSeg.fromPoint.id, { x: worldPt.x, y: worldPt.y });
        setCanvasTool('select_move');
      }
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const worldPt = screenClientToProfileMeters(e.clientX, e.clientY, svgRef.current, stage);
    setCursorMeters({ x: worldPt.x, y: worldPt.y });

    if (!draggingState) return;

    if (draggingState.kind === 'pan') {
      const dx = e.clientX - (draggingState.startClientX || 0);
      const dy = e.clientY - (draggingState.startClientY || 0);
      setPanX((draggingState.startPanX || 0) + dx);
      setPanY((draggingState.startPanY || 0) + dy);
      return;
    }

    if (draggingState.kind === 'point') {
      const targetPt = profile.controlPoints.find((p) => p.id === draggingState.id);
      if (!targetPt || targetPt.locked) return;
      const snapped = applySnapping({ x: worldPt.x, y: worldPt.y });
      setProfile((prev) => {
        const next = {
          ...prev,
          controlPoints: prev.controlPoints.map((p) =>
            p.id === draggingState.id ? { ...p, x: snapped.x, y: snapped.y } : p
          ),
          updatedAt: new Date().toISOString(),
        };
        syncDimensionInputsFromEvaluated(next);
        return next;
      });
      return;
    }

    if (draggingState.kind === 'arc_handle') {
      const seg = profile.segments.find((s) => s.id === draggingState.id);
      if (!seg) return;
      const pFrom = profile.controlPoints.find((p) => p.id === seg.fromPointId);
      const pTo = profile.controlPoints.find((p) => p.id === seg.toPointId);
      if (!pFrom || !pTo) return;
      const nextBulge = computeBulgeFromMidpointHandle(pFrom, pTo, {
        x: worldPt.x,
        y: worldPt.y,
      });
      setProfile((prev) => ({
        ...prev,
        segments: prev.segments.map((s) =>
          s.id === draggingState.id
            ? { ...s, type: 'arc', arcBulge: nextBulge, arcRadiusMeters: undefined }
            : s
        ),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (draggingState.kind === 'bezier_cp1' || draggingState.kind === 'bezier_cp2') {
      const handleKey = draggingState.kind === 'bezier_cp1' ? 'cp1' : 'cp2';
      setProfile((prev) => ({
        ...prev,
        segments: prev.segments.map((s) =>
          s.id === draggingState.id
            ? {
                ...s,
                type: 'bezier',
                [handleKey]: {
                  x: Number(worldPt.x.toFixed(3)),
                  y: Number(worldPt.y.toFixed(3)),
                },
              }
            : s
        ),
        updatedAt: new Date().toISOString(),
      }));
    }
  };

  const handleCanvasPointerUp = () => {
    setDraggingState(null);
  };

  // Insert a control point after `fromPointId`
  const handleInsertPointAfter = (fromPointId: string, customCoord?: Point2D) => {
    const idx = profile.controlPoints.findIndex((p) => p.id === fromPointId);
    if (idx === -1) return;
    const pA = profile.controlPoints[idx];
    const pB = profile.controlPoints[(idx + 1) % profile.controlPoints.length];
    const mid: Point2D = customCoord || {
      x: Number(((pA.x + pB.x) / 2).toFixed(3)),
      y: Number(((pA.y + pB.y) / 2).toFixed(3)),
    };

    const newId = `P${profile.controlPoints.length + 1}`;
    const newPt: ProfileControlPoint = {
      id: newId,
      label: newId,
      x: mid.x,
      y: mid.y,
      role: 'corner',
    };

    const nextPts = [...profile.controlPoints];
    nextPts.splice(idx + 1, 0, newPt);
    // Relabel P1..Pn cleanly
    const relabeledPts = nextPts.map((pt, i) => ({
      ...pt,
      label: `P${i + 1}`,
    }));

    // Rebuild segments preserving existing segment types where endpoints still match
    const nextSegs: ProfileSegment[] = [];
    const count = profile.isClosed ? relabeledPts.length : relabeledPts.length - 1;
    for (let i = 0; i < count; i++) {
      const f = relabeledPts[i];
      const t = relabeledPts[(i + 1) % relabeledPts.length];
      const existing = profile.segments.find(
        (s) => s.fromPointId === f.id && s.toPointId === t.id
      );
      if (existing) {
        nextSegs.push(existing);
      } else {
        nextSegs.push({
          id: `S-${f.id}-${t.id}`,
          fromPointId: f.id,
          toPointId: t.id,
          type: 'line',
        });
      }
    }

    const updated: CustomTunnelProfileDefinition = {
      ...profile,
      controlPoints: relabeledPts,
      segments: nextSegs,
      updatedAt: new Date().toISOString(),
    };
    setProfile(updated);
    setSelectedPointId(newId);
    syncDimensionInputsFromEvaluated(updated);
  };

  // Delete a control point
  const handleDeleteControlPoint = (pointId: string) => {
    if (profile.controlPoints.length <= 3) {
      setFeedbackBanner('A closed tunnel profile requires at least 3 control points.');
      return;
    }
    const remaining = profile.controlPoints
      .filter((p) => p.id !== pointId)
      .map((p, i) => ({ ...p, label: `P${i + 1}` }));

    const nextSegs: ProfileSegment[] = [];
    const count = profile.isClosed ? remaining.length : remaining.length - 1;
    for (let i = 0; i < count; i++) {
      const f = remaining[i];
      const t = remaining[(i + 1) % remaining.length];
      const existing = profile.segments.find(
        (s) => s.fromPointId === f.id && s.toPointId === t.id
      );
      nextSegs.push(
        existing || {
          id: `S-${f.id}-${t.id}`,
          fromPointId: f.id,
          toPointId: t.id,
          type: 'line',
        }
      );
    }

    const updated: CustomTunnelProfileDefinition = {
      ...profile,
      controlPoints: remaining,
      segments: nextSegs,
      updatedAt: new Date().toISOString(),
    };
    setProfile(updated);
    setSelectedPointId(remaining[0]?.id || null);
    syncDimensionInputsFromEvaluated(updated);
  };

  // Reorder a control point up or down in sequence
  const handleMovePointOrder = (pointId: string, dir: -1 | 1) => {
    const idx = profile.controlPoints.findIndex((p) => p.id === pointId);
    if (idx === -1) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= profile.controlPoints.length) return;
    const copy = [...profile.controlPoints];
    const [item] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, item);
    const relabeled = copy.map((p, i) => ({ ...p, label: `P${i + 1}` }));

    const nextSegs: ProfileSegment[] = relabeled.map((f, i) => {
      const t = relabeled[(i + 1) % relabeled.length];
      const existing = profile.segments.find(
        (s) => s.fromPointId === f.id && s.toPointId === t.id
      );
      return (
        existing || {
          id: `S-${f.id}-${t.id}`,
          fromPointId: f.id,
          toPointId: t.id,
          type: 'line',
        }
      );
    });

    setProfile({
      ...profile,
      controlPoints: relabeled,
      segments: nextSegs,
      updatedAt: new Date().toISOString(),
    });
  };

  // Change segment type between Line, Circular Arc, and Smooth Bezier Curve
  const handleChangeSegmentType = (segmentId: string, nextType: CustomSegmentType) => {
    setProfile((prev) => {
      const exists = prev.segments.some((s) => s.id === segmentId);
      const baseSegs = exists
        ? prev.segments
        : evaluated.segmentMetrics.map((m) => ({
            id: m.segmentId,
            fromPointId: m.fromPoint.id,
            toPointId: m.toPoint.id,
            type: m.type,
            zoneRole: m.zoneRole,
            arcBulge: m.bulge,
            arcRadiusMeters: m.radiusMeters,
            cp1: m.cp1,
            cp2: m.cp2,
          }));

      const nextSegs = baseSegs.map((s) => {
        if (s.id !== segmentId) return s;
        if (nextType === 'arc') {
          return {
            ...s,
            type: 'arc' as CustomSegmentType,
            arcBulge: s.arcBulge && Math.abs(s.arcBulge) > 0.02 ? s.arcBulge : 0.28,
          };
        }
        if (nextType === 'bezier') {
          const pFrom = prev.controlPoints.find((p) => p.id === s.fromPointId);
          const pTo = prev.controlPoints.find((p) => p.id === s.toPointId);
          const dx = pTo && pFrom ? pTo.x - pFrom.x : 2;
          const dy = pTo && pFrom ? pTo.y - pFrom.y : 2;
          const chord = Math.hypot(dx, dy) || 1;
          const nx = -dy / chord;
          const ny = dx / chord;
          return {
            ...s,
            type: 'bezier' as CustomSegmentType,
            cp1:
              s.cp1 ||
              (pFrom
                ? {
                    x: Number((pFrom.x + dx * 0.33 + nx * chord * 0.18).toFixed(3)),
                    y: Number((pFrom.y + dy * 0.33 + ny * chord * 0.18).toFixed(3)),
                  }
                : undefined),
            cp2:
              s.cp2 ||
              (pFrom
                ? {
                    x: Number((pFrom.x + dx * 0.67 + nx * chord * 0.18).toFixed(3)),
                    y: Number((pFrom.y + dy * 0.67 + ny * chord * 0.18).toFixed(3)),
                  }
                : undefined),
          };
        }
        return {
          ...s,
          type: 'line' as CustomSegmentType,
        };
      });

      return {
        ...prev,
        segments: nextSegs,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Upload Reference Engineering Drawing / Image for Tracing (Section 5)
  const handleUploadReferenceImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / Math.max(1, img.height);
        const hMeters = Math.max(6, evaluated.height * 1.25);
        const wMeters = Number((hMeters * aspect).toFixed(3));
        setProfile((prev) => ({
          ...prev,
          category: 'traced_drawing',
          referenceImage: {
            dataUrl,
            fileName: file.name,
            opacity: 65,
            visible: true,
            knownDistanceMeters: parseFloat(knownScaleMetersInput) || 9.486,
            widthMeters: wMeters,
            heightMeters: hMeters,
            offsetX: 0,
            offsetY: Number((evaluated.height / 2).toFixed(2)),
          },
        }));
        setFeedbackBanner(
          `Loaded Reference Drawing "${file.name}". Click "Set Scale (Pick A → B)" to calibrate exact meters, then trace or adjust control points.`
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Apply Bulk XY Coordinates from Text
  const handleApplyBulkXYCoordinates = () => {
    const lines = bulkXYText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    const parsedPts: ProfileControlPoint[] = [];
    lines.forEach((line) => {
      const parts = line.split(/[,;\t\s]+/).filter(Boolean);
      if (parts.length < 2) return;
      let x = parseFloat(parts[0]);
      let y = parseFloat(parts[1]);
      if (Number.isNaN(x) && parts.length >= 3) {
        x = parseFloat(parts[1]);
        y = parseFloat(parts[2]);
      }
      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        const idx = parsedPts.length + 1;
        parsedPts.push({
          id: `P${idx}`,
          label: `P${idx}`,
          x: Number(x.toFixed(3)),
          y: Number(y.toFixed(3)),
          role: 'corner',
        });
      }
    });

    if (parsedPts.length < 3) {
      setFeedbackBanner('Enter at least 3 valid (X, Y) coordinate pairs in meters.');
      return;
    }

    const segs: ProfileSegment[] = parsedPts.map((p, i) => ({
      id: `S${i + 1}`,
      fromPointId: p.id,
      toPointId: parsedPts[(i + 1) % parsedPts.length].id,
      type: 'line',
    }));

    const nextProf: CustomTunnelProfileDefinition = {
      ...profile,
      controlPoints: parsedPts,
      segments: segs,
      isClosed: true,
      updatedAt: new Date().toISOString(),
    };
    setProfile(nextProf);
    setSelectedPointId(parsedPts[0].id);
    setSelectedSegmentId(segs[0].id);
    syncDimensionInputsFromEvaluated(nextProf);
    setFeedbackBanner(
      `Constructed custom vector profile from ${parsedPts.length} entered control-point coordinates.`
    );
  };

  // Confirm & Use This Profile as Authoritative Tunnel Geometry
  const handleConfirmAuthoritativeGeometry = (proceedToNextScreen = true) => {
    const authoritativeGeom = buildAuthoritativeCustomTunnelGeometry(profile);
    onConfirmGeometry(authoritativeGeom, proceedToNextScreen);
    setFeedbackBanner(
      `Confirmed "${profile.name}" (${authoritativeGeom.width.toFixed(3)}m W × ${authoritativeGeom.height.toFixed(3)}m H, Area ${authoritativeGeom.designAreaSqMeters?.toFixed(2)}m²) as Authoritative Master Tunnel Geometry.`
    );
  };

  // Build SVG path for evaluated cross-section
  const closedBoundarySvgPath = useMemo(() => {
    if (evaluated.crossSectionPoints.length < 2) return '';
    return (
      evaluated.crossSectionPoints
        .map((pt, i) => {
          const px = profileMetersToCanvasPx(pt, stage);
          return `${i === 0 ? 'M' : 'L'} ${px.cx} ${px.cy}`;
        })
        .join(' ') + (profile.isClosed ? ' Z' : '')
    );
  }, [evaluated.crossSectionPoints, stage, profile.isClosed]);

  // Evaluated Transition Preview for Tab 5 (Chainage / RD Range Schedule)
  const resolvedChainagePreview = useMemo(
    () => resolveGeometryForChainageMeters(testRdMeters, chainageSchedule),
    [testRdMeters, chainageSchedule]
  );

  return (
    <div className="w-full h-full flex flex-col bg-[#0B0E14] text-slate-100 font-mono text-xs overflow-hidden">
      {/* Top Header & Authoritative Confirmation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#111621] border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 rounded cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm sm:text-base tracking-wide text-white">
                CUSTOM TUNNEL &amp; CAVERN VECTOR GEOMETRY STUDIO
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-700/60 rounded">
                AUTHORITATIVE VECTOR ENGINE
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Supports Powerhouse Caverns · Transformer Halls · Junctions · Asymmetric Walls ·
              Sloping Crowns · Multi-Arc &amp; Freeform Profiles
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const authGeom = buildAuthoritativeCustomTunnelGeometry(profile);
              onSaveGeometryToLibrary(saveLibName || profile.name, authGeom);
              setFeedbackBanner(`Saved "${saveLibName || profile.name}" to Reusable Profile Library.`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save Profile
          </button>

          <button
            type="button"
            onClick={() => handleConfirmAuthoritativeGeometry(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-600/60 rounded font-semibold cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Apply Profile
          </button>

          <button
            type="button"
            onClick={() => handleConfirmAuthoritativeGeometry(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-semibold shadow-md cursor-pointer"
          >
            USE THIS PROFILE &amp; CONTINUE
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 5 Mode Navigation Tabs */}
      <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-[#0E131D] border-b border-slate-800 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1.5">
          {(
            [
              {
                id: 'freeform_canvas',
                label: '1. Freeform Profile & Cavern Editor',
                icon: Crosshair,
              },
              {
                id: 'trace_image',
                label: '2. Trace Engineering Drawing / Image',
                icon: ImageIcon,
              },
              {
                id: 'coordinates_table',
                label: `3. Control Points & Exact Dimensions (${profile.controlPoints.length} Pts)`,
                icon: Ruler,
              },
              {
                id: 'dxf_and_library',
                label: `4. Import DXF/DWG & Saved Library (${savedGeometries.length})`,
                icon: Upload,
              },
              {
                id: 'chainage_schedule',
                label: `5. Profiles by Chainage/RD & Transitions (${chainageSchedule.length})`,
                icon: Layers,
              },
            ] as { id: ProfileEditorMainTab; label: string; icon: React.ElementType }[]
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Live Authoritative Engineering Metrics Pill */}
        <div className="hidden xl:flex items-center gap-3 px-3 py-1 bg-slate-900/90 border border-slate-800 rounded text-[11px]">
          <span>
            W: <strong className="text-cyan-300">{evaluated.width.toFixed(3)}m</strong>
          </span>
          <span>
            H: <strong className="text-cyan-300">{evaluated.height.toFixed(3)}m</strong>
          </span>
          <span>
            L-Wall: <strong className="text-emerald-300">{evaluated.leftWallHeight.toFixed(2)}m</strong>
          </span>
          <span>
            R-Wall: <strong className="text-emerald-300">{evaluated.rightWallHeight.toFixed(2)}m</strong>
          </span>
          <span>
            Crown Arc: <strong className="text-amber-300">{evaluated.crownArcLength.toFixed(3)}m</strong>
          </span>
          <span>
            Perim: <strong className="text-white">{evaluated.totalPerimeterMeters.toFixed(2)}m</strong>
          </span>
          <span>
            Area: <strong className="text-rose-300">{evaluated.designAreaSqMeters.toFixed(2)}m²</strong>
          </span>
        </div>
      </div>

      {feedbackBanner && (
        <div className="px-4 py-1.5 bg-cyan-950/60 border-b border-cyan-800/60 text-cyan-200 flex items-center justify-between text-[11px] shrink-0">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner('')}
            className="text-cyan-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          TABS 1 & 2: INTERACTIVE VECTOR CANVAS + CONTROL POINT / IMAGE PANELS
         ==================================================================== */}
      {(activeTab === 'freeform_canvas' || activeTab === 'trace_image') && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT SIDEBAR: Presets, Parametric Dimensions & Reference Image Controls (4 cols) */}
          <div className="lg:col-span-4 border-r border-slate-800 bg-[#111621] overflow-y-auto p-3.5 space-y-3.5">
            {/* Profile Name & Preset Selector */}
            <div className="p-3 bg-slate-900/90 border border-slate-800 rounded space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-400 text-[11px]">
                  1. EXCAVATION PROFILE PRESETS OR BLANK FREEFORM
                </span>
                <button
                  type="button"
                  onClick={handleStartBlankFreeform}
                  className="px-2 py-0.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded text-[10px] cursor-pointer"
                >
                  + Blank Freeform
                </button>
              </div>

              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {CUSTOM_PROFILE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`w-full text-left p-2 rounded border transition-colors cursor-pointer ${
                      profile.id === preset.id || profile.name === preset.label
                        ? 'bg-cyan-950/60 border-cyan-500/70 text-white'
                        : 'bg-slate-950/80 hover:bg-slate-900 border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[11px] text-cyan-300">
                        {preset.label}
                      </span>
                      <span className="px-1.5 py-0.2 bg-slate-900 border border-slate-700 rounded text-[9px] text-slate-300 shrink-0">
                        {preset.badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{preset.subtitle}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Section 5: Reference Image Import & Scale Calibration (Highlighted on Tab 2 or always available) */}
            <div
              className={`p-3 rounded border space-y-2.5 ${
                activeTab === 'trace_image'
                  ? 'bg-cyan-950/30 border-cyan-500/60'
                  : 'bg-slate-900/90 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 text-[11px] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  IMPORT &amp; TRACE REFERENCE DRAWING
                </span>
                <input
                  ref={refImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadReferenceImage(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => refImageInputRef.current?.click()}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-[10px] cursor-pointer"
                >
                  {profile.referenceImage ? 'Replace Image' : 'Import Reference Image'}
                </button>
              </div>

              {profile.referenceImage ? (
                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="truncate max-w-[180px]">{profile.referenceImage.fileName}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setProfile((p) => ({
                            ...p,
                            referenceImage: p.referenceImage
                              ? { ...p.referenceImage, visible: !p.referenceImage.visible }
                              : null,
                          }))
                        }
                        className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px]"
                      >
                        {profile.referenceImage.visible ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setProfile((p) => ({ ...p, referenceImage: null }))}
                        className="px-1.5 py-0.5 bg-rose-950 text-rose-300 rounded text-[10px]"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 items-end">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Known Dimension (m)</span>
                      <input
                        type="number"
                        step="0.001"
                        value={knownScaleMetersInput}
                        onChange={(e) => setKnownScaleMetersInput(e.target.value)}
                        className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-cyan-300 font-bold"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setCanvasTool('calibrate_scale');
                        setScaleCalibStep('pick_a');
                        setFeedbackBanner(
                          'Click Reference Point A on the drawing, then click Reference Point B to calibrate exact scale.'
                        );
                      }}
                      className={`py-1.5 px-2 rounded font-semibold text-[10px] cursor-pointer ${
                        canvasTool === 'calibrate_scale'
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-cyan-700 hover:bg-cyan-600 text-white'
                      }`}
                    >
                      {canvasTool === 'calibrate_scale'
                        ? `Click Pt ${scaleCalibStep === 'pick_b' ? 'B' : 'A'} on Canvas`
                        : '1. Set Scale (Pick A→B)'}
                    </button>
                  </div>

                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-slate-400">
                      Underlay Opacity: {profile.referenceImage.opacity}% (Final geometry is pure vector)
                    </span>
                    <input
                      type="range"
                      min="10"
                      max="95"
                      value={profile.referenceImage.opacity}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          referenceImage: p.referenceImage
                            ? { ...p.referenceImage, opacity: Number(e.target.value) }
                            : null,
                        }))
                      }
                      className="w-full accent-cyan-500"
                    />
                  </label>
                </div>
              ) : (
                <div className="text-[10px] text-slate-400 leading-relaxed">
                  Load an engineering cross-section drawing, sketch, or photo to calibrate scale and
                  trace the excavation boundary into editable vector geometry.
                </div>
              )}
            </div>

            {/* Section 3: Exact Engineering Dimensions (Parametric Resizing) */}
            <div className="p-3 bg-slate-900/90 border border-slate-800 rounded space-y-2.5">
              <div className="font-bold text-cyan-400 text-[11px] flex items-center justify-between">
                <span>2. EXACT ENGINEERING DIMENSIONS (METERS)</span>
                <span className="text-[10px] text-slate-400">Parametric Update</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">Total Width (m)</span>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.001"
                      min="1.0"
                      value={dimWidthInput}
                      onChange={(e) => setDimWidthInput(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const w = parseFloat(dimWidthInput);
                        if (w >= 1.0) {
                          const next = applyParametricOverallDimensions(profile, { width: w });
                          setProfile(next);
                          syncDimensionInputsFromEvaluated(next);
                        }
                      }}
                      className="px-2 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-[10px]"
                    >
                      Set
                    </button>
                  </div>
                </label>

                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">Total Height (m)</span>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.001"
                      min="1.0"
                      value={dimHeightInput}
                      onChange={(e) => setDimHeightInput(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const h = parseFloat(dimHeightInput);
                        if (h >= 1.0) {
                          const next = applyParametricOverallDimensions(profile, { height: h });
                          setProfile(next);
                          syncDimensionInputsFromEvaluated(next);
                        }
                      }}
                      className="px-2 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-[10px]"
                    >
                      Set
                    </button>
                  </div>
                </label>

                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">Left Wall Height (m)</span>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      value={dimLeftWallInput}
                      onChange={(e) => setDimLeftWallInput(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const lwh = parseFloat(dimLeftWallInput);
                        if (lwh >= 0.5) {
                          const next = applyParametricOverallDimensions(profile, {
                            leftWallHeight: lwh,
                          });
                          setProfile(next);
                          syncDimensionInputsFromEvaluated(next);
                        }
                      }}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded text-[10px]"
                    >
                      Set
                    </button>
                  </div>
                </label>

                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">Right Wall Height (m)</span>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      value={dimRightWallInput}
                      onChange={(e) => setDimRightWallInput(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const rwh = parseFloat(dimRightWallInput);
                        if (rwh >= 0.5) {
                          const next = applyParametricOverallDimensions(profile, {
                            rightWallHeight: rwh,
                          });
                          setProfile(next);
                          syncDimensionInputsFromEvaluated(next);
                        }
                      }}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded text-[10px]"
                    >
                      Set
                    </button>
                  </div>
                </label>
              </div>
            </div>

            {/* Selected Control Point & Segment Inspector */}
            <div className="p-3 bg-slate-900/90 border border-slate-800 rounded space-y-2.5">
              <div className="font-bold text-cyan-400 text-[11px]">
                3. SELECTED CONTROL POINT &amp; SEGMENT INSPECTOR
              </div>

              {selectedPoint ? (
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300">
                      Control Point {selectedPoint.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setProfile((prev) => ({
                            ...prev,
                            controlPoints: prev.controlPoints.map((p) =>
                              p.id === selectedPoint.id ? { ...p, locked: !p.locked } : p
                            ),
                          }))
                        }
                        className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 ${
                          selectedPoint.locked
                            ? 'bg-amber-950 text-amber-300 border border-amber-700'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {selectedPoint.locked ? (
                          <>
                            <Lock className="w-3 h-3" /> Locked
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3 h-3" /> Unlocked
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInsertPointAfter(selectedPoint.id)}
                        className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded text-[10px]"
                      >
                        +Insert Next
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteControlPoint(selectedPoint.id)}
                        className="p-1 text-rose-400 hover:bg-rose-950 rounded"
                        title="Delete Control Point"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">X Coordinate (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        disabled={selectedPoint.locked}
                        value={selectedPoint.x}
                        onChange={(e) => {
                          const nx = parseFloat(e.target.value);
                          if (Number.isNaN(nx)) return;
                          setProfile((prev) => {
                            const next = {
                              ...prev,
                              controlPoints: prev.controlPoints.map((p) =>
                                p.id === selectedPoint.id ? { ...p, x: nx } : p
                              ),
                            };
                            syncDimensionInputsFromEvaluated(next);
                            return next;
                          });
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Y Elevation (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        disabled={selectedPoint.locked}
                        value={selectedPoint.y}
                        onChange={(e) => {
                          const ny = parseFloat(e.target.value);
                          if (Number.isNaN(ny)) return;
                          setProfile((prev) => {
                            const next = {
                              ...prev,
                              controlPoints: prev.controlPoints.map((p) =>
                                p.id === selectedPoint.id ? { ...p, y: ny } : p
                              ),
                            };
                            syncDimensionInputsFromEvaluated(next);
                            return next;
                          });
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {/* Selected Segment Type (Line <-> Arc <-> Bezier) & Exact Length/Radius */}
              {selectedSegmentMetric ? (
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300">
                      Segment {selectedSegmentMetric.fromPoint.label} →{' '}
                      {selectedSegmentMetric.toPoint.label}
                    </span>
                    <select
                      value={selectedSegmentMetric.zoneRole}
                      onChange={(e) => {
                        const role = e.target.value as BoundaryZoneRole;
                        setProfile((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSegmentMetric.segmentId
                              ? { ...s, zoneRole: role }
                              : s
                          ),
                        }));
                      }}
                      className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[10px] text-cyan-300"
                    >
                      <option value="leftWall">Zone: Left Wall</option>
                      <option value="crown">Zone: Crown</option>
                      <option value="rightWall">Zone: Right Wall</option>
                      <option value="invert">Zone: Invert / Floor</option>
                    </select>
                  </div>

                  {/* Line / Arc / Bezier Curve Switcher */}
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'line', label: 'Straight Line' },
                        { id: 'arc', label: 'Circular Arc' },
                        { id: 'bezier', label: 'Smooth Curve' },
                      ] as { id: CustomSegmentType; label: string }[]
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          handleChangeSegmentType(selectedSegmentMetric.segmentId, st.id)
                        }
                        className={`py-1 px-1.5 rounded text-[10px] font-semibold cursor-pointer ${
                          selectedSegmentMetric.type === st.id
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Chord Length (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedSegmentMetric.chordLength.toFixed(3)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (val >= 0.2) {
                            setProfile((prev) =>
                              applySegmentExactDimension(prev, selectedSegmentMetric.segmentId, {
                                chordLengthMeters: val,
                              })
                            );
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                      />
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[10px] text-amber-300">True Arc Length (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedSegmentMetric.arcLength.toFixed(3)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (val >= selectedSegmentMetric.chordLength) {
                            setProfile((prev) =>
                              applySegmentExactDimension(prev, selectedSegmentMetric.segmentId, {
                                arcLengthMeters: val,
                              })
                            );
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-amber-700/60 rounded text-amber-200 font-bold"
                      />
                    </label>
                  </div>

                  {selectedSegmentMetric.type === 'arc' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Arc Radius R (m)</span>
                        <input
                          type="number"
                          step="0.05"
                          value={selectedSegmentMetric.radiusMeters?.toFixed(3) || '5.000'}
                          onChange={(e) => {
                            const r = parseFloat(e.target.value);
                            if (r >= selectedSegmentMetric.chordLength / 2) {
                              setProfile((prev) =>
                                applySegmentExactDimension(prev, selectedSegmentMetric.segmentId, {
                                  arcRadiusMeters: r,
                                })
                              );
                            }
                          }}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">
                          Curvature Bulge ({selectedSegmentMetric.bulge?.toFixed(2) || '0.28'})
                        </span>
                        <input
                          type="range"
                          min="-1.2"
                          max="1.2"
                          step="0.02"
                          value={selectedSegmentMetric.bulge ?? 0.28}
                          onChange={(e) => {
                            const b = parseFloat(e.target.value);
                            setProfile((prev) => ({
                              ...prev,
                              segments: prev.segments.map((s) =>
                                s.id === selectedSegmentMetric.segmentId
                                  ? { ...s, arcBulge: b, arcRadiusMeters: undefined }
                                  : s
                              ),
                            }));
                          }}
                          className="w-full accent-amber-400 mt-1.5"
                        />
                      </label>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* RIGHT AREA: Interactive Vector CAD Canvas (8 cols) */}
          <div className="lg:col-span-8 flex flex-col h-full bg-[#070A0F] overflow-hidden relative">
            {/* Canvas Floating Drawing Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0E131D] border-b border-slate-800 z-10">
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'select_move', label: 'Move Point / Curve Handle' },
                    { id: 'add_line_pt', label: '+ Line Point' },
                    { id: 'add_arc_pt', label: '+ Arc Point' },
                    { id: 'add_bezier_pt', label: '+ Smooth Curve' },
                    { id: 'insert_on_segment', label: '+ Split Segment' },
                  ] as { id: CanvasEditorTool; label: string }[]
                ).map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setCanvasTool(tool.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
                      canvasTool === tool.id
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                    }`}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableGridSnap}
                    onChange={(e) => setEnableGridSnap(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  Snap {snapGridMeters}m
                </label>

                <label className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableOrthoSnap}
                    onChange={(e) => setEnableOrthoSnap(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  Ortho
                </label>

                <label className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.isClosed}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, isClosed: e.target.checked }))
                    }
                    className="accent-emerald-500"
                  />
                  Closed Loop
                </label>

                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, Number((z * 1.2).toFixed(2))))}
                  className="p-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.4, Number((z / 1.2).toFixed(2))))}
                  className="p-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPanX(0);
                    setPanY(0);
                  }}
                  className="p-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded"
                  title="Fit View"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Interactive SVG Vector Canvas */}
            <div className="flex-1 min-h-0 relative flex items-center justify-center">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${stage.viewW} ${stage.viewH}`}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onWheel={(e) => {
                  e.preventDefault();
                  const factor = e.deltaY < 0 ? 1.1 : 0.91;
                  setZoom((z) => Math.max(0.35, Math.min(5, Number((z * factor).toFixed(3)))));
                }}
                className="w-full h-full select-none cursor-crosshair"
              >
                <defs>
                  <pattern
                    id="custom-prof-grid"
                    width={Math.max(12, stage.pxPerMeter)}
                    height={Math.max(12, stage.pxPerMeter)}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M ${Math.max(12, stage.pxPerMeter)} 0 L 0 0 0 ${Math.max(12, stage.pxPerMeter)}`}
                      fill="none"
                      stroke="#1E293B"
                      strokeWidth="0.7"
                    />
                  </pattern>
                </defs>

                <rect x="0" y="0" width={stage.viewW} height={stage.viewH} fill="url(#custom-prof-grid)" />

                {/* Reference Image Underlay for Tracing (Section 5) */}
                {profile.referenceImage && profile.referenceImage.visible && (() => {
                  const refImg = profile.referenceImage;
                  const tl = profileMetersToCanvasPx(
                    {
                      x: refImg.offsetX - refImg.widthMeters / 2,
                      y: refImg.offsetY + refImg.heightMeters / 2,
                    },
                    stage
                  );
                  const wPx = refImg.widthMeters * stage.pxPerMeter;
                  const hPx = refImg.heightMeters * stage.pxPerMeter;
                  return (
                    <g opacity={refImg.opacity / 100}>
                      <image
                        href={refImg.dataUrl}
                        x={tl.cx}
                        y={tl.cy}
                        width={wPx}
                        height={hPx}
                        preserveAspectRatio="none"
                      />
                      {refImg.scalePointA && (
                        <circle
                          cx={profileMetersToCanvasPx(refImg.scalePointA, stage).cx}
                          cy={profileMetersToCanvasPx(refImg.scalePointA, stage).cy}
                          r="5"
                          fill="#F59E0B"
                          stroke="#000"
                        />
                      )}
                      {refImg.scalePointA && refImg.scalePointB && (
                        <line
                          x1={profileMetersToCanvasPx(refImg.scalePointA, stage).cx}
                          y1={profileMetersToCanvasPx(refImg.scalePointA, stage).cy}
                          x2={profileMetersToCanvasPx(refImg.scalePointB, stage).cx}
                          y2={profileMetersToCanvasPx(refImg.scalePointB, stage).cy}
                          stroke="#F59E0B"
                          strokeWidth="2"
                          strokeDasharray="4,3"
                        />
                      )}
                    </g>
                  );
                })()}

                {/* Tunnel Datum Axes: Centerline X = 0m and Invert Floor Y = 0m */}
                <line
                  x1={stage.originCanvasX}
                  y1={16}
                  x2={stage.originCanvasX}
                  y2={stage.viewH - 16}
                  stroke="#334155"
                  strokeWidth="1.2"
                  strokeDasharray="5,5"
                />
                <line
                  x1={16}
                  y1={stage.originCanvasY}
                  x2={stage.viewW - 16}
                  y2={stage.originCanvasY}
                  stroke="#334155"
                  strokeWidth="1.2"
                  strokeDasharray="5,5"
                />
                <text
                  x={stage.originCanvasX + 6}
                  y={28}
                  fill="#64748B"
                  fontSize="10"
                >
                  CL (X = 0.00m)
                </text>
                <text
                  x={24}
                  y={stage.originCanvasY - 6}
                  fill="#64748B"
                  fontSize="10"
                >
                  Invert Datum (Y = 0.00m)
                </text>

                {/* Filled Authoritative Excavation Cross-Section Polygon */}
                {closedBoundarySvgPath && (
                  <path
                    d={closedBoundarySvgPath}
                    fill="rgba(56, 189, 248, 0.10)"
                    stroke="none"
                  />
                )}

                {/* Individual Segments (Color-coded by Zone: Left Wall, Crown, Right Wall, Invert) */}
                {evaluated.segmentMetrics.map((seg) => {
                  const isSelected = seg.segmentId === selectedSegmentId;
                  const segPath = seg.sampledPoints
                    .map((pt, i) => {
                      const px = profileMetersToCanvasPx(pt, stage);
                      return `${i === 0 ? 'M' : 'L'} ${px.cx} ${px.cy}`;
                    })
                    .join(' ');

                  const zoneColor =
                    seg.zoneRole === 'crown'
                      ? '#38BDF8'
                      : seg.zoneRole === 'leftWall'
                      ? '#34D399'
                      : seg.zoneRole === 'rightWall'
                      ? '#A78BFA'
                      : '#94A3B8';

                  const midPx = profileMetersToCanvasPx(seg.midHandlePoint, stage);

                  return (
                    <g key={seg.segmentId}>
                      <path
                        d={segPath}
                        fill="none"
                        stroke={isSelected ? '#FBBF24' : zoneColor}
                        strokeWidth={isSelected ? 3.5 : 2.4}
                        className="cursor-pointer"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedSegmentId(seg.segmentId);
                        }}
                      />

                      {/* Segment Dimension Label (Arc length or Chord length + Radius) */}
                      <g
                        transform={`translate(${midPx.cx}, ${midPx.cy - 10})`}
                        className="cursor-pointer"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedSegmentId(seg.segmentId);
                        }}
                      >
                        <rect
                          x="-44"
                          y="-9"
                          width="88"
                          height="15"
                          rx="3"
                          fill="rgba(15, 23, 42, 0.88)"
                          stroke={isSelected ? '#FBBF24' : '#334155'}
                          strokeWidth="0.8"
                        />
                        <text
                          x="0"
                          y="1.5"
                          textAnchor="middle"
                          fontSize="9"
                          fill={isSelected ? '#FDE68A' : '#E2E8F0'}
                        >
                          {seg.type === 'arc'
                            ? `Arc ${seg.arcLength.toFixed(2)}m (R=${seg.radiusMeters?.toFixed(1)}m)`
                            : seg.type === 'bezier'
                            ? `Curve ${seg.arcLength.toFixed(2)}m`
                            : `${seg.chordLength.toFixed(2)}m`}
                        </text>
                      </g>

                      {/* Draggable Arc Midpoint Handle (for 'arc' segments) */}
                      {seg.type === 'arc' && (
                        <circle
                          cx={midPx.cx}
                          cy={midPx.cy}
                          r="6"
                          fill="#F59E0B"
                          stroke="#0F172A"
                          strokeWidth="1.5"
                          className="cursor-grab"
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            setSelectedSegmentId(seg.segmentId);
                            setDraggingState({
                              kind: 'arc_handle',
                              id: seg.segmentId,
                            });
                          }}
                        >
                          <title>Drag to adjust Circular Arc Radius &amp; Curvature</title>
                        </circle>
                      )}

                      {/* Draggable Bezier Control Handles (cp1, cp2) */}
                      {seg.type === 'bezier' && seg.cp1 && seg.cp2 && (() => {
                        const p1Px = profileMetersToCanvasPx(seg.fromPoint, stage);
                        const p2Px = profileMetersToCanvasPx(seg.toPoint, stage);
                        const cp1Px = profileMetersToCanvasPx(seg.cp1, stage);
                        const cp2Px = profileMetersToCanvasPx(seg.cp2, stage);
                        return (
                          <g>
                            <line
                              x1={p1Px.cx}
                              y1={p1Px.cy}
                              x2={cp1Px.cx}
                              y2={cp1Px.cy}
                              stroke="#F472B6"
                              strokeWidth="1"
                              strokeDasharray="3,3"
                            />
                            <line
                              x1={p2Px.cx}
                              y1={p2Px.cy}
                              x2={cp2Px.cx}
                              y2={cp2Px.cy}
                              stroke="#F472B6"
                              strokeWidth="1"
                              strokeDasharray="3,3"
                            />
                            <circle
                              cx={cp1Px.cx}
                              cy={cp1Px.cy}
                              r="5"
                              fill="#EC4899"
                              stroke="#FFF"
                              strokeWidth="1.2"
                              className="cursor-grab"
                              onPointerDown={(ev) => {
                                ev.stopPropagation();
                                setSelectedSegmentId(seg.segmentId);
                                setDraggingState({
                                  kind: 'bezier_cp1',
                                  id: seg.segmentId,
                                });
                              }}
                            />
                            <circle
                              cx={cp2Px.cx}
                              cy={cp2Px.cy}
                              r="5"
                              fill="#EC4899"
                              stroke="#FFF"
                              strokeWidth="1.2"
                              className="cursor-grab"
                              onPointerDown={(ev) => {
                                ev.stopPropagation();
                                setSelectedSegmentId(seg.segmentId);
                                setDraggingState({
                                  kind: 'bezier_cp2',
                                  id: seg.segmentId,
                                });
                              }}
                            />
                          </g>
                        );
                      })()}
                    </g>
                  );
                })}

                {/* Overall Width & Height Engineering Dimension Callouts */}
                {(() => {
                  const botLeft = profileMetersToCanvasPx(
                    { x: evaluated.minX, y: evaluated.minY },
                    stage
                  );
                  const botRight = profileMetersToCanvasPx(
                    { x: evaluated.maxX, y: evaluated.minY },
                    stage
                  );
                  const topApex = profileMetersToCanvasPx(
                    { x: evaluated.minX, y: evaluated.maxY },
                    stage
                  );
                  const dimY = Math.min(stage.viewH - 18, botLeft.cy + 28);
                  const dimX = Math.max(24, botLeft.cx - 32);

                  return (
                    <g>
                      {/* Total Span Width Dimension Line */}
                      <line
                        x1={botLeft.cx}
                        y1={dimY}
                        x2={botRight.cx}
                        y2={dimY}
                        stroke="#38BDF8"
                        strokeWidth="1.4"
                      />
                      <text
                        x={(botLeft.cx + botRight.cx) / 2}
                        y={dimY + 13}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="#38BDF8"
                      >
                        SPAN WIDTH = {evaluated.width.toFixed(3)} m
                      </text>

                      {/* Total Height Dimension Line */}
                      <line
                        x1={dimX}
                        y1={topApex.cy}
                        x2={dimX}
                        y2={botLeft.cy}
                        stroke="#34D399"
                        strokeWidth="1.4"
                      />
                      <text
                        x={dimX - 8}
                        y={(topApex.cy + botLeft.cy) / 2}
                        textAnchor="middle"
                        fontSize="10.5"
                        fontWeight="700"
                        fill="#34D399"
                        transform={`rotate(-90, ${dimX - 8}, ${(topApex.cy + botLeft.cy) / 2})`}
                      >
                        HEIGHT = {evaluated.height.toFixed(3)} m
                      </text>
                    </g>
                  );
                })()}

                {/* Editable Control Point Nodes (P1..Pn) */}
                {profile.controlPoints.map((pt) => {
                  const px = profileMetersToCanvasPx(pt, stage);
                  const isSel = pt.id === selectedPointId;
                  return (
                    <g
                      key={pt.id}
                      className="cursor-grab"
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        setSelectedPointId(pt.id);
                        if (!pt.locked) {
                          setDraggingState({
                            kind: 'point',
                            id: pt.id,
                          });
                        }
                      }}
                    >
                      <circle
                        cx={px.cx}
                        cy={px.cy}
                        r={isSel ? 7.5 : 5.5}
                        fill={pt.locked ? '#F59E0B' : isSel ? '#22D3EE' : '#0F172A'}
                        stroke={isSel ? '#FFFFFF' : '#38BDF8'}
                        strokeWidth="2"
                      />
                      <text
                        x={px.cx + 9}
                        y={px.cy - 7}
                        fontSize="10"
                        fontWeight="700"
                        fill={isSel ? '#22D3EE' : '#F8FAFC'}
                      >
                        {pt.label} ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})
                        {pt.surveyControlPointId ? ` [${pt.surveyControlPointId}]` : ''}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Bottom Coordinate & Multi-Space Status Strip */}
              <div className="absolute bottom-2 left-3 right-3 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-950/90 border border-slate-800 rounded text-[10px] text-slate-300 pointer-events-none">
                <div>
                  CURSOR (WORLD METERS):{' '}
                  <strong className="text-cyan-300">
                    X = {cursorMeters ? cursorMeters.x.toFixed(3) : '0.000'} m, Y ={' '}
                    {cursorMeters ? cursorMeters.y.toFixed(3) : '0.000'} m
                  </strong>{' '}
                  · Scale: {stage.pxPerMeter.toFixed(1)} px/m (Zoom {Math.round(zoom * 100)}%)
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400">● Left Wall: {evaluated.leftWallArcLength.toFixed(2)}m</span>
                  <span className="text-sky-400">● Crown Arc: {evaluated.crownArcLength.toFixed(2)}m</span>
                  <span className="text-purple-400">● Right Wall: {evaluated.rightWallArcLength.toFixed(2)}m</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 3: CONTROL-POINT COORDINATE TABLE, SURVEY CP LINKING & BULK XY
         ==================================================================== */}
      {activeTab === 'coordinates_table' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between bg-[#111621] p-3 border border-slate-800 rounded">
              <div>
                <div className="font-bold text-cyan-300 text-xs">
                  CONTROL-POINT &amp; SEGMENT TABLE (P1 → P{profile.controlPoints.length})
                </div>
                <div className="text-[11px] text-slate-400">
                  Edit exact X/Y coordinates (m), link points to Survey Control Points (CP1..CPn),
                  lock points, or switch segments between Line, Arc, and Curve.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onSyncProfileToSurveyControlPoints && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextPts = profile.controlPoints.map((cp, idx) => ({
                        ...cp,
                        surveyControlPointId: cp.surveyControlPointId || `CP${idx + 1}`,
                      }));
                      const nextProf: CustomTunnelProfileDefinition = {
                        ...profile,
                        controlPoints: nextPts,
                        updatedAt: new Date().toISOString(),
                      };
                      setProfile(nextProf);
                      onSyncProfileToSurveyControlPoints(nextProf);
                      setFeedbackBanner(
                        `Linked ${nextPts.length} profile control points to Survey Control Points (CP1→CP${nextPts.length}). Moving any CP updates the connected profile automatically.`
                      );
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    Link &amp; Place Survey Control Points (CP1→CP{profile.controlPoints.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    handleInsertPointAfter(
                      profile.controlPoints[profile.controlPoints.length - 1]?.id || 'P1'
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Control Point
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded bg-[#111621]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[10px]">
                    <th className="p-2.5">POINT</th>
                    <th className="p-2.5">X (m)</th>
                    <th className="p-2.5">Y (m)</th>
                    <th className="p-2.5">OUTGOING SEGMENT</th>
                    <th className="p-2.5">ZONE ROLE</th>
                    <th className="p-2.5">LINKED SURVEY CP</th>
                    <th className="p-2.5">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.controlPoints.map((pt, idx) => {
                    const nextPt = profile.controlPoints[(idx + 1) % profile.controlPoints.length];
                    const segMetric = evaluated.segmentMetrics[idx];
                    return (
                      <tr
                        key={pt.id}
                        className="border-b border-slate-800/80 hover:bg-slate-900/60"
                      >
                        <td className="p-2 font-bold text-cyan-300">{pt.label}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            disabled={pt.locked}
                            value={pt.x}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (Number.isNaN(val)) return;
                              setProfile((prev) => ({
                                ...prev,
                                controlPoints: prev.controlPoints.map((item) =>
                                  item.id === pt.id ? { ...item, x: val } : item
                                ),
                              }));
                            }}
                            className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            disabled={pt.locked}
                            value={pt.y}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (Number.isNaN(val)) return;
                              setProfile((prev) => ({
                                ...prev,
                                controlPoints: prev.controlPoints.map((item) =>
                                  item.id === pt.id ? { ...item, y: val } : item
                                ),
                              }));
                            }}
                            className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                          />
                        </td>
                        <td className="p-2">
                          {segMetric && (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={segMetric.type}
                                onChange={(e) =>
                                  handleChangeSegmentType(
                                    segMetric.segmentId,
                                    e.target.value as CustomSegmentType
                                  )
                                }
                                className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-amber-300"
                              >
                                <option value="line">
                                  Line ({segMetric.chordLength.toFixed(2)}m)
                                </option>
                                <option value="arc">
                                  Arc (L={segMetric.arcLength.toFixed(2)}m)
                                </option>
                                <option value="bezier">
                                  Smooth Curve ({segMetric.arcLength.toFixed(2)}m)
                                </option>
                              </select>
                              <span className="text-[10px] text-slate-500">→ {nextPt?.label}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          {segMetric && (
                            <select
                              value={segMetric.zoneRole}
                              onChange={(e) => {
                                const role = e.target.value as BoundaryZoneRole;
                                setProfile((prev) => ({
                                  ...prev,
                                  segments: prev.segments.map((s) =>
                                    s.id === segMetric.segmentId ? { ...s, zoneRole: role } : s
                                  ),
                                }));
                              }}
                              className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200"
                            >
                              <option value="leftWall">Left Wall</option>
                              <option value="crown">Crown Arch</option>
                              <option value="rightWall">Right Wall</option>
                              <option value="invert">Invert / Floor</option>
                            </select>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="e.g. CP1"
                            value={pt.surveyControlPointId || ''}
                            onChange={(e) => {
                              const cpRef = e.target.value.trim();
                              setProfile((prev) => ({
                                ...prev,
                                controlPoints: prev.controlPoints.map((item) =>
                                  item.id === pt.id
                                    ? { ...item, surveyControlPointId: cpRef || undefined }
                                    : item
                                ),
                              }));
                            }}
                            className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-emerald-300"
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMovePointOrder(pt.id, -1)}
                              className="p-1 bg-slate-800 hover:bg-slate-700 rounded"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePointOrder(pt.id, 1)}
                              className="p-1 bg-slate-800 hover:bg-slate-700 rounded"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInsertPointAfter(pt.id)}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded text-[10px]"
                            >
                              +Ins
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteControlPoint(pt.id)}
                              className="p-1 text-slate-400 hover:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bulk Coordinate Entry Box */}
          <div className="lg:col-span-4 space-y-4">
            <div className="p-4 bg-[#111621] border border-slate-800 rounded space-y-3">
              <div className="font-bold text-cyan-300">
                PASTE / ENTER CONTROL-POINT COORDINATES (X, Y in meters)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Enter one control point per line as <code>X, Y</code> or{' '}
                <code>Label, X, Y</code> in meters (X = 0 is tunnel centerline, Y = 0 is invert):
              </p>
              <textarea
                rows={8}
                value={bulkXYText}
                onChange={(e) => setBulkXYText(e.target.value)}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-slate-100 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleApplyBulkXYCoordinates}
                className="w-full py-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer"
              >
                Build Vector Profile from Coordinates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 4: IMPORT DXF / DWG & REUSABLE SAVED GEOMETRIES LIBRARY
         ==================================================================== */}
      {activeTab === 'dxf_and_library' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Upload DXF / DWG */}
          <div className="p-5 bg-[#111621] border border-slate-800 rounded space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300 text-sm">
                IMPORT AUTOCAD .DXF OR .DWG EXCAVATION PROFILE
              </span>
              <button
                type="button"
                onClick={onDownloadSampleDXF}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 text-[11px]"
              >
                <Download className="w-3.5 h-3.5" />
                Download Sample DXF
              </button>
            </div>

            <input
              ref={cadFileInputRef}
              type="file"
              accept=".dxf,.dwg"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  await onUploadCADFile(f);
                }
                e.target.value = '';
              }}
            />

            <div
              onClick={() => cadFileInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-lg bg-slate-900/60 flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-colors"
            >
              <Upload className="w-8 h-8 text-cyan-400" />
              <div className="font-bold text-slate-100 text-xs">
                Click to Upload Tunnel or Cavern CAD File (.DXF / .DWG)
              </div>
              <div className="text-[11px] text-slate-400 max-w-md">
                Extracts LINE, ARC, and LWPOLYLINE entities into editable control-point vector
                geometry. Preserves stepped powerhouse walls, side chambers, and asymmetric arches.
              </div>
            </div>

            {cadStatus && (
              <div className="p-3 bg-slate-950 border border-cyan-700/50 rounded text-cyan-300">
                {cadStatus}
              </div>
            )}
          </div>

          {/* Saved Design Geometries Library */}
          <div className="p-5 bg-[#111621] border border-slate-800 rounded space-y-4">
            <div className="font-bold text-emerald-300 text-sm">
              REUSE SAVED DESIGN GEOMETRY LIBRARY ({savedGeometries.length})
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={saveLibName}
                onChange={(e) => setSaveLibName(e.target.value)}
                placeholder="Profile Name to Save..."
                className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded text-white"
              />
              <button
                type="button"
                onClick={() => {
                  const authGeom = buildAuthoritativeCustomTunnelGeometry(profile);
                  onSaveGeometryToLibrary(saveLibName || profile.name, authGeom);
                  setFeedbackBanner(`Saved "${saveLibName}" to Library.`);
                }}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded cursor-pointer"
              >
                Save Current
              </button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {savedGeometries.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-slate-950 rounded border border-slate-800">
                  No saved profiles yet. Click &quot;Save Current&quot; above to store any custom
                  cavern or tunnel profile for one-click reuse.
                </div>
              ) : (
                savedGeometries.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-3 bg-slate-900 border border-slate-800 rounded flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-cyan-300">{rec.name}</div>
                      <div className="text-[11px] text-slate-400">
                        Span {rec.geometry.width.toFixed(2)}m × Height{' '}
                        {rec.geometry.height.toFixed(2)}m · Crown Arc{' '}
                        {rec.geometry.crownArcLength.toFixed(2)}m
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadSavedGeometry(rec);
                          if (rec.geometry.customProfile) {
                            setProfile(rec.geometry.customProfile);
                          }
                          setFeedbackBanner(`Loaded saved profile "${rec.name}".`);
                        }}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer"
                      >
                        Load &amp; Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedGeometry(rec.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 5: MULTIPLE PROFILE TYPES BY CHAINAGE/RD & PROFILE TRANSITIONS
          (Sections 7 & 8: RD 100-120 Regular -> RD 120-150 Transition -> RD 150-200 Powerhouse -> RD 200-230 Transformer Hall)
         ==================================================================== */}
      {activeTab === 'chainage_schedule' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Chainage Schedule Table & Add Range Form (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-4 bg-[#111621] border border-slate-800 rounded space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-cyan-300 text-sm">
                    PROFILE BY CHAINAGE / RD RANGE &amp; TRANSITION SCHEDULE
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Define different tunnel/cavern profiles and smooth transitions along project
                    chainage (RD start → RD end).
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {chainageSchedule.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded border flex flex-wrap items-center justify-between gap-2 ${
                      item.isTransition
                        ? 'bg-amber-950/20 border-amber-600/50'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-700/60 rounded font-bold">
                          RD {item.rdStartMeters.toFixed(0)}m – {item.rdEndMeters.toFixed(0)}m
                        </span>
                        <span className="font-bold text-white">{item.profileName}</span>
                        <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded text-[10px]">
                          {item.sectionType.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Span: {item.geometry.width.toFixed(2)}m × Height:{' '}
                        {item.geometry.height.toFixed(2)}m · Area:{' '}
                        {(item.geometry.designAreaSqMeters || 0).toFixed(1)}m² · Perim:{' '}
                        {(item.geometry.totalPerimeterMeters || 0).toFixed(1)}m · {item.version} (
                        {item.date})
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (item.geometry.customProfile) {
                            setProfile(item.geometry.customProfile);
                          }
                          onConfirmGeometry(item.geometry, false);
                          onUpdateSettings?.((prev) => ({
                            ...prev,
                            chainage: `RD ${item.rdStartMeters.toFixed(2)}m - ${item.rdEndMeters.toFixed(2)}m`,
                            faceChainage: `RD ${item.rdStartMeters.toFixed(2)}m`,
                          }));
                          setFeedbackBanner(
                            `Activated "${item.profileName}" for RD ${item.rdStartMeters}–${item.rdEndMeters}m.`
                          );
                        }}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer"
                      >
                        Use for Mapping
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateChainageSchedule(
                            chainageSchedule.filter((s) => s.id !== item.id)
                          )
                        }
                        className="p-1.5 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Assign Current Custom Profile to a Chainage / RD Range */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded space-y-2.5 pt-3">
                <div className="font-bold text-emerald-400 text-[11px]">
                  + ADD CURRENT PROFILE OR TRANSITION TO CHAINAGE / RD SCHEDULE
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">RD Start (m)</span>
                    <input
                      type="number"
                      value={newRangeStart}
                      onChange={(e) => setNewRangeStart(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">RD End (m)</span>
                    <input
                      type="number"
                      value={newRangeEnd}
                      onChange={(e) => setNewRangeEnd(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                    />
                  </label>
                  <label className="space-y-0.5 col-span-2">
                    <span className="text-[10px] text-slate-400">Excavation Section Type</span>
                    <select
                      value={newRangeType}
                      onChange={(e) => {
                        const val = e.target.value as ChainageProfileSegmentRecord['sectionType'];
                        setNewRangeType(val);
                        setNewRangeIsTransition(val === 'TRANSITION');
                      }}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300"
                    >
                      <option value="REGULAR_TUNNEL">Regular Tunnel</option>
                      <option value="TRANSITION">Profile Transition (Expansion / Reduction)</option>
                      <option value="POWERHOUSE_CAVERN">Powerhouse Cavern</option>
                      <option value="TRANSFORMER_HALL">Transformer Hall</option>
                      <option value="CAVERN_JUNCTION">Cavern Junction</option>
                      <option value="ENLARGED_CHAMBER">Enlarged Chamber</option>
                      <option value="REDUCED_SECTION">Reduced Section</option>
                      <option value="CUSTOM_IRREGULAR">Custom Irregular Profile</option>
                    </select>
                  </label>
                </div>

                {newRangeIsTransition && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-amber-300">Transition From Section</span>
                      <select
                        value={newRangeFromId}
                        onChange={(e) => setNewRangeFromId(e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                      >
                        {chainageSchedule.map((s) => (
                          <option key={s.id} value={s.id}>
                            RD {s.rdStartMeters}–{s.rdEndMeters}m: {s.profileName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-amber-300">Transition To Section</span>
                      <select
                        value={newRangeToId}
                        onChange={(e) => setNewRangeToId(e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                      >
                        {chainageSchedule.map((s) => (
                          <option key={s.id} value={s.id}>
                            RD {s.rdStartMeters}–{s.rdEndMeters}m: {s.profileName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const sRd = parseFloat(newRangeStart) || 0;
                    const eRd = Math.max(sRd + 1, parseFloat(newRangeEnd) || sRd + 20);
                    let geomToStore = buildAuthoritativeCustomTunnelGeometry(profile, {
                      rdStartMeters: sRd,
                      rdEndMeters: eRd,
                    });

                    if (newRangeIsTransition) {
                      const fromSec = chainageSchedule.find((s) => s.id === newRangeFromId);
                      const toSec = chainageSchedule.find((s) => s.id === newRangeToId);
                      if (fromSec && toSec) {
                        geomToStore = interpolateTransitionTunnelGeometry(
                          fromSec.geometry,
                          toSec.geometry,
                          0.5,
                          `Transition (${fromSec.profileName} → ${toSec.profileName})`
                        );
                      }
                    }

                    const newRec: ChainageProfileSegmentRecord = {
                      id: `ch-seg-${Date.now()}`,
                      profileId: profile.id,
                      profileName: newRangeIsTransition
                        ? `Transition RD ${sRd}–${eRd}m`
                        : profile.name,
                      tunnelName: settings.tunnelName,
                      location: settings.locationName || 'Underground Complex',
                      rdStartMeters: sRd,
                      rdEndMeters: eRd,
                      sectionType: newRangeType,
                      isTransition: newRangeIsTransition,
                      transitionFromProfileId: newRangeIsTransition ? newRangeFromId : undefined,
                      transitionToProfileId: newRangeIsTransition ? newRangeToId : undefined,
                      geometry: geomToStore,
                      version: profile.version,
                      date: new Date().toISOString().slice(0, 10),
                    };

                    onUpdateChainageSchedule([...chainageSchedule, newRec]);
                    setFeedbackBanner(
                      `Added RD ${sRd}m–${eRd}m (${newRec.profileName}) to project Chainage Profile Schedule.`
                    );
                  }}
                  className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded cursor-pointer"
                >
                  Save Range to Project Schedule
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Chainage Transition & Profile Morphing Preview (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-4 bg-[#111621] border border-slate-800 rounded space-y-3">
              <div className="font-bold text-amber-300 text-sm">
                LIVE CHAINAGE / RD TRANSITION &amp; PROFILE RESOLVER
              </div>
              <p className="text-[11px] text-slate-400">
                Slide along project chainage (RD 100m → RD 230m) to inspect how the geometry
                transitions from Regular Tunnel → Expansion → Powerhouse Cavern → Transformer Hall:
              </p>

              <label className="block space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Inspect Chainage Station:</span>
                  <strong className="text-cyan-300 text-sm">RD {testRdMeters.toFixed(1)} m</strong>
                </div>
                <input
                  type="range"
                  min="100"
                  max="230"
                  step="1"
                  value={testRdMeters}
                  onChange={(e) => setTestRdMeters(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </label>

              {resolvedChainagePreview ? (
                <div className="space-y-3">
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded text-[11px] space-y-1">
                    <div className="font-bold text-cyan-300">
                      {resolvedChainagePreview.matchedRecord.profileName}
                    </div>
                    <div className="text-slate-300">
                      Span:{' '}
                      <strong>{resolvedChainagePreview.resolvedGeometry.width.toFixed(2)}m</strong>{' '}
                      × Height:{' '}
                      <strong>{resolvedChainagePreview.resolvedGeometry.height.toFixed(2)}m</strong>{' '}
                      · Area:{' '}
                      <strong className="text-emerald-300">
                        {(resolvedChainagePreview.resolvedGeometry.designAreaSqMeters || 0).toFixed(
                          2
                        )}{' '}
                        m²
                      </strong>
                    </div>
                  </div>

                  {/* Mini SVG Cross-Section Preview at Selected RD */}
                  {(() => {
                    const g = resolvedChainagePreview.resolvedGeometry;
                    const s = computeProfileEditorStage(g.crossSectionPoints, 1, 0, 0, 360, 260, 28);
                    const dPath =
                      g.crossSectionPoints
                        .map((pt, idx) => {
                          const p = profileMetersToCanvasPx(pt, s);
                          return `${idx === 0 ? 'M' : 'L'} ${p.cx} ${p.cy}`;
                        })
                        .join(' ') + ' Z';
                    return (
                      <div className="bg-[#070A0F] border border-slate-800 rounded p-2">
                        <svg viewBox="0 0 360 260" className="w-full h-56">
                          <path
                            d={dPath}
                            fill="rgba(56, 189, 248, 0.14)"
                            stroke="#38BDF8"
                            strokeWidth="2.2"
                          />
                          <text
                            x="180"
                            y="248"
                            textAnchor="middle"
                            fontSize="10"
                            fill="#94A3B8"
                          >
                            RD {testRdMeters.toFixed(1)}m: {g.width.toFixed(2)}m W ×{' '}
                            {g.height.toFixed(2)}m H (Perim{' '}
                            {(g.totalPerimeterMeters || 0).toFixed(1)}m)
                          </text>
                        </svg>
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => {
                      onConfirmGeometry(resolvedChainagePreview.resolvedGeometry, true);
                      onUpdateSettings?.((prev) => ({
                        ...prev,
                        faceChainage: `RD ${testRdMeters.toFixed(2)}m`,
                      }));
                    }}
                    className="w-full py-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer"
                  >
                    Use Resolved Profile at RD {testRdMeters.toFixed(1)}m for Mapping
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-slate-950 border border-slate-800 rounded text-slate-400 text-center">
                  No profile range defined at RD {testRdMeters}m.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
