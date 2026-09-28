import React from 'react';
import {
  PhotoSurface,
  Point2D,
  SurfaceTransform,
  SurfaceType,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  createDefaultSurfaceTransform,
  solveProjectiveHomography3x3,
} from '../engine/geometryEngine';
import {
  addIntermediateMeshControlPoints,
  createDefaultMeshControlPoints,
  createTunnelBoundaryCustomMask,
  subdivideCustomMaskPolygon,
} from '../engine/photoWarpEngine';
import {
  Check,
  FlipHorizontal,
  FlipVertical,
  Grid,
  Maximize2,
  Plus,
  Redo2,
  RotateCcw,
  Sliders,
  Undo2,
  X,
} from 'lucide-react';

export type PhotoEditorSubTab = 'basic' | 'perspective' | 'mesh_warp' | 'custom_mask';

interface PhotoFittingPanelProps {
  activeSurface: SurfaceType;
  currentPhoto: PhotoSurface;
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  subTab: PhotoEditorSubTab;
  onChangeSubTab: (tab: PhotoEditorSubTab) => void;
  showMeshGrid: boolean;
  onToggleMeshGrid: (show: boolean) => void;
  addingControlPointMode: boolean;
  onToggleAddingControlPointMode: (active: boolean) => void;
  drawingCustomMaskMode: boolean;
  onToggleDrawingCustomMaskMode: (active: boolean) => void;
  onUpdateTransform: (updater: (prev: SurfaceTransform) => SurfaceTransform) => void;
  onUpdateOpacity: (opacity: number) => void;
  onUpdateCalibration: (focalMm: number, k1: number) => void;
  onFitToTunnel: () => void;
  onUndoTransform: () => void;
  onRedoTransform: () => void;
  canUndoTransform: boolean;
  canRedoTransform: boolean;
  onApply: () => void;
  onCancel: () => void;
}

export const PhotoFittingPanel: React.FC<PhotoFittingPanelProps> = ({
  activeSurface,
  currentPhoto,
  geometry,
  settings,
  subTab,
  onChangeSubTab,
  showMeshGrid,
  onToggleMeshGrid,
  addingControlPointMode,
  onToggleAddingControlPointMode,
  drawingCustomMaskMode,
  onToggleDrawingCustomMaskMode,
  onUpdateTransform,
  onUpdateOpacity,
  onUpdateCalibration,
  onFitToTunnel,
  onUndoTransform,
  onRedoTransform,
  canUndoTransform,
  canRedoTransform,
  onApply,
  onCancel,
}) => {
  const t = currentPhoto.transform;
  const edgeOffsets = t.edgeOffsets || [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const meshPts = t.meshControlPoints || createDefaultMeshControlPoints(3, 3);
  const customMaskPts = t.customMaskPoints || [];

  return (
    <div className="absolute top-3 left-3 w-96 max-h-[calc(100%-24px)] flex flex-col bg-slate-900/95 border border-cyan-500/50 rounded shadow-2xl text-xs z-30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#131A28] border-b border-slate-800 shrink-0">
        <span className="font-mono font-bold text-cyan-300 flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5" />
          PHOTO FITTING &amp; DEFORMATION ({activeSurface.toUpperCase()})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onUndoTransform}
            disabled={!canUndoTransform}
            title="Undo Photo Edit"
            className="p-1 text-slate-300 hover:text-white disabled:opacity-35 rounded hover:bg-slate-800"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedoTransform}
            disabled={!canRedoTransform}
            title="Redo Photo Edit"
            className="p-1 text-slate-300 hover:text-white disabled:opacity-35 rounded hover:bg-slate-800"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4 Mode Sub-Tabs: Basic | Perspective | Mesh Warp | Custom Shape */}
      <div className="grid grid-cols-4 gap-0.5 p-1 bg-slate-950 border-b border-slate-800 font-mono text-[10px] shrink-0">
        {(
          [
            { id: 'basic', label: '1. BASIC' },
            { id: 'perspective', label: '2. PERSPECTIVE' },
            { id: 'mesh_warp', label: '3. MESH WARP' },
            { id: 'custom_mask', label: '4. SHAPE P1..P13' },
          ] as { id: PhotoEditorSubTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onChangeSubTab(tab.id);
              onToggleAddingControlPointMode(false);
              onToggleDrawingCustomMaskMode(false);
            }}
            className={`py-1.5 px-1 rounded font-semibold transition-colors text-center ${
              subTab === tab.id
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Scrollable Editor Controls */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-[11px]">
        {/* Always-accessible Photo Opacity (0-100%) (Section 5) */}
        <div className="p-2 bg-slate-950/90 border border-slate-800 rounded space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-semibold">
              PHOTO OPACITY: {currentPhoto.opacity}%
            </span>
            <div className="flex items-center gap-1">
              {[100, 75, 50, 25, 0].map((val) => (
                <button
                  key={val}
                  onClick={() => onUpdateOpacity(val)}
                  className={`px-1 py-0.2 text-[9px] rounded ${
                    currentPhoto.opacity === val
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={currentPhoto.opacity}
            onChange={(e) => onUpdateOpacity(Number(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        {/* ================================================================
            SUB-TAB 1: BASIC (Move, Pan, Zoom, Rotate, Scale X/Y, Flip, Crop)
           ================================================================ */}
        {subTab === 'basic' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <span className="text-slate-400">Move / Pan X: {t.offsetX.toFixed(2)}m</span>
                <input
                  type="range"
                  min="-4"
                  max="4"
                  step="0.05"
                  value={t.offsetX}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      offsetX: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-slate-400">Move / Pan Y: {t.offsetY.toFixed(2)}m</span>
                <input
                  type="range"
                  min="-4"
                  max="4"
                  step="0.05"
                  value={t.offsetY}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      offsetY: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Scale X (Stretch/Shrink): {t.scaleX.toFixed(2)}×
                </span>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.02"
                  value={t.scaleX}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      scaleX: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Scale Y (Stretch/Shrink): {t.scaleY.toFixed(2)}×
                </span>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.02"
                  value={t.scaleY}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      scaleY: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Uniform Zoom: {(t.zoom ?? 1).toFixed(2)}×
                </span>
                <input
                  type="range"
                  min="0.4"
                  max="2.4"
                  step="0.02"
                  value={t.zoom ?? 1}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      zoom: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">Rotate: {t.rotation.toFixed(1)}°</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="0.5"
                  value={t.rotation}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      rotation: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>
            </div>

            {/* Flip Horizontal / Flip Vertical & Quick Rotate */}
            <div className="flex items-center justify-between gap-1.5 pt-1">
              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({ ...prev, flipH: !prev.flipH }))
                }
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded border ${
                  t.flipH
                    ? 'bg-cyan-600 text-white border-cyan-400'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                Flip Horiz
              </button>
              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({ ...prev, flipV: !prev.flipV }))
                }
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded border ${
                  t.flipV
                    ? 'bg-cyan-600 text-white border-cyan-400'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <FlipVertical className="w-3.5 h-3.5" />
                Flip Vert
              </button>
              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({ ...prev, rotation: 0 }))
                }
                className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded"
              >
                0°
              </button>
            </div>

            {/* Rectangular Image Crop Margins */}
            <div className="p-2 bg-slate-950/80 border border-slate-800 rounded space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-cyan-400 font-semibold">
                <span>IMAGE CROP MARGINS (TOP / BOTTOM / LEFT / RIGHT)</span>
                <button
                  onClick={() =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      cropTop: 0,
                      cropBottom: 0,
                      cropLeft: 0,
                      cropRight: 0,
                    }))
                  }
                  className="text-slate-400 hover:text-white"
                >
                  Reset Crop
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <label>
                  <span className="text-slate-400">
                    Crop Top: {Math.round((t.cropTop || 0) * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.4"
                    step="0.01"
                    value={t.cropTop || 0}
                    onChange={(e) =>
                      onUpdateTransform((prev) => ({
                        ...prev,
                        cropTop: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-cyan-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Crop Bottom: {Math.round((t.cropBottom || 0) * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.4"
                    step="0.01"
                    value={t.cropBottom || 0}
                    onChange={(e) =>
                      onUpdateTransform((prev) => ({
                        ...prev,
                        cropBottom: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-cyan-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Crop Left: {Math.round((t.cropLeft || 0) * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.4"
                    step="0.01"
                    value={t.cropLeft || 0}
                    onChange={(e) =>
                      onUpdateTransform((prev) => ({
                        ...prev,
                        cropLeft: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-cyan-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Crop Right: {Math.round((t.cropRight || 0) * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.4"
                    step="0.01"
                    value={t.cropRight || 0}
                    onChange={(e) =>
                      onUpdateTransform((prev) => ({
                        ...prev,
                        cropRight: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-cyan-500"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================
            SUB-TAB 2: PERSPECTIVE (4 Corners, 4 Edges, Skew, Shear, Keystone)
           ================================================================ */}
        {subTab === 'perspective' && (
          <div className="space-y-2.5">
            <div className="p-2 bg-cyan-950/30 border border-cyan-800/50 rounded text-[10px] text-cyan-200">
              Drag the <strong>4 Cyan Corner Handles (TL, TR, BR, BL)</strong> or{' '}
              <strong>4 Amber Edge Handles (TOP, RIGHT, BOTTOM, LEFT)</strong> directly on the
              canvas, or use the perspective/skew controls below.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Horiz. Perspective: {((t.perspH || 0) * 100).toFixed(0)}%
                </span>
                <input
                  type="range"
                  min="-0.35"
                  max="0.35"
                  step="0.01"
                  value={t.perspH || 0}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      perspH: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Vert. Perspective: {((t.perspV || 0) * 100).toFixed(0)}%
                </span>
                <input
                  type="range"
                  min="-0.35"
                  max="0.35"
                  step="0.01"
                  value={t.perspV || 0}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      perspV: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Skew / Shear X: {(t.skewX || 0).toFixed(1)}°
                </span>
                <input
                  type="range"
                  min="-35"
                  max="35"
                  step="0.5"
                  value={t.skewX || 0}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      skewX: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>

              <label className="space-y-0.5">
                <span className="text-slate-400">
                  Skew / Shear Y: {(t.skewY || 0).toFixed(1)}°
                </span>
                <input
                  type="range"
                  min="-35"
                  max="35"
                  step="0.5"
                  value={t.skewY || 0}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      skewY: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </label>
            </div>

            {/* 4 Edge Midpoint Push/Pull Sliders */}
            <div className="p-2 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-amber-300 font-semibold">
                <span>EDGE MOVEMENT / BOWING (TOP, RIGHT, BOTTOM, LEFT)</span>
                <button
                  onClick={() =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      edgeOffsets: [
                        { x: 0, y: 0 },
                        { x: 0, y: 0 },
                        { x: 0, y: 0 },
                        { x: 0, y: 0 },
                      ],
                    }))
                  }
                  className="text-slate-400 hover:text-white"
                >
                  Zero Edges
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <label>
                  <span className="text-slate-400">
                    Top Edge Arch: {Math.round(edgeOffsets[0].y * 100)}%
                  </span>
                  <input
                    type="range"
                    min="-0.3"
                    max="0.3"
                    step="0.01"
                    value={edgeOffsets[0].y}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateTransform((prev) => {
                        const nextEdges = [
                          ...(prev.edgeOffsets || [
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                          ]),
                        ] as [Point2D, Point2D, Point2D, Point2D];
                        nextEdges[0] = { ...nextEdges[0], y: val };
                        return { ...prev, edgeOffsets: nextEdges };
                      });
                    }}
                    className="w-full accent-amber-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Bottom Edge: {Math.round(edgeOffsets[2].y * 100)}%
                  </span>
                  <input
                    type="range"
                    min="-0.3"
                    max="0.3"
                    step="0.01"
                    value={edgeOffsets[2].y}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateTransform((prev) => {
                        const nextEdges = [
                          ...(prev.edgeOffsets || [
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                          ]),
                        ] as [Point2D, Point2D, Point2D, Point2D];
                        nextEdges[2] = { ...nextEdges[2], y: val };
                        return { ...prev, edgeOffsets: nextEdges };
                      });
                    }}
                    className="w-full accent-amber-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Left Wall Edge: {Math.round(edgeOffsets[3].x * 100)}%
                  </span>
                  <input
                    type="range"
                    min="-0.3"
                    max="0.3"
                    step="0.01"
                    value={edgeOffsets[3].x}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateTransform((prev) => {
                        const nextEdges = [
                          ...(prev.edgeOffsets || [
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                          ]),
                        ] as [Point2D, Point2D, Point2D, Point2D];
                        nextEdges[3] = { ...nextEdges[3], x: val };
                        return { ...prev, edgeOffsets: nextEdges };
                      });
                    }}
                    className="w-full accent-amber-500"
                  />
                </label>
                <label>
                  <span className="text-slate-400">
                    Right Wall Edge: {Math.round(edgeOffsets[1].x * 100)}%
                  </span>
                  <input
                    type="range"
                    min="-0.3"
                    max="0.3"
                    step="0.01"
                    value={edgeOffsets[1].x}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateTransform((prev) => {
                        const nextEdges = [
                          ...(prev.edgeOffsets || [
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                            { x: 0, y: 0 },
                          ]),
                        ] as [Point2D, Point2D, Point2D, Point2D];
                        nextEdges[1] = { ...nextEdges[1], x: val };
                        return { ...prev, edgeOffsets: nextEdges };
                      });
                    }}
                    className="w-full accent-amber-500"
                  />
                </label>
              </div>
            </div>

            {/* Camera Calibration & Lens k1 */}
            {currentPhoto.calibration && (
              <div className="p-2 bg-slate-950/90 border border-slate-800 rounded space-y-1 text-[10px]">
                <div className="flex justify-between text-slate-400">
                  <span>CAMERA LENS CALIBRATION:</span>
                  <span className="text-cyan-300 font-semibold">
                    {currentPhoto.calibration.focalLengthMm}mm eq · k1=
                    {currentPhoto.calibration.radialDistortionK1.toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="range"
                    min="14"
                    max="70"
                    step="1"
                    value={currentPhoto.calibration.focalLengthMm}
                    onChange={(e) =>
                      onUpdateCalibration(
                        parseFloat(e.target.value),
                        currentPhoto.calibration!.radialDistortionK1
                      )
                    }
                    className="w-full accent-cyan-500"
                  />
                  <input
                    type="range"
                    min="-0.25"
                    max="0.15"
                    step="0.005"
                    value={currentPhoto.calibration.radialDistortionK1}
                    onChange={(e) =>
                      onUpdateCalibration(
                        currentPhoto.calibration!.focalLengthMm,
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            SUB-TAB 3: MESH WARP / PIECEWISE TRANSFORMATION (Section 3)
           ================================================================ */}
        {subTab === 'mesh_warp' && (
          <div className="space-y-2.5">
            <div className="p-2 bg-emerald-950/30 border border-emerald-700/50 rounded text-[10px] text-emerald-200 leading-relaxed">
              <strong>Piecewise Mesh Deformation ({meshPts.length} Control Points):</strong> Drag
              any green control point <strong>C1..C{meshPts.length}</strong> on the canvas to
              locally stretch, shrink, or warp the photograph to match curved{' '}
              <strong>CROWN, LEFT WALL, RIGHT WALL, or FACE</strong> geometry.
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => onToggleAddingControlPointMode(!addingControlPointMode)}
                className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded border font-semibold ${
                  addingControlPointMode
                    ? 'bg-emerald-600 text-white border-emerald-400'
                    : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-700'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                {addingControlPointMode ? 'Click Photo to Place C_n' : '+ Add Control Point'}
              </button>

              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({
                    ...prev,
                    meshControlPoints: addIntermediateMeshControlPoints(
                      prev.meshControlPoints || createDefaultMeshControlPoints(3, 3)
                    ),
                  }))
                }
                className="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded"
              >
                <Grid className="w-3.5 h-3.5" />
                + Intermediate Points
              </button>

              <button
                onClick={() => {
                  // Apply curved arch / wall foreshortening preset
                  onUpdateTransform((prev) => {
                    const base = prev.meshControlPoints || createDefaultMeshControlPoints(3, 3);
                    const warped = base.map((cp) => {
                      if (activeSurface === 'crown') {
                        // Expand lateral springline edges for cylindrical crown unwrapping
                        const du = (cp.srcU - 0.5) * 0.08;
                        return { ...cp, dstU: Number((cp.srcU + du).toFixed(4)) };
                      }
                      // For face/walls: conform top corners slightly toward arch
                      const archShift =
                        cp.srcV < 0.35 ? (0.5 - cp.srcU) * 0.09 : 0;
                      return {
                        ...cp,
                        dstU: Number((cp.srcU + archShift).toFixed(4)),
                      };
                    });
                    return { ...prev, meshControlPoints: warped };
                  });
                }}
                className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded"
              >
                Warp to Arch Curve
              </button>

              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({
                    ...prev,
                    meshControlPoints: createDefaultMeshControlPoints(3, 3),
                  }))
                }
                className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded"
              >
                Reset Mesh (3×3)
              </button>
            </div>

            <label className="flex items-center justify-between p-2 bg-slate-950 border border-slate-800 rounded cursor-pointer">
              <span className="text-slate-300">Show Piecewise Warp Grid on Canvas</span>
              <input
                type="checkbox"
                checked={showMeshGrid}
                onChange={(e) => onToggleMeshGrid(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-cyan-500"
              />
            </label>
          </div>
        )}

        {/* ================================================================
            SUB-TAB 4: CUSTOM POLYGON SHAPE MASK (P1, P2, P3, P4, P5, P6, P7...)
           ================================================================ */}
        {subTab === 'custom_mask' && (
          <div className="space-y-2.5">
            <div className="p-2 bg-amber-950/30 border border-amber-700/50 rounded text-[10px] text-amber-200 leading-relaxed">
              <strong>Custom Tunnel Shape Boundary (P1..P{customMaskPts.length || 'n'}):</strong>{' '}
              Create an irregular boundary matching the real tunnel geometry instead of a simple
              rectangle. Drag any vertex <strong>P1, P2, P3...</strong> on the canvas.
            </div>

            <div className="flex items-center justify-between p-2 bg-slate-950 border border-slate-800 rounded">
              <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={t.cropToGeometry}
                  onChange={(e) =>
                    onUpdateTransform((prev) => ({
                      ...prev,
                      cropToGeometry: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                />
                <span>Clip Photo to Boundary Mask</span>
              </label>

              <label className="flex items-center gap-1.5 text-amber-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(t.useCustomMask)}
                  onChange={(e) => {
                    const useCustom = e.target.checked;
                    onUpdateTransform((prev) => ({
                      ...prev,
                      useCustomMask: useCustom,
                      customMaskPoints:
                        prev.customMaskPoints && prev.customMaskPoints.length >= 3
                          ? prev.customMaskPoints
                          : createTunnelBoundaryCustomMask(activeSurface, geometry, settings),
                    }));
                  }}
                  className="rounded border-slate-700 bg-slate-800 text-amber-500"
                />
                <span>Use Custom P1..Pn</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => {
                  const pts = createTunnelBoundaryCustomMask(activeSurface, geometry, settings);
                  onUpdateTransform((prev) => ({
                    ...prev,
                    useCustomMask: true,
                    cropToGeometry: true,
                    customMaskPoints: pts,
                  }));
                }}
                className="py-1.5 px-2 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-700/60 rounded font-semibold"
              >
                Fit P1..Pn to Tunnel
              </button>

              <button
                onClick={() => {
                  onToggleDrawingCustomMaskMode(!drawingCustomMaskMode);
                  if (!t.useCustomMask) {
                    onUpdateTransform((prev) => ({
                      ...prev,
                      useCustomMask: true,
                      cropToGeometry: true,
                    }));
                  }
                }}
                className={`py-1.5 px-2 rounded border font-semibold ${
                  drawingCustomMaskMode
                    ? 'bg-amber-600 text-white border-amber-400'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                }`}
              >
                {drawingCustomMaskMode ? 'Click Canvas for P_n' : '+ Draw Custom P_n'}
              </button>

              <button
                onClick={() =>
                  onUpdateTransform((prev) => ({
                    ...prev,
                    useCustomMask: true,
                    customMaskPoints: subdivideCustomMaskPolygon(
                      prev.customMaskPoints && prev.customMaskPoints.length >= 3
                        ? prev.customMaskPoints
                        : createTunnelBoundaryCustomMask(activeSurface, geometry, settings)
                    ),
                  }))
                }
                className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded"
              >
                + Add Intermediate P_i
              </button>

              <button
                onClick={() => {
                  onToggleDrawingCustomMaskMode(true);
                  onUpdateTransform((prev) => ({
                    ...prev,
                    useCustomMask: true,
                    customMaskPoints: [],
                  }));
                }}
                className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 rounded"
              >
                Clear &amp; Redraw P1..Pn
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================
          SECTION 4 REQUIRED FOOTER ACTION BAR:
          FIT TO TUNNEL | RESET | UNDO | REDO | APPLY | CANCEL
         ==================================================================== */}
      <div className="p-2.5 bg-[#131A28] border-t border-slate-800 space-y-2 shrink-0 font-mono text-[11px]">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            onClick={onFitToTunnel}
            className="col-span-2 flex items-center justify-center gap-1 py-1.5 px-2 bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-600/60 rounded font-semibold"
            title="Auto-fit photograph to authoritative tunnel boundary"
          >
            <Maximize2 className="w-3 h-3" />
            FIT TO TUNNEL
          </button>

          <button
            onClick={() =>
              onUpdateTransform(() => createDefaultSurfaceTransform())
            }
            className="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded"
          >
            <RotateCcw className="w-3 h-3" />
            RESET
          </button>

          <button
            onClick={() => {
              const resetCorners: [Point2D, Point2D, Point2D, Point2D] = [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
                { x: 0, y: 0 },
                { x: 0, y: 0 },
              ];
              onUpdateTransform((prev) => ({
                ...prev,
                perspectiveCorners: resetCorners,
                homographyMatrix: solveProjectiveHomography3x3(resetCorners),
              }));
            }}
            className="py-1.5 px-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px]"
          >
            1:1 Quad
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="flex items-center justify-center gap-1 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded font-semibold"
          >
            <X className="w-3.5 h-3.5" />
            CANCEL
          </button>

          <button
            onClick={onApply}
            className="flex items-center justify-center gap-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50 rounded font-semibold shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            APPLY FITTING
          </button>
        </div>
      </div>
    </div>
  );
};
