import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileSpreadsheet,
  Layers,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Joint,
  JointSet,
  PhotoSurface,
  SurfaceType,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import {
  computePhotogrammetricStructuralSummary,
  exportPhotogrammetricPointCloudToPLY,
  exportPhotogrammetricStructuralCSV,
  generatePhotogrammetricPointCloud,
} from '../engine/photogrammetryAndStructuralEngine';

interface PhotogrammetryStructuralModalProps {
  isOpen: boolean;
  onClose: () => void;
  joints: Joint[];
  jointSets: JointSet[];
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  photos: Record<SurfaceType, PhotoSurface>;
  activeSurface: SurfaceType;
  hasActiveRidgeField: boolean;
  onRefineAllActiveSurfaceTraces: () => void;
  onSelectJoint?: (jointId: string, surface: SurfaceType) => void;
}

export const PhotogrammetryStructuralModal: React.FC<PhotogrammetryStructuralModalProps> = ({
  isOpen,
  onClose,
  joints,
  jointSets,
  geometry,
  settings,
  photos,
  activeSurface,
  hasActiveRidgeField,
  onRefineAllActiveSurfaceTraces,
  onSelectJoint,
}) => {
  const [activeTab, setActiveTab] = useState<'kinematic' | 'jrc' | 'pointcloud'>('kinematic');

  const summary = useMemo(
    () => computePhotogrammetricStructuralSummary(joints, jointSets, geometry, settings, photos),
    [joints, jointSets, geometry, settings, photos]
  );

  const pointCloud = useMemo(
    () => generatePhotogrammetricPointCloud(joints, geometry, settings),
    [joints, geometry, settings]
  );

  if (!isOpen) return null;

  const handleDownloadPLY = () => {
    const plyContent = exportPhotogrammetricPointCloudToPLY(joints, geometry, settings);
    const blob = new Blob([plyContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeChainage = (settings.faceChainage || 'CH0').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.href = url;
    a.download = `Tunnel_3D_Photogrammetry_${safeChainage}.ply`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCSV = () => {
    const csvContent = exportPhotogrammetricStructuralCSV(joints, jointSets, geometry, settings);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeChainage = (settings.faceChainage || 'CH0').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.href = url;
    a.download = `Structural_Joints_And_Wedges_${safeChainage}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const criticalWedgeCount = summary.kinematicWedges.filter(
    (w) => w.riskLevel === 'CRITICAL'
  ).length;
  const moderateWedgeCount = summary.kinematicWedges.filter(
    (w) => w.riskLevel === 'MODERATE'
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/90 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-bold tracking-wide uppercase text-white">
                  3D Photogrammetry & Quantitative Structural Geology Engine
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                  Steger Sub-Pixel + Phase Congruency + 3D SVD
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Non-destructive photogrammetric trace refinement, Barton-Bandis JRC (Z₂) roughness, Mauldon P₂₁/P₃₂ fracture intensity & Goodman-Shi 3D kinematic wedge stability
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveRidgeField && (
              <button
                onClick={onRefineAllActiveSurfaceTraces}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow transition-colors cursor-pointer"
                title="Lock all traces on active surface onto sub-pixel Steger ridge & recompute 3D SVD orientation + Barton JRC without losing any existing traces"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sub-Pixel Lock & 3D Refine ({activeSurface})</span>
              </button>
            )}
            <button
              onClick={handleDownloadPLY}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors cursor-pointer"
              title="Export 3D Colored Point Cloud with Surface Normals (.PLY) for CloudCompare / Agisoft Metashape / MeshLab"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export 3D .PLY Cloud</span>
            </button>
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors cursor-pointer"
              title="Export Structural Joints, Terzaghi Weights, Barton JRC & Kinematic Wedges (.CSV) for Rocscience DIPS / UnWedge"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export DIPS / UnWedge .CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* High-Density Photogrammetric & Rock Mass KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 p-3.5 bg-slate-950/60 border-b border-slate-800">
          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Steger Sub-Pixel Lock
            </div>
            <div className="text-base font-mono font-bold text-cyan-400 mt-0.5">
              ±{summary.meanSubPixelResidualPx.toFixed(2)} px
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Phase Congruency: {(summary.meanPhaseCongruency * 100).toFixed(0)}%
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              3D Bundle Residual
            </div>
            <div className="text-base font-mono font-bold text-emerald-400 mt-0.5">
              {(summary.meanTriangulationResidualM * 1000).toFixed(1)} mm
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Reproj Error: {summary.meanReprojectionErrorPx.toFixed(2)} px
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Fracture Intensity P₂₁ / P₃₂
            </div>
            <div className="text-base font-mono font-bold text-amber-300 mt-0.5">
              {summary.arealFractureIntensityP21.toFixed(2)} m⁻¹ · {summary.volumetricFractureIntensityP32.toFixed(2)} m²/m³
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Areal P₂₁ & Volumetric P₃₂
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Mauldon Unbiased Trace
            </div>
            <div className="text-base font-mono font-bold text-sky-300 mt-0.5">
              {summary.mauldonTrueMeanLengthMeters.toFixed(2)} m
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Censorship-Corrected Mean L
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Palmström Vb & RQD*
            </div>
            <div className="text-base font-mono font-bold text-indigo-300 mt-0.5">
              {summary.estimatedBlockVolumeM3.toFixed(2)} m³ · {summary.terzaghiCorrectedRqdPct}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Terzaghi Bias-Corrected
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Barton Field JRCₙ & Wedges
            </div>
            <div className="text-base font-mono font-bold text-rose-300 mt-0.5">
              JRCₙ {summary.meanBartonJrc.toFixed(1)} · {criticalWedgeCount + moderateWedgeCount} Risk
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {summary.pointCloudCount.toLocaleString()} 3D Cloud Vertices
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-5 pt-3 bg-slate-900 border-b border-slate-800">
          <button
            onClick={() => setActiveTab('kinematic')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
              activeTab === 'kinematic'
                ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>1. 3D Kinematic Wedge & Block Stability ({summary.kinematicWedges.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('jrc')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
              activeTab === 'jrc'
                ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>2. Barton-Bandis JRC (Z₂) Roughness & Terzaghi Bias ({summary.jrcProfiles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('pointcloud')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pointcloud'
                ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>3. 3D Photogrammetric Point Cloud & Normal Vectors ({summary.pointCloudCount})</span>
          </button>
        </div>

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'kinematic' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded p-3">
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-white">Goodman & Shi (1985) 3D Vector Wedge & Planar Analysis:</span>{' '}
                  Evaluates all intersecting joint sets (<span className="font-mono text-cyan-300">I = n₁ × n₂</span>) against Tunnel Drive Azimuth{' '}
                  <span className="font-mono text-amber-300">N {Math.round(settings.driveDirection)}° E</span> and span{' '}
                  <span className="font-mono text-amber-300">{geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m</span> using Barton-Bandis mobilized shear strength.
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Critical (FoS &lt; 1.3): {criticalWedgeCount}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Moderate (1.3–1.8): {moderateWedgeCount}
                  </span>
                </div>
              </div>

              {summary.kinematicWedges.length === 0 ? (
                <div className="text-center py-12 bg-slate-950/40 border border-slate-800 rounded text-slate-400 text-sm">
                  Map or auto-detect at least 1–2 joint sets on the tunnel surfaces to compute 3D kinematic wedges and block stability.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-300 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                        <th className="py-2.5 px-3">Intersecting Sets</th>
                        <th className="py-2.5 px-3">Failure Mode</th>
                        <th className="py-2.5 px-3">Excavation Surface</th>
                        <th className="py-2.5 px-3 font-mono">Line of Intersection (Plunge / Trend)</th>
                        <th className="py-2.5 px-3 font-mono">Apex Height</th>
                        <th className="py-2.5 px-3 font-mono">Block Vol / Mass</th>
                        <th className="py-2.5 px-3 font-mono">FoS (Dry / Wet)</th>
                        <th className="py-2.5 px-3">Stability Risk</th>
                        <th className="py-2.5 px-3">Recommended Support</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {summary.kinematicWedges.map((w) => (
                        <tr key={w.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-cyan-300">
                            {w.pairLabel}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-200">
                            {w.failureMode.replace(/_/g, ' ')}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{w.affectedSurface}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-200">
                            {w.intersectionPlungeDeg.toFixed(1)}° / {String(Math.round(w.intersectionTrendDeg)).padStart(3, '0')}°
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-200">
                            {w.wedgeApexHeightMeters.toFixed(2)} m
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-200">
                            {w.estimatedVolumeM3.toFixed(2)} m³ ({w.estimatedMassTonnes.toFixed(1)} t)
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            <span
                              className={
                                w.factorOfSafetyDry < 1.3
                                  ? 'text-rose-400 font-bold'
                                  : w.factorOfSafetyDry < 1.8
                                  ? 'text-amber-300 font-semibold'
                                  : 'text-emerald-400'
                              }
                            >
                              {w.factorOfSafetyDry.toFixed(2)}
                            </span>
                            <span className="text-slate-500"> / </span>
                            <span
                              className={
                                w.factorOfSafetyWater < 1.2
                                  ? 'text-rose-400 font-bold'
                                  : 'text-slate-300'
                              }
                            >
                              {w.factorOfSafetyWater.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {w.riskLevel === 'CRITICAL' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertTriangle className="w-3 h-3" /> CRITICAL
                              </span>
                            ) : w.riskLevel === 'MODERATE' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <AlertTriangle className="w-3 h-3" /> MODERATE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                <CheckCircle2 className="w-3 h-3" /> STABLE
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-cyan-200">
                            L = {w.recommendedBoltLengthM.toFixed(1)}m @ {w.recommendedBoltSpacingM.toFixed(1)}m c/c
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'jrc' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 border border-slate-800 rounded p-3 text-xs text-slate-300">
                <span className="font-semibold text-white">Tse & Cruden (1979) Z₂ + Barton-Bandis (1982) Scale-Corrected Roughness:</span>{' '}
                Computes the root-mean-square first derivative <span className="font-mono text-cyan-300">Z₂ = √[ (1/L) ∫ (dy/dx)² dx ]</span> along every multi-vertex photogrammetric trace, converts to Lab <span className="font-mono text-cyan-300">JRC₀ = 32.2 + 32.47 log₁₀(Z₂)</span>, and applies field scale correction <span className="font-mono text-amber-300">JRCₙ = JRC₀ (Lₙ/L₀)^(-0.02 JRC₀)</span> and Terzaghi angular blind-zone weight <span className="font-mono text-emerald-300">W_T = 1 / sin(α)</span>.
              </div>

              {joints.length === 0 ? (
                <div className="text-center py-12 bg-slate-950/40 border border-slate-800 rounded text-slate-400 text-sm">
                  No geological discontinuities mapped yet. Run AI + CV Hybrid Trace or draw joints on the photograph.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-300 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                        <th className="py-2.5 px-3">Joint ID</th>
                        <th className="py-2.5 px-3">Surface / Set</th>
                        <th className="py-2.5 px-3 font-mono">Dip / Dip Dir</th>
                        <th className="py-2.5 px-3 font-mono">Length Lₙ</th>
                        <th className="py-2.5 px-3 font-mono">Z₂ (RMS Slope)</th>
                        <th className="py-2.5 px-3 font-mono">Rp Index</th>
                        <th className="py-2.5 px-3 font-mono">JRC₀ → Field JRCₙ</th>
                        <th className="py-2.5 px-3 font-mono">Peak φ_p (JCS)</th>
                        <th className="py-2.5 px-3 font-mono">Terzaghi W_T</th>
                        <th className="py-2.5 px-3">ISRM Roughness Class</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {summary.jrcProfiles.map((prof, idx) => {
                        const j = joints.find((jt) => jt.id === prof.jointId) || joints[idx];
                        if (!j) return null;
                        const wT = j.terzaghiWeight ?? 1.25;
                        return (
                          <tr
                            key={prof.jointId}
                            onClick={() => onSelectJoint && onSelectJoint(j.id, j.surface)}
                            className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-3 font-mono font-bold text-cyan-300">
                              {j.jointNumber || `J-${idx + 1}`}
                            </td>
                            <td className="py-2 px-3">
                              <span className="uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 mr-1.5">
                                {j.surface}
                              </span>
                              <span className="font-mono font-bold text-amber-300">{prof.set}</span>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-200">
                              {String(Math.round(j.dip)).padStart(2, '0')}° / {String(Math.round(j.dipDirection)).padStart(3, '0')}°
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-200">
                              {j.persistenceMeters.toFixed(2)} m
                            </td>
                            <td className="py-2 px-3 font-mono text-cyan-300">
                              {prof.z2RmsDerivative.toFixed(4)}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-300">
                              {prof.rpRoughnessIndex.toFixed(4)}
                            </td>
                            <td className="py-2 px-3 font-mono">
                              <span className="text-slate-400">{prof.jrc0LabScale.toFixed(1)}</span>
                              <span className="text-slate-500"> → </span>
                              <span className="font-bold text-emerald-300">{prof.jrcNFieldScale.toFixed(1)}</span>
                            </td>
                            <td className="py-2 px-3 font-mono text-amber-300">
                              {prof.peakFrictionAngleDeg.toFixed(1)}° ({prof.jcsMPa} MPa)
                            </td>
                            <td className="py-2 px-3 font-mono text-indigo-300">
                              {wT.toFixed(2)}×
                            </td>
                            <td className="py-2 px-3 text-[11px] text-slate-300">
                              {prof.isrmRoughnessClass}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pointcloud' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Isometric 3D Point Cloud Canvas Preview */}
              <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                    3D Isometric Tunnel Point Cloud & Fracture Normal Vectors ({pointCloud.length.toLocaleString()} pts)
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Drive: N {Math.round(settings.driveDirection)}° E · Span {geometry.width.toFixed(2)}m × {geometry.height.toFixed(2)}m
                  </span>
                </div>

                <div className="flex-1 min-h-[300px] flex items-center justify-center bg-slate-900/60 rounded border border-slate-800/80 overflow-hidden">
                  <svg viewBox="-220 -170 440 340" className="w-full h-[310px]">
                    {/* Coordinate axes */}
                    <g stroke="#334155" strokeWidth="1" strokeDasharray="3 3">
                      <line x1="-180" y1="110" x2="180" y2="110" />
                      <line x1="0" y1="-140" x2="0" y2="140" />
                    </g>
                    {/* Render sampled 3D point cloud in oblique isometric projection */}
                    {pointCloud.slice(0, 1200).map((pt, i) => {
                      const scale = 24 / Math.max(1, geometry.width / 6);
                      const isoX = (pt.x - pt.z * 0.48) * scale;
                      const isoY = (-pt.y + (geometry.height * 0.45) - pt.z * 0.28) * scale;
                      const isJointPt = Boolean(pt.jointId);
                      return (
                        <g key={i}>
                          <circle
                            cx={isoX}
                            cy={isoY}
                            r={isJointPt ? 2.3 : 1.1}
                            fill={`rgb(${pt.r}, ${pt.g}, ${pt.b})`}
                            fillOpacity={isJointPt ? 0.95 : 0.38}
                          />
                          {isJointPt && i % 3 === 0 && (
                            <line
                              x1={isoX}
                              y1={isoY}
                              x2={isoX + pt.nx * 9}
                              y2={isoY - pt.ny * 9}
                              stroke={`rgb(${pt.r}, ${pt.g}, ${pt.b})`}
                              strokeWidth="0.9"
                              strokeOpacity="0.8"
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Photogrammetry Export & Pipeline Specifications */}
              <div className="bg-slate-950 border border-slate-800 rounded p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Photogrammetric Structure-from-Motion (SfM) Compatibility
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Every traced discontinuity is reconstructed in 3D tunnel coordinates{' '}
                    <span className="font-mono text-cyan-300">(East, North, Up)</span> with local relief depth{' '}
                    <span className="font-mono text-cyan-300">ΔZ</span> and outward rock normal vectors{' '}
                    <span className="font-mono text-cyan-300">(nx, ny, nz)</span>.
                  </p>
                  <div className="space-y-2 text-[11px] text-slate-300 bg-slate-900/90 p-3 rounded border border-slate-800">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sub-Pixel Ridge Tracker:</span>
                      <span className="font-mono text-emerald-300">Steger 2nd-Order Taylor</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Illumination Invariance:</span>
                      <span className="font-mono text-cyan-300">Log-Gabor Phase Congruency</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">3D Plane Orientation Solver:</span>
                      <span className="font-mono text-amber-300">Huber IRLS + SVD Eigenvector</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sampling Bias Correction:</span>
                      <span className="font-mono text-indigo-300">Terzaghi + Mauldon MLE</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <button
                    onClick={handleDownloadPLY}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Stanford .PLY 3D Point Cloud</span>
                  </button>
                  <button
                    onClick={handleDownloadCSV}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded text-xs font-bold bg-emerald-600/90 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Download Rocscience DIPS / UnWedge .CSV</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
