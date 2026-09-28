import React, { useState } from 'react';
import {
  Joint,
  JointSet,
  QIndexParameters,
  RockMassSummaryTable,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  autoEstimateQIndexFromMappedJoints,
  calculateBartonQSystem,
  exportGeologyAndQIndexToCSV,
} from '../engine/photoWarpEngine';
import { Calculator, CheckCircle2, Download, FileSpreadsheet, Sparkles, X } from 'lucide-react';

interface GeologyAndQIndexDrawerProps {
  activeTab: 'geology_tables' | 'q_index';
  onChangeTab: (tab: 'geology_tables' | 'q_index') => void;
  onClose: () => void;
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  joints: Joint[];
  jointSets: JointSet[];
  onUpdateJoints?: (nextJoints: Joint[]) => void;
  onUpdateJointSetAttribute: (setId: string, field: keyof JointSet, value: string) => void;
  onMergeJointSets: (fromSetId: string, toSetId: string) => void;
  qIndexParams: QIndexParameters;
  onUpdateQIndexParams: (next: QIndexParameters) => void;
  rockMassSummary: RockMassSummaryTable;
  onUpdateRockMassSummary: (next: RockMassSummaryTable) => void;
  onOpenExportSheet: () => void;
}

const JN_OPTIONS = [
  { val: 0.75, label: '0.75 — Massive, no or few joints' },
  { val: 2, label: '2.0 — One joint set' },
  { val: 3, label: '3.0 — One joint set plus random joints' },
  { val: 4, label: '4.0 — Two joint sets' },
  { val: 6, label: '6.0 — Two joint sets plus random joints' },
  { val: 9, label: '9.0 — Three joint sets' },
  { val: 12, label: '12.0 — Three joint sets plus random joints' },
  { val: 15, label: '15.0 — Four or more joint sets, heavily jointed' },
  { val: 20, label: '20.0 — Crushed rock, earth-like' },
];

const JR_OPTIONS = [
  { val: 4.0, label: '4.0 — Discontinuous joints' },
  { val: 3.0, label: '3.0 — Rough or irregular, undulating' },
  { val: 2.0, label: '2.0 — Smooth, undulating' },
  { val: 1.5, label: '1.5 — Slickensided undulating OR Rough/irregular planar' },
  { val: 1.0, label: '1.0 — Smooth, planar OR No rock-wall contact when sheared' },
  { val: 0.5, label: '0.5 — Slickensided, planar' },
];

const JA_OPTIONS = [
  { val: 0.75, label: '0.75 — Tightly healed, hard, non-softening impermeable filling' },
  { val: 1.0, label: '1.0 — Unaltered joint walls, surface staining only' },
  { val: 2.0, label: '2.0 — Slightly altered joint walls, non-softening mineral coatings' },
  { val: 3.0, label: '3.0 — Silty or sandy-clay coatings, small clay fraction' },
  { val: 4.0, label: '4.0 — Softening or low-friction clay/chlorite/talc coatings (1–2 mm)' },
  { val: 6.0, label: '6.0 — Strongly over-consolidated non-softening clay filling (< 5 mm)' },
  { val: 8.0, label: '8.0 — Medium or low over-consolidation softening clay filling (< 5 mm)' },
  { val: 10.0, label: '10.0 — Swelling clay fillings OR Thick crushed clay zone' },
  { val: 15.0, label: '15.0 — Thick continuous bands of clay / gouge (Ja = 15)' },
];

const JW_OPTIONS = [
  { val: 1.0, label: '1.0 — Dry excavations or minor inflow (< 5 L/min locally)' },
  { val: 0.66, label: '0.66 — Medium inflow or pressure, occasional outwash of fillings' },
  { val: 0.5, label: '0.50 — Large inflow or high pressure in competent rock with unfilled joints' },
  { val: 0.33, label: '0.33 — Large inflow or high pressure with considerable outwash of fillings' },
  { val: 0.15, label: '0.15 — Exceptionally high inflow or water pressure at blasting, decaying' },
  { val: 0.08, label: '0.08 — Exceptionally high continuing water inflow / pressure' },
];

const SRF_OPTIONS = [
  { val: 1.0, label: '1.0 — Competent rock, medium stress, favorable stress condition' },
  { val: 2.5, label: '2.5 — Single shear zone in competent rock (excavation depth > 50m)' },
  { val: 5.0, label: '5.0 — Single weakness zone with clay OR depth <= 50m OR loose open joints' },
  { val: 7.5, label: '7.5 — Multiple shear zones in competent rock (clay-free), loose rock' },
  { val: 10.0, label: '10.0 — Multiple occurrences of weakness zones containing clay / chemically disintegrated rock' },
  { val: 15.0, label: '15.0 — Mild to Heavy squeezing rock pressure or slabbing' },
  { val: 20.0, label: '20.0 — Heavy squeezing or swelling rock pressure' },
];

export const GeologyAndQIndexDrawer: React.FC<GeologyAndQIndexDrawerProps> = ({
  activeTab,
  onChangeTab,
  onClose,
  geometry,
  settings,
  joints,
  jointSets,
  onUpdateJoints,
  onUpdateJointSetAttribute,
  onMergeJointSets,
  qIndexParams,
  onUpdateQIndexParams,
  rockMassSummary,
  onUpdateRockMassSummary,
  onOpenExportSheet,
}) => {
  const [mergeSourceSet, setMergeSourceSet] = useState<string>('J2');
  const [mergeTargetSet, setMergeTargetSet] = useState<string>('J1');

  const qResult = calculateBartonQSystem(qIndexParams, geometry.width);

  const handleDownloadCSV = () => {
    const csvContent = exportGeologyAndQIndexToCSV(
      geometry,
      settings,
      joints,
      jointSets,
      qIndexParams,
      rockMassSummary
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${settings.tunnelName.replace(/\s+/g, '_')}_${settings.faceChainage.replace(/\s+/g, '_')}_geology_qindex.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-[340px] bg-[#0E131D] border-t border-slate-700/90 flex flex-col shrink-0 z-30 shadow-2xl">
      {/* Top Drawer Header & Workflow Switcher */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#131A28] border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeTab('geology_tables')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-semibold transition-colors ${
              activeTab === 'geology_tables'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:text-white'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            1. GEOLOGICAL &amp; DISCONTINUITY TABLES ({jointSets.length} Sets · {joints.length} Traces)
          </button>

          <button
            onClick={() => onChangeTab('q_index')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-semibold transition-colors ${
              activeTab === 'q_index'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:text-white'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            2. BARTON Q-INDEX CALCULATOR (Q = {qResult.qValue.toFixed(2)} · {qResult.rockQualityCategory})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const autoParams = autoEstimateQIndexFromMappedJoints(
                joints,
                jointSets,
                geometry,
                settings,
                qIndexParams
              );
              onUpdateQIndexParams(autoParams);
              onChangeTab('q_index');
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono bg-amber-600/25 hover:bg-amber-600/40 text-amber-200 border border-amber-500/40 rounded transition-colors"
            title="Compute RQD, Jn, Jr, Ja, Jw, SRF from mapped discontinuity traces"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Auto-Calculate Q from Mapped Traces
          </button>

          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded transition-colors"
            title="Export Discontinuity Sets, Individual Traces, and Barton Q-Index to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            onClick={onOpenExportSheet}
            className="flex items-center gap-1 px-3 py-1 text-xs font-mono font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Final Review &amp; Mapping Sheet
          </button>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Drawer Body Content */}
      <div className="flex-1 overflow-y-auto p-3.5 font-mono text-xs">
        {activeTab === 'geology_tables' ? (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* LEFT 7 COLUMNS: DISCONTINUITY-SET ENGINEERING TABLE */}
            <div className="xl:col-span-7 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300">
                  A. DISCONTINUITY-SET TABLE (ORIENTATION, SPACING, PERSISTENCE, ROUGHNESS, INFILLING, WATER)
                </span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Merge:</span>
                  <select
                    value={mergeSourceSet}
                    onChange={(e) => setMergeSourceSet(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
                  >
                    {['J0', 'J1', 'J2', 'J3', 'J4', 'J5', 'F1'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">→</span>
                  <select
                    value={mergeTargetSet}
                    onChange={(e) => setMergeTargetSet(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
                  >
                    {['J0', 'J1', 'J2', 'J3', 'J4', 'J5', 'F1'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onMergeJointSets(mergeSourceSet, mergeTargetSet)}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded"
                  >
                    Merge Sets
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded bg-slate-950/70">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400">
                      <th className="py-1.5 px-2">SET</th>
                      <th className="py-1.5 px-2">DIP DIR / DIP</th>
                      <th className="py-1.5 px-2">SPACING</th>
                      <th className="py-1.5 px-2">PERSISTENCE</th>
                      <th className="py-1.5 px-2">APERTURE</th>
                      <th className="py-1.5 px-2">ROUGHNESS</th>
                      <th className="py-1.5 px-2">INFILLING</th>
                      <th className="py-1.5 px-2">WATER</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jointSets.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          No discontinuity sets mapped yet. Click &quot;AI Trace&quot; or &quot;Add Joint&quot; on the canvas.
                        </td>
                      </tr>
                    ) : (
                      jointSets.map((js) => (
                        <tr key={js.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
                          <td className="py-1.5 px-2 font-bold">
                            <span
                              className="inline-block px-2 py-0.5 rounded text-white text-[10px]"
                              style={{ backgroundColor: js.color }}
                            >
                              {js.id}
                            </span>
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.orientation}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'orientation', e.target.value)
                              }
                              className="w-28 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.spacing}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'spacing', e.target.value)
                              }
                              className="w-24 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.persistence}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'persistence', e.target.value)
                              }
                              className="w-20 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.aperture}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'aperture', e.target.value)
                              }
                              className="w-24 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.roughness}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'roughness', e.target.value)
                              }
                              className="w-28 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.infilling}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'infilling', e.target.value)
                              }
                              className="w-28 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={js.water}
                              onChange={(e) =>
                                onUpdateJointSetAttribute(js.id, 'water', e.target.value)
                              }
                              className="w-20 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-100"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT 5 COLUMNS: LITHOLOGY, WEATHERING, STRENGTH, WATER & SUPPORT GEOLOGICAL TABLE */}
            <div className="xl:col-span-5 space-y-2">
              <span className="text-[11px] font-bold text-cyan-300 block">
                B. ROCK MASS, LITHOLOGY, WEATHERING &amp; SUPPORT LOG TABLE
              </span>

              <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-950/80 border border-slate-800 rounded text-[11px]">
                <label className="space-y-0.5">
                  <span className="text-slate-400">Rock Type / Lithology</span>
                  <input
                    type="text"
                    value={rockMassSummary.rockType}
                    onChange={(e) =>
                      onUpdateRockMassSummary({ ...rockMassSummary, rockType: e.target.value })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  />
                </label>

                <label className="space-y-0.5">
                  <span className="text-slate-400">Weathering Grade (ISRM)</span>
                  <select
                    value={rockMassSummary.weatheringGrade}
                    onChange={(e) =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        weatheringGrade: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  >
                    <option value="W1 (Fresh / Unweathered)">W1 (Fresh / Unweathered)</option>
                    <option value="W2 (Slightly Weathered)">W2 (Slightly Weathered)</option>
                    <option value="W3 (Moderately Weathered)">W3 (Moderately Weathered)</option>
                    <option value="W4 (Highly Weathered)">W4 (Highly Weathered)</option>
                    <option value="W5 (Completely Weathered)">W5 (Completely Weathered)</option>
                  </select>
                </label>

                <label className="space-y-0.5">
                  <span className="text-slate-400">Intact Rock Strength (UCS)</span>
                  <select
                    value={rockMassSummary.strengthGrade}
                    onChange={(e) =>
                      onUpdateRockMassSummary({ ...rockMassSummary, strengthGrade: e.target.value })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  >
                    <option value="R5 (Very Strong, 100–250 MPa)">R5 (Very Strong, 100–250 MPa)</option>
                    <option value="R4 (Strong, 50–100 MPa)">R4 (Strong, 50–100 MPa)</option>
                    <option value="R3–R4 (Medium Strong to Strong, UCS 50–100 MPa)">
                      R3–R4 (Medium Strong to Strong, 50–100 MPa)
                    </option>
                    <option value="R3 (Medium Strong, 25–50 MPa)">R3 (Medium Strong, 25–50 MPa)</option>
                    <option value="R2 (Weak, 5–25 MPa)">R2 (Weak, 5–25 MPa)</option>
                    <option value="R1 (Very Weak, 1–5 MPa)">R1 (Very Weak, 1–5 MPa)</option>
                  </select>
                </label>

                <label className="space-y-0.5">
                  <span className="text-slate-400">Groundwater / Inflow</span>
                  <input
                    type="text"
                    value={rockMassSummary.groundwaterCondition}
                    onChange={(e) =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        groundwaterCondition: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  />
                </label>

                <label className="space-y-0.5">
                  <span className="text-slate-400">Overbreak / Stability Condition</span>
                  <input
                    type="text"
                    value={rockMassSummary.overbreakCondition}
                    onChange={(e) =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        overbreakCondition: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  />
                </label>

                <label className="space-y-0.5">
                  <span className="text-slate-400">Installed / Designed Support</span>
                  <input
                    type="text"
                    value={rockMassSummary.installedSupport}
                    onChange={(e) =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        installedSupport: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  />
                </label>

                <label className="col-span-2 space-y-0.5">
                  <span className="text-slate-400">Engineering Geologist Field Remarks</span>
                  <input
                    type="text"
                    value={rockMassSummary.geologistRemarks}
                    onChange={(e) =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        geologistRemarks: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-100"
                  />
                </label>
              </div>
            </div>

            {/* FULL-WIDTH ROW C: INDIVIDUAL MAPPED STRUCTURAL TRACES LOG TABLE */}
            <div className="xl:col-span-12 space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300">
                  C. INDIVIDUAL MAPPED STRUCTURAL TRACES LOG ({joints.length} Vectors Registered to Main Photos)
                </span>
                <span className="text-[10px] text-slate-400">
                  Drive Azimuth: N {String(Math.round(settings.driveDirection)).padStart(3, '0')}° E · True / Apparent 3D Orientation
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded bg-slate-950/70 max-h-40">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 sticky top-0">
                      <th className="py-1 px-2">#</th>
                      <th className="py-1 px-2">SURFACE</th>
                      <th className="py-1 px-2">SET</th>
                      <th className="py-1 px-2">FEATURE TYPE</th>
                      <th className="py-1 px-2">DIP DIR (°)</th>
                      <th className="py-1 px-2">DIP (°)</th>
                      <th className="py-1 px-2">STRIKE (°)</th>
                      <th className="py-1 px-2">LENGTH (m)</th>
                      <th className="py-1 px-2">PTS</th>
                      <th className="py-1 px-2">WATER</th>
                      <th className="py-1 px-2">3D STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {joints.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-3 text-center text-slate-500">
                          No individual traces mapped yet.
                        </td>
                      </tr>
                    ) : (
                      joints.map((j, idx) => (
                        <tr key={j.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
                          <td className="py-1 px-2 text-slate-400">{idx + 1}</td>
                          <td className="py-1 px-2 uppercase text-cyan-300 font-semibold">
                            {j.surface}
                          </td>
                          <td className="py-1 px-2 font-bold text-white">{j.set}</td>
                          <td className="py-1 px-2 text-slate-200">{j.featureType}</td>
                          <td className="py-1 px-2 font-semibold text-emerald-300">
                            {String(Math.round(j.dipDirection)).padStart(3, '0')}°
                          </td>
                          <td className="py-1 px-2 font-semibold text-emerald-300">
                            {String(Math.round(j.dip)).padStart(2, '0')}°
                          </td>
                          <td className="py-1 px-2 text-slate-300">
                            {String(Math.round(j.strike)).padStart(3, '0')}°
                          </td>
                          <td className="py-1 px-2 text-slate-200">
                            {j.persistenceMeters.toFixed(2)} m
                          </td>
                          <td className="py-1 px-2 text-slate-400">
                            P1..P{j.geometry.length}
                          </td>
                          <td className="py-1 px-2">
                            <select
                              value={j.waterCondition || 'Dry'}
                              onChange={(e) => {
                                if (!onUpdateJoints) return;
                                onUpdateJoints(
                                  joints.map((item) =>
                                    item.id === j.id
                                      ? {
                                          ...item,
                                          waterCondition: e.target.value as Joint['waterCondition'],
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-200"
                            >
                              <option value="Dry">Dry</option>
                              <option value="Damp">Damp</option>
                              <option value="Wet">Wet</option>
                              <option value="Dripping">Dripping</option>
                              <option value="Flowing">Flowing</option>
                            </select>
                          </td>
                          <td className="py-1 px-2 text-[10px] text-slate-400">
                            {j.orientationStatus.replace(/_/g, ' ')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* ====================================================================
             TAB 2: BARTON Q-INDEX CALCULATOR (Q = RQD/Jn * Jr/Ja * Jw/SRF)
             ==================================================================== */
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* LEFT 8 COLUMNS: 6 NGI Q-SYSTEM PARAMETERS */}
            <div className="xl:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {/* 1. RQD */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">1. RQD (%)</span>
                  <span className="text-white font-bold text-sm">{qIndexParams.rqd}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={qIndexParams.rqd}
                  onChange={(e) =>
                    onUpdateQIndexParams({ ...qIndexParams, rqd: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-500"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Rock Quality Designation</span>
                  <span>Jv ≈ {qIndexParams.volumetricJointCountJv ?? 14} jts/m³</span>
                </div>
              </div>

              {/* 2. Jn */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">2. Joint Set No. (Jn)</span>
                  <span className="text-white font-bold text-sm">{qResult.effectiveJn}</span>
                </div>
                <select
                  value={qIndexParams.jn}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const found = JN_OPTIONS.find((o) => o.val === val);
                    onUpdateQIndexParams({
                      ...qIndexParams,
                      jn: val,
                      jnDescription: found ? found.label : `Jn = ${val}`,
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100"
                >
                  {JN_OPTIONS.map((opt) => (
                    <option key={opt.val} value={opt.val}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-3 text-[10px] text-slate-300 pt-0.5">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(qIndexParams.isPortal)}
                      onChange={(e) =>
                        onUpdateQIndexParams({
                          ...qIndexParams,
                          isPortal: e.target.checked,
                          isIntersection: e.target.checked ? false : qIndexParams.isIntersection,
                        })
                      }
                      className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                    />
                    Portal (2×Jn)
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(qIndexParams.isIntersection)}
                      onChange={(e) =>
                        onUpdateQIndexParams({
                          ...qIndexParams,
                          isIntersection: e.target.checked,
                          isPortal: e.target.checked ? false : qIndexParams.isPortal,
                        })
                      }
                      className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                    />
                    Intersection (3×Jn)
                  </label>
                </div>
              </div>

              {/* 3. Jr */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">3. Joint Roughness (Jr)</span>
                  <span className="text-white font-bold text-sm">{qIndexParams.jr}</span>
                </div>
                <select
                  value={qIndexParams.jr}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const found = JR_OPTIONS.find((o) => o.val === val);
                    onUpdateQIndexParams({
                      ...qIndexParams,
                      jr: val,
                      jrDescription: found ? found.label : `Jr = ${val}`,
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100"
                >
                  {JR_OPTIONS.map((opt) => (
                    <option key={opt.val} value={opt.val}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-400 truncate">
                  {qIndexParams.jrDescription}
                </div>
              </div>

              {/* 4. Ja */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">4. Joint Alteration (Ja)</span>
                  <span className="text-white font-bold text-sm">{qIndexParams.ja}</span>
                </div>
                <select
                  value={qIndexParams.ja}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const found = JA_OPTIONS.find((o) => o.val === val);
                    onUpdateQIndexParams({
                      ...qIndexParams,
                      ja: val,
                      jaDescription: found ? found.label : `Ja = ${val}`,
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100"
                >
                  {JA_OPTIONS.map((opt) => (
                    <option key={opt.val} value={opt.val}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-400 truncate">
                  {qIndexParams.jaDescription}
                </div>
              </div>

              {/* 5. Jw */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">5. Joint Water (Jw)</span>
                  <span className="text-white font-bold text-sm">{qIndexParams.jw}</span>
                </div>
                <select
                  value={qIndexParams.jw}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const found = JW_OPTIONS.find((o) => o.val === val);
                    onUpdateQIndexParams({
                      ...qIndexParams,
                      jw: val,
                      jwDescription: found ? found.label : `Jw = ${val}`,
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100"
                >
                  {JW_OPTIONS.map((opt) => (
                    <option key={opt.val} value={opt.val}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-400 truncate">
                  {qIndexParams.jwDescription}
                </div>
              </div>

              {/* 6. SRF */}
              <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">6. Stress Factor (SRF)</span>
                  <span className="text-white font-bold text-sm">{qIndexParams.srf}</span>
                </div>
                <select
                  value={qIndexParams.srf}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const found = SRF_OPTIONS.find((o) => o.val === val);
                    onUpdateQIndexParams({
                      ...qIndexParams,
                      srf: val,
                      srfDescription: found ? found.label : `SRF = ${val}`,
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100"
                >
                  {SRF_OPTIONS.map((opt) => (
                    <option key={opt.val} value={opt.val}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-400 truncate">
                  {qIndexParams.srfDescription}
                </div>
              </div>
            </div>

            {/* RIGHT 4 COLUMNS: COMPUTED Q-VALUE, QUOTIENTS & SUPPORT RECOMMENDATION */}
            <div className="xl:col-span-4 p-3 bg-slate-950 border border-cyan-500/40 rounded flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <div className="text-[10px] text-slate-400">
                    BARTON NGI TUNNELLING QUALITY INDEX
                  </div>
                  <div className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Q = {qResult.qValue.toFixed(2)}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded font-semibold text-white"
                      style={{ backgroundColor: qResult.colorHex }}
                    >
                      {qResult.rockMassClass}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400">Est. RMR89</div>
                  <div className="text-sm font-bold text-cyan-300">{qResult.estimatedRmr} / 100</div>
                </div>
              </div>

              {/* 3 Physical Quotients */}
              <div className="grid grid-cols-3 gap-2 text-center bg-slate-900/90 p-2 rounded border border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-400">Block Size (RQD/Jn)</div>
                  <div className="text-xs font-bold text-slate-100">
                    {qResult.effectiveRqd}/{qResult.effectiveJn} = {qResult.blockSizeQuotient}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Shear (Jr/Ja)</div>
                  <div className="text-xs font-bold text-slate-100">
                    {qIndexParams.jr}/{qIndexParams.ja} = {qResult.shearStrengthQuotient}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Stress (Jw/SRF)</div>
                  <div className="text-xs font-bold text-slate-100">
                    {qIndexParams.jw}/{qIndexParams.srf} = {qResult.activeStressQuotient}
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between text-slate-300">
                  <span>
                    Span = {geometry.width.toFixed(2)}m · ESR = {qIndexParams.esr} · De ={' '}
                    <strong className="text-cyan-300">{qResult.equivalentDimensionDe}m</strong>
                  </span>
                  <button
                    onClick={() =>
                      onUpdateRockMassSummary({
                        ...rockMassSummary,
                        installedSupport: qResult.recommendedSupport,
                      })
                    }
                    className="text-[10px] text-cyan-400 hover:underline"
                  >
                    Copy to Support Table
                  </button>
                </div>
                <div className="p-2 bg-slate-900 border border-slate-800 rounded text-[10px] text-emerald-300">
                  <strong>NGI Support Category:</strong> {qResult.recommendedSupport}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
