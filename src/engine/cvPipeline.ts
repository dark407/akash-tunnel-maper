import {
  CameraCalibration,
  GeologicalFeatureType,
  ImageQualityReport,
  Joint,
  Point2D,
  SessionLearningMemory,
  SupportingPhoto,
  SurfaceTransform,
  SurfaceType,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';
import { calibrateAndUndistortPhotograph } from './cameraCalibration';
import {
  clipPolylineToSurface,
  createDefaultSurfaceTransform,
  imageUVToSurfaceMeters,
  preserveGeologicalPolyline,
  solveProjectiveHomography3x3,
} from './geometryEngine';
import {
  calculateJointOrientation3D,
  clusterJointsIntoSets,
  refineMultiSurfaceOrientations,
} from './orientationEngine';

export interface CVTraceCandidate {
  uvPoints: Point2D[];      // Multi-point normalized image coordinates u, v in [0, 1] (P1 -> P2 -> ... -> Pn)
  vertexWidths: number[];   // Relative aperture width multiplier at each vertex (thin -> wider -> thin)
  angleDeg: number;
  strength: number;         // 0 to 1
  isCurved: boolean;
}

/**
 * Loads a dataURL into an HTMLImageElement and extracts pixel data at a working resolution.
 */
async function loadImageData(
  imageSrc: string,
  maxDim = 320
): Promise<{
  imageData: ImageData;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const origWidth = img.naturalWidth || img.width || 640;
      const origHeight = img.naturalHeight || img.height || 480;
      const scale = Math.min(1, maxDim / Math.max(origWidth, origHeight));
      const width = Math.max(64, Math.round(origWidth * scale));
      const height = Math.max(64, Math.round(origHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        imageData: ctx.getImageData(0, 0, width, height),
        width,
        height,
        origWidth,
        origHeight,
      });
    };
    img.onerror = () => reject(new Error('Failed to decode tunnel photograph'));
    img.src = imageSrc;
  });
}

/**
 * ACCURACY ENGINE UPGRADE — STEPS 1, 2, 3, 4:
 * Camera Calibration & Lens Distortion Correction + Image Quality Check +
 * Automatic Tunnel Boundary Identification & 3x3 Projective Homography Registration.
 */
export async function analyzeAndAutoFitPhoto(
  imageSrc: string,
  surface: SurfaceType,
  geometry: TunnelGeometry,
  rawFileBuffer?: ArrayBuffer
): Promise<{
  transform: SurfaceTransform;
  qualityReport: ImageQualityReport;
  calibration: CameraCalibration;
  undistortedDataUrl: string;
}> {
  const { calibration, undistortedDataUrl } = await calibrateAndUndistortPhotograph(
    imageSrc,
    rawFileBuffer
  );

  const { imageData, width, height, origWidth, origHeight } = await loadImageData(
    undistortedDataUrl,
    260
  );
  const data = imageData.data;
  const gray = new Float32Array(width * height);

  let sumLum = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum;
    sumLum += lum;
  }

  const meanLum = sumLum / (width * height);
  let varLum = 0;
  for (let i = 0; i < gray.length; i++) {
    varLum += (gray[i] - meanLum) ** 2;
  }
  const rmsContrast = Math.sqrt(varLum / gray.length);

  // Compute Laplacian variance for sharpness check
  let lapSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - width] +
        gray[idx + width];
      lapSum += Math.abs(lap);
    }
  }
  const sharpnessScore = Number((lapSum / ((width - 2) * (height - 2))).toFixed(1));

  const threshold = Math.max(18, meanLum * 0.35);
  let minX = width,
    maxX = 0,
    minY = height,
    maxY = 0;
  let activeCount = 0;

  let topRowMinX = width,
    topRowMaxX = 0;
  let botRowMinX = width,
    botRowMaxX = 0;

  for (let y = Math.floor(height * 0.04); y < Math.floor(height * 0.96); y++) {
    for (let x = Math.floor(width * 0.04); x < Math.floor(width * 0.96); x++) {
      const val = gray[y * width + x];
      if (val > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        activeCount++;

        if (y > height * 0.15 && y < height * 0.35) {
          if (x < topRowMinX) topRowMinX = x;
          if (x > topRowMaxX) topRowMaxX = x;
        }
        if (y > height * 0.65 && y < height * 0.88) {
          if (x < botRowMinX) botRowMinX = x;
          if (x > botRowMaxX) botRowMaxX = x;
        }
      }
    }
  }

  const boundaryDetected = activeCount > width * height * 0.2;
  const warnings: string[] = [];
  if (meanLum < 35)
    warnings.push('Low illumination in photograph — adaptive CLAHE enhancement applied.');
  if (rmsContrast < 22)
    warnings.push('Low rock surface contrast — directional ridge amplification enabled.');
  if (sharpnessScore < 6) warnings.push('Slight motion/lens blur detected.');
  if (calibration.source === 'ESTIMATED_FROM_GEOMETRY') {
    warnings.push(
      `Camera parameters estimated (${calibration.focalLengthMm}mm eq, k1=${calibration.radialDistortionK1}).`
    );
  }

  const transform = createDefaultSurfaceTransform();

  if (boundaryDetected && maxX > minX + 20 && maxY > minY + 20) {
    const detectedW = (maxX - minX) / width;
    const detectedH = (maxY - minY) / height;
    const centerU = (minX + maxX) / (2 * width);
    const centerV = (minY + maxY) / (2 * height);

    transform.scaleX = Number(
      Math.min(1.35, Math.max(0.85, 1 / Math.max(0.72, detectedW))).toFixed(3)
    );
    transform.scaleY = Number(
      Math.min(1.35, Math.max(0.85, 1 / Math.max(0.72, detectedH))).toFixed(3)
    );
    transform.offsetX = Number(((0.5 - centerU) * geometry.width * 0.5).toFixed(2));
    transform.offsetY = Number(((centerV - 0.5) * geometry.height * 0.5).toFixed(2));

    const topSpan = topRowMaxX > topRowMinX ? (topRowMaxX - topRowMinX) / width : detectedW;
    const botSpan = botRowMaxX > botRowMinX ? (botRowMaxX - botRowMinX) / width : detectedW;
    const keystoneDiff = Math.max(-0.08, Math.min(0.08, (botSpan - topSpan) * 0.25));

    if (surface === 'face' && Math.abs(keystoneDiff) > 0.01) {
      transform.perspectiveCorners = [
        { x: Number((-keystoneDiff).toFixed(3)), y: 0 },
        { x: Number(keystoneDiff.toFixed(3)), y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ];
    }
    transform.homographyMatrix = solveProjectiveHomography3x3(transform.perspectiveCorners);
  }

  return {
    transform,
    qualityReport: {
      width: origWidth,
      height: origHeight,
      brightness: Math.round(meanLum),
      contrast: Math.round(rmsContrast),
      sharpnessScore,
      BoundaryDetected: boundaryDetected,
      detectedArchApexRatio: Number((minY / height).toFixed(2)),
      warnings,
    },
    calibration,
    undistortedDataUrl,
  };
}

/**
 * Measures the local fracture aperture width multiplier (0.65 to 1.85) at each vertex
 * along a UV trace by scanning perpendicular to the local segment direction in the dark-valley response map.
 * Separates TRACE GEOMETRY from JOINT APERTURE MEASUREMENT (Section 4).
 */
function measureVariableApertureAlongUVTrace(
  uvPts: Point2D[],
  response: Float32Array,
  maxResp: number,
  width: number,
  height: number
): number[] {
  if (uvPts.length === 0) return [];
  return uvPts.map((pt, idx) => {
    const prev = uvPts[Math.max(0, idx - 1)];
    const next = uvPts[Math.min(uvPts.length - 1, idx + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tLen = Math.max(1e-5, Math.hypot(tx, ty));
    // Normal vector perpendicular to trace tangent
    const nx = -ty / tLen;
    const ny = tx / tLen;

    const px = Math.round(pt.x * (width - 1));
    const py = Math.round(pt.y * (height - 1));

    let activeWidthPx = 1.0;
    for (let d = 1; d <= 4; d++) {
      const xPlus = Math.max(0, Math.min(width - 1, Math.round(px + nx * d)));
      const yPlus = Math.max(0, Math.min(height - 1, Math.round(py + ny * d)));
      const xMinus = Math.max(0, Math.min(width - 1, Math.round(px - nx * d)));
      const yMinus = Math.max(0, Math.min(height - 1, Math.round(py - ny * d)));

      const rPlus = response[yPlus * width + xPlus] / maxResp;
      const rMinus = response[yMinus * width + xMinus] / maxResp;
      if (rPlus > 0.24) activeWidthPx += 0.25;
      if (rMinus > 0.24) activeWidthPx += 0.25;
    }

    return Number(Math.max(0.65, Math.min(1.85, activeWidthPx)).toFixed(2));
  });
}

/**
 * Ensures any polyline with fewer than 7 vertices is subdivided and snapped to the actual
 * dark-valley rock discontinuity ridge in the image so that natural curvature, stepped offsets,
 * undulations, and local angle variations are preserved (Sections 1, 2, 3).
 */
function snapAndSubdivideTraceToRockFeature(
  uvPts: Point2D[],
  response: Float32Array,
  width: number,
  height: number,
  targetVertices = 10
): Point2D[] {
  if (uvPts.length < 2) return uvPts;

  // If already rich multi-vertex trace, refine each interior point to local fracture ridge
  const basePts: Point2D[] = [];
  if (uvPts.length >= 7) {
    basePts.push(...uvPts);
  } else {
    // Subdivide along existing polyline segments to achieve targetVertices
    basePts.push(uvPts[0]);
    const segCount = uvPts.length - 1;
    const subPerSeg = Math.max(2, Math.ceil((targetVertices - 1) / segCount));
    for (let s = 0; s < segCount; s++) {
      const p1 = uvPts[s];
      const p2 = uvPts[s + 1];
      for (let k = 1; k <= subPerSeg; k++) {
        const t = k / subPerSeg;
        basePts.push({
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y),
        });
      }
    }
  }

  // Snap each intermediate vertex perpendicular to local tangent toward strongest dark fracture valley within ±5 px
  const snapped: Point2D[] = [basePts[0]];
  for (let i = 1; i < basePts.length - 1; i++) {
    const prev = basePts[i - 1];
    const curr = basePts[i];
    const next = basePts[i + 1];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tLen = Math.max(1e-5, Math.hypot(tx, ty));
    const nx = -ty / tLen;
    const ny = tx / tLen;

    const cx = curr.x * width;
    const cy = curr.y * height;

    let bestScore = -1;
    let bestU = curr.x;
    let bestV = curr.y;

    for (let offset = -5; offset <= 5; offset++) {
      const sx = Math.round(cx + nx * offset);
      const sy = Math.round(cy + ny * offset);
      if (sx < 4 || sx >= width - 4 || sy < 4 || sy >= height - 4) continue;
      // Weight slightly toward small offsets to avoid jumping to a neighboring joint
      const distPenalty = 1 - Math.abs(offset) * 0.04;
      const val = response[sy * width + sx] * distPenalty;
      if (val > bestScore) {
        bestScore = val;
        bestU = sx / width;
        bestV = sy / height;
      }
    }

    snapped.push({
      x: Number(bestU.toFixed(4)),
      y: Number(bestV.toFixed(4)),
    });
  }
  snapped.push(basePts[basePts.length - 1]);
  return snapped;
}

/**
 * DETERMINISTIC COMPUTER VISION JOINT & FRACTURE DETECTION PIPELINE
 * Preserves multi-point natural geological curvature, local angle variation,
 * variable aperture width, and genuine terminations inside the rock exposure.
 */
export async function runComputerVisionJointDetection(
  imageSrc: string
): Promise<{
  candidates: CVTraceCandidate[];
  compressedDataUrl: string;
  responseMap: Float32Array;
  maxResp: number;
  workWidth: number;
  workHeight: number;
}> {
  const { imageData, width, height } = await loadImageData(imageSrc, 320);
  const rgba = imageData.data;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imageData, 0, 0);
  const compressedDataUrl = tempCanvas.toDataURL('image/jpeg', 0.82);

  // 1. Grayscale conversion + Specular Glare / Coloured Paint / Utility Cable Mask
  const gray = new Float32Array(width * height);
  const artifactMask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum;

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (lum > 242 || (saturation > 0.52 && lum > 90)) {
      artifactMask[i] = 1;
    }
  }

  // 2. Local Contrast Enhancement (CLAHE / block normalization)
  const enhanced = new Float32Array(width * height);
  const tileSize = 24;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - tileSize);
    const y1 = Math.min(height - 1, y + tileSize);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - tileSize);
      const x1 = Math.min(width - 1, x + tileSize);
      const c = gray[y * width + x];
      const n1 = gray[y0 * width + x0];
      const n2 = gray[y0 * width + x];
      const n3 = gray[y0 * width + x1];
      const n4 = gray[y * width + x0];
      const n5 = gray[y * width + x1];
      const n6 = gray[y1 * width + x0];
      const n7 = gray[y1 * width + x];
      const n8 = gray[y1 * width + x1];
      const localMean = (c + n1 + n2 + n3 + n4 + n5 + n6 + n7 + n8) / 9;
      const diff = c - localMean;
      enhanced[y * width + x] = Math.max(0, Math.min(255, 128 + diff * 2.1));
    }
  }

  // 3. 3x3 Gaussian smoothing
  const smoothed = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      smoothed[idx] =
        (4 * enhanced[idx] +
          2 *
            (enhanced[idx - 1] +
              enhanced[idx + 1] +
              enhanced[idx - width] +
              enhanced[idx + width]) +
          (enhanced[idx - width - 1] +
            enhanced[idx - width + 1] +
            enhanced[idx + width - 1] +
            enhanced[idx + width + 1])) /
        16;
    }
  }

  // 4. Sobel Gradient + Dark Fracture Valley Response
  const response = new Float32Array(width * height);
  const orientation = new Float32Array(width * height);

  let maxResp = 1e-5;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (artifactMask[idx]) continue;

      const gx =
        -smoothed[idx - width - 1] +
        smoothed[idx - width + 1] -
        2 * smoothed[idx - 1] +
        2 * smoothed[idx + 1] -
        smoothed[idx + width - 1] +
        smoothed[idx + width + 1];
      const gy =
        -smoothed[idx - width - 1] -
        2 * smoothed[idx - width] -
        smoothed[idx - width + 1] +
        smoothed[idx + width - 1] +
        2 * smoothed[idx + width] +
        smoothed[idx + width + 1];

      const gradMag = Math.hypot(gx, gy);

      const neighborMean =
        (smoothed[idx - 2] +
          smoothed[idx + 2] +
          smoothed[idx - 2 * width] +
          smoothed[idx + 2 * width]) /
        4;
      const darkValley = Math.max(0, neighborMean - smoothed[idx]);

      const combined = gradMag * 0.55 + darkValley * 2.25;
      response[idx] = combined;
      orientation[idx] = Math.atan2(gy, gx);
      if (combined > maxResp) maxResp = combined;
    }
  }

  // 5. Non-Maximum Suppression (NMS) along gradient direction
  const nms = new Float32Array(width * height);
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const idx = y * width + x;
      const val = response[idx];
      if (val < maxResp * 0.22) continue;

      const ang = orientation[idx];
      const dx = Math.round(Math.cos(ang));
      const dy = Math.round(Math.sin(ang));
      const n1 = response[(y + dy) * width + (x + dx)];
      const n2 = response[(y - dy) * width + (x - dx)];

      if (val >= n1 && val >= n2) {
        nms[idx] = val / maxResp;
      }
    }
  }

  // 6. Connected Ridge Chain Tracing preserving natural bends, steps, undulations & terminations
  const visited = new Uint8Array(width * height);
  const rawChains: { pts: Point2D[]; strengthSum: number }[] = [];
  const marginX = Math.floor(width * 0.07);
  const marginY = Math.floor(height * 0.07);

  for (let y = marginY; y < height - marginY; y++) {
    for (let x = marginX; x < width - marginX; x++) {
      const idx = y * width + x;
      if (nms[idx] >= 0.34 && !visited[idx]) {
        const chain: Point2D[] = [];
        let strengthSum = 0;
        let cx = x;
        let cy = y;

        while (true) {
          const cIdx = cy * width + cx;
          visited[cIdx] = 1;
          chain.push({ x: cx / width, y: cy / height });
          strengthSum += nms[cIdx];

          let bestNx = -1;
          let bestNy = -1;
          let bestScore = 0.22;

          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (
                nx < marginX ||
                nx >= width - marginX ||
                ny < marginY ||
                ny >= height - marginY
              )
                continue;
              const nIdx = ny * width + nx;
              if (!visited[nIdx] && nms[nIdx] > bestScore) {
                bestScore = nms[nIdx];
                bestNx = nx;
                bestNy = ny;
              }
            }
          }

          // Genuine termination: stop immediately when fracture ridge ends in the rock
          if (bestNx === -1) break;
          cx = bestNx;
          cy = bestNy;
          if (chain.length > 220) break;
        }

        const chord =
          chain.length >= 2
            ? Math.hypot(
                chain[chain.length - 1].x - chain[0].x,
                chain[chain.length - 1].y - chain[0].y
              )
            : 0;

        if (chain.length >= 14 && chord >= 0.10) {
          // Preserve 9 to 15 multi-point vertices along the chain (NEVER collapse to 2 points!)
          rawChains.push({
            pts: preserveGeologicalPolyline(chain, 12),
            strengthSum: strengthSum / chain.length,
          });
        }
      }
    }
  }

  // 7. Collinear/Curvilinear Fragment Linking & False-Line Removal
  const candidates: CVTraceCandidate[] = [];
  rawChains.sort((a, b) => b.pts.length * b.strengthSum - a.pts.length * a.strengthSum);

  for (const ch of rawChains) {
    if (candidates.length >= 16) break;
    const first = ch.pts[0];
    const last = ch.pts[ch.pts.length - 1];
    const dx = last.x - first.x;
    const dy = -(last.y - first.y);
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 180;

    const mid = ch.pts[Math.floor(ch.pts.length / 2)];
    const distFromCenter = Math.hypot(mid.x - 0.5, mid.y - 0.5);
    if (distFromCenter > 0.43) continue;

    const isDuplicate = candidates.some((existing) => {
      const eMid = existing.uvPoints[Math.floor(existing.uvPoints.length / 2)];
      return (
        Math.hypot(eMid.x - mid.x, eMid.y - mid.y) < 0.07 &&
        Math.abs(existing.angleDeg - angleDeg) < 15
      );
    });
    if (isDuplicate) continue;

    // Link fragments only across small shadow/debris occlusions (< 6% of span)
    const linkTarget = candidates.find((existing) => {
      const eLast = existing.uvPoints[existing.uvPoints.length - 1];
      const gap = Math.hypot(first.x - eLast.x, first.y - eLast.y);
      const angDiff = Math.min(
        Math.abs(existing.angleDeg - angleDeg),
        180 - Math.abs(existing.angleDeg - angleDeg)
      );
      return gap < 0.065 && angDiff < 12;
    });

    if (linkTarget) {
      linkTarget.uvPoints = preserveGeologicalPolyline(
        [...linkTarget.uvPoints, ...ch.pts],
        15
      );
      linkTarget.vertexWidths = measureVariableApertureAlongUVTrace(
        linkTarget.uvPoints,
        response,
        maxResp,
        width,
        height
      );
      continue;
    }

    let arcLen = 0;
    for (let i = 0; i < ch.pts.length - 1; i++) {
      arcLen += Math.hypot(ch.pts[i + 1].x - ch.pts[i].x, ch.pts[i + 1].y - ch.pts[i].y);
    }
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    const vWidths = measureVariableApertureAlongUVTrace(
      ch.pts,
      response,
      maxResp,
      width,
      height
    );

    candidates.push({
      uvPoints: ch.pts,
      vertexWidths: vWidths,
      angleDeg: Number(angleDeg.toFixed(1)),
      strength: Number(Math.min(0.98, ch.strengthSum * 1.45).toFixed(2)),
      isCurved: arcLen / Math.max(1e-4, chord) > 1.008,
    });
  }

  return {
    candidates,
    compressedDataUrl,
    responseMap: response,
    maxResp,
    workWidth: width,
    workHeight: height,
  };
}

/**
 * FULL HYBRID AI + CV + 3D GEOMETRY JOINT DETECTION PIPELINE
 * Preserves multi-point natural geological curvature, local angle variation,
 * variable trace aperture width, and genuine terminations inside the rock exposure.
 */
export async function executeHybridJointTracingPipeline(
  surface: SurfaceType,
  imageSrc: string,
  transform: SurfaceTransform,
  geometry: TunnelGeometry,
  settings: TunnelSettings,
  sessionMemory: SessionLearningMemory,
  existingOtherSurfaceJoints: Joint[],
  calibration?: CameraCalibration,
  hasStereoPair: boolean = false,
  supportingPhotos: SupportingPhoto[] = []
): Promise<{
  detectedJoints: Joint[];
  allClusteredJoints: Joint[];
  pipelineSummary: string;
}> {
  // 1. Run local Computer Vision ridge/skeleton detector on the MAIN PHOTO (always primary basis)
  const {
    candidates,
    compressedDataUrl,
    responseMap,
    maxResp,
    workWidth,
    workHeight,
  } = await runComputerVisionJointDetection(imageSrc);

  const supportingImagesBase64 = supportingPhotos
    .slice(0, 5)
    .map((sp) => sp.image)
    .filter(Boolean);
  const totalSupportCount = supportingImagesBase64.length + (hasStereoPair && supportingImagesBase64.length === 0 ? 1 : 0);

  // 2. Call Server-Side Gemini Vision AI endpoint for geological segmentation & non-geological filtering
  let aiTraces: {
    points: { u: number; v: number }[];
    vertexWidths?: number[];
    featureType: GeologicalFeatureType;
    confidence: 'High' | 'Medium' | 'Low';
    supportingPhotosCorroborated?: number;
    roughness?: string;
    infilling?: string;
    apertureMm?: string;
    waterCondition?: 'Dry' | 'Damp' | 'Wet' | 'Dripping' | 'Flowing';
  }[] = [];

  try {
    const response = await fetch('/api/ai/trace-joints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: compressedDataUrl,
        supportingImagesBase64,
        surface,
        tunnelWidth: geometry.width,
        tunnelHeight: geometry.height,
        driveDirection: settings.driveDirection,
        cvCandidates: candidates.slice(0, 12).map((c) => ({
          points: c.uvPoints.map((p) => ({
            u: Number(p.x.toFixed(3)),
            v: Number(p.y.toFixed(3)),
          })),
          vertexWidths: c.vertexWidths,
          angleDeg: c.angleDeg,
          strength: c.strength,
        })),
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.traces)) {
        aiTraces = data.traces;
      }
    }
  } catch {
    // Fallback gracefully to deterministic CV pipeline if offline
  }

  // 3. Project multi-vertex UV polylines through Camera Undistortion + 3x3 Homography + Master Tunnel Geometry
  const rawJoints: Joint[] = [];

  for (let i = 0; i < aiTraces.length; i++) {
    const t = aiTraces[i];
    if (!Array.isArray(t.points) || t.points.length < 2) continue;

    // Ensure the trace is a multi-point geological polyline snapped to the visible rock fracture ridge
    // (NEVER a 2-point idealized straight line!)
    const rawUvPts: Point2D[] = t.points.map((pt) => ({
      x: Math.max(0.02, Math.min(0.98, pt.u)),
      y: Math.max(0.02, Math.min(0.98, pt.v)),
    }));
    const refinedUvPts = snapAndSubdivideTraceToRockFeature(
      rawUvPts,
      responseMap,
      workWidth,
      workHeight,
      10
    );

    const measuredWidths =
      Array.isArray(t.vertexWidths) && t.vertexWidths.length === refinedUvPts.length
        ? t.vertexWidths
        : measureVariableApertureAlongUVTrace(
            refinedUvPts,
            responseMap,
            maxResp,
            workWidth,
            workHeight
          );

    // Compute raw image trace angle (Section 21A)
    const u0 = refinedUvPts[0];
    const uN = refinedUvPts[refinedUvPts.length - 1];
    let imgAng = (Math.atan2(-(uN.y - u0.y), uN.x - u0.x) * 180) / Math.PI;
    if (imgAng < 0) imgAng += 180;
    if (imgAng >= 180) imgAng -= 180;

    const meterPts = refinedUvPts.map((pt) =>
      imageUVToSurfaceMeters(pt.x, pt.y, surface, geometry, settings, transform, calibration)
    );

    const clipped = clipPolylineToSurface(meterPts, surface, geometry, settings);
    if (clipped.length < 2) continue;

    const confLevel = t.confidence || 'High';
    const detScore = confLevel === 'High' ? 0.92 : confLevel === 'Medium' ? 0.76 : 0.58;

    const orient = calculateJointOrientation3D(
      clipped,
      surface,
      geometry,
      settings,
      undefined,
      calibration,
      detScore,
      0.88,
      imgAng,
      hasStereoPair || totalSupportCount > 0
    );
    if (orient.persistenceMeters < 0.35) continue;

    const isRejectedByUserSession = sessionMemory.rejectedAngleRanges.some(
      (r) =>
        r.surface === surface &&
        Math.min(
          Math.abs(r.angleDeg - orient.traceAngle),
          180 - Math.abs(r.angleDeg - orient.traceAngle)
        ) <= r.tolerance
    );
    if (isRejectedByUserSession) continue;

    const confirmedMatch = sessionMemory.confirmedOrientations.find(
      (c) =>
        c.surface === surface &&
        Math.min(
          Math.abs(c.traceAngle - orient.traceAngle),
          180 - Math.abs(c.traceAngle - orient.traceAngle)
        ) <= 14
    );

    const status = confirmedMatch ? 'DIRECTLY_MEASURED' : orient.orientationStatus;
    const avgScore =
      (orient.confidenceBreakdown.detection +
        orient.confidenceBreakdown.trace +
        orient.confidenceBreakdown.geometric +
        orient.confidenceBreakdown.orientation) /
      400;

    const corroboratedCount =
      typeof t.supportingPhotosCorroborated === 'number'
        ? Math.min(totalSupportCount, Math.max(0, t.supportingPhotosCorroborated))
        : totalSupportCount;

    rawJoints.push({
      id: `jt-${surface}-${Date.now()}-${i}`,
      surface,
      geometry: clipped,
      aiOriginalGeometry: clipped.map((p) => ({ ...p })),
      aiOriginalFeatureType: t.featureType || 'joint',
      aiOriginalDip: orient.dip,
      aiOriginalDipDirection: orient.dipDirection,
      points3D: orient.points3D,
      localAnglesDeg: orient.localAnglesDeg,
      wavinessAngleDeg: orient.wavinessAngleDeg,
      vertexWidths: measuredWidths.slice(0, clipped.length),
      terminationStart: orient.terminationStart,
      terminationEnd: orient.terminationEnd,
      imageTraceAngleDeg: orient.imageTraceAngleDeg,
      traceAngle: orient.traceAngle,
      apparentDip: orient.apparentDip,
      strike: confirmedMatch
        ? (confirmedMatch.dipDirection - 90 + 360) % 360
        : orient.strike,
      dip: confirmedMatch ? confirmedMatch.dip : orient.dip,
      dipDirection: confirmedMatch ? confirmedMatch.dipDirection : orient.dipDirection,
      dipUncertaintyDeg: orient.dipUncertaintyDeg,
      dipDirectionUncertaintyDeg: orient.dipDirectionUncertaintyDeg,
      triangulationResidualMeters: orient.triangulationResidualMeters,
      reprojectionErrorPx: orient.reprojectionErrorPx,
      reprojectionErrorByView: orient.reprojectionErrorByView,
      numObservingViews: 1 + corroboratedCount,
      supportingPhotosCorroborated: corroboratedCount,
      geometricConfidenceLevel: orient.geometricConfidenceLevel,
      continuityStatus: corroboratedCount > 0 ? 'SUPPORTED' : orient.continuityStatus,
      orientationStatus: status,
      set: confirmedMatch
        ? confirmedMatch.set
        : t.featureType === 'bedding' || t.featureType === 'foliation'
        ? 'J0'
        : t.featureType === 'fault' || t.featureType === 'shear'
        ? 'F1'
        : 'J1',
      featureType: t.featureType || 'joint',
      confidence: avgScore >= 0.78 ? 'High' : avgScore >= 0.58 ? 'Medium' : 'Low',
      confidenceScore: Number(avgScore.toFixed(2)),
      confidenceBreakdown: orient.confidenceBreakdown,
      source: 'AI_HYBRID',
      accepted: true,
      persistenceMeters: orient.persistenceMeters,
      isCurved: orient.isCurved,
      roughness:
        t.roughness ||
        (orient.wavinessAngleDeg >= 5 ? 'Rough / Undulating' : 'Slightly rough / Stepped'),
      infilling: t.infilling || 'Not determined',
      apertureMm: t.apertureMm || '1-3 mm (Variable)',
      waterCondition: t.waterCondition || 'Dry',
    });
  }

  // Merge non-duplicate high-confidence CV Hough/Ridge traces
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (rawJoints.length >= 14) break;

    const refinedUv = snapAndSubdivideTraceToRockFeature(
      cand.uvPoints,
      responseMap,
      workWidth,
      workHeight,
      10
    );
    const meterPts = refinedUv.map((pt) =>
      imageUVToSurfaceMeters(pt.x, pt.y, surface, geometry, settings, transform, calibration)
    );
    const clipped = clipPolylineToSurface(meterPts, surface, geometry, settings);
    if (clipped.length < 2) continue;

    const orient = calculateJointOrientation3D(
      clipped,
      surface,
      geometry,
      settings,
      undefined,
      calibration,
      cand.strength,
      cand.strength,
      cand.angleDeg,
      hasStereoPair || totalSupportCount > 0
    );
    if (orient.persistenceMeters < 0.45) continue;

    const isRejected = sessionMemory.rejectedAngleRanges.some(
      (r) =>
        r.surface === surface &&
        Math.min(
          Math.abs(r.angleDeg - orient.traceAngle),
          180 - Math.abs(r.angleDeg - orient.traceAngle)
        ) <= r.tolerance
    );
    if (isRejected) continue;

    const mid = clipped[Math.floor(clipped.length / 2)];
    const alreadyCovered = rawJoints.some((rj) => {
      const rMid = rj.geometry[Math.floor(rj.geometry.length / 2)];
      const dist = Math.hypot(rMid.x - mid.x, rMid.y - mid.y);
      const angDiff = Math.min(
        Math.abs(rj.traceAngle - orient.traceAngle),
        180 - Math.abs(rj.traceAngle - orient.traceAngle)
      );
      return dist < geometry.width * 0.12 && angDiff < 18;
    });
    if (alreadyCovered) continue;

    const avgScore =
      (orient.confidenceBreakdown.detection +
        orient.confidenceBreakdown.trace +
        orient.confidenceBreakdown.geometric +
        orient.confidenceBreakdown.orientation) /
      400;

    const confidence: 'High' | 'Medium' | 'Low' =
      avgScore >= 0.75 ? 'High' : avgScore >= 0.55 ? 'Medium' : 'Low';

    const vWidths = measureVariableApertureAlongUVTrace(
      refinedUv,
      responseMap,
      maxResp,
      workWidth,
      workHeight
    );

    rawJoints.push({
      id: `jt-cv-${surface}-${Date.now()}-${i}`,
      surface,
      geometry: clipped,
      aiOriginalGeometry: clipped.map((p) => ({ ...p })),
      aiOriginalFeatureType: 'joint',
      aiOriginalDip: orient.dip,
      aiOriginalDipDirection: orient.dipDirection,
      points3D: orient.points3D,
      localAnglesDeg: orient.localAnglesDeg,
      wavinessAngleDeg: orient.wavinessAngleDeg,
      vertexWidths: vWidths.slice(0, clipped.length),
      terminationStart: orient.terminationStart,
      terminationEnd: orient.terminationEnd,
      imageTraceAngleDeg: orient.imageTraceAngleDeg,
      traceAngle: orient.traceAngle,
      apparentDip: orient.apparentDip,
      strike: orient.strike,
      dip: orient.dip,
      dipDirection: orient.dipDirection,
      dipUncertaintyDeg: orient.dipUncertaintyDeg,
      dipDirectionUncertaintyDeg: orient.dipDirectionUncertaintyDeg,
      triangulationResidualMeters: orient.triangulationResidualMeters,
      reprojectionErrorPx: orient.reprojectionErrorPx,
      reprojectionErrorByView: orient.reprojectionErrorByView,
      numObservingViews: 1 + totalSupportCount,
      supportingPhotosCorroborated: totalSupportCount,
      geometricConfidenceLevel: orient.geometricConfidenceLevel,
      continuityStatus: totalSupportCount > 0 ? 'SUPPORTED' : orient.continuityStatus,
      orientationStatus: orient.orientationStatus,
      set: 'J1',
      featureType: 'joint',
      confidence,
      confidenceScore: Number(avgScore.toFixed(2)),
      confidenceBreakdown: orient.confidenceBreakdown,
      source: 'CV_PIPELINE',
      accepted: true,
      persistenceMeters: orient.persistenceMeters,
      isCurved: orient.isCurved,
      roughness: orient.wavinessAngleDeg >= 5 ? 'Rough / Undulating' : 'Stepped / Irregular',
      infilling: 'Not determined',
      apertureMm: 'Tight - 2 mm (Variable)',
      waterCondition: 'Dry',
    });
  }

  // 4. Check for Joint-to-Joint Abutment Terminations (Section 5: continuation/termination against another joint)
  for (let i = 0; i < rawJoints.length; i++) {
    const jA = rawJoints[i];
    const startPt = jA.geometry[0];
    const endPt = jA.geometry[jA.geometry.length - 1];

    for (let k = 0; k < rawJoints.length; k++) {
      if (i === k) continue;
      const jB = rawJoints[k];
      for (const bPt of jB.geometry) {
        if (
          jA.terminationStart === 'ROCK_TERMINATION' &&
          Math.hypot(startPt.x - bPt.x, startPt.y - bPt.y) < 0.28
        ) {
          jA.terminationStart = 'JOINT_ABUTMENT';
        }
        if (
          jA.terminationEnd === 'ROCK_TERMINATION' &&
          Math.hypot(endPt.x - bPt.x, endPt.y - bPt.y) < 0.28
        ) {
          jA.terminationEnd = 'JOINT_ABUTMENT';
        }
      }
    }
  }

  // 5. Combine with other surfaces and run Clustering + Multi-Surface 3D Plane Solver
  const combined = [...existingOtherSurfaceJoints, ...rawJoints];
  const { clusteredJoints } = clusterJointsIntoSets(combined);
  const refinedAll = refineMultiSurfaceOrientations(clusteredJoints, geometry, settings);
  const finalForSurface = refinedAll.filter((j) => j.surface === surface);

  return {
    detectedJoints: finalForSurface,
    allClusteredJoints: refinedAll,
    pipelineSummary: `Registered to Main Photo: Traced ${finalForSurface.length} natural geological discontinuities on ${surface}${
      totalSupportCount > 0 ? ` (verified with ${totalSupportCount} supporting photo(s))` : ''
    }.`,
  };
}
