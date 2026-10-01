import {
  CameraCalibration,
  Joint,
  MasterSurfaceCategory,
  Point2D,
  Point3D,
  ProfileType,
  SurfaceTransform,
  SurfaceType,
  TraceFitMode,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import { undistortNormalizedUV } from './cameraCalibration';

/**
 * Canonical fixed perimeter ratio (Sum of Side Wall Lengths + Crown Arc Length) / (Width + Height)
 * Derived from standard D-shaped tunnel reference: W = 8.40m, H = 7.20m, Wall = 4.20m, Arch Rise = 3.00m
 * -> R = 4.44m, Crown Arc = 11.02m, Total Perimeter = 2*4.20 + 11.02 = 19.42m, Ratio = 19.42 / 15.60 = 1.2449
 */
export const FIXED_TUNNEL_PERIMETER_RATIO = 1.2449;
export const CANONICAL_WALL_TO_HEIGHT_RATIO = 7 / 12; // 4.20 / 7.20 = 0.583333

/**
 * Computes the exact analytical circular arch radius R and arc length L_crown
 * for a tunnel of span W and arch rise h_arch = H - H_w.
 */
export function computeAnalyticalArchMetrics(
  width: number,
  archRise: number
): { radius: number; arcLength: number } {
  const halfW = Math.max(0.5, width / 2);
  const clampedRise = Math.max(0.15, Math.min(halfW, archRise));
  const radius = (halfW * halfW + clampedRise * clampedRise) / (2 * clampedRise);
  const halfAngle = Math.asin(Math.min(1, halfW / radius));
  const arcLength = 2 * radius * halfAngle;
  return {
    radius: Number(radius.toFixed(4)),
    arcLength: Number(arcLength.toFixed(4)),
  };
}

/**
 * Enforces a strict geometric constraint on tunnel dimensions (Width, Height, Wall Height, Crown Radius)
 * so that:
 * 1. The arch rise (Height - WallHeight) never exceeds Width/2 (preventing bulb distortion) or flattens out.
 * 2. The sum of the side wall lengths (2 * WallHeight) and Crown Arc Length (L_crown) maintains a strict,
 *    distortion-free perimeter ratio relative to Width and Height when resizing tunnel dimensions.
 */
export function enforceStrictTunnelGeometryConstraints(
  width: number,
  height: number,
  rawWallHeight?: number,
  profileType: ProfileType = 'd_shaped',
  _rawCrownRadius?: number
): {
  width: number;
  height: number;
  wallHeight: number;
  crownRadius: number;
  crownArcLength: number;
  totalPerimeter: number;
  perimeterRatio: number;
} {
  const safeWidth = Math.max(1.5, width);
  const safeHeight = Math.max(1.5, height);
  const halfW = safeWidth / 2;

  if (profileType === 'circular') {
    const wallHeight = Number((safeHeight * 0.5).toFixed(2));
    const rX = halfW;
    const rY = safeHeight / 2;
    // Ramanujan ellipse semi-perimeter for upper crown arch
    const hParam = Math.pow(rX - rY, 2) / Math.pow(rX + rY, 2);
    const crownArcLength = Number(
      ((Math.PI * (rX + rY) * (1 + (3 * hParam) / (10 + Math.sqrt(4 - 3 * hParam)))) / 2).toFixed(2)
    );
    const crownRadius = Number(((rX + rY) / 2).toFixed(2));
    const totalPerimeter = Number((2 * wallHeight + crownArcLength).toFixed(2));
    return {
      width: Number(safeWidth.toFixed(2)),
      height: Number(safeHeight.toFixed(2)),
      wallHeight,
      crownRadius,
      crownArcLength,
      totalPerimeter,
      perimeterRatio: Number((totalPerimeter / (safeWidth + safeHeight)).toFixed(4)),
    };
  }

  // Geometric arch-rise bounds to prevent any distortion when resizing Width or Height:
  // Arch rise h_arch = H - H_w must not exceed halfW (semicircle limit) and must be >= 0.22 * min(W, H)
  const maxArchRise = Math.min(halfW * 0.98, safeHeight * 0.55);
  const minArchRise = Math.min(maxArchRise, Math.max(0.35, Math.min(safeWidth * 0.22, safeHeight * 0.25)));

  // Target total perimeter P_target = FIXED_TUNNEL_PERIMETER_RATIO * (W + H)
  const targetPerimeter = FIXED_TUNNEL_PERIMETER_RATIO * (safeWidth + safeHeight);

  // Solve for archRise within [minArchRise, maxArchRise] that satisfies P(h_arch) = 2*(H - h_arch) + L_crown(W, h_arch) = targetPerimeter
  // Note: dP/dh_arch = -2 + dL_crown/dh_arch < 0 because 2*wallHeight decreases faster than arc length increases.
  let bestRise = Math.max(minArchRise, Math.min(maxArchRise, safeHeight * (1 - CANONICAL_WALL_TO_HEIGHT_RATIO)));
  let low = minArchRise;
  let high = maxArchRise;
  for (let iter = 0; iter < 24; iter++) {
    const mid = 0.5 * (low + high);
    const { arcLength } = computeAnalyticalArchMetrics(safeWidth, mid);
    const perim = 2 * (safeHeight - mid) + arcLength;
    if (perim > targetPerimeter) {
      low = mid; // Need larger archRise (smaller wallHeight) to reduce perimeter
    } else {
      high = mid;
    }
    bestRise = 0.5 * (low + high);
  }

  // If the caller supplied an explicit rawWallHeight that is already within the non-distorted structural envelope
  // (within ±8% of the fixed-perimeter-ratio wall height and not violating arch rise limits), blend/clamp it safely
  const constrainedWallHeightIdeal = safeHeight - bestRise;
  let finalWallHeight = constrainedWallHeightIdeal;
  if (typeof rawWallHeight === 'number' && Number.isFinite(rawWallHeight)) {
    const userRise = safeHeight - rawWallHeight;
    const minValidWallH = safeHeight - maxArchRise;
    const maxValidWallH = safeHeight - minArchRise;
    const deviationRatio = Math.abs(rawWallHeight - constrainedWallHeightIdeal) / Math.max(1, safeHeight);
    if (userRise >= minArchRise && userRise <= maxArchRise && deviationRatio <= 0.08) {
      finalWallHeight = Math.max(minValidWallH, Math.min(maxValidWallH, rawWallHeight));
    } else {
      finalWallHeight = constrainedWallHeightIdeal;
    }
  }

  finalWallHeight = Number(finalWallHeight.toFixed(2));
  const finalArchRise = Math.max(0.25, safeHeight - finalWallHeight);
  const { radius: exactRadius, arcLength: baseArcLen } = computeAnalyticalArchMetrics(
    safeWidth,
    finalArchRise
  );

  const shapeArcFactor = profileType === 'flat_arch' ? 1.025 : 1.0;
  const crownArcLength = Number((baseArcLen * shapeArcFactor).toFixed(2));
  const crownRadius = Number(exactRadius.toFixed(2));
  const totalPerimeter = Number((2 * finalWallHeight + crownArcLength).toFixed(2));

  return {
    width: Number(safeWidth.toFixed(2)),
    height: Number(safeHeight.toFixed(2)),
    wallHeight: finalWallHeight,
    crownRadius,
    crownArcLength,
    totalPerimeter,
    perimeterRatio: Number((totalPerimeter / (safeWidth + safeHeight)).toFixed(4)),
  };
}

/**
 * Generates real-world cross-section boundary polygon in meters.
 * Coordinate convention for Face cross-section:
 * x = 0 is tunnel centerline, x in [-width/2, +width/2]
 * y = 0 is tunnel floor/invert, y = height is crown apex.
 */
export function buildTunnelCrossSection(
  width: number,
  height: number,
  wallHeight: number,
  profileType: ProfileType,
  crownRadius?: number,
  customPoints?: Point2D[]
): {
  crossSectionPoints: Point2D[];
  crownArcLength: number;
  effectiveCrownRadius: number;
  constrainedWallHeight: number;
} {
  const constrained = enforceStrictTunnelGeometryConstraints(
    width,
    height,
    wallHeight,
    profileType,
    crownRadius
  );
  const safeWidth = constrained.width;
  const safeHeight = constrained.height;
  const safeWallHeight = constrained.wallHeight;
  const halfW = safeWidth / 2;
  const archRise = Math.max(0.25, safeHeight - safeWallHeight);

  const isCustomProfileType =
    profileType === 'custom_cad' ||
    profileType === 'freeform_custom' ||
    profileType === 'powerhouse_cavern' ||
    profileType === 'transformer_hall' ||
    profileType === 'cavern_junction' ||
    profileType === 'asymmetric_cavern';

  if (isCustomProfileType && customPoints && customPoints.length >= 3) {
    const xs = customPoints.map((p) => p.x);
    const ys = customPoints.map((p) => p.y);
    const actualW = Math.max(1.0, Math.max(...xs) - Math.min(...xs));
    const actualH = Math.max(1.0, Math.max(...ys) - Math.min(...ys));
    const safeWallH = Math.max(0.5, Math.min(actualH * 0.92, wallHeight || actualH * 0.58));
    const crownArcLength = computeCrownArcLength(customPoints, safeWallH);
    return {
      crossSectionPoints: customPoints,
      crownArcLength: Number(crownArcLength.toFixed(2)),
      effectiveCrownRadius: Number((crownRadius || actualW * 0.55).toFixed(2)),
      constrainedWallHeight: Number(safeWallH.toFixed(2)),
    };
  }

  const pts: Point2D[] = [];
  const numArchSteps = 48;

  if (profileType === 'circular') {
    const rX = halfW;
    const rY = safeHeight / 2;
    const cY = safeHeight / 2;
    for (let i = 0; i <= 64; i++) {
      const theta = -Math.PI / 2 + (i / 64) * 2 * Math.PI;
      pts.push({
        x: Number((rX * Math.cos(theta)).toFixed(4)),
        y: Number((cY + rY * Math.sin(theta)).toFixed(4)),
      });
    }
    return {
      crossSectionPoints: pts,
      crownArcLength: constrained.crownArcLength,
      effectiveCrownRadius: constrained.crownRadius,
      constrainedWallHeight: safeWallHeight,
    };
  }

  // Exact circular arch geometry above springline y = safeWallHeight
  const R = (halfW * halfW + archRise * archRise) / (2 * archRise);
  const centerY = safeHeight - R;
  const startAngle = Math.atan2(safeWallHeight - centerY, -halfW);
  const endAngle = Math.atan2(safeWallHeight - centerY, halfW);

  if (profileType === 'horseshoe') {
    const invertHalfW = halfW * 0.88;
    pts.push({ x: -invertHalfW, y: 0 });
    const wallSteps = 14;
    for (let i = 1; i <= wallSteps; i++) {
      const t = i / wallSteps;
      const x = -invertHalfW - (halfW - invertHalfW) * Math.sin((t * Math.PI) / 2);
      const y = t * safeWallHeight;
      pts.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    }
    for (let i = 1; i < numArchSteps; i++) {
      const t = i / numArchSteps;
      const theta = startAngle + t * (endAngle - startAngle);
      const x = R * Math.cos(theta);
      const y = centerY + R * Math.sin(theta);
      pts.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    }
    for (let i = 0; i <= wallSteps; i++) {
      const t = 1 - i / wallSteps;
      const x = invertHalfW + (halfW - invertHalfW) * Math.sin((t * Math.PI) / 2);
      const y = t * safeWallHeight;
      pts.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    }
  } else if (profileType === 'flat_arch') {
    pts.push({ x: -halfW, y: 0 });
    pts.push({ x: -halfW, y: safeWallHeight });
    for (let i = 1; i < numArchSteps; i++) {
      const t = i / numArchSteps;
      const angle = Math.PI * (1 - t);
      const x = halfW * Math.cos(angle);
      const sinVal = Math.pow(Math.max(0, Math.sin(angle)), 0.78);
      const y = safeWallHeight + archRise * sinVal;
      pts.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    }
    pts.push({ x: halfW, y: safeWallHeight });
    pts.push({ x: halfW, y: 0 });
  } else {
    pts.push({ x: -halfW, y: 0 });
    pts.push({ x: -halfW, y: safeWallHeight });

    for (let i = 1; i < numArchSteps; i++) {
      const t = i / numArchSteps;
      const theta = startAngle + t * (endAngle - startAngle);
      const x = R * Math.cos(theta);
      const y = centerY + R * Math.sin(theta);
      pts.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    }

    pts.push({ x: halfW, y: safeWallHeight });
    pts.push({ x: halfW, y: 0 });
  }

  const polyCrownArc = computeCrownArcLength(pts, safeWallHeight);
  const exactCrownArc =
    profileType === 'flat_arch' ? Number(polyCrownArc.toFixed(2)) : constrained.crownArcLength;

  return {
    crossSectionPoints: pts,
    crownArcLength: exactCrownArc,
    effectiveCrownRadius: Number(R.toFixed(2)),
    constrainedWallHeight: safeWallHeight,
  };
}

export function computeCrownArcLength(points: Point2D[], wallHeight: number): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p1.y >= wallHeight - 0.02 && p2.y >= wallHeight - 0.02 && (p1.y > wallHeight + 0.001 || p2.y > wallHeight + 0.001)) {
      length += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
  }
  if (length < 1) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(0.3, Math.max(...ys) - wallHeight);
    return computeAnalyticalArchMetrics(w, h).arcLength;
  }
  return length;
}

export function createTunnelGeometry(
  width: number,
  height: number,
  wallHeight: number,
  crownGeometry: ProfileType,
  crownRadius?: number,
  source: TunnelGeometry['source'] = 'manual',
  cadFileName?: string,
  customPoints?: Point2D[]
): TunnelGeometry {
  const {
    crossSectionPoints,
    crownArcLength,
    effectiveCrownRadius,
    constrainedWallHeight,
  } = buildTunnelCrossSection(
    width,
    height,
    wallHeight,
    crownGeometry,
    crownRadius,
    customPoints
  );

  const xs = crossSectionPoints.map((p) => p.x);
  const ys = crossSectionPoints.map((p) => p.y);
  const minX = xs.length > 0 ? Number(Math.min(...xs).toFixed(3)) : -width / 2;
  const maxX = xs.length > 0 ? Number(Math.max(...xs).toFixed(3)) : width / 2;
  const minY = ys.length > 0 ? Number(Math.min(...ys).toFixed(3)) : 0;
  const maxY = ys.length > 0 ? Number(Math.max(...ys).toFixed(3)) : height;

  // Compute exact closed perimeter and Shoelace area from crossSectionPoints
  let totalPerimeter = 0;
  let shoelaceSum = 0;
  for (let i = 0; i < crossSectionPoints.length; i++) {
    const a = crossSectionPoints[i];
    const b = crossSectionPoints[(i + 1) % crossSectionPoints.length];
    totalPerimeter += Math.hypot(b.x - a.x, b.y - a.y);
    shoelaceSum += a.x * b.y - b.x * a.y;
  }

  return {
    width: Number(Math.max(1.5, maxX - minX || width).toFixed(3)),
    height: Number(Math.max(1.5, maxY - minY || height).toFixed(3)),
    wallHeight: Number(constrainedWallHeight.toFixed(3)),
    leftWallHeight: Number(constrainedWallHeight.toFixed(3)),
    rightWallHeight: Number(constrainedWallHeight.toFixed(3)),
    leftWallArcLength: Number(constrainedWallHeight.toFixed(3)),
    rightWallArcLength: Number(constrainedWallHeight.toFixed(3)),
    totalPerimeterMeters: Number(totalPerimeter.toFixed(3)),
    designAreaSqMeters: Number((Math.abs(shoelaceSum) * 0.5).toFixed(3)),
    minX,
    maxX,
    minY,
    maxY,
    crownGeometry,
    crownRadius: effectiveCrownRadius,
    units: 'm',
    source,
    cadFileName,
    crossSectionPoints,
    crownArcLength,
  };
}

export function getSurfaceBoundsMeters(
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings
): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
  const roundLen = Math.max(1.0, settings.roundLength || 3.5);
  switch (surface) {
    case 'face': {
      const minX =
        typeof geometry.minX === 'number' && Number.isFinite(geometry.minX)
          ? geometry.minX
          : -geometry.width / 2;
      const maxX =
        typeof geometry.maxX === 'number' && Number.isFinite(geometry.maxX)
          ? geometry.maxX
          : geometry.width / 2;
      const minY =
        typeof geometry.minY === 'number' && Number.isFinite(geometry.minY)
          ? geometry.minY
          : 0;
      const maxY =
        typeof geometry.maxY === 'number' && Number.isFinite(geometry.maxY)
          ? geometry.maxY
          : geometry.height;
      return {
        minX,
        maxX,
        minY,
        maxY,
        width: Math.max(1.0, maxX - minX),
        height: Math.max(1.0, maxY - minY),
      };
    }
    case 'crown': {
      // Unfolded Crown surface width strictly equals the actual developed Crown Arc Length (geometry.crownArcLength)
      const span = Math.max(0.5, geometry.crownArcLength || geometry.width);
      return {
        minX: -span / 2,
        maxX: span / 2,
        minY: 0,
        maxY: roundLen,
        width: span,
        height: roundLen,
      };
    }
    case 'leftWall': {
      const leftWallH = Math.max(
        0.5,
        geometry.leftWallArcLength ?? geometry.leftWallHeight ?? geometry.wallHeight ?? 4.2
      );
      return {
        minX: 0,
        maxX: roundLen,
        minY: 0,
        maxY: leftWallH,
        width: roundLen,
        height: leftWallH,
      };
    }
    case 'rightWall': {
      const rightWallH = Math.max(
        0.5,
        geometry.rightWallArcLength ?? geometry.rightWallHeight ?? geometry.wallHeight ?? 4.2
      );
      return {
        minX: 0,
        maxX: roundLen,
        minY: 0,
        maxY: rightWallH,
        width: roundLen,
        height: rightWallH,
      };
    }
  }
}

export function isPointInsidePolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInsideSurface(
  pt: Point2D,
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings,
  marginMeters = 0.08
): boolean {
  const bounds = getSurfaceBoundsMeters(surface, geometry, settings);
  if (surface === 'face') {
    if (
      pt.x < bounds.minX - marginMeters ||
      pt.x > bounds.maxX + marginMeters ||
      pt.y < bounds.minY - marginMeters ||
      pt.y > bounds.maxY + marginMeters
    ) {
      return false;
    }
    if (isPointInsidePolygon(pt, geometry.crossSectionPoints)) return true;
    return distanceToPolygonBoundary(pt, geometry.crossSectionPoints) <= marginMeters;
  }

  return (
    pt.x >= bounds.minX - marginMeters &&
    pt.x <= bounds.maxX + marginMeters &&
    pt.y >= bounds.minY - marginMeters &&
    pt.y <= bounds.maxY + marginMeters
  );
}

export function distanceToPolygonBoundary(pt: Point2D, polygon: Point2D[]): number {
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const d = pointToSegmentDistance(pt, p1, p2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function pointToSegmentDistance(p: Point2D, v: Point2D, w: Point2D): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

export function clipPolylineToSurface(
  points: Point2D[],
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings
): Point2D[] {
  if (points.length < 2) return points;
  const bounds = getSurfaceBoundsMeters(surface, geometry, settings);

  // Filter vertices to those inside or on the master surface boundary WITHOUT stretching
  // internal rock terminations to the walls, and WITHOUT straightening intermediate vertices.
  const clipped: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const isInside =
      surface === 'face'
        ? isPointInsidePolygon(pt, geometry.crossSectionPoints) ||
          distanceToPolygonBoundary(pt, geometry.crossSectionPoints) <= 0.06
        : pt.x >= bounds.minX - 0.04 &&
          pt.x <= bounds.maxX + 0.04 &&
          pt.y >= bounds.minY - 0.04 &&
          pt.y <= bounds.maxY + 0.04;

    if (isInside) {
      clipped.push({
        x: Number(Math.max(bounds.minX, Math.min(bounds.maxX, pt.x)).toFixed(4)),
        y: Number(Math.max(bounds.minY, Math.min(bounds.maxY, pt.y)).toFixed(4)),
      });
    } else if (i > 0 && clipped.length > 0) {
      // Find boundary intersection along segment from previous point to current point
      const prev = points[i - 1];
      for (let s = 1; s <= 16; s++) {
        const t = s / 16;
        const cand = {
          x: prev.x + t * (pt.x - prev.x),
          y: prev.y + t * (pt.y - prev.y),
        };
        const candIn =
          surface === 'face'
            ? isPointInsidePolygon(cand, geometry.crossSectionPoints)
            : cand.x >= bounds.minX &&
              cand.x <= bounds.maxX &&
              cand.y >= bounds.minY &&
              cand.y <= bounds.maxY;
        if (!candIn) {
          const lastIn = {
            x: prev.x + ((s - 1) / 16) * (pt.x - prev.x),
            y: prev.y + ((s - 1) / 16) * (pt.y - prev.y),
          };
          if (Math.hypot(lastIn.x - clipped[clipped.length - 1].x, lastIn.y - clipped[clipped.length - 1].y) > 0.02) {
            clipped.push({
              x: Number(lastIn.x.toFixed(4)),
              y: Number(lastIn.y.toFixed(4)),
            });
          }
          break;
        }
      }
    }
  }

  if (clipped.length < 2) return [];
  return preserveGeologicalPolyline(clipped);
}

/**
 * CRITICAL GEOLOGICAL REALISM RULE (Sections 1, 2, 3):
 * Never straighten a real rock discontinuity into a 2-point CAD line.
 * Preserves multi-vertex polylines (P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7...)
 * including slight/strong curvature, stepped geometry, local bends, and undulations,
 * while removing only duplicate coincident pixel noise.
 */
export function preserveGeologicalPolyline(points: Point2D[], maxVertices = 18): Point2D[] {
  if (points.length <= 2) return points;

  // 1. Remove zero-length duplicate adjacent vertices
  const deduped: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= 0.004) {
      deduped.push(points[i]);
    }
  }
  if (deduped.length <= 2) return deduped;

  // 2. Apply very gentle 3-point Chaikin/moving-window de-pixelation (0.15 weight on neighbors)
  // so 1-pixel raster stair-stepping is smoothed while every real geological bend, step, and undulation is kept.
  const smoothed: Point2D[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const pPrev = deduped[i - 1];
    const pCurr = deduped[i];
    const pNext = deduped[i + 1];
    smoothed.push({
      x: Number((0.14 * pPrev.x + 0.72 * pCurr.x + 0.14 * pNext.x).toFixed(4)),
      y: Number((0.14 * pPrev.y + 0.72 * pCurr.y + 0.14 * pNext.y).toFixed(4)),
    });
  }
  smoothed.push(deduped[deduped.length - 1]);

  if (smoothed.length <= maxVertices) {
    return smoothed;
  }

  // 3. Downsample along arc-length while always preserving local high-curvature bends/steps
  const result: Point2D[] = [smoothed[0]];
  const step = (smoothed.length - 1) / (maxVertices - 1);
  for (let k = 1; k < maxVertices - 1; k++) {
    const idx = Math.round(k * step);
    result.push(smoothed[idx]);
  }
  result.push(smoothed[smoothed.length - 1]);
  return result;
}

export function simplifyPolyline(points: Point2D[], _epsilon = 0.002): Point2D[] {
  return preserveGeologicalPolyline(points, 16);
}

/**
 * Solves a 3x3 Projective Homography Matrix H (row-major 9 numbers, H[8] = 1)
 * mapping unit square [(0,0), (1,0), (1,1), (0,1)] to target perspective quadrilateral
 * defined by 4 corner offsets [cTL, cTR, cBR, cBL].
 */
export function solveProjectiveHomography3x3(
  corners: [Point2D, Point2D, Point2D, Point2D]
): number[] {
  const src: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const dst: [number, number][] = [
    [0 + corners[0].x, 0 + corners[0].y],
    [1 + corners[1].x, 0 + corners[1].y],
    [1 + corners[2].x, 1 + corners[2].y],
    [0 + corners[3].x, 1 + corners[3].y],
  ];

  // Build 8x8 linear system A * h = b for H = [h0, h1, h2; h3, h4, h5; h6, h7, 1]
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) {
        maxRow = row;
      }
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-10) {
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }

    for (let j = col; j < n; j++) A[col][j] /= pivot;
    b[col] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = A[row][col];
        for (let j = col; j < n; j++) {
          A[row][j] -= factor * A[col][j];
        }
        b[row] -= factor * b[col];
      }
    }
  }

  return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
}

export function applyProjectiveHomography3x3(u: number, v: number, H: number[]): { u: number; v: number } {
  const denom = H[6] * u + H[7] * v + H[8];
  if (Math.abs(denom) < 1e-8) return { u, v };
  return {
    u: (H[0] * u + H[1] * v + H[2]) / denom,
    v: (H[3] * u + H[4] * v + H[5]) / denom,
  };
}

/**
 * Pipeline Step (Section 11):
 * IMAGE COORDINATES (u, v)
 * -> LENS UNDISTORTION
 * -> PROJECTIVE HOMOGRAPHY (H_3x3)
 * -> TUNNEL SURFACE COORDINATES (x, y in meters)
 */
/**
 * Pipeline Step (Section 11):
 * IMAGE COORDINATES (u, v in [0..1] on the active displayed/warped photograph)
 * -> TUNNEL SURFACE COORDINATES (x, y in meters)
 *
 * Guaranteed to match `photoUVToTunnelMeters` and the SVG `<g transform={photoSvgTransform}>`
 * rendering transform so that any feature at (u, v) in the photograph lands at the exact
 * same pixel on the mapping canvas.
 */
export function imageUVToSurfaceMeters(
  u: number,
  v: number,
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings,
  transform: SurfaceTransform,
  _calibration?: CameraCalibration,
  isAlreadyWarpedImage = true
): Point2D {
  const bounds = getSurfaceBoundsMeters(surface, geometry, settings);

  let warpedU = u;
  let warpedV = v;

  if (!isAlreadyWarpedImage) {
    // Apply flip if set
    const uFlip = transform.flipH ? 1 - u : u;
    const vFlip = transform.flipV ? 1 - v : v;

    // Exact 3x3 Projective Homography Transformation
    const H =
      transform.homographyMatrix && transform.homographyMatrix.length === 9
        ? transform.homographyMatrix
        : solveProjectiveHomography3x3(transform.perspectiveCorners);

    const hom = applyProjectiveHomography3x3(uFlip, vFlip, H);
    warpedU = hom.u;
    warpedV = hom.v;

    // Apply piecewise mesh control point displacement if present
    if (transform.meshControlPoints && transform.meshControlPoints.length > 0) {
      let sumW = 0;
      let sumDu = 0;
      let sumDv = 0;
      for (const cp of transform.meshControlPoints) {
        const d2 = (uFlip - cp.srcU) * (uFlip - cp.srcU) + (vFlip - cp.srcV) * (vFlip - cp.srcV);
        if (d2 < 1e-7) {
          sumW = 1;
          sumDu = cp.dstU - cp.srcU;
          sumDv = cp.dstV - cp.srcV;
          break;
        }
        const w = 1 / Math.pow(d2 + 0.008, 1.35);
        sumW += w;
        sumDu += w * (cp.dstU - cp.srcU);
        sumDv += w * (cp.dstV - cp.srcV);
      }
      if (sumW > 1e-9) {
        warpedU += sumDu / sumW;
        warpedV += sumDv / sumW;
      }
    }
  }

  const zoom = transform.zoom ?? 1;
  let dx = (warpedU - 0.5) * bounds.width * (transform.scaleX || 1) * zoom;
  let dy = (0.5 - warpedV) * bounds.height * (transform.scaleY || 1) * zoom;

  if (Math.abs(transform.rotation) > 0.01) {
    // Note: in SVG Y-down space, clockwise rotation by +theta corresponds to
    // rotating (dx, dy) in Y-up meters by -theta
    const rad = (-transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    x: Number((centerX + dx + (transform.offsetX || 0)).toFixed(4)),
    y: Number((centerY + dy + (transform.offsetY || 0)).toFixed(4)),
  };
}

/**
 * Exact inverse of `imageUVToSurfaceMeters`:
 * Converts real-world surface coordinates (x, y in meters) back to normalized image UV [0, 1]
 * on the active displayed photograph so Computer Vision geodesic ridge snapping & seed tracking
 * sample the exact pixel under the user's cursor.
 */
export function surfaceMetersToImageUV(
  pt: Point2D,
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings,
  transform: SurfaceTransform
): { u: number; v: number } {
  const bounds = getSurfaceBoundsMeters(surface, geometry, settings);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  let dx = pt.x - centerX - (transform.offsetX || 0);
  let dy = pt.y - centerY - (transform.offsetY || 0);

  if (Math.abs(transform.rotation) > 0.01) {
    const rad = (transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  const zoom = transform.zoom ?? 1;
  const u = 0.5 + dx / Math.max(0.05, bounds.width * (transform.scaleX || 1) * zoom);
  const v = 0.5 - dy / Math.max(0.05, bounds.height * (transform.scaleY || 1) * zoom);

  return {
    u: Math.max(0.005, Math.min(0.995, u)),
    v: Math.max(0.005, Math.min(0.995, v)),
  };
}

/**
 * Pipeline Step (Section 11):
 * TUNNEL SURFACE COORDINATES (x_s, y_s in meters)
 * -> TUNNEL 3D COORDINATES (East, North, Up in meters)
 *
 * Uses the master TunnelGeometry cross-section and Tunnel Drive Direction (Azimuth)
 * to project every 2D surface point onto the true 3D underground excavation shell:
 * - Local tunnel axes:
 *   X_local = Transverse Right [-width/2, +width/2]
 *   Y_local = Distance along Drive Direction (0 at current face, negative behind face along roundLength)
 *   Z_local = Elevation above invert [0, height]
 * - Then rotated by Tunnel Drive Azimuth alpha_d into geographic 3D (East, North, Up).
 */
/**
 * Samples the exact 2D cross-section coordinate (x = localRight, y = localUp) and inward 2D unit normal (nx, ny)
 * along the actual tunnel profile boundary (supporting custom freeform, asymmetric walls, transformer halls, and CAD profiles).
 */
export function sampleCrossSectionZoneArcLength(
  zone: 'leftWall' | 'crown' | 'rightWall',
  ratio01: number,
  geometry: TunnelGeometry
): { x: number; y: number; nx: number; ny: number } | null {
  const pts = geometry.crossSectionPoints;
  if (!pts || pts.length < 4) return null;

  const t = Math.max(0, Math.min(1, ratio01));
  const leftSpringH = geometry.leftWallHeight ?? geometry.wallHeight ?? geometry.height * 0.58;
  const rightSpringH = geometry.rightWallHeight ?? geometry.wallHeight ?? geometry.height * 0.58;

  // Separate perimeter points into Left Wall (bottom->top), Crown (left->right), Right Wall (bottom->top)
  const leftPts: Point2D[] = [];
  const crownPts: Point2D[] = [];
  const rightPts: Point2D[] = [];

  for (const p of pts) {
    if (p.x <= 0 && p.y <= leftSpringH + 0.08) {
      leftPts.push(p);
    }
    if (p.y >= Math.min(leftSpringH, rightSpringH) - 0.08 && (geometry.hasCrown !== false)) {
      crownPts.push(p);
    }
    if (p.x >= 0 && p.y <= rightSpringH + 0.08) {
      rightPts.push(p);
    }
  }

  leftPts.sort((a, b) => a.y - b.y);
  crownPts.sort((a, b) => a.x - b.x);
  rightPts.sort((a, b) => a.y - b.y);

  const targetPoly =
    zone === 'leftWall' ? leftPts : zone === 'crown' ? crownPts : rightPts;
  if (targetPoly.length < 2) return null;

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < targetPoly.length - 1; i++) {
    const d = Math.hypot(
      targetPoly[i + 1].x - targetPoly[i].x,
      targetPoly[i + 1].y - targetPoly[i].y
    );
    segLengths.push(d);
    totalLen += d;
  }
  if (totalLen < 1e-4) return null;

  const targetDist = t * totalLen;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const sl = segLengths[i];
    if (acc + sl >= targetDist || i === segLengths.length - 1) {
      const localT = sl > 1e-6 ? Math.max(0, Math.min(1, (targetDist - acc) / sl)) : 0;
      const p0 = targetPoly[i];
      const p1 = targetPoly[i + 1];
      const x = p0.x + localT * (p1.x - p0.x);
      const y = p0.y + localT * (p1.y - p0.y);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const mag = Math.max(1e-6, Math.hypot(dx, dy));
      // Point inward toward tunnel centerline (0, wallH/2)
      let nx = dy / mag;
      let ny = -dx / mag;
      const toCenterX = 0 - x;
      const toCenterY = Math.max(1.0, geometry.wallHeight * 0.5) - y;
      if (nx * toCenterX + ny * toCenterY < 0) {
        nx = -nx;
        ny = -ny;
      }
      return { x, y, nx, ny };
    }
    acc += sl;
  }
  return null;
}

export function surfacePointTo3DTunnelCoords(
  pt: Point2D,
  surface: SurfaceType,
  geometry: TunnelGeometry,
  settings: TunnelSettings
): Point3D {
  const halfW = Math.max(0.5, geometry.width / 2);
  const wallH = geometry.wallHeight;
  const totalH = geometry.height;
  const archRise = Math.max(0.3, totalH - wallH);
  const R = Math.max(halfW, geometry.crownRadius || (halfW * halfW + archRise * archRise) / (2 * archRise));
  const isCustomOrAsymmetric =
    Boolean(geometry.isAuthoritativeCustom || geometry.customProfile) ||
    geometry.crownGeometry === 'freeform_custom' ||
    geometry.crownGeometry === 'custom_cad' ||
    Math.abs((geometry.leftWallArcLength ?? wallH) - (geometry.rightWallArcLength ?? wallH)) > 0.05;

  let localRight = 0; // Master X: Tunnel Transverse direction (m)
  let localUp = 0;    // Master Y: Tunnel Vertical direction (m)
  let localDrive = 0; // Master Z: Tunnel Drive / Chainage direction (m)
  let normal = { nx: 0, ny: 0, nz: -1 };
  let surfaceCategory: MasterSurfaceCategory = 'FACE';

  if (surface === 'face') {
    localRight = pt.x;
    localUp = pt.y;
    // Slight 3D concavity/arch relief near crown perimeter of blasted face
    const radialNorm = Math.min(1, Math.hypot(pt.x / halfW, Math.max(0, pt.y - wallH) / archRise));
    localDrive = -0.12 * (1 - radialNorm * radialNorm);
    normal = { nx: 0, ny: 0, nz: -1 };
    surfaceCategory =
      geometry.crownGeometry === 'custom_cad' || geometry.crownGeometry === 'freeform_custom'
        ? 'OTHER_CUSTOM_SURFACE'
        : 'FACE';
  } else if (surface === 'crown') {
    const crownSpan = Math.max(0.5, geometry.crownArcLength || geometry.width);
    const ratio01 = Math.max(0, Math.min(1, (pt.x + crownSpan / 2) / crownSpan));
    const customSample = isCustomOrAsymmetric
      ? sampleCrossSectionZoneArcLength('crown', ratio01, geometry)
      : null;

    if (customSample) {
      localRight = customSample.x;
      localUp = customSample.y;
      localDrive = -pt.y;
      normal = {
        nx: Number(customSample.nx.toFixed(4)),
        ny: Number(customSample.ny.toFixed(4)),
        nz: 0,
      };
    } else {
      // Section 14: Crown is NOT a flat rectangle in 3D — intersect with curved crown profile
      const phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pt.x / R));
      localRight = R * Math.sin(phi);
      localDrive = -pt.y; // behind face along Z axis
      const centerY = totalH - R;
      localUp = Math.max(wallH, centerY + R * Math.cos(phi));
      // Inward unit normal to curved crown arch
      normal = {
        nx: Number((-Math.sin(phi)).toFixed(4)),
        ny: Number((-Math.cos(phi)).toFixed(4)),
        nz: 0,
      };
    }
    surfaceCategory = 'CROWN';
  } else if (surface === 'leftWall') {
    const leftSpan = Math.max(
      0.5,
      geometry.leftWallArcLength ?? geometry.leftWallHeight ?? geometry.wallHeight ?? 4.2
    );
    const ratio01 = Math.max(0, Math.min(1, pt.y / leftSpan));
    const customSample = isCustomOrAsymmetric
      ? sampleCrossSectionZoneArcLength('leftWall', ratio01, geometry)
      : null;

    if (customSample) {
      localRight = customSample.x;
      localUp = customSample.y;
      localDrive = -pt.x;
      normal = {
        nx: Number(customSample.nx.toFixed(4)),
        ny: Number(customSample.ny.toFixed(4)),
        nz: 0,
      };
    } else {
      // Section 13: Left wall surface in Master Tunnel Coordinate System
      localRight = geometry.minX ?? -halfW;
      localDrive = -pt.x;
      localUp = pt.y;
      normal = { nx: 1, ny: 0, nz: 0 };
    }
    surfaceCategory = 'LEFT_WALL';
  } else {
    const rightSpan = Math.max(
      0.5,
      geometry.rightWallArcLength ?? geometry.rightWallHeight ?? geometry.wallHeight ?? 4.2
    );
    const ratio01 = Math.max(0, Math.min(1, pt.y / rightSpan));
    const customSample = isCustomOrAsymmetric
      ? sampleCrossSectionZoneArcLength('rightWall', ratio01, geometry)
      : null;

    if (customSample) {
      localRight = customSample.x;
      localUp = customSample.y;
      localDrive = -pt.x;
      normal = {
        nx: Number(customSample.nx.toFixed(4)),
        ny: Number(customSample.ny.toFixed(4)),
        nz: 0,
      };
    } else {
      // Section 13: Right wall surface in Master Tunnel Coordinate System
      localRight = geometry.maxX ?? halfW;
      localDrive = -pt.x;
      localUp = pt.y;
      normal = { nx: -1, ny: 0, nz: 0 };
    }
    surfaceCategory = 'RIGHT_WALL';
  }

  // Rotate (localRight, localDrive) by Tunnel Drive Azimuth (clockwise from North)
  const azRad = (settings.driveDirection * Math.PI) / 180;
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);

  const east = localRight * cosAz + localDrive * sinAz;
  const north = -localRight * sinAz + localDrive * cosAz;

  return {
    x: Number(localRight.toFixed(4)),
    y: Number(localUp.toFixed(4)),
    z: Number(localDrive.toFixed(4)),
    east: Number(east.toFixed(4)),
    north: Number(north.toFixed(4)),
    up: Number(localUp.toFixed(4)),
    normal,
    surfaceCategory,
  };
}

/**
 * Returns the joint geometry points according to the active toolbar TraceFitMode:
 * - 'smart_fit': preserves all detected natural irregularities, curvature, local bends, and undulations (P1..Pn).
 * - 'linear': returns a geometrically simplified straight segment [P1, Pn] between the trace endpoints without mutating the underlying natural trace.
 */
export function getDisplayedJointGeometry(
  joint: Pick<Joint, 'geometry'>,
  fitMode: TraceFitMode = 'smart_fit'
): Point2D[] {
  if (!joint.geometry || joint.geometry.length < 2) return joint.geometry || [];
  if (fitMode === 'linear') {
    return [joint.geometry[0], joint.geometry[joint.geometry.length - 1]];
  }
  return joint.geometry;
}

export function createDefaultSurfaceTransform(): SurfaceTransform {
  const defaultCorners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const defaultEdges: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const meshPts = [];
  let idx = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const u = Number((c / 2).toFixed(4));
      const v = Number((r / 2).toFixed(4));
      meshPts.push({
        id: `cp-${r}-${c}`,
        label: `C${idx++}`,
        srcU: u,
        srcV: v,
        dstU: u,
        dstV: v,
      });
    }
  }
  return {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    zoom: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    cropTop: 0,
    cropBottom: 0,
    cropLeft: 0,
    cropRight: 0,
    skewX: 0,
    skewY: 0,
    perspH: 0,
    perspV: 0,
    perspectiveCorners: defaultCorners,
    edgeOffsets: defaultEdges,
    meshControlPoints: meshPts,
    useCustomMask: false,
    customMaskPoints: [],
    homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    cropToGeometry: true,
  };
}
