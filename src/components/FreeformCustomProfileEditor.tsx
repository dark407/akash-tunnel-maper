import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChainageProfileSegmentRecord,
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
  buildAuthoritativeCustomTunnelGeometry,
  computeBulgeFromMidpointHandle,
  CUSTOM_PROFILE_PRESETS,
  evaluateCustomProfileGeometry,
} from '../engine/customProfileEngine';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CornerUpRight,
  Crosshair,
  Maximize2,
  MousePointer,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ThemeToggleButton, useTheme } from '../context/ThemeContext';

export type ProfileEditorMainTab =
  | 'freeform_canvas'
  | 'trace_image'
  | 'coordinates_table'
  | 'dxf_and_library'
  | 'chainage_schedule';

type GraphToolMode = 'select' | 'draw_line' | 'draw_arc' | 'round_corner';

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

/**
 * Helper: Convert sagitta/radius into bulge for a chord of length L
 */
function radiusToBulge(chordLen: number, radius: number, sign = 1): number {
  const halfC = chordLen / 2;
  if (chordLen < 1e-4 || Math.abs(radius) <= halfC) {
    return (sign >= 0 ? 1 : -1) * 0.5;
  }
  const r = Math.max(halfC + 0.01, Math.abs(radius));
  const sagitta = r - Math.sqrt(Math.max(0, r * r - halfC * halfC));
  const bulgeMag = (2 * sagitta) / chordLen;
  return (sign >= 0 ? 1 : -1) * Number(Math.min(2.5, Math.max(0.02, bulgeMag)).toFixed(4));
}

/**
 * Helper: Build clean initial profile from current geometry
 */
function createInitialGraphProfile(geometry: TunnelGeometry): CustomTunnelProfileDefinition {
  if (geometry.customProfile && geometry.customProfile.controlPoints.length >= 2) {
    return geometry.customProfile;
  }
  const w = Number((geometry.width || 9.0).toFixed(2));
  const h = Number((geometry.height || 7.5).toFixed(2));
  const wh = Number(Math.min(h - 1.0, geometry.wallHeight || 4.2).toFixed(2));
  const halfW = Number((w / 2).toFixed(3));
  const crownSag = Math.max(0.5, h - wh);
  const crownBulge = Number(((2 * crownSag) / Math.max(1, w)).toFixed(4));

  const pts: ProfileControlPoint[] = [
    { id: 'P1', label: 'P1', x: -halfW, y: 0, role: 'left_invert' },
    { id: 'P2', label: 'P2', x: -halfW, y: wh, role: 'left_wall_top' },
    { id: 'P3', label: 'P3', x: halfW, y: wh, role: 'right_wall_top' },
    { id: 'P4', label: 'P4', x: halfW, y: 0, role: 'right_invert' },
  ];
  const segs: ProfileSegment[] = [
    { id: 'S1', fromPointId: 'P1', toPointId: 'P2', type: 'line' },
    { id: 'S2', fromPointId: 'P2', toPointId: 'P3', type: 'arc', arcBulge: crownBulge },
    { id: 'S3', fromPointId: 'P3', toPointId: 'P4', type: 'line' },
    { id: 'S4', fromPointId: 'P4', toPointId: 'P1', type: 'line' },
  ];
  return {
    id: `prof-${Date.now()}`,
    name: geometry.profileName || `Custom Shape (${w}m × ${h}m)`,
    category: 'freeform',
    controlPoints: pts,
    segments: segs,
    isClosed: true,
    version: 'v1.0',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalize control point labels P1, P2, ... Pn and rebuild matching sequential segments
 */
function normalizeProfileTopology(
  points: ProfileControlPoint[],
  existingSegments: ProfileSegment[],
  isClosed: boolean
): { controlPoints: ProfileControlPoint[]; segments: ProfileSegment[] } {
  const renamedPoints = points.map((pt, idx) => ({
    ...pt,
    label: `P${idx + 1}`,
  }));

  if (renamedPoints.length < 2) {
    return { controlPoints: renamedPoints, segments: [] };
  }

  const segCount = isClosed ? renamedPoints.length : renamedPoints.length - 1;
  const nextSegments: ProfileSegment[] = [];

  for (let i = 0; i < segCount; i++) {
    const a = renamedPoints[i];
    const b = renamedPoints[(i + 1) % renamedPoints.length];
    const existing =
      existingSegments.find((s) => s.fromPointId === a.id && s.toPointId === b.id) ||
      existingSegments[i];

    nextSegments.push({
      id: existing?.id || `S${i + 1}`,
      fromPointId: a.id,
      toPointId: b.id,
      type: existing?.type === 'arc' ? 'arc' : 'line',
      arcBulge: existing?.type === 'arc' ? existing.arcBulge ?? 0.35 : undefined,
      arcRadiusMeters: existing?.arcRadiusMeters,
    });
  }

  return { controlPoints: renamedPoints, segments: nextSegments };
}

export const FreeformCustomProfileEditor: React.FC<FreeformCustomProfileEditorProps> = ({
  geometry,
  onConfirmGeometry,
  onBack,
  onUploadCADFile,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  // Profile + Undo / Redo History Stack
  const [profile, setProfile] = useState<CustomTunnelProfileDefinition>(() =>
    createInitialGraphProfile(geometry)
  );
  const [pastProfiles, setPastProfiles] = useState<CustomTunnelProfileDefinition[]>([]);
  const [futureProfiles, setFutureProfiles] = useState<CustomTunnelProfileDefinition[]>([]);

  const updateProfileWithUndo = useCallback(
    (
      updater:
        | CustomTunnelProfileDefinition
        | ((prev: CustomTunnelProfileDefinition) => CustomTunnelProfileDefinition)
    ) => {
      setProfile((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        setPastProfiles((p) => [...p.slice(-39), prev]);
        setFutureProfiles([]);
        return {
          ...next,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    setPastProfiles((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFutureProfiles((prevFuture) => [profile, ...prevFuture.slice(0, 39)]);
      setProfile(previous);
      return prevPast.slice(0, -1);
    });
  }, [profile]);

  const handleRedo = useCallback(() => {
    setFutureProfiles((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPastProfiles((prevPast) => [...prevPast.slice(-39), profile]);
      setProfile(next);
      return prevFuture.slice(1);
    });
  }, [profile]);

  // Keyboard shortcuts for Undo (Ctrl+Z) & Redo (Ctrl+Y)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // Active Tool & Selection
  const [tool, setTool] = useState<GraphToolMode>('select');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(
    profile.controlPoints[profile.controlPoints.length - 1]?.id || null
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    profile.segments[0]?.id || null
  );

  // Graph Paper Viewport (Origin + Scale in pixels per meter)
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cadInputRef = useRef<HTMLInputElement | null>(null);
  const viewW = 920;
  const viewH = 660;
  const [pxPerMeter, setPxPerMeter] = useState<number>(46);
  const [originPx, setOriginPx] = useState<{ x: number; y: number }>({
    x: 460,
    y: 520,
  });
  const [gridSnapStep, setGridSnapStep] = useState<number>(0.25); // meters (0 = off)
  const [cursorMeters, setCursorMeters] = useState<Point2D | null>(null);

  const [dragging, setDragging] = useState<{
    kind: 'point' | 'arc_handle' | 'pan';
    id: string;
    startClientX: number;
    startClientY: number;
    startOriginX: number;
    startOriginY: number;
    snapshotSaved?: boolean;
  } | null>(null);

  // Input State: Add by Length & Angle OR Add by X, Y
  const [addMode, setAddMode] = useState<'length_angle' | 'xy'>('length_angle');
  const [inputLengthM, setInputLengthM] = useState<string>('3.50');
  const [inputAngleDeg, setInputAngleDeg] = useState<string>('90');
  const [inputSegType, setInputSegType] = useState<'line' | 'arc'>('line');
  const [inputArcRadiusM, setInputArcRadiusM] = useState<string>('5.00');
  const [inputX, setInputX] = useState<string>('0.00');
  const [inputY, setInputY] = useState<string>('6.00');

  // Corner Round (Fillet) Radius Input
  const [roundRadiusM, setRoundRadiusM] = useState<string>('1.20');

  // Evaluate current profile geometry
  const evaluated = useMemo(() => evaluateCustomProfileGeometry(profile), [profile]);

  // Coordinate conversions between Graph Paper (Meters) and SVG Canvas (Pixels)
  const metersToPx = useCallback(
    (pt: Point2D) => ({
      x: originPx.x + pt.x * pxPerMeter,
      y: originPx.y - pt.y * pxPerMeter,
    }),
    [originPx, pxPerMeter]
  );

  const clientToMeters = useCallback(
    (clientX: number, clientY: number, applySnap = true): Point2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const scaleX = viewW / Math.max(1, rect.width);
      const scaleY = viewH / Math.max(1, rect.height);
      const svgX = (clientX - rect.left) * scaleX;
      const svgY = (clientY - rect.top) * scaleY;

      let mx = (svgX - originPx.x) / pxPerMeter;
      let my = (originPx.y - svgY) / pxPerMeter;

      if (applySnap && gridSnapStep > 0) {
        mx = Math.round(mx / gridSnapStep) * gridSnapStep;
        my = Math.round(my / gridSnapStep) * gridSnapStep;
      }
      return {
        x: Number(mx.toFixed(3)),
        y: Number(my.toFixed(3)),
      };
    },
    [originPx, pxPerMeter, gridSnapStep]
  );

  // Auto-Fit Graph Viewport to current profile
  const handleFitGraph = useCallback(() => {
    if (profile.controlPoints.length === 0) {
      setOriginPx({ x: viewW / 2, y: viewH * 0.78 });
      setPxPerMeter(45);
      return;
    }
    const xs = profile.controlPoints.map((p) => p.x);
    const ys = profile.controlPoints.map((p) => p.y);
    const minX = Math.min(...xs, -4);
    const maxX = Math.max(...xs, 4);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 6);

    const spanX = Math.max(6, maxX - minX + 4);
    const spanY = Math.max(6, maxY - minY + 4);
    const nextScale = Math.max(
      18,
      Math.min(85, Math.min((viewW - 140) / spanX, (viewH - 130) / spanY))
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setPxPerMeter(Math.round(nextScale));
    setOriginPx({
      x: Math.round(viewW / 2 - midX * nextScale),
      y: Math.round(viewH / 2 + midY * nextScale),
    });
  }, [profile.controlPoints]);

  // Round (Fillet) a Corner Vertex Pi into a smooth tangent circular arc of radius R
  const handleRoundCornerVertex = useCallback(
    (pointId: string, radiusMeters: number) => {
      const pts = profile.controlPoints;
      const idx = pts.findIndex((p) => p.id === pointId);
      if (idx === -1 || pts.length < 3) return;

      const prevIdx = (idx - 1 + pts.length) % pts.length;
      const nextIdx = (idx + 1) % pts.length;
      const A = pts[prevIdx];
      const B = pts[idx];
      const C = pts[nextIdx];

      const ux = A.x - B.x;
      const uy = A.y - B.y;
      const vx = C.x - B.x;
      const vy = C.y - B.y;
      const lenA = Math.hypot(ux, uy);
      const lenC = Math.hypot(vx, vy);
      if (lenA < 0.1 || lenC < 0.1) return;

      const uUnit = { x: ux / lenA, y: uy / lenA };
      const vUnit = { x: vx / lenC, y: vy / lenC };
      const dot = Math.max(-0.995, Math.min(0.995, uUnit.x * vUnit.x + uUnit.y * vUnit.y));
      const interiorAngle = Math.acos(dot); // radians
      if (interiorAngle < 0.15 || interiorAngle > Math.PI - 0.1) return;

      const halfAngle = interiorAngle / 2;
      const rawTangentDist = radiusMeters / Math.tan(halfAngle);
      const maxDist = 0.45 * Math.min(lenA, lenC);
      const d = Math.min(rawTangentDist, maxDist);
      const effectiveRadius = d * Math.tan(halfAngle);

      const T1: ProfileControlPoint = {
        id: `P-${Date.now()}-a`,
        label: 'P',
        x: Number((B.x + uUnit.x * d).toFixed(3)),
        y: Number((B.y + uUnit.y * d).toFixed(3)),
        role: B.role || 'corner',
      };
      const T2: ProfileControlPoint = {
        id: `P-${Date.now()}-b`,
        label: 'P',
        x: Number((B.x + vUnit.x * d).toFixed(3)),
        y: Number((B.y + vUnit.y * d).toFixed(3)),
        role: B.role || 'corner',
      };

      // Cross product determines turn direction so the arc curves outward around the corner
      const cross = uUnit.x * vUnit.y - uUnit.y * vUnit.x;
      const sweepAngle = Math.PI - interiorAngle;
      const bulgeMag = Math.tan(sweepAngle / 4);
      const bulge = Number(((cross >= 0 ? -1 : 1) * bulgeMag).toFixed(4));

      const newPts = [...pts.slice(0, idx), T1, T2, ...pts.slice(idx + 1)];

      updateProfileWithUndo((prev) => {
        const norm = normalizeProfileTopology(newPts, prev.segments, prev.isClosed);
        // Set the segment connecting T1 -> T2 as an arc with the computed bulge
        const updatedSegs = norm.segments.map((s) =>
          s.fromPointId === T1.id && s.toPointId === T2.id
            ? {
                ...s,
                type: 'arc' as const,
                arcBulge: bulge,
                arcRadiusMeters: Number(effectiveRadius.toFixed(3)),
              }
            : s
        );
        return {
          ...prev,
          controlPoints: norm.controlPoints,
          segments: updatedSegs,
        };
      });
      setSelectedPointId(T1.id);
    },
    [profile.controlPoints, updateProfileWithUndo]
  );

  // Add a new point at (x, y) connected by line or arc from the last point
  const handleAddPointAt = useCallback(
    (pt: Point2D, segType: 'line' | 'arc' = 'line', arcRadius?: number) => {
      const newPointId = `P-${Date.now()}`;
      const newPt: ProfileControlPoint = {
        id: newPointId,
        label: `P${profile.controlPoints.length + 1}`,
        x: Number(pt.x.toFixed(3)),
        y: Number(pt.y.toFixed(3)),
        role: pt.y <= 0.15 ? 'left_invert' : 'corner',
      };

      updateProfileWithUndo((prev) => {
        const lastPt = prev.controlPoints[prev.controlPoints.length - 1];
        const nextPts = [...prev.controlPoints, newPt];
        const norm = normalizeProfileTopology(nextPts, prev.segments, prev.isClosed);

        if (lastPt && segType === 'arc') {
          const chord = Math.hypot(newPt.x - lastPt.x, newPt.y - lastPt.y);
          const r = arcRadius && arcRadius > 0 ? arcRadius : Math.max(chord * 0.75, 3.0);
          const b = radiusToBulge(chord, r, 1);
          norm.segments = norm.segments.map((s) =>
            s.fromPointId === lastPt.id && s.toPointId === newPt.id
              ? { ...s, type: 'arc', arcBulge: b, arcRadiusMeters: r }
              : s
          );
        }

        return {
          ...prev,
          controlPoints: norm.controlPoints,
          segments: norm.segments,
        };
      });
      setSelectedPointId(newPointId);
    },
    [profile.controlPoints.length, updateProfileWithUndo]
  );

  // Add Next Segment by Length (m) and Angle (deg) from Selected Point or Last Point
  const handleAddByLengthAndAngle = () => {
    const length = Math.max(0.05, parseFloat(inputLengthM) || 2.0);
    const angleDeg = parseFloat(inputAngleDeg) || 0;
    const rad = (angleDeg * Math.PI) / 180;

    const anchorPt =
      profile.controlPoints.find((p) => p.id === selectedPointId) ||
      profile.controlPoints[profile.controlPoints.length - 1] || { x: 0, y: 0 };

    const nextX = Number((anchorPt.x + length * Math.cos(rad)).toFixed(3));
    const nextY = Number((anchorPt.y + length * Math.sin(rad)).toFixed(3));
    const r = parseFloat(inputArcRadiusM) || length;

    handleAddPointAt({ x: nextX, y: nextY }, inputSegType, r);
  };

  // Update an existing segment's Length or Angle (moves its endpoint `toPointId`)
  const handleUpdateSegmentLengthAngle = (
    segId: string,
    newLengthMeters: number,
    newAngleDeg: number
  ) => {
    const seg = profile.segments.find((s) => s.id === segId);
    if (!seg) return;
    const fromPt = profile.controlPoints.find((p) => p.id === seg.fromPointId);
    if (!fromPt) return;

    const safeLen = Math.max(0.05, newLengthMeters);
    const rad = (newAngleDeg * Math.PI) / 180;
    const nextX = Number((fromPt.x + safeLen * Math.cos(rad)).toFixed(3));
    const nextY = Number((fromPt.y + safeLen * Math.sin(rad)).toFixed(3));

    updateProfileWithUndo((prev) => ({
      ...prev,
      controlPoints: prev.controlPoints.map((pt) =>
        pt.id === seg.toPointId ? { ...pt, x: nextX, y: nextY } : pt
      ),
    }));
  };

  // Mouse handlers on the Graph Canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.shiftKey) {
      setDragging({
        kind: 'pan',
        id: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOriginX: originPx.x,
        startOriginY: originPx.y,
      });
      return;
    }

    const ptMeters = clientToMeters(e.clientX, e.clientY, true);
    if (tool === 'draw_line') {
      handleAddPointAt(ptMeters, 'line');
    } else if (tool === 'draw_arc') {
      handleAddPointAt(ptMeters, 'arc', parseFloat(inputArcRadiusM) || 5.0);
    } else if (tool === 'select') {
      // Start panning when clicking empty graph paper
      setDragging({
        kind: 'pan',
        id: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOriginX: originPx.x,
        startOriginY: originPx.y,
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const ptMeters = clientToMeters(e.clientX, e.clientY, true);
    setCursorMeters(ptMeters);

    if (!dragging) return;

    if (dragging.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - dragging.startClientX) * (viewW / Math.max(1, rect.width));
      const dy = (e.clientY - dragging.startClientY) * (viewH / Math.max(1, rect.height));
      setOriginPx({
        x: Math.round(dragging.startOriginX + dx),
        y: Math.round(dragging.startOriginY + dy),
      });
      return;
    }

    if (dragging.kind === 'point') {
      setProfile((prev) => ({
        ...prev,
        controlPoints: prev.controlPoints.map((p) =>
          p.id === dragging.id && !p.locked ? { ...p, x: ptMeters.x, y: ptMeters.y } : p
        ),
      }));
      return;
    }

    if (dragging.kind === 'arc_handle') {
      const rawPt = clientToMeters(e.clientX, e.clientY, false);
      setProfile((prev) => {
        const seg = prev.segments.find((s) => s.id === dragging.id);
        if (!seg) return prev;
        const a = prev.controlPoints.find((p) => p.id === seg.fromPointId);
        const b = prev.controlPoints.find((p) => p.id === seg.toPointId);
        if (!a || !b) return prev;
        const arcBulge = computeBulgeFromMidpointHandle(a, b, rawPt);
        return {
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === seg.id ? { ...s, type: 'arc', arcBulge } : s
          ),
        };
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setDragging(null);
  };

  // Compute grid lines & scale ticks in real-world meters
  const graphGrid = useMemo(() => {
    const minX = Math.floor(-originPx.x / pxPerMeter) - 1;
    const maxX = Math.ceil((viewW - originPx.x) / pxPerMeter) + 1;
    const minY = Math.floor((originPx.y - viewH) / pxPerMeter) - 1;
    const maxY = Math.ceil(originPx.y / pxPerMeter) + 1;

    const majorStep = pxPerMeter < 26 ? 2 : 1;
    const minorStep = pxPerMeter >= 40 ? 0.25 : 0.5;

    const vMinor: number[] = [];
    const vMajor: number[] = [];
    for (let x = Math.floor(minX / minorStep) * minorStep; x <= maxX; x += minorStep) {
      const rx = Number(x.toFixed(2));
      if (Math.abs(rx % majorStep) < 1e-3) {
        vMajor.push(rx);
      } else {
        vMinor.push(rx);
      }
    }

    const hMinor: number[] = [];
    const hMajor: number[] = [];
    for (let y = Math.floor(minY / minorStep) * minorStep; y <= maxY; y += minorStep) {
      const ry = Number(y.toFixed(2));
      if (Math.abs(ry % majorStep) < 1e-3) {
        hMajor.push(ry);
      } else {
        hMinor.push(ry);
      }
    }

    return { vMinor, vMajor, hMinor, hMajor };
  }, [originPx, pxPerMeter]);

  // Sampled polygon path in SVG pixels
  const profileSvgPath = useMemo(() => {
    if (evaluated.crossSectionPoints.length === 0) return '';
    const cmds = evaluated.crossSectionPoints.map((pt, i) => {
      const p = metersToPx(pt);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    });
    if (profile.isClosed && cmds.length >= 3) cmds.push('Z');
    return cmds.join(' ');
  }, [evaluated.crossSectionPoints, metersToPx, profile.isClosed]);

  // Selected Point & Selected Segment objects
  const selectedPoint = useMemo(
    () => profile.controlPoints.find((p) => p.id === selectedPointId) || null,
    [profile.controlPoints, selectedPointId]
  );

  const selectedSegmentMetrics = useMemo(
    () => evaluated.segmentMetrics.find((m) => m.segmentId === selectedSegmentId) || null,
    [evaluated.segmentMetrics, selectedSegmentId]
  );

  const selectedSegment = useMemo(
    () => profile.segments.find((s) => s.id === selectedSegmentId) || null,
    [profile.segments, selectedSegmentId]
  );

  // Live polar readout from last point to cursor
  const livePolarFromLast = useMemo(() => {
    const lastPt = profile.controlPoints[profile.controlPoints.length - 1];
    if (!lastPt || !cursorMeters) return null;
    const dx = cursorMeters.x - lastPt.x;
    const dy = cursorMeters.y - lastPt.y;
    const len = Math.hypot(dx, dy);
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return { lastPt, len, deg };
  }, [profile.controlPoints, cursorMeters]);

  return (
    <div className="h-dvh w-full flex flex-col bg-[#090D16] text-slate-100 font-mono select-none overflow-hidden">
      {/* ====================================================================
          TOP HEADER BAR: Simple, Clean Controls + Quick Shape Presets + Confirm
         ==================================================================== */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-[#111726] border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div>
            <div className="text-xs sm:text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <span>CUSTOM TUNNEL SHAPE — GRAPH BUILDER</span>
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 text-[10px]">
                X,Y Points · Length &amp; Angle · Line · Arc · Round · Undo
              </span>
            </div>
          </div>
        </div>

        {/* Quick Template / Preset Loader + DXF Upload + Confirm Button */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === 'blank') {
                updateProfileWithUndo({
                  ...profile,
                  name: 'Custom Graph Profile',
                  controlPoints: [{ id: 'P1', label: 'P1', x: -4.5, y: 0, role: 'left_invert' }],
                  segments: [],
                  isClosed: false,
                });
                setTool('draw_line');
                return;
              }
              const found = CUSTOM_PROFILE_PRESETS.find((p) => p.id === val);
              if (found) {
                const nextP = found.createProfile();
                updateProfileWithUndo(nextP);
                setSelectedPointId(nextP.controlPoints[0]?.id || null);
                setSelectedSegmentId(nextP.segments[0]?.id || null);
              }
            }}
            className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-cyan-300 cursor-pointer"
          >
            <option value="">Load Starter Shape...</option>
            <option value="blank">Blank Graph (Start from P1)</option>
            {CUSTOM_PROFILE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <input
            ref={cadInputRef}
            type="file"
            accept=".dxf,.dwg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadCADFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => cadInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
            title="Import DXF/DWG profile onto graph"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            Import DXF
          </button>

          <button
            type="button"
            onClick={() => {
              const built = buildAuthoritativeCustomTunnelGeometry(profile);
              onConfirmGeometry(built, true);
            }}
            disabled={profile.controlPoints.length < 3}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold text-xs shadow-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Confirm Tunnel Shape &amp; Continue
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <ThemeToggleButton compact />
        </div>
      </header>

      {/* ====================================================================
          MAIN BODY: LEFT GRAPH PAPER WITH SCALES (74%) + RIGHT INSPECTOR (26%)
         ==================================================================== */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* LEFT COLUMN: GRAPH PAPER STAGE + TOP DRAWING TOOLBAR */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-[#070B12]">
          {/* Simple, Clean Drawing Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#0E1524] border-b border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTool('select')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  tool === 'select'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" />
                Select / Move
              </button>

              <button
                type="button"
                onClick={() => setTool('draw_line')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  tool === 'draw_line'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                + Line Point
              </button>

              <button
                type="button"
                onClick={() => setTool('draw_arc')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  tool === 'draw_arc'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                + Arc Point
              </button>

              <button
                type="button"
                onClick={() => setTool('round_corner')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  tool === 'round_corner'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Click any corner point on the graph to round/fillet it with Radius R"
              >
                <CornerUpRight className="w-3.5 h-3.5" />
                Round Corner (R={roundRadiusM}m)
              </button>

              <div className="h-4 w-px bg-slate-700 mx-1" />

              {/* Undo / Redo Buttons */}
              <button
                type="button"
                onClick={handleUndo}
                disabled={pastProfiles.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 cursor-pointer"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5 text-cyan-400" />
                Undo ({pastProfiles.length})
              </button>

              <button
                type="button"
                onClick={handleRedo}
                disabled={futureProfiles.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 cursor-pointer"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5 text-cyan-400" />
                Redo
              </button>

              <button
                type="button"
                onClick={() =>
                  updateProfileWithUndo((prev) => {
                    const nextClosed = !prev.isClosed;
                    const norm = normalizeProfileTopology(
                      prev.controlPoints,
                      prev.segments,
                      nextClosed
                    );
                    return {
                      ...prev,
                      isClosed: nextClosed,
                      controlPoints: norm.controlPoints,
                      segments: norm.segments,
                    };
                  })
                }
                className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                  profile.isClosed
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-600/50'
                    : 'bg-amber-950/70 text-amber-300 border-amber-600/50'
                }`}
              >
                {profile.isClosed ? 'Closed Shape' : 'Open Polyline (Click to Close)'}
              </button>

              <button
                type="button"
                onClick={() => {
                  updateProfileWithUndo({
                    ...profile,
                    controlPoints: [{ id: 'P1', label: 'P1', x: -4.0, y: 0, role: 'left_invert' }],
                    segments: [],
                    isClosed: false,
                  });
                  setSelectedPointId('P1');
                  setTool('draw_line');
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-200 border border-rose-700/50 text-[11px] cursor-pointer"
                title="Clear all points and start fresh on the graph"
              >
                <RotateCcw className="w-3 h-3" />
                Clear
              </button>
            </div>

            {/* Grid Snap & Zoom Controls */}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                <span>Grid Snap:</span>
                <select
                  value={gridSnapStep}
                  onChange={(e) => setGridSnapStep(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-cyan-300"
                >
                  <option value={0}>Off (Free)</option>
                  <option value={0.05}>0.05 m</option>
                  <option value={0.1}>0.10 m</option>
                  <option value={0.25}>0.25 m</option>
                  <option value={0.5}>0.50 m</option>
                  <option value={1.0}>1.00 m</option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => setPxPerMeter((s) => Math.min(110, Math.round(s * 1.2)))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPxPerMeter((s) => Math.max(14, Math.round(s / 1.2)))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFitGraph}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px]"
                title="Center & Fit Shape on Graph"
              >
                <Maximize2 className="w-3 h-3" />
                Fit
              </button>
            </div>
          </div>

          {/* Interactive SVG Graph Paper with X and Y Scales */}
          <div className="flex-1 relative min-h-0 overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${viewW} ${viewH}`}
              preserveAspectRatio="xMidYMid meet"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.12 : 0.89;
                setPxPerMeter((s) => Math.max(14, Math.min(110, Math.round(s * factor))));
              }}
              className={`w-full h-full ${
                tool === 'draw_line' || tool === 'draw_arc'
                  ? 'cursor-crosshair'
                  : tool === 'round_corner'
                  ? 'cursor-pointer'
                  : 'cursor-grab active:cursor-grabbing'
              }`}
            >
              {/* 1. Minor Grid Lines */}
              {graphGrid.vMinor.map((mx) => {
                const px = originPx.x + mx * pxPerMeter;
                return (
                  <line
                    key={`vmin-${mx}`}
                    x1={px}
                    y1={0}
                    x2={px}
                    y2={viewH - 28}
                    stroke={isLight ? '#E2E8F0' : '#162033'}
                    strokeWidth="0.8"
                  />
                );
              })}
              {graphGrid.hMinor.map((my) => {
                const py = originPx.y - my * pxPerMeter;
                return (
                  <line
                    key={`hmin-${my}`}
                    x1={44}
                    y1={py}
                    x2={viewW}
                    y2={py}
                    stroke={isLight ? '#E2E8F0' : '#162033'}
                    strokeWidth="0.8"
                  />
                );
              })}

              {/* 2. Major Meter Grid Lines */}
              {graphGrid.vMajor.map((mx) => {
                const px = originPx.x + mx * pxPerMeter;
                const isZero = Math.abs(mx) < 1e-3;
                return (
                  <line
                    key={`vmaj-${mx}`}
                    x1={px}
                    y1={0}
                    x2={px}
                    y2={viewH - 28}
                    stroke={isZero ? '#0284C7' : isLight ? '#CBD5E1' : '#1E2D47'}
                    strokeWidth={isZero ? '1.6' : '1.1'}
                    strokeDasharray={isZero ? '6,3' : undefined}
                  />
                );
              })}
              {graphGrid.hMajor.map((my) => {
                const py = originPx.y - my * pxPerMeter;
                const isZero = Math.abs(my) < 1e-3;
                return (
                  <line
                    key={`hmaj-${my}`}
                    x1={44}
                    y1={py}
                    x2={viewW}
                    y2={py}
                    stroke={isZero ? '#10B981' : isLight ? '#CBD5E1' : '#1E2D47'}
                    strokeWidth={isZero ? '1.6' : '1.1'}
                  />
                );
              })}

              {/* 3. Excavated Tunnel Profile Fill & Vector Boundary */}
              {profileSvgPath && (
                <path
                  d={profileSvgPath}
                  fill={
                    profile.isClosed
                      ? isLight
                        ? 'rgba(2, 132, 199, 0.12)'
                        : 'rgba(14, 165, 233, 0.13)'
                      : 'none'
                  }
                  stroke={isLight ? '#0284C7' : '#38BDF8'}
                  strokeWidth="2.8"
                  strokeLinejoin="round"
                />
              )}

              {/* 4. Live Rubber-Band Line when Drawing */}
              {(tool === 'draw_line' || tool === 'draw_arc') && livePolarFromLast && cursorMeters && (
                <g>
                  {(() => {
                    const aPx = metersToPx(livePolarFromLast.lastPt);
                    const bPx = metersToPx(cursorMeters);
                    return (
                      <>
                        <line
                          x1={aPx.x}
                          y1={aPx.y}
                          x2={bPx.x}
                          y2={bPx.y}
                          stroke={tool === 'draw_arc' ? '#F59E0B' : isLight ? '#0284C7' : '#22D3EE'}
                          strokeWidth="2"
                          strokeDasharray="5,4"
                        />
                        <rect
                          x={(aPx.x + bPx.x) / 2 - 58}
                          y={(aPx.y + bPx.y) / 2 - 22}
                          width="116"
                          height="18"
                          rx="3"
                          fill={isLight ? '#FFFFFF' : '#0F172A'}
                          stroke={isLight ? '#0284C7' : '#38BDF8'}
                          strokeWidth="0.8"
                        />
                        <text
                          x={(aPx.x + bPx.x) / 2}
                          y={(aPx.y + bPx.y) / 2 - 10}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="700"
                          fill={isLight ? '#0369A1' : '#38BDF8'}
                        >
                          L={livePolarFromLast.len.toFixed(2)}m ∠{livePolarFromLast.deg.toFixed(1)}°
                        </text>
                      </>
                    );
                  })()}
                </g>
              )}

              {/* 5. Segment Length, Angle & Arc Midpoint Handles */}
              {evaluated.segmentMetrics.map((segMetric) => {
                const seg = profile.segments.find((s) => s.id === segMetric.segmentId);
                if (!seg) return null;
                const a = profile.controlPoints.find((p) => p.id === seg.fromPointId);
                const b = profile.controlPoints.find((p) => p.id === seg.toPointId);
                if (!a || !b) return null;

                const midPx = metersToPx(segMetric.midHandlePoint);
                const isSelected = seg.id === selectedSegmentId;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

                return (
                  <g key={seg.id}>
                    {/* Clickable Label Pill on Segment */}
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSegmentId(seg.id);
                      }}
                      className="cursor-pointer"
                    >
                      <rect
                        x={midPx.x - 48}
                        y={midPx.y - 10}
                        width="96"
                        height="20"
                        rx="4"
                        fill={
                          isSelected
                            ? '#0284C7'
                            : isLight
                            ? 'rgba(255, 255, 255, 0.94)'
                            : 'rgba(15, 23, 42, 0.90)'
                        }
                        stroke={
                          isSelected
                            ? isLight
                              ? '#0F172A'
                              : '#FFFFFF'
                            : seg.type === 'arc'
                            ? '#F59E0B'
                            : '#475569'
                        }
                        strokeWidth={isSelected ? '1.5' : '1'}
                      />
                      <text
                        x={midPx.x}
                        y={midPx.y + 3.5}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="700"
                        fill={
                          isSelected
                            ? '#FFFFFF'
                            : seg.type === 'arc'
                            ? isLight
                              ? '#B45309'
                              : '#FDE68A'
                            : isLight
                            ? '#0F172A'
                            : '#E2E8F0'
                        }
                      >
                        {seg.type === 'arc'
                          ? `ARC L=${segMetric.arcLength.toFixed(2)}m`
                          : `${segMetric.chordLength.toFixed(2)}m ∠${angleDeg.toFixed(0)}°`}
                      </text>
                    </g>

                    {/* Draggable Arc Handle (or Convert-to-Arc Handle when segment is selected) */}
                    {(seg.type === 'arc' || isSelected) && (
                      <circle
                        cx={midPx.x}
                        cy={midPx.y - (seg.type === 'arc' ? 0 : 16)}
                        r={7}
                        fill="#F59E0B"
                        stroke={isLight ? '#FFFFFF' : '#0F172A'}
                        strokeWidth="2"
                        className="cursor-ns-resize"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedSegmentId(seg.id);
                          setPastProfiles((p) => [...p.slice(-39), profile]);
                          setFutureProfiles([]);
                          setDragging({
                            kind: 'arc_handle',
                            id: seg.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            startOriginX: originPx.x,
                            startOriginY: originPx.y,
                          });
                        }}
                      >
                        <title>Drag to curve this segment into an Arc</title>
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* 6. Control Points P1, P2, ... Pn */}
              {profile.controlPoints.map((pt) => {
                const px = metersToPx(pt);
                const isSelected = pt.id === selectedPointId;
                return (
                  <g
                    key={pt.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (tool === 'round_corner') {
                        handleRoundCornerVertex(pt.id, Math.max(0.2, parseFloat(roundRadiusM) || 1.2));
                        return;
                      }
                      setSelectedPointId(pt.id);
                      setPastProfiles((p) => [...p.slice(-39), profile]);
                      setFutureProfiles([]);
                      setDragging({
                        kind: 'point',
                        id: pt.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        startOriginX: originPx.x,
                        startOriginY: originPx.y,
                      });
                    }}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={px.x}
                      cy={px.y}
                      r={isSelected ? 8 : 6}
                      fill={isSelected ? '#0284C7' : isLight ? '#FFFFFF' : '#0F172A'}
                      stroke={isSelected ? (isLight ? '#0F172A' : '#FFFFFF') : isLight ? '#0284C7' : '#38BDF8'}
                      strokeWidth="2.2"
                    />
                    <text
                      x={px.x + 10}
                      y={px.y - 8}
                      fontSize="10.5"
                      fontWeight="700"
                      fill={isSelected ? (isLight ? '#0369A1' : '#22D3EE') : isLight ? '#0F172A' : '#F8FAFC'}
                    >
                      {pt.label} ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})
                    </text>
                  </g>
                );
              })}

              {/* 7. Bottom X-Axis Scale Bar (Meters from Centerline) */}
              <rect
                x={44}
                y={viewH - 28}
                width={viewW - 44}
                height={28}
                fill={isLight ? '#E2E8F0' : '#0D1320'}
              />
              <line
                x1={44}
                y1={viewH - 28}
                x2={viewW}
                y2={viewH - 28}
                stroke={isLight ? '#94A3B8' : '#334155'}
                strokeWidth="1.2"
              />
              {graphGrid.vMajor.map((mx) => {
                const px = originPx.x + mx * pxPerMeter;
                if (px < 50 || px > viewW - 20) return null;
                return (
                  <g key={`xscale-${mx}`}>
                    <line
                      x1={px}
                      y1={viewH - 28}
                      x2={px}
                      y2={viewH - 21}
                      stroke={isLight ? '#475569' : '#94A3B8'}
                      strokeWidth="1.2"
                    />
                    <text
                      x={px}
                      y={viewH - 8}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight={Math.abs(mx) < 1e-3 ? '700' : '500'}
                      fill={
                        Math.abs(mx) < 1e-3
                          ? isLight
                            ? '#0369A1'
                            : '#38BDF8'
                          : isLight
                          ? '#334155'
                          : '#94A3B8'
                      }
                    >
                      {mx > 0 ? `+${mx}m` : `${mx}m`}
                    </text>
                  </g>
                );
              })}

              {/* 8. Left Y-Axis Scale Bar (Height in Meters) */}
              <rect x={0} y={0} width={44} height={viewH} fill={isLight ? '#E2E8F0' : '#0D1320'} />
              <line
                x1={44}
                y1={0}
                x2={44}
                y2={viewH - 28}
                stroke={isLight ? '#94A3B8' : '#334155'}
                strokeWidth="1.2"
              />
              {graphGrid.hMajor.map((my) => {
                const py = originPx.y - my * pxPerMeter;
                if (py < 16 || py > viewH - 34) return null;
                return (
                  <g key={`yscale-${my}`}>
                    <line
                      x1={37}
                      y1={py}
                      x2={44}
                      y2={py}
                      stroke={isLight ? '#475569' : '#94A3B8'}
                      strokeWidth="1.2"
                    />
                    <text
                      x={33}
                      y={py + 3.5}
                      textAnchor="end"
                      fontSize="10"
                      fontWeight={Math.abs(my) < 1e-3 ? '700' : '500'}
                      fill={
                        Math.abs(my) < 1e-3
                          ? isLight
                            ? '#047857'
                            : '#10B981'
                          : isLight
                          ? '#334155'
                          : '#94A3B8'
                      }
                    >
                      {my}m
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Floating Live Dimensions & Cursor Coordinates Bar */}
            <div className="absolute top-3 left-14 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
              <div className="px-3 py-1.5 rounded bg-slate-950/90 border border-slate-800 text-[11px] flex items-center gap-3 shadow-lg">
                <span>
                  Width: <strong className="text-cyan-300">{evaluated.width.toFixed(2)} m</strong>
                </span>
                <span>·</span>
                <span>
                  Height: <strong className="text-cyan-300">{evaluated.height.toFixed(2)} m</strong>
                </span>
                <span>·</span>
                <span>
                  Area: <strong className="text-emerald-300">{evaluated.designAreaSqMeters.toFixed(2)} m²</strong>
                </span>
                <span>·</span>
                <span>
                  Perimeter:{' '}
                  <strong className="text-amber-300">{evaluated.totalPerimeterMeters.toFixed(2)} m</strong>
                </span>
              </div>

              <div className="px-3 py-1.5 rounded bg-slate-950/90 border border-slate-800 text-[11px] flex items-center gap-2 shadow-lg">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                {cursorMeters ? (
                  <span>
                    X: <strong className="text-white">{cursorMeters.x.toFixed(2)}m</strong>, Y:{' '}
                    <strong className="text-white">{cursorMeters.y.toFixed(2)}m</strong>
                  </span>
                ) : (
                  <span className="text-slate-400">Move cursor on graph</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ====================================================================
            RIGHT PANEL: ADD BY LENGTH & ANGLE / X,Y + ROUND / ARC + POINTS LIST
           ==================================================================== */}
        <aside className="w-full lg:w-[370px] bg-[#101726] border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-xs shrink-0">
          {/* 1. ADD SEGMENT BY LENGTH & ANGLE OR X,Y POINT */}
          <div className="p-3 bg-slate-950/90 border border-slate-800 rounded space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300 text-[11px]">
                1. ADD LINE / ARC / POINT
              </span>
              <div className="flex rounded overflow-hidden border border-slate-700 text-[10px]">
                <button
                  type="button"
                  onClick={() => setAddMode('length_angle')}
                  className={`px-2 py-0.5 font-semibold cursor-pointer ${
                    addMode === 'length_angle'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  Length &amp; Angle
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('xy')}
                  className={`px-2 py-0.5 font-semibold cursor-pointer ${
                    addMode === 'xy' ? 'bg-cyan-600 text-white' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  X, Y Point
                </button>
              </div>
            </div>

            {addMode === 'length_angle' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">Length (m)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={inputLengthM}
                      onChange={(e) => setInputLengthM(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white font-bold"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">Angle (°) [0–360°]</span>
                    <input
                      type="number"
                      step="5"
                      value={inputAngleDeg}
                      onChange={(e) => setInputAngleDeg(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white font-bold"
                    />
                  </label>
                </div>

                {/* Quick Angle Preset Buttons */}
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  {[
                    { deg: '0', label: '0° → Right' },
                    { deg: '90', label: '90° ↑ Up' },
                    { deg: '180', label: '180° ← Left' },
                    { deg: '270', label: '270° ↓ Down' },
                  ].map((b) => (
                    <button
                      key={b.deg}
                      type="button"
                      onClick={() => setInputAngleDeg(b.deg)}
                      className={`py-1 rounded border cursor-pointer ${
                        inputAngleDeg === b.deg
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-500/60 font-bold'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {/* Segment Type: Line vs Arc */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInputSegType('line')}
                    className={`flex-1 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                      inputSegType === 'line'
                        ? 'bg-cyan-600 text-white border-cyan-400'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    Straight Line
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputSegType('arc')}
                    className={`flex-1 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                      inputSegType === 'arc'
                        ? 'bg-amber-600 text-white border-amber-400'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    Curved Arc
                  </button>
                  {inputSegType === 'arc' && (
                    <input
                      type="number"
                      step="0.2"
                      min="0.5"
                      value={inputArcRadiusM}
                      onChange={(e) => setInputArcRadiusM(e.target.value)}
                      placeholder="Radius"
                      title="Arc Radius (m)"
                      className="w-20 px-2 py-1 bg-slate-900 border border-amber-500/60 rounded text-amber-200"
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleAddByLengthAndAngle}
                  className="w-full py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add {inputSegType === 'arc' ? 'Arc' : 'Line'} ({inputLengthM}m @ {inputAngleDeg}°)
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">X Coordinate (m)</span>
                    <input
                      type="number"
                      step="0.25"
                      value={inputX}
                      onChange={(e) => setInputX(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white font-bold"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">Y Coordinate (m)</span>
                    <input
                      type="number"
                      step="0.25"
                      value={inputY}
                      onChange={(e) => setInputY(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white font-bold"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleAddPointAt(
                      { x: parseFloat(inputX) || 0, y: parseFloat(inputY) || 0 },
                      inputSegType,
                      parseFloat(inputArcRadiusM) || 5
                    )
                  }
                  className="w-full py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Point ({inputX}m, {inputY}m)
                </button>
              </div>
            )}
          </div>

          {/* 2. SELECTED POINT (X, Y & CORNER ROUND) & SELECTED SEGMENT (LINE / ARC / LENGTH / ANGLE) */}
          <div className="p-3 bg-slate-950/90 border border-slate-800 rounded space-y-2.5">
            <span className="font-bold text-cyan-300 text-[11px] block">
              2. EDIT SELECTED POINT / LINE / ARC / ROUND
            </span>

            {selectedPoint && (
              <div className="p-2 bg-slate-900/90 border border-slate-800 rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Point {selectedPoint.label}</span>
                  {profile.controlPoints.length > 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        updateProfileWithUndo((prev) => {
                          const filtered = prev.controlPoints.filter(
                            (p) => p.id !== selectedPoint.id
                          );
                          const norm = normalizeProfileTopology(
                            filtered,
                            prev.segments,
                            prev.isClosed
                          );
                          return {
                            ...prev,
                            controlPoints: norm.controlPoints,
                            segments: norm.segments,
                          };
                        });
                        setSelectedPointId(profile.controlPoints[0]?.id || null);
                      }}
                      className="text-rose-400 hover:text-rose-300 flex items-center gap-1 text-[10px] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete Point
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">X (m)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPoint.x}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isNaN(val)) return;
                        updateProfileWithUndo((prev) => ({
                          ...prev,
                          controlPoints: prev.controlPoints.map((p) =>
                            p.id === selectedPoint.id ? { ...p, x: val } : p
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-cyan-300 font-bold"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">Y (m)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPoint.y}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isNaN(val)) return;
                        updateProfileWithUndo((prev) => ({
                          ...prev,
                          controlPoints: prev.controlPoints.map((p) =>
                            p.id === selectedPoint.id ? { ...p, y: val } : p
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-cyan-300 font-bold"
                    />
                  </label>
                </div>

                {/* Round / Fillet This Corner */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                  <span className="text-[10px] text-indigo-300 font-semibold">
                    Round Radius (m):
                  </span>
                  <input
                    type="number"
                    step="0.2"
                    min="0.2"
                    max="15"
                    value={roundRadiusM}
                    onChange={(e) => setRoundRadiusM(e.target.value)}
                    className="w-16 px-1.5 py-0.5 bg-slate-950 border border-indigo-500/50 rounded text-white text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleRoundCornerVertex(
                        selectedPoint.id,
                        Math.max(0.2, parseFloat(roundRadiusM) || 1.2)
                      )
                    }
                    className="flex-1 py-1 px-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <CornerUpRight className="w-3 h-3" />
                    Round Corner {selectedPoint.label}
                  </button>
                </div>
              </div>
            )}

            {/* Selected Segment Inspector */}
            {selectedSegment && selectedSegmentMetrics && (
              <div className="p-2 bg-slate-900/90 border border-slate-800 rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-300">
                    Segment {selectedSegment.id} ({selectedSegment.type.toUpperCase()})
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateProfileWithUndo((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSegment.id
                              ? { ...s, type: 'line', arcBulge: undefined }
                              : s
                          ),
                        }))
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        selectedSegment.type === 'line'
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Line
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateProfileWithUndo((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSegment.id
                              ? { ...s, type: 'arc', arcBulge: s.arcBulge || 0.38 }
                              : s
                          ),
                        }))
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        selectedSegment.type === 'arc'
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Arc
                    </button>
                  </div>
                </div>

                {(() => {
                  const a = profile.controlPoints.find(
                    (p) => p.id === selectedSegment.fromPointId
                  );
                  const b = profile.controlPoints.find((p) => p.id === selectedSegment.toPointId);
                  const curAngle =
                    a && b
                      ? Number(
                          (((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360).toFixed(
                            1
                          )
                        )
                      : 0;
                  const curLen = Number(selectedSegmentMetrics.chordLength.toFixed(2));

                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="text-slate-400 text-[10px]">Segment Length (m)</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={curLen}
                          onChange={(e) =>
                            handleUpdateSegmentLengthAngle(
                              selectedSegment.id,
                              parseFloat(e.target.value) || curLen,
                              curAngle
                            )
                          }
                          className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white font-bold"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-slate-400 text-[10px]">Angle (°)</span>
                        <input
                          type="number"
                          step="5"
                          value={curAngle}
                          onChange={(e) =>
                            handleUpdateSegmentLengthAngle(
                              selectedSegment.id,
                              curLen,
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white font-bold"
                        />
                      </label>
                    </div>
                  );
                })()}

                {selectedSegment.type === 'arc' && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-800">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-amber-300">
                        Arc Curve Bulge ({selectedSegment.arcBulge?.toFixed(2) || '0.35'})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateProfileWithUndo((prev) => ({
                            ...prev,
                            segments: prev.segments.map((s) =>
                              s.id === selectedSegment.id
                                ? { ...s, arcBulge: -(s.arcBulge || 0.35) }
                                : s
                            ),
                          }))
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-200 cursor-pointer"
                      >
                        Flip Curve Direction ⌒/⌣
                      </button>
                    </div>
                    <input
                      type="range"
                      min="-1.2"
                      max="1.2"
                      step="0.02"
                      value={selectedSegment.arcBulge ?? 0.35}
                      onChange={(e) => {
                        const b = parseFloat(e.target.value);
                        updateProfileWithUndo((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSegment.id ? { ...s, arcBulge: b } : s
                          ),
                        }));
                      }}
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. POINTS & SEGMENTS TABLE (X, Y, LINE/ARC, LENGTH) */}
          <div className="p-3 bg-slate-950/90 border border-slate-800 rounded space-y-2 flex-1 min-h-[180px] flex flex-col">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300 text-[11px]">
                3. X, Y POINTS &amp; LINES / ARCS ({profile.controlPoints.length} Pts)
              </span>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-slate-400">Scale W×H:</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextP = applyParametricOverallDimensions(profile, {
                      width: evaluated.width,
                      height: evaluated.height,
                    });
                    updateProfileWithUndo(nextP);
                  }}
                  className="text-cyan-400 hover:underline"
                >
                  {evaluated.width.toFixed(1)}×{evaluated.height.toFixed(1)}m
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 border border-slate-800 rounded">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0">
                    <th className="py-1 px-1.5">PT</th>
                    <th className="py-1 px-1.5">X (m)</th>
                    <th className="py-1 px-1.5">Y (m)</th>
                    <th className="py-1 px-1.5">NEXT SEG</th>
                    <th className="py-1 px-1.5">LEN</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.controlPoints.map((pt, idx) => {
                    const seg = profile.segments[idx];
                    const metric = seg
                      ? evaluated.segmentMetrics.find((m) => m.segmentId === seg.id)
                      : null;
                    const isSel = pt.id === selectedPointId;

                    return (
                      <tr
                        key={pt.id}
                        onClick={() => {
                          setSelectedPointId(pt.id);
                          if (seg) setSelectedSegmentId(seg.id);
                        }}
                        className={`border-b border-slate-800/60 cursor-pointer ${
                          isSel ? 'bg-cyan-950/50' : 'hover:bg-slate-900/60'
                        }`}
                      >
                        <td className="py-1 px-1.5 font-bold text-cyan-300">{pt.label}</td>
                        <td className="py-1 px-1">
                          <input
                            type="number"
                            step="0.1"
                            value={pt.x}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isNaN(v)) return;
                              updateProfileWithUndo((prev) => ({
                                ...prev,
                                controlPoints: prev.controlPoints.map((item) =>
                                  item.id === pt.id ? { ...item, x: v } : item
                                ),
                              }));
                            }}
                            className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-white"
                          />
                        </td>
                        <td className="py-1 px-1">
                          <input
                            type="number"
                            step="0.1"
                            value={pt.y}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isNaN(v)) return;
                              updateProfileWithUndo((prev) => ({
                                ...prev,
                                controlPoints: prev.controlPoints.map((item) =>
                                  item.id === pt.id ? { ...item, y: v } : item
                                ),
                              }));
                            }}
                            className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-white"
                          />
                        </td>
                        <td className="py-1 px-1.5">
                          {seg ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateProfileWithUndo((prev) => ({
                                  ...prev,
                                  segments: prev.segments.map((s) =>
                                    s.id === seg.id
                                      ? {
                                          ...s,
                                          type: s.type === 'arc' ? 'line' : 'arc',
                                          arcBulge: s.type === 'arc' ? undefined : 0.35,
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                                seg.type === 'arc'
                                  ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                              title="Click to toggle Line ↔ Arc"
                            >
                              {seg.type.toUpperCase()}
                            </button>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-1 px-1.5 text-slate-300">
                          {metric ? `${metric.arcLength.toFixed(2)}m` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
