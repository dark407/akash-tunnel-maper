import React, { useMemo, useRef, useState } from 'react';
import {
  ConnectedSurveyProfile,
  MappingWorkspaceMode,
  OverbreakReasonCategory,
  OverbreakUndercutAnalysis,
  PlaneSurfaceConfig,
  SavedDesignGeometryRecord,
  SavedProjectRecord,
  SurfaceType,
  SurveyControlPoint,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  parseSurveyControlPointsFromText,
  sortControlPointsAroundPerimeter,
} from '../engine/overbreakEngine';
import {
  computeSectionToSectionVolumes,
  filterSavedProjects,
} from '../engine/projectMemoryEngine';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Compass,
  Crosshair,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Layers,
  Link2,
  Lock,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Unlink,
  Unlock,
  Upload,
  X,
} from 'lucide-react';

interface OverbreakAnalysisPanelProps {
  activeSurface: SurfaceType;
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  controlPoints: SurveyControlPoint[];
  surveyProfile: ConnectedSurveyProfile;
  analysis: OverbreakUndercutAnalysis;
  selectedControlPointId: string | null;
  onSelectControlPointId: (id: string | null) => void;
  onUpdateControlPoints: ( next: SurveyControlPoint[] ) => void;
  onUpdateSurveyProfile: (updater: (prev: ConnectedSurveyProfile) => ConnectedSurveyProfile) => void;
  onGenerateSampleAsBuiltProfile: () => void;
  onOpenProjectMemoryModal: () => void;
  onClose: () => void;
  onStatusMessage?: (msg: string) => void;
}

export const OverbreakAnalysisPanel: React.FC<OverbreakAnalysisPanelProps> = ({
  activeSurface,
  geometry,
  settings,
  controlPoints,
  surveyProfile,
  analysis,
  selectedControlPointId,
  onSelectControlPointId,
  onUpdateControlPoints,
  onUpdateSurveyProfile,
  onGenerateSampleAsBuiltProfile,
  onOpenProjectMemoryModal,
  onClose,
  onStatusMessage,
}) => {
  const [subTab, setSubTab] = useState<'profile_points' | 'quantities' | 'reasons'>('quantities');
  const [showImportBox, setShowImportBox] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>(
    'CP1, -4.20, 0.00\nCP2, -4.35, 2.20\nCP3, -4.28, 4.25\nCP4, -3.15, 6.18\nCP5, 0.00, 7.62\nCP6, 3.28, 6.24\nCP7, 4.42, 4.20\nCP8, 4.02, 2.10\nCP9, 4.20, 0.00'
  );

  const surfaceCPs = useMemo(
    () => controlPoints.filter((c) => c.surface === activeSurface),
    [controlPoints, activeSurface]
  );

  const connectedIdSet = useMemo(
    () => new Set(surveyProfile.orderedControlPointIds),
    [surveyProfile.orderedControlPointIds]
  );

  // Connect all visible surface control points in perimeter sequence
  const handleAutoConnectPerimeter = () => {
    if (surfaceCPs.length < 2) {
      onStatusMessage?.('Add at least 2 Survey Control Points (or load Sample Profile) first.');
      return;
    }
    const sortedIds = sortControlPointsAroundPerimeter(surfaceCPs, geometry);
    onUpdateSurveyProfile((prev) => ({
      ...prev,
      surface: activeSurface,
      orderedControlPointIds: sortedIds,
      isClosed: true,
      visible: true,
    }));
    onStatusMessage?.(
      `Connected ${sortedIds.length} survey control points (${sortedIds
        .map((id) => surfaceCPs.find((c) => c.id === id)?.label || id)
        .join(' → ')}) around tunnel profile.`
    );
  };

  // Connect in current creation order
  const handleConnectInOrder = () => {
    if (surfaceCPs.length < 2) {
      onStatusMessage?.('Place at least 2 Survey Control Points to connect a profile.');
      return;
    }
    const ids = surfaceCPs.map((c) => c.id);
    onUpdateSurveyProfile((prev) => ({
      ...prev,
      surface: activeSurface,
      orderedControlPointIds: ids,
      visible: true,
    }));
    onStatusMessage?.(
      `Connected ${ids.length} control points in sequence: ${surfaceCPs
        .map((c) => c.label)
        .join(' → ')}.`
    );
  };

  // Disconnect all segments
  const handleDisconnectAll = () => {
    onUpdateSurveyProfile((prev) => ({
      ...prev,
      orderedControlPointIds: [],
    }));
    onStatusMessage?.(
      'Disconnected survey profile segments. Isolated control points remain editable.'
    );
  };

  // Toggle whether a single CP is in the connected profile sequence
  const handleTogglePointInSequence = (cpId: string) => {
    if (surveyProfile.locked) return;
    onUpdateSurveyProfile((prev) => {
      const exists = prev.orderedControlPointIds.includes(cpId);
      const nextIds = exists
        ? prev.orderedControlPointIds.filter((id) => id !== cpId)
        : [...prev.orderedControlPointIds, cpId];
      return {
        ...prev,
        orderedControlPointIds: nextIds,
      };
    });
  };

  // Move a connected CP up or down in the sequence
  const handleMovePointInSequence = (cpId: string, direction: -1 | 1) => {
    if (surveyProfile.locked) return;
    onUpdateSurveyProfile((prev) => {
      const idx = prev.orderedControlPointIds.indexOf(cpId);
      if (idx === -1) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= prev.orderedControlPointIds.length) return prev;
      const copy = [...prev.orderedControlPointIds];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return {
        ...prev,
        orderedControlPointIds: copy,
      };
    });
  };

  // Insert a new control point midway between connected point i and i+1
  const handleInsertMidpointAfter = (cpId: string) => {
    if (surveyProfile.locked) return;
    const seq = surveyProfile.orderedControlPointIds;
    const idx = seq.indexOf(cpId);
    if (idx === -1 || seq.length < 2) return;
    const nextId = seq[(idx + 1) % seq.length];
    const cpA = surfaceCPs.find((c) => c.id === cpId);
    const cpB = surfaceCPs.find((c) => c.id === nextId);
    if (!cpA || !cpB) return;

    const midPt = {
      x: Number(((cpA.point.x + cpB.point.x) / 2).toFixed(2)),
      y: Number(((cpA.point.y + cpB.point.y) / 2).toFixed(2)),
    };
    const newCp: SurveyControlPoint = {
      id: `cp-ins-${Date.now()}`,
      label: `CP${surfaceCPs.length + 1}`,
      surface: activeSurface,
      point: midPt,
      color: '#10B981',
      visible: true,
      locked: false,
    };

    onUpdateControlPoints([...controlPoints, newCp]);
    onUpdateSurveyProfile((prev) => {
      const copy = [...prev.orderedControlPointIds];
      copy.splice(idx + 1, 0, newCp.id);
      return {
        ...prev,
        orderedControlPointIds: copy,
      };
    });
    onSelectControlPointId(newCp.id);
    onStatusMessage?.(`Inserted ${newCp.label} at (${midPt.x.toFixed(2)}m, ${midPt.y.toFixed(2)}m).`);
  };

  // Import survey points from text
  const handleImportSurveyText = () => {
    const parsed = parseSurveyControlPointsFromText(
      importText,
      activeSurface,
      surfaceCPs.length
    );
    if (parsed.length === 0) {
      onStatusMessage?.('No valid X, Y survey coordinates found in text.');
      return;
    }
    const otherSurfaceCPs = controlPoints.filter((c) => c.surface !== activeSurface);
    onUpdateControlPoints([...otherSurfaceCPs, ...parsed]);
    onUpdateSurveyProfile((prev) => ({
      ...prev,
      surface: activeSurface,
      orderedControlPointIds: parsed.map((c) => c.id),
      isClosed: true,
      visible: true,
    }));
    setShowImportBox(false);
    onStatusMessage?.(
      `Imported & connected ${parsed.length} surveyed profile control points.`
    );
  };

  return (
    <aside className="w-96 bg-[#111621] border-l border-slate-800 flex flex-col h-full text-xs font-mono shrink-0 z-20">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#0D121B] border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-rose-400" />
          <div>
            <div className="font-display font-bold text-slate-100 text-xs tracking-wide">
              OVERBREAK &amp; UNDERCUT ANALYSIS
            </div>
            <div className="text-[10px] text-slate-400">
              Design ({geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m) vs Surveyed As-Built
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              onUpdateSurveyProfile((prev) => ({ ...prev, visible: !prev.visible }))
            }
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            title={surveyProfile.visible ? 'Hide Overbreak/Undercut Layer' : 'Show Layer'}
          >
            {surveyProfile.visible ? (
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateSurveyProfile((prev) => ({ ...prev, locked: !prev.locked }))
            }
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            title={surveyProfile.locked ? 'Unlock Survey Profile' : 'Lock Survey Profile'}
          >
            {surveyProfile.locked ? (
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
            title="Close Overbreak Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="p-2.5 bg-slate-900/90 border-b border-slate-800 space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={surveyProfile.locked}
            onClick={onGenerateSampleAsBuiltProfile}
            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded text-[11px]"
            title="Generate 14 Survey Control Points (CP1→CP14) connected around the tunnel profile with realistic Overbreak & Undercut"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Load Sample As-Built
          </button>
          <button
            type="button"
            disabled={surveyProfile.locked || surfaceCPs.length < 2}
            onClick={handleAutoConnectPerimeter}
            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-semibold rounded text-[11px]"
            title="Connect all control points in clockwise sequence around tunnel perimeter"
          >
            <Link2 className="w-3.5 h-3.5" />
            Connect Perimeter ({surfaceCPs.length})
          </button>
        </div>

        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            disabled={surveyProfile.locked || surfaceCPs.length < 2}
            onClick={handleConnectInOrder}
            className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded text-[10px]"
          >
            Connect CP1→CPn
          </button>
          <button
            type="button"
            disabled={surveyProfile.locked || surveyProfile.orderedControlPointIds.length === 0}
            onClick={handleDisconnectAll}
            className="flex items-center gap-1 py-1 px-2 bg-slate-800 hover:bg-rose-950/60 disabled:opacity-40 text-slate-300 hover:text-rose-200 border border-slate-700 rounded text-[10px]"
          >
            <Unlink className="w-3 h-3" />
            Disconnect
          </button>
          <button
            type="button"
            onClick={() => setShowImportBox((p) => !p)}
            className="py-1 px-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-[10px]"
          >
            Import XY
          </button>
        </div>

        {showImportBox && (
          <div className="p-2 bg-slate-950 border border-slate-700 rounded space-y-1.5">
            <div className="text-[10px] text-slate-400">
              Paste Survey Control Points (`Label, X(m), Y(m)`):
            </div>
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-200 font-mono"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setShowImportBox(false)}
                className="px-2 py-1 text-[10px] text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSurveyText}
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[10px] font-semibold"
              >
                Import &amp; Connect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sub-navigation Tabs */}
      <div className="grid grid-cols-3 bg-[#0B0E14] border-b border-slate-800 p-1 gap-1">
        <button
          type="button"
          onClick={() => setSubTab('quantities')}
          className={`py-1.5 rounded text-[10px] font-semibold transition-colors ${
            subTab === 'quantities'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          1. Quantities &amp; Vol
        </button>
        <button
          type="button"
          onClick={() => setSubTab('profile_points')}
          className={`py-1.5 rounded text-[10px] font-semibold transition-colors ${
            subTab === 'profile_points'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          2. Profile ({analysis.connectedPointsCount} CPs)
        </button>
        <button
          type="button"
          onClick={() => setSubTab('reasons')}
          className={`py-1.5 rounded text-[10px] font-semibold transition-colors ${
            subTab === 'reasons'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          3. Reasons ({analysis.overbreakRegions.length + analysis.undercutRegions.length})
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!analysis.hasConnectedProfile && (
          <div className="p-3 bg-amber-950/40 border border-amber-600/50 rounded text-[11px] text-amber-200 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              No Connected Survey Profile Yet
            </div>
            <p className="text-[10px] text-amber-200/90 leading-relaxed">
              Isolated control points alone do not define a complete tunnel profile. Click{' '}
              <strong>&quot;Load Sample As-Built&quot;</strong> or place Control Points on the
              canvas and click <strong>&quot;Connect Perimeter&quot;</strong> (CP1 → CP2 → CP3 →
              ...) to calculate Overbreak and Undercut.
            </p>
          </div>
        )}

        {subTab === 'quantities' && (
          <>
            {/* Reference Design vs Surveyed As-Built Summary */}
            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded space-y-1.5">
              <div className="text-[10px] font-bold text-cyan-400 border-b border-slate-800 pb-1 flex items-center justify-between">
                <span>PROFILE COMPARISON ({settings.faceChainage})</span>
                <span className="text-slate-400">{geometry.source.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2 bg-slate-950 rounded border border-slate-800/90">
                  <div className="text-[10px] text-slate-400">Design Area</div>
                  <div className="text-sm font-bold text-cyan-300">
                    {analysis.designAreaSqMeters.toFixed(2)} m²
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Perim: {analysis.designPerimeterMeters.toFixed(2)} m
                  </div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800/90">
                  <div className="text-[10px] text-slate-400">Surveyed As-Built</div>
                  <div className="text-sm font-bold text-emerald-300">
                    {analysis.hasConnectedProfile
                      ? `${analysis.surveyedAreaSqMeters.toFixed(2)} m²`
                      : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Perim:{' '}
                    {analysis.hasConnectedProfile
                      ? `${analysis.surveyedPerimeterMeters.toFixed(2)} m`
                      : 'Not connected'}
                  </div>
                </div>
              </div>
            </div>

            {/* Pull / Chainage Interval Configuration for Volume Calculation */}
            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={surveyProfile.useValidPullInterval}
                    onChange={(e) =>
                      onUpdateSurveyProfile((prev) => ({
                        ...prev,
                        useValidPullInterval: e.target.checked,
                        pullIntervalMeters:
                          e.target.checked && (!prev.pullIntervalMeters || prev.pullIntervalMeters <= 0)
                            ? settings.roundLength || 3.5
                            : prev.pullIntervalMeters,
                      }))
                    }
                    className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                  />
                  Valid Pull / Chainage Interval (m)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  disabled={!surveyProfile.useValidPullInterval}
                  value={surveyProfile.pullIntervalMeters ?? ''}
                  placeholder="e.g. 3.50"
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      pullIntervalMeters: Number.isNaN(val) ? null : val,
                    }));
                  }}
                  className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-cyan-300 font-bold"
                />
              </div>
              <div
                className={`text-[10px] px-2 py-1 rounded border ${
                  analysis.hasValidVolumeInterval
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-amber-950/50 border-amber-700/60 text-amber-300 font-semibold'
                }`}
              >
                {analysis.volumeStatusMessage}
              </div>
            </div>

            {/* OVERBREAK CARD (Outside Design Boundary) */}
            <div className="p-2.5 bg-rose-950/20 border border-rose-500/40 rounded space-y-1.5">
              <div className="flex items-center justify-between border-b border-rose-900/50 pb-1">
                <span className="font-bold text-rose-300">
                  OVERBREAK (OUTSIDE DESIGN)
                </span>
                <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 rounded text-[10px] border border-rose-700/50">
                  {analysis.overbreakRegions.length} Zone(s)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Area:</span>
                  <strong className="text-rose-300">
                    {analysis.overbreakAreaSqMeters.toFixed(2)} m²
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Overbreak %:</span>
                  <strong className="text-rose-300">
                    {analysis.overbreakPercentage.toFixed(2)}%
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Radial:</span>
                  <strong className="text-slate-100">
                    {analysis.maxRadialOverbreakMeters.toFixed(3)} m
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Min Radial:</span>
                  <strong className="text-slate-100">
                    {analysis.minRadialOverbreakMeters.toFixed(3)} m
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Radial:</span>
                  <strong className="text-slate-100">
                    {analysis.avgRadialOverbreakMeters.toFixed(3)} m
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Perimeter:</span>
                  <strong className="text-slate-100">
                    {analysis.overbreakPerimeterMeters.toFixed(2)} m
                  </strong>
                </div>
              </div>
              <div className="pt-1 border-t border-rose-900/40 flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Overbreak Volume:</span>
                {analysis.overbreakVolumeCubicMeters !== null ? (
                  <strong className="text-rose-300 text-xs">
                    {analysis.overbreakVolumeCubicMeters.toFixed(2)} m³
                  </strong>
                ) : (
                  <span className="text-[10px] text-amber-300">
                    Volume requires valid chainage/pull interval.
                  </span>
                )}
              </div>
            </div>

            {/* UNDERCUT CARD (Inside Design Boundary) */}
            <div className="p-2.5 bg-amber-950/20 border border-amber-500/40 rounded space-y-1.5">
              <div className="flex items-center justify-between border-b border-amber-900/50 pb-1">
                <span className="font-bold text-amber-300">
                  UNDERCUT (INSIDE DESIGN)
                </span>
                <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 rounded text-[10px] border border-amber-700/50">
                  {analysis.undercutRegions.length} Zone(s)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Area:</span>
                  <strong className="text-amber-300">
                    {analysis.undercutAreaSqMeters.toFixed(2)} m²
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Undercut %:</span>
                  <strong className="text-amber-300">
                    {analysis.undercutPercentage.toFixed(2)}%
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Undercut:</span>
                  <strong className="text-slate-100">
                    {analysis.maxRadialUndercutMeters.toFixed(3)} m
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Undercut:</span>
                  <strong className="text-slate-100">
                    {analysis.avgRadialUndercutMeters.toFixed(3)} m
                  </strong>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-slate-400">Affected Perimeter:</span>
                  <strong className="text-slate-100">
                    {analysis.undercutPerimeterMeters.toFixed(2)} m
                  </strong>
                </div>
              </div>
              <div className="pt-1 border-t border-amber-900/40 flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Undercut Volume:</span>
                {analysis.undercutVolumeCubicMeters !== null ? (
                  <strong className="text-amber-300 text-xs">
                    {analysis.undercutVolumeCubicMeters.toFixed(2)} m³
                  </strong>
                ) : (
                  <span className="text-[10px] text-amber-300">
                    Volume requires valid chainage/pull interval.
                  </span>
                )}
              </div>
            </div>

            {/* Multi-Section Volume & Project File Memory Shortcut */}
            <button
              type="button"
              onClick={onOpenProjectMemoryModal}
              className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-700/50 rounded flex items-center justify-center gap-2 text-[11px] font-semibold"
            >
              <Database className="w-3.5 h-3.5" />
              Project Memory &amp; Section-to-Section Volumes
            </button>
          </>
        )}

        {subTab === 'profile_points' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between bg-slate-900 p-2 rounded border border-slate-800">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={surveyProfile.isClosed}
                  disabled={surveyProfile.locked}
                  onChange={(e) =>
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      isClosed: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                />
                Close Profile Loop (CPn → CP1)
              </label>
              <span className="text-[10px] text-emerald-400">
                {surveyProfile.orderedControlPointIds.length} Connected
              </span>
            </div>

            <div className="text-[10px] text-slate-400">
              Connected Sequence:{' '}
              <strong className="text-emerald-300">
                {surveyProfile.orderedControlPointIds.length > 0
                  ? surveyProfile.orderedControlPointIds
                      .map((id) => surfaceCPs.find((c) => c.id === id)?.label || '?')
                      .join(' → ') + (surveyProfile.isClosed ? ' → Close' : '')
                  : 'None (Click Connect Perimeter above)'}
              </strong>
            </div>

            {/* Ordered Control Points Table */}
            <div className="space-y-1.5">
              {surfaceCPs.length === 0 ? (
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded text-center text-slate-400 text-[11px]">
                  No survey control points on this surface yet. Click on the canvas or click
                  &quot;Load Sample As-Built&quot;.
                </div>
              ) : (
                surfaceCPs.map((cp) => {
                  const seqIdx = surveyProfile.orderedControlPointIds.indexOf(cp.id);
                  const isConnected = connectedIdSet.has(cp.id);
                  const isSel = selectedControlPointId === cp.id;
                  return (
                    <div
                      key={cp.id}
                      onClick={() => onSelectControlPointId(cp.id)}
                      className={`p-2 rounded border transition-colors cursor-pointer space-y-1.5 ${
                        isSel
                          ? 'bg-emerald-950/50 border-emerald-500/60'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isConnected}
                            disabled={surveyProfile.locked}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleTogglePointInSequence(cp.id);
                            }}
                            title="Include/exclude control point in connected profile"
                            className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                          />
                          <span className="font-bold text-emerald-300">{cp.label}</span>
                          {seqIdx >= 0 && (
                            <span className="px-1.5 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded text-[9px]">
                              #{seqIdx + 1}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {isConnected && (
                            <>
                              <button
                                type="button"
                                disabled={surveyProfile.locked || seqIdx <= 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMovePointInSequence(cp.id, -1);
                                }}
                                className="p-0.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded"
                                title="Move earlier in sequence"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  surveyProfile.locked ||
                                  seqIdx >= surveyProfile.orderedControlPointIds.length - 1
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMovePointInSequence(cp.id, 1);
                                }}
                                className="p-0.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded"
                                title="Move later in sequence"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={surveyProfile.locked}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInsertMidpointAfter(cp.id);
                                }}
                                className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded text-[9px]"
                                title="Insert new point after this CP along segment"
                              >
                                +Ins
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={surveyProfile.locked || cp.locked}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateControlPoints(
                                controlPoints.filter((item) => item.id !== cp.id)
                              );
                              onUpdateSurveyProfile((prev) => ({
                                ...prev,
                                orderedControlPointIds: prev.orderedControlPointIds.filter(
                                  (id) => id !== cp.id
                                ),
                              }));
                            }}
                            className="p-0.5 text-slate-400 hover:text-rose-400"
                            title="Delete Control Point"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          <span className="text-[9px] text-slate-500">X:</span>
                          <input
                            type="number"
                            step="0.02"
                            disabled={surveyProfile.locked || cp.locked}
                            value={cp.point.x}
                            onChange={(e) => {
                              const nx = parseFloat(e.target.value);
                              if (Number.isNaN(nx)) return;
                              onUpdateControlPoints(
                                controlPoints.map((item) =>
                                  item.id === cp.id
                                    ? { ...item, point: { x: nx, y: item.point.y } }
                                    : item
                                )
                              );
                            }}
                            className="w-full bg-transparent text-slate-100 text-[10px] focus:outline-none"
                          />
                          <span className="text-[9px] text-slate-500">m</span>
                        </label>
                        <label className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          <span className="text-[9px] text-slate-500">Y:</span>
                          <input
                            type="number"
                            step="0.02"
                            disabled={surveyProfile.locked || cp.locked}
                            value={cp.point.y}
                            onChange={(e) => {
                              const ny = parseFloat(e.target.value);
                              if (Number.isNaN(ny)) return;
                              onUpdateControlPoints(
                                controlPoints.map((item) =>
                                  item.id === cp.id
                                    ? { ...item, point: { x: item.point.x, y: ny } }
                                    : item
                                )
                              );
                            }}
                            className="w-full bg-transparent text-slate-100 text-[10px] focus:outline-none"
                          />
                          <span className="text-[9px] text-slate-500">m</span>
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {subTab === 'reasons' && (
          <div className="space-y-3">
            {/* Overall Default Overbreak & Undercut Reason Categories */}
            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded space-y-2">
              <div className="text-[10px] font-bold text-cyan-400">
                PRIMARY OVERBREAK &amp; UNDERCUT CLASSIFICATION
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] text-rose-300 font-semibold">
                  Overall Overbreak Category:
                </span>
                <select
                  value={surveyProfile.overallOverbreakCategory}
                  onChange={(e) =>
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      overallOverbreakCategory: e.target.value as OverbreakReasonCategory,
                    }))
                  }
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-[11px]"
                >
                  <option value="GEOLOGICAL">
                    GEOLOGICAL (Wedge / Joint Intersection / Shear Zone / Foliation)
                  </option>
                  <option value="MECHANICAL_EXCAVATION">
                    MECHANICAL / EXCAVATION (Blasting / Drill Lookout / Overcharging)
                  </option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">Overbreak Engineering Remarks:</span>
                <input
                  type="text"
                  value={surveyProfile.overallOverbreakReason}
                  onChange={(e) =>
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      overallOverbreakReason: e.target.value,
                    }))
                  }
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-[11px]"
                />
              </label>

              <label className="block space-y-1 pt-1 border-t border-slate-800">
                <span className="text-[10px] text-amber-300 font-semibold">
                  Overall Undercut Category:
                </span>
                <select
                  value={surveyProfile.overallUndercutCategory}
                  onChange={(e) =>
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      overallUndercutCategory: e.target.value as OverbreakReasonCategory,
                    }))
                  }
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-[11px]"
                >
                  <option value="MECHANICAL_EXCAVATION">
                    MECHANICAL / EXCAVATION (Under-drilling / Tight Toe / Scaling)
                  </option>
                  <option value="GEOLOGICAL">
                    GEOLOGICAL (Massive Competent Quartzite / Hard Dyke Ledge)
                  </option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">Undercut Engineering Remarks:</span>
                <input
                  type="text"
                  value={surveyProfile.overallUndercutReason}
                  onChange={(e) =>
                    onUpdateSurveyProfile((prev) => ({
                      ...prev,
                      overallUndercutReason: e.target.value,
                    }))
                  }
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-[11px]"
                />
              </label>
            </div>

            {/* Per-Zone Reason Recording */}
            {[...analysis.overbreakRegions, ...analysis.undercutRegions].map((zone) => {
              const isOB = zone.type === 'OVERBREAK';
              return (
                <div
                  key={zone.id}
                  className={`p-2.5 rounded border space-y-1.5 ${
                    isOB
                      ? 'bg-rose-950/20 border-rose-500/40'
                      : 'bg-amber-950/20 border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold ${isOB ? 'text-rose-300' : 'text-amber-300'}`}>
                      {zone.id}: {zone.locationLabel}
                    </span>
                    <span className="text-[10px] text-slate-300">
                      {zone.areaSqMeters.toFixed(2)} m² (Max {zone.maxRadialMeters.toFixed(2)}m)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[9px] text-slate-400">Reason Category</span>
                      <select
                        value={zone.reasonCategory}
                        onChange={(e) => {
                          const cat = e.target.value as OverbreakReasonCategory;
                          onUpdateSurveyProfile((prev) => ({
                            ...prev,
                            zoneReasonOverrides: {
                              ...prev.zoneReasonOverrides,
                              [zone.id]: {
                                zoneId: zone.id,
                                category: cat,
                                reasonDetail: zone.reasonDetail,
                                linkedJointSets: zone.linkedJointSets,
                              },
                            },
                          }));
                        }}
                        className="w-full px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-100"
                      >
                        <option value="GEOLOGICAL">GEOLOGICAL</option>
                        <option value="MECHANICAL_EXCAVATION">MECHANICAL / EXCAV.</option>
                      </select>
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[9px] text-slate-400">Linked Joint Sets</span>
                      <input
                        type="text"
                        value={zone.linkedJointSets}
                        placeholder="e.g. J1 + J2"
                        onChange={(e) => {
                          const setsVal = e.target.value;
                          onUpdateSurveyProfile((prev) => ({
                            ...prev,
                            zoneReasonOverrides: {
                              ...prev.zoneReasonOverrides,
                              [zone.id]: {
                                zoneId: zone.id,
                                category: zone.reasonCategory,
                                reasonDetail: zone.reasonDetail,
                                linkedJointSets: setsVal,
                              },
                            },
                          }));
                        }}
                        className="w-full px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-100"
                      />
                    </label>
                  </div>

                  <label className="block space-y-0.5">
                    <span className="text-[9px] text-slate-400">Specific Cause / Remarks</span>
                    <input
                      type="text"
                      value={zone.reasonDetail}
                      onChange={(e) => {
                        const detailVal = e.target.value;
                        onUpdateSurveyProfile((prev) => ({
                          ...prev,
                          zoneReasonOverrides: {
                            ...prev.zoneReasonOverrides,
                            [zone.id]: {
                              zoneId: zone.id,
                              category: zone.reasonCategory,
                              reasonDetail: detailVal,
                              linkedJointSets: zone.linkedJointSets,
                            },
                          },
                        }));
                      }}
                      className="w-full px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-100"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};

// ============================================================================
// PROJECT FILE MEMORY, MULTI-SECTION VOLUME & SAVED GEOMETRY MODAL
// ============================================================================

interface ProjectMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'projects' | 'volumes' | 'geometries';
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<TunnelSettings>>;
  savedProjects: SavedProjectRecord[];
  onSaveCurrentProject: () => void;
  onLoadProjectRecord: (record: SavedProjectRecord) => void;
  onDeleteProjectRecord: (id: string) => void;
  onImportProjectRecordFile: (file: File) => void;
  onExportCurrentProjectFile: () => void;
  savedGeometries: SavedDesignGeometryRecord[];
  onSaveCurrentGeometryToLibrary: (customName: string) => void;
  onLoadDesignGeometry: (geomRecord: SavedDesignGeometryRecord) => void;
  onDeleteDesignGeometry: (id: string) => void;
  onCreateCompanionSectionForVolumeTest: () => void;
}

export const ProjectMemoryModal: React.FC<ProjectMemoryModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'projects',
  geometry,
  settings,
  onUpdateSettings,
  savedProjects,
  onSaveCurrentProject,
  onLoadProjectRecord,
  onDeleteProjectRecord,
  onImportProjectRecordFile,
  onExportCurrentProjectFile,
  savedGeometries,
  onSaveCurrentGeometryToLibrary,
  onLoadDesignGeometry,
  onDeleteDesignGeometry,
  onCreateCompanionSectionForVolumeTest,
}) => {
  const [tab, setTab] = useState<'projects' | 'volumes' | 'geometries'>(
    initialTab
  );

  // Search filters by Tunnel + Location + Chainage + Date
  const [tunnelFilter, setTunnelFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [chainageFilter, setChainageFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');

  const [newGeomName, setNewGeomName] = useState<string>(
    `${settings.tunnelName} (${geometry.width.toFixed(2)}m × ${geometry.height.toFixed(2)}m)`
  );

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filteredProjects = useMemo(
    () =>
      filterSavedProjects(savedProjects, {
        tunnelQuery: tunnelFilter,
        locationQuery: locationFilter,
        chainageQuery: chainageFilter,
        dateQuery: dateFilter,
      }),
    [savedProjects, tunnelFilter, locationFilter, chainageFilter, dateFilter]
  );

  const sectionVolumeRows = useMemo(
    () => computeSectionToSectionVolumes(savedProjects),
    [savedProjects]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[#111621] border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs font-mono text-slate-100">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#0D121B] border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-cyan-400" />
            <span className="font-display font-bold text-sm tracking-wide text-white">
              PROJECT FILE MEMORY, SAVED GEOMETRIES &amp; SECTION VOLUMES
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-5 py-2 bg-slate-900 border-b border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('projects')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors whitespace-nowrap ${
              tab === 'projects'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            1. Project File Memory ({savedProjects.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('volumes')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors whitespace-nowrap ${
              tab === 'volumes'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            2. Section-to-Section Volumes ({sectionVolumeRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('geometries')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors whitespace-nowrap ${
              tab === 'geometries'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            3. Saved Design Geometries ({savedGeometries.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'projects' && (
            <>
              {/* Current Active Project Index Key: Tunnel + Location + Chainage + Date */}
              <div className="p-4 bg-slate-900/90 border border-cyan-500/40 rounded space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <span className="font-bold text-cyan-300">
                    CURRENT ACTIVE SECTION INDEX (TUNNEL + LOCATION + CHAINAGE + DATE)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onSaveCurrentProject}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save Section to Project Memory
                    </button>
                    <button
                      type="button"
                      onClick={onExportCurrentProjectFile}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export .akash.json
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".json,.akash.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onImportProjectRecordFile(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import File
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-400">1. Tunnel Name</span>
                    <input
                      type="text"
                      value={settings.tunnelName}
                      onChange={(e) =>
                        onUpdateSettings((p) => ({ ...p, tunnelName: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-400">2. Location / Adit / Heading</span>
                    <input
                      type="text"
                      value={settings.location || ''}
                      placeholder="e.g. Package-II Main Drive"
                      onChange={(e) =>
                        onUpdateSettings((p) => ({ ...p, location: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-400">3. Face Chainage / RD</span>
                    <input
                      type="text"
                      value={settings.faceChainage}
                      onChange={(e) =>
                        onUpdateSettings((p) => ({ ...p, faceChainage: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-400">4. Mapping Date</span>
                    <input
                      type="date"
                      value={settings.date}
                      onChange={(e) =>
                        onUpdateSettings((p) => ({ ...p, date: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                    />
                  </label>
                </div>
              </div>

              {/* Search & Recall Filter by Tunnel + Location + Chainage + Date */}
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-cyan-400" />
                    SEARCH &amp; REOPEN SAVED PROJECT SECTIONS (TUNNEL + LOCATION + CHAINAGE + DATE)
                  </span>
                  {(tunnelFilter || locationFilter || chainageFilter || dateFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setTunnelFilter('');
                        setLocationFilter('');
                        setChainageFilter('');
                        setDateFilter('');
                      }}
                      className="text-[10px] text-cyan-400 hover:underline"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <input
                    type="text"
                    placeholder="Filter by Tunnel Name..."
                    value={tunnelFilter}
                    onChange={(e) => setTunnelFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="Filter by Location..."
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="Filter by Chainage / RD..."
                    value={chainageFilter}
                    onChange={(e) => setChainageFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="Filter by Date (YYYY-MM-DD)..."
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                  />
                </div>
              </div>

              {/* Saved Project Records Table */}
              <div className="space-y-2">
                {filteredProjects.length === 0 ? (
                  <div className="p-6 bg-slate-900/50 border border-slate-800 rounded text-center text-slate-400">
                    No saved project sections match your filter. Click{' '}
                    <strong className="text-emerald-300">
                      &quot;Save Section to Project Memory&quot;
                    </strong>{' '}
                    above to store the current mapping section.
                  </div>
                ) : (
                  filteredProjects.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded flex flex-wrap items-center justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-cyan-300 text-xs">
                            {rec.tunnelName}
                          </span>
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-200 rounded border border-slate-700 text-[10px]">
                            {rec.location || 'Main Heading'}
                          </span>
                          <span className="px-2 py-0.5 bg-emerald-950/80 text-emerald-300 rounded border border-emerald-700/60 text-[10px] font-bold">
                            {rec.faceChainage || rec.chainage}
                          </span>
                          <span className="px-2 py-0.5 bg-slate-950 text-slate-300 rounded border border-slate-800 text-[10px]">
                            {rec.date}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Geometry: {rec.geometry.width.toFixed(2)}m ×{' '}
                          {rec.geometry.height.toFixed(2)}m · Joints: {rec.joints.length} ·
                          Lithology: {rec.lithologyRegions.length} · Control Pts:{' '}
                          {rec.controlPoints.length} · Overbreak:{' '}
                          <strong className="text-rose-300">
                            {rec.quantitySummary.overbreakAreaSqM.toFixed(2)} m² (
                            {rec.quantitySummary.overbreakPct.toFixed(1)}%)
                          </strong>{' '}
                          · Undercut:{' '}
                          <strong className="text-amber-300">
                            {rec.quantitySummary.undercutAreaSqM.toFixed(2)} m²
                          </strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onLoadProjectRecord(rec);
                            onClose();
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Reopen Section
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProjectRecord(rec.id)}
                          className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 rounded border border-slate-700"
                          title="Delete Saved Record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {tab === 'volumes' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 bg-slate-900 border border-slate-800 rounded">
                <div>
                  <div className="font-bold text-cyan-300">
                    SECTION-TO-SECTION EXCAVATION, OVERBREAK &amp; UNDERCUT VOLUME SCHEDULE
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Calculates chainage interval ΔRD = |RD₂ − RD₁| and engineering volumes (m³)
                    using Average End Area &amp; Prismoidal formulas.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onCreateCompanionSectionForVolumeTest}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Save Current + Companion Section (ΔRD = {settings.roundLength.toFixed(1)}m)
                </button>
              </div>

              {sectionVolumeRows.length === 0 ? (
                <div className="p-6 bg-slate-900/50 border border-slate-800 rounded text-center text-slate-400 space-y-2">
                  <div>
                    Section-to-section volume requires at least 2 saved cross-sections with valid
                    chainages (e.g., RD 1420.00m and RD 1423.50m).
                  </div>
                  <div className="text-cyan-300">
                    Click &quot;Save Current + Companion Section&quot; above to populate two
                    consecutive tunnel chainage sections immediately.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-300 border-b border-slate-800 text-[10px]">
                        <th className="p-2.5">CHAINAGE INTERVAL</th>
                        <th className="p-2.5">ΔL (m)</th>
                        <th className="p-2.5">DESIGN VOL (m³)</th>
                        <th className="p-2.5">AS-BUILT VOL (m³)</th>
                        <th className="p-2.5 text-rose-300">OVERBREAK VOL (Avg End)</th>
                        <th className="p-2.5 text-rose-300">OVERBREAK VOL (Prismoidal)</th>
                        <th className="p-2.5 text-amber-300">UNDERCUT VOL (Avg End)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionVolumeRows.map((row, idx) => (
                        <tr
                          key={`${row.fromSectionId}-${row.toSectionId}-${idx}`}
                          className="border-b border-slate-800/80 bg-slate-900/60"
                        >
                          <td className="p-2.5 font-bold text-cyan-300">
                            {row.fromChainageLabel} → {row.toChainageLabel}
                          </td>
                          <td className="p-2.5 font-semibold text-white">
                            {row.intervalLengthMeters.toFixed(2)} m
                          </td>
                          <td className="p-2.5">{row.designVolumeM3.toFixed(2)} m³</td>
                          <td className="p-2.5 text-emerald-300 font-semibold">
                            {row.surveyedVolumeM3.toFixed(2)} m³
                          </td>
                          <td className="p-2.5 text-rose-300 font-bold">
                            {row.overbreakVolumeAvgEndAreaM3.toFixed(2)} m³
                          </td>
                          <td className="p-2.5 text-rose-200">
                            {row.overbreakVolumePrismoidalM3.toFixed(2)} m³
                          </td>
                          <td className="p-2.5 text-amber-300 font-bold">
                            {row.undercutVolumeAvgEndAreaM3.toFixed(2)} m³
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'geometries' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded flex flex-wrap items-end justify-between gap-3">
                <label className="flex-1 min-w-[240px] space-y-1">
                  <span className="text-[10px] text-slate-400">
                    Save Current Tunnel Design Profile ({geometry.width.toFixed(2)}m W ×{' '}
                    {geometry.height.toFixed(2)}m H · {geometry.source.toUpperCase()}) to Reusable
                    Library:
                  </span>
                  <input
                    type="text"
                    value={newGeomName}
                    onChange={(e) => setNewGeomName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onSaveCurrentGeometryToLibrary(newGeomName)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Design Geometry
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {savedGeometries.map((g) => (
                  <div
                    key={g.id}
                    className="p-3 bg-slate-900 border border-slate-800 rounded flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="font-bold text-cyan-300">{g.name}</div>
                      <div className="text-[11px] text-slate-400">
                        Span {g.geometry.width.toFixed(2)}m × Height{' '}
                        {g.geometry.height.toFixed(2)}m (Wall {g.geometry.wallHeight.toFixed(2)}m)
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Source: {g.geometry.source.toUpperCase()} · {g.tunnelName}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadDesignGeometry(g);
                          onClose();
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded"
                      >
                        Use Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDesignGeometry(g.id)}
                        className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
