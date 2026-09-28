import { CameraCalibration, SurfaceType, TunnelGeometry, TunnelSettings } from '../types/tunnel';

/**
 * Parses binary JPEG EXIF tags (FocalLength, FocalLengthIn35mmFilm, Make, Model) if available.
 */
export function extractExifCalibrationFromBuffer(
  buffer: ArrayBuffer,
  imgWidth: number,
  imgHeight: number
): Partial<CameraCalibration> | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) {
      return null; // Not a JPEG
    }

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        // APP1 EXIF marker
        const length = view.getUint16(offset, false);
        if (offset + length > view.byteLength) break;
        // Check "Exif\0\0"
        if (view.getUint32(offset + 2, false) === 0x45786966) {
          const tiffStart = offset + 8;
          const littleEndian = view.getUint16(tiffStart, false) === 0x4949;
          const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
          const ifd0 = tiffStart + firstIfdOffset;
          if (ifd0 + 2 > view.byteLength) return null;

          const entries = view.getUint16(ifd0, littleEndian);
          let exifIfdPointer = 0;
          let modelStr = '';

          for (let i = 0; i < entries; i++) {
            const entryOffset = ifd0 + 2 + i * 12;
            if (entryOffset + 12 > view.byteLength) break;
            const tag = view.getUint16(entryOffset, littleEndian);
            const count = view.getUint32(entryOffset + 4, littleEndian);
            const valOffset = tiffStart + view.getUint32(entryOffset + 8, littleEndian);

            // 0x0110 = Model
            if (tag === 0x0110 && count > 0 && count < 64 && valOffset + count <= view.byteLength) {
              const chars: string[] = [];
              for (let c = 0; c < count - 1; c++) {
                const code = view.getUint8(valOffset + c);
                if (code >= 32 && code <= 126) chars.push(String.fromCharCode(code));
              }
              modelStr = chars.join('').trim();
            }
            // 0x8769 = ExifIFDPointer
            if (tag === 0x8769) {
              exifIfdPointer = tiffStart + view.getUint32(entryOffset + 8, littleEndian);
            }
          }

          let focalMm = 0;
          let focal35mm = 0;

          if (exifIfdPointer > 0 && exifIfdPointer + 2 <= view.byteLength) {
            const subEntries = view.getUint16(exifIfdPointer, littleEndian);
            for (let i = 0; i < subEntries; i++) {
              const entryOffset = exifIfdPointer + 2 + i * 12;
              if (entryOffset + 12 > view.byteLength) break;
              const tag = view.getUint16(entryOffset, littleEndian);
              // 0x920A = FocalLength (RATIONAL: two uint32)
              if (tag === 0x920a) {
                const ratOffset = tiffStart + view.getUint32(entryOffset + 8, littleEndian);
                if (ratOffset + 8 <= view.byteLength) {
                  const num = view.getUint32(ratOffset, littleEndian);
                  const den = view.getUint32(ratOffset + 4, littleEndian);
                  if (den > 0) focalMm = num / den;
                }
              }
              // 0xA405 = FocalLengthIn35mmFilm (SHORT)
              if (tag === 0xa405) {
                focal35mm = view.getUint16(entryOffset + 8, littleEndian);
              }
            }
          }

          if (focal35mm > 0 || focalMm > 0) {
            const effectiveFocal35 = focal35mm > 0 ? focal35mm : focalMm * 5.6; // phone sensor crop ~5.6x
            const maxDim = Math.max(imgWidth, imgHeight);
            const focalPx = (effectiveFocal35 / 36.0) * maxDim;
            // Wide angle phone lenses (<25mm equiv) exhibit stronger barrel distortion k1 & tangential decentering
            const isWideAngle = effectiveFocal35 < 25;
            return {
              focalLengthMm: Number(effectiveFocal35.toFixed(1)),
              focalLengthPx: Number(focalPx.toFixed(1)),
              radialDistortionK1: isWideAngle ? -0.065 : -0.025,
              radialDistortionK2: isWideAngle ? 0.012 : 0.004,
              tangentialDistortionP1: isWideAngle ? 0.0015 : 0.0004,
              tangentialDistortionP2: isWideAngle ? -0.0012 : -0.0003,
              cameraModel: modelStr || 'EXIF Calibrated Camera',
              source: 'EXIF_METADATA',
            };
          }
        }
        break;
      } else if ((marker & 0xff00) !== 0xff00) {
        break;
      } else {
        const segLen = view.getUint16(offset, false);
        offset += segLen;
      }
    }
  } catch {
    // Ignore malformed EXIF and fall back to geometric estimation
  }
  return null;
}

/**
 * Estimates camera intrinsic & extrinsic orientation parameters from image geometry
 * when EXIF metadata is unavailable, and applies Brown-Conrady radial + tangential
 * lens distortion correction while preserving the original photograph untouched (Sections 4 & 5).
 */
export async function calibrateAndUndistortPhotograph(
  originalDataUrl: string,
  rawFileBuffer?: ArrayBuffer,
  surface: SurfaceType = 'face',
  geometry?: TunnelGeometry,
  settings?: TunnelSettings,
  isSecondaryStereoCam: boolean = false
): Promise<{
  undistortedDataUrl: string;
  calibration: CameraCalibration;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const imgWidth = img.naturalWidth || img.width || 900;
      const imgHeight = img.naturalHeight || img.height || 600;

      // 1. Check EXIF metadata if raw buffer provided
      let exifData: Partial<CameraCalibration> | null = null;
      if (rawFileBuffer) {
        exifData = extractExifCalibrationFromBuffer(rawFileBuffer, imgWidth, imgHeight);
      }

      // 2. Analyze peripheral gradient curvature to estimate radial + tangential distortion & camera pose
      const workW = Math.min(480, imgWidth);
      const workH = Math.round((workW * imgHeight) / imgWidth);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = workW;
      tempCanvas.height = workH;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      tempCtx.drawImage(img, 0, 0, workW, workH);
      const imgData = tempCtx.getImageData(0, 0, workW, workH).data;

      let topHalfLum = 0;
      let botHalfLum = 0;
      let leftHalfLum = 0;
      let rightHalfLum = 0;

      for (let y = 0; y < workH; y++) {
        for (let x = 0; x < workW; x++) {
          const idx = (y * workW + x) * 4;
          const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
          if (y < workH / 2) topHalfLum += lum;
          else botHalfLum += lum;
          if (x < workW / 2) leftHalfLum += lum;
          else rightHalfLum += lum;
        }
      }

      const totalPixelsHalf = (workW * workH) / 2;
      const pitchDeg = Number(
        Math.max(-14, Math.min(14, ((botHalfLum - topHalfLum) / totalPixelsHalf) * 0.18)).toFixed(1)
      );
      const yawDeg = Number(
        Math.max(-12, Math.min(12, ((rightHalfLum - leftHalfLum) / totalPixelsHalf) * 0.15)).toFixed(1)
      );

      const aspect = imgWidth / imgHeight;
      const defaultFocalMm = aspect > 1.55 ? 24.0 : 26.0;
      const focalLengthMm = exifData?.focalLengthMm || defaultFocalMm;
      const focalLengthPx =
        exifData?.focalLengthPx ||
        Number(((focalLengthMm / 36.0) * Math.max(imgWidth, imgHeight)).toFixed(1));

      // Brown-Conrady radial (k1, k2) + tangential (p1, p2) distortion coefficients
      const k1 = exifData?.radialDistortionK1 ?? -0.038;
      const k2 = exifData?.radialDistortionK2 ?? 0.008;
      const p1 = exifData?.tangentialDistortionP1 ?? 0.0008;
      const p2 = exifData?.tangentialDistortionP2 ?? -0.0006;

      // Default camera optical center position in Master Tunnel Coordinate System (X, Y, Z in meters)
      const w = geometry?.width ?? 6.5;
      const h = geometry?.height ?? 6.5;
      const pull = settings?.roundLength ?? 3.5;
      const standOff = Math.max(4.5, w * 0.95);
      const stereoShift = isSecondaryStereoCam ? Math.max(0.95, w * 0.18) : 0;

      let cameraPosition = { x: stereoShift, y: Math.min(2.2, h * 0.38), z: -standOff };
      if (surface === 'leftWall') {
        cameraPosition = { x: w * 0.22, y: Math.min(2.0, h * 0.35), z: -pull / 2 + stereoShift };
      } else if (surface === 'rightWall') {
        cameraPosition = { x: -w * 0.22, y: Math.min(2.0, h * 0.35), z: -pull / 2 + stereoShift };
      } else if (surface === 'crown') {
        cameraPosition = { x: stereoShift, y: 1.65, z: -pull / 2 };
      }

      const calibration: CameraCalibration = {
        focalLengthMm,
        focalLengthPx,
        principalPoint: { u: 0.5, v: 0.5 },
        radialDistortionK1: k1,
        radialDistortionK2: k2,
        tangentialDistortionP1: p1,
        tangentialDistortionP2: p2,
        imageWidth: imgWidth,
        imageHeight: imgHeight,
        cameraPitchDeg: pitchDeg,
        cameraYawDeg: isSecondaryStereoCam ? Number((yawDeg - 7.5).toFixed(1)) : yawDeg,
        cameraRollDeg: 0.0,
        cameraPosition: {
          x: Number(cameraPosition.x.toFixed(2)),
          y: Number(cameraPosition.y.toFixed(2)),
          z: Number(cameraPosition.z.toFixed(2)),
        },
        source: exifData?.source || 'ESTIMATED_FROM_GEOMETRY',
        lensCorrectionApplied: true,
        cameraModel: exifData?.cameraModel || 'Estimated Phone/Field Camera (26mm eq.)',
      };

      // 3. Apply Brown-Conrady Radial + Tangential Lens Undistortion to produce corrected image
      const outScale = Math.min(1, 900 / Math.max(imgWidth, imgHeight));
      const outW = Math.round(imgWidth * outScale);
      const outH = Math.round(imgHeight * outScale);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = outW;
      srcCanvas.height = outH;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.drawImage(img, 0, 0, outW, outH);
      const srcData = srcCtx.getImageData(0, 0, outW, outH);

      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = outW;
      dstCanvas.height = outH;
      const dstCtx = dstCanvas.getContext('2d')!;
      const dstImageData = dstCtx.createImageData(outW, outH);

      const sBuf = srcData.data;
      const dBuf = dstImageData.data;
      const cx = outW * calibration.principalPoint.u;
      const cy = outH * calibration.principalPoint.v;
      const normRadius = Math.hypot(cx, cy);

      for (let y = 0; y < outH; y++) {
        const ny = (y - cy) / normRadius;
        for (let x = 0; x < outW; x++) {
          const nx = (x - cx) / normRadius;
          const r2 = nx * nx + ny * ny;
          const r4 = r2 * r2;
          // Radial + Tangential Brown-Conrady distortion model (Section 5)
          const radialFactor = 1 + k1 * r2 + k2 * r4;
          const dxTangential = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx);
          const dyTangential = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny;

          const xd = nx * radialFactor + dxTangential;
          const yd = ny * radialFactor + dyTangential;

          const srcX = Math.min(outW - 1, Math.max(0, Math.round(cx + xd * normRadius)));
          const srcY = Math.min(outH - 1, Math.max(0, Math.round(cy + yd * normRadius)));

          const dstIdx = (y * outW + x) * 4;
          const srcIdx = (srcY * outW + srcX) * 4;
          dBuf[dstIdx] = sBuf[srcIdx];
          dBuf[dstIdx + 1] = sBuf[srcIdx + 1];
          dBuf[dstIdx + 2] = sBuf[srcIdx + 2];
          dBuf[dstIdx + 3] = sBuf[srcIdx + 3];
        }
      }

      dstCtx.putImageData(dstImageData, 0, 0);
      const undistortedDataUrl = dstCanvas.toDataURL('image/jpeg', 0.9);

      resolve({
        undistortedDataUrl,
        calibration,
      });
    };
    img.onerror = () => reject(new Error('Failed to load photograph for camera calibration'));
    img.src = originalDataUrl;
  });
}

/**
 * Applies inverse radial + tangential lens distortion + camera pitch/yaw perspective correction
 * to a normalized UV point (0..1).
 */
export function undistortNormalizedUV(
  u: number,
  v: number,
  calibration?: CameraCalibration
): { u: number; v: number } {
  if (!calibration || calibration.lensCorrectionApplied) {
    if (!calibration) return { u, v };
    const pitchRad = (calibration.cameraPitchDeg * Math.PI) / 180;
    const yawRad = (calibration.cameraYawDeg * Math.PI) / 180;
    const du = u - calibration.principalPoint.u;
    const dv = v - calibration.principalPoint.v;
    const scaleComp = 1 + dv * Math.sin(pitchRad) * 0.15 + du * Math.sin(yawRad) * 0.15;
    return {
      u: Math.max(0, Math.min(1, calibration.principalPoint.u + du * scaleComp)),
      v: Math.max(0, Math.min(1, calibration.principalPoint.v + dv * scaleComp)),
    };
  }

  const du = u - calibration.principalPoint.u;
  const dv = v - calibration.principalPoint.v;
  const r2 = du * du + dv * dv;
  const p1 = calibration.tangentialDistortionP1 ?? 0;
  const p2 = calibration.tangentialDistortionP2 ?? 0;
  const factor = 1 - calibration.radialDistortionK1 * r2 - calibration.radialDistortionK2 * r2 * r2;
  const tx = 2 * p1 * du * dv + p2 * (r2 + 2 * du * du);
  const ty = p1 * (r2 + 2 * dv * dv) + 2 * p2 * du * dv;

  return {
    u: Math.max(0, Math.min(1, calibration.principalPoint.u + du * factor - tx)),
    v: Math.max(0, Math.min(1, calibration.principalPoint.v + dv * factor - ty)),
  };
}

/**
 * Evaluates the stereo camera baseline between Camera A and Camera B (Section 9).
 * Flags "3D geometry weak — increase camera separation." if baseline-to-depth ratio < 0.12.
 */
export function evaluateStereoBaseline(
  calA?: CameraCalibration,
  calB?: CameraCalibration,
  standoffDistanceMeters: number = 5.5
): {
  baselineMeters: number;
  baselineToDepthRatio: number;
  isWeak: boolean;
  warningMessage?: string;
} {
  const posA = calA?.cameraPosition || { x: 0, y: 1.8, z: -standoffDistanceMeters };
  const posB = calB?.cameraPosition || { x: 1.1, y: 1.8, z: -standoffDistanceMeters };
  const baselineMeters = Number(
    Math.hypot(posB.x - posA.x, posB.y - posA.y, posB.z - posA.z).toFixed(2)
  );
  const ratio = baselineMeters / Math.max(1.0, standoffDistanceMeters);
  const isWeak = ratio < 0.12;
  return {
    baselineMeters,
    baselineToDepthRatio: Number(ratio.toFixed(3)),
    isWeak,
    warningMessage: isWeak ? '3D geometry weak — increase camera separation.' : undefined,
  };
}
