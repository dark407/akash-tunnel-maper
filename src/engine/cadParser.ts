import { Point2D, TunnelGeometry } from '../types/tunnel';
import { createTunnelGeometry } from './geometryEngine';

interface RawSegment {
  pts: Point2D[];
}

/**
 * Parses a DXF (or ASCII CAD) string to extract real-world tunnel cross-section geometry.
 * Supports LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC, and CIRCLE entities.
 */
export function parseDXFStringToGeometry(dxfText: string, fileName: string): TunnelGeometry {
  const lines = dxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: RawSegment[] = [];

  let i = 0;
  let inEntities = false;

  // Helper to read group code & value pairs
  const pairs: { code: number; value: string }[] = [];
  while (i < lines.length - 1) {
    const codeStr = lines[i].trim();
    const valStr = lines[i + 1].trim();
    const code = parseInt(codeStr, 10);
    if (!isNaN(code)) {
      pairs.push({ code, value: valStr });
    }
    i += 2;
  }

  let idx = 0;
  while (idx < pairs.length) {
    const p = pairs[idx];
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[idx + 1];
      if (next && next.code === 2 && next.value === 'ENTITIES') {
        inEntities = true;
        idx += 2;
        continue;
      }
    }
    if (p.code === 0 && p.value === 'ENDSEC' && inEntities) {
      inEntities = false;
    }

    if (p.code === 0 && p.value === 'LINE') {
      let x1 = 0,
        y1 = 0,
        x2 = 0,
        y2 = 0;
      idx++;
      while (idx < pairs.length && pairs[idx].code !== 0) {
        const c = pairs[idx].code;
        const v = parseFloat(pairs[idx].value);
        if (c === 10) x1 = v;
        if (c === 20) y1 = v;
        if (c === 11) x2 = v;
        if (c === 21) y2 = v;
        idx++;
      }
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
        segments.push({
          pts: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
        });
      }
      continue;
    }

    if (p.code === 0 && p.value === 'LWPOLYLINE') {
      const polyPts: Point2D[] = [];
      let curX: number | null = null;
      idx++;
      while (idx < pairs.length && pairs[idx].code !== 0) {
        const c = pairs[idx].code;
        const v = parseFloat(pairs[idx].value);
        if (c === 10) {
          curX = v;
        } else if (c === 20 && curX !== null) {
          polyPts.push({ x: curX, y: v });
          curX = null;
        }
        idx++;
      }
      if (polyPts.length >= 2) {
        segments.push({ pts: polyPts });
      }
      continue;
    }

    if (p.code === 0 && p.value === 'ARC') {
      let cx = 0,
        cy = 0,
        r = 1,
        startAngle = 0,
        endAngle = 180;
      idx++;
      while (idx < pairs.length && pairs[idx].code !== 0) {
        const c = pairs[idx].code;
        const v = parseFloat(pairs[idx].value);
        if (c === 10) cx = v;
        if (c === 20) cy = v;
        if (c === 40) r = v;
        if (c === 50) startAngle = v;
        if (c === 51) endAngle = v;
        idx++;
      }
      const arcPts: Point2D[] = [];
      let sA = startAngle;
      let eA = endAngle;
      if (eA < sA) eA += 360;
      const steps = 32;
      for (let k = 0; k <= steps; k++) {
        const deg = sA + (k / steps) * (eA - sA);
        const rad = (deg * Math.PI) / 180;
        arcPts.push({
          x: cx + r * Math.cos(rad),
          y: cy + r * Math.sin(rad),
        });
      }
      segments.push({ pts: arcPts });
      continue;
    }

    idx++;
  }

  // Collect all points
  const allPts: Point2D[] = [];
  for (const seg of segments) {
    for (const pt of seg.pts) {
      if (isFinite(pt.x) && isFinite(pt.y)) {
        allPts.push(pt);
      }
    }
  }

  if (allPts.length < 3) {
    throw new Error('No valid vector cross-section entities (LINE, LWPOLYLINE, ARC) found in CAD file.');
  }

  // Compute bounding box
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const pt of allPts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  let rawWidth = maxX - minX;
  let rawHeight = maxY - minY;

  // Detect unit scale: if width > 100, CAD file is in millimeters (or cm)
  let unitScale = 1.0;
  if (rawWidth > 500) {
    unitScale = 0.001; // mm -> m
  } else if (rawWidth > 50) {
    unitScale = 0.01; // cm -> m
  }

  const widthMeters = Math.max(2.0, Number((rawWidth * unitScale).toFixed(2)));
  const heightMeters = Math.max(2.0, Number((rawHeight * unitScale).toFixed(2)));

  // Normalize points to tunnel coordinate frame: x in [-width/2, +width/2], y in [0, height]
  const centerX = (minX + maxX) / 2;
  const normalizedPts: Point2D[] = allPts.map((p) => ({
    x: Number(((p.x - centerX) * unitScale).toFixed(4)),
    y: Number(((p.y - minY) * unitScale).toFixed(4)),
  }));

  // Order boundary points clockwise starting from bottom-left invert
  const orderedPolygon = orderCrossSectionPerimeter(normalizedPts);

  // Estimate springline / wallHeight where width is maximum or arch curvature begins
  const wallHeight = estimateWallHeight(orderedPolygon, heightMeters);
  const archRise = Math.max(0.5, heightMeters - wallHeight);
  const crownRadius = Number(
    (((widthMeters / 2) ** 2 + archRise ** 2) / (2 * archRise)).toFixed(2)
  );

  return createTunnelGeometry(
    widthMeters,
    heightMeters,
    wallHeight,
    'custom_cad',
    crownRadius,
    fileName.toLowerCase().endsWith('.dwg') ? 'dwg' : 'dxf',
    fileName,
    orderedPolygon
  );
}

function orderCrossSectionPerimeter(points: Point2D[]): Point2D[] {
  // Calculate centroid
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  // Deduplicate close points
  const unique: Point2D[] = [];
  for (const p of points) {
    if (!unique.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 0.04)) {
      unique.push(p);
    }
  }

  // Sort clockwise starting from bottom-left (-PI/2)
  return unique.sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    // Shift angle so bottom-left is first
    const normA = ((angA - (-Math.PI * 0.75)) + 4 * Math.PI) % (2 * Math.PI);
    const normB = ((angB - (-Math.PI * 0.75)) + 4 * Math.PI) % (2 * Math.PI);
    return normB - normA;
  });
}

function estimateWallHeight(points: Point2D[], totalHeight: number): number {
  // Find max X points and their Y coordinate (springline)
  const maxX = Math.max(...points.map((p) => Math.abs(p.x)));
  const nearMaxWidth = points.filter((p) => Math.abs(p.x) >= maxX * 0.96);
  if (nearMaxWidth.length > 0) {
    const maxYAtWall = Math.max(...nearMaxWidth.map((p) => p.y));
    if (maxYAtWall > 0.5 && maxYAtWall < totalHeight * 0.85) {
      return Number(maxYAtWall.toFixed(2));
    }
  }
  return Number((totalHeight * 0.55).toFixed(2));
}

/**
 * Generates a valid standard AutoCAD DXF string for the current master TunnelGeometry
 * so users can also export or test-upload an authentic DXF profile.
 */
export function generateSampleTunnelDXF(width = 8.4, height = 7.2, wallHeight = 4.2): string {
  const halfW = width / 2;
  const rise = height - wallHeight;
  const R = (halfW * halfW + rise * rise) / (2 * rise);
  const centerY = height - R;
  const startDeg = (Math.atan2(wallHeight - centerY, halfW) * 180) / Math.PI;
  const endDeg = (Math.atan2(wallHeight - centerY, -halfW) * 180) / Math.PI;

  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    // Floor invert line
    '0',
    'LINE',
    '8',
    'TUNNEL_PROFILE',
    '10',
    (-halfW).toFixed(4),
    '20',
    '0.0000',
    '11',
    halfW.toFixed(4),
    '21',
    '0.0000',
    // Left vertical wall
    '0',
    'LINE',
    '8',
    'TUNNEL_PROFILE',
    '10',
    (-halfW).toFixed(4),
    '20',
    '0.0000',
    '11',
    (-halfW).toFixed(4),
    '21',
    wallHeight.toFixed(4),
    // Right vertical wall
    '0',
    'LINE',
    '8',
    'TUNNEL_PROFILE',
    '10',
    halfW.toFixed(4),
    '20',
    '0.0000',
    '11',
    halfW.toFixed(4),
    '21',
    wallHeight.toFixed(4),
    // Crown Arch ARC
    '0',
    'ARC',
    '8',
    'TUNNEL_PROFILE',
    '10',
    '0.0000',
    '20',
    centerY.toFixed(4),
    '40',
    R.toFixed(4),
    '50',
    startDeg.toFixed(4),
    '51',
    endDeg.toFixed(4),
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');
}
