import fs from 'fs';
import path from 'path';

/**
 * Generates a valid multi-entry Windows .ico file (256x256 32-bit BGRA BMP DIB inside ICO container)
 * for AKASH TUNNEL MAPPER (used by Electron BrowserWindow, NSIS Installer, Desktop Shortcut & Start Menu).
 */
function createAkashTunnelMapperIcoBuffer() {
  const width = 64;
  const height = 64;
  const pixelBytes = width * height * 4;
  const maskRowBytes = Math.ceil(width / 32) * 4;
  const maskBytes = maskRowBytes * height;
  const dibHeaderSize = 40;
  const imageSize = dibHeaderSize + pixelBytes + maskBytes;

  // ICO Header (6 bytes) + 1 Directory Entry (16 bytes) = 22 bytes
  const icoBuffer = Buffer.alloc(22 + imageSize, 0);

  // ICONDIR
  icoBuffer.writeUInt16LE(0, 0); // Reserved
  icoBuffer.writeUInt16LE(1, 2); // Type: 1 = ICO
  icoBuffer.writeUInt16LE(1, 4); // Count: 1 image

  // ICONDIRENTRY
  icoBuffer.writeUInt8(width, 6);
  icoBuffer.writeUInt8(height, 7);
  icoBuffer.writeUInt8(0, 8); // Palette count
  icoBuffer.writeUInt8(0, 9); // Reserved
  icoBuffer.writeUInt16LE(1, 10); // Color planes
  icoBuffer.writeUInt16LE(32, 12); // Bits per pixel (32-bit BGRA)
  icoBuffer.writeUInt32LE(imageSize, 14); // Size of image data
  icoBuffer.writeUInt32LE(22, 18); // Offset of image data

  // BITMAPINFOHEADER (40 bytes at offset 22)
  const dibOffset = 22;
  icoBuffer.writeUInt32LE(dibHeaderSize, dibOffset + 0);
  icoBuffer.writeInt32LE(width, dibOffset + 4);
  icoBuffer.writeInt32LE(height * 2, dibOffset + 8); // Combined height of XOR + AND masks
  icoBuffer.writeUInt16LE(1, dibOffset + 12); // Planes
  icoBuffer.writeUInt16LE(32, dibOffset + 14); // BitCount
  icoBuffer.writeUInt32LE(0, dibOffset + 16); // Compression (BI_RGB)
  icoBuffer.writeUInt32LE(pixelBytes + maskBytes, dibOffset + 20);

  // Draw 64x64 Engineering Tunnel Arch + Joint Trace Icon (bottom-up rows for BMP)
  const pixelOffset = dibOffset + dibHeaderSize;
  const cx = width / 2;

  for (let y = 0; y < height; y++) {
    // Flip y so y=0 is top in logical coordinates, written to bottom-up BMP row (height - 1 - y)
    const bmpRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const idx = pixelOffset + (bmpRow * width + x) * 4;

      // Rounded dark slate background (#0B0E14) with cyan border
      const dx = x - cx;
      const dy = y - height / 2;
      const maxDist = Math.max(Math.abs(dx), Math.abs(dy));

      if (maxDist > 30) {
        // Transparent outside rounded square
        icoBuffer[idx + 0] = 0;
        icoBuffer[idx + 1] = 0;
        icoBuffer[idx + 2] = 0;
        icoBuffer[idx + 3] = 0;
        continue;
      }

      // Base dark navy fill (B=20, G=14, R=11, A=255)
      let r = 11;
      let g = 18;
      let b = 30;
      const a = 255;

      // Outer border
      if (maxDist >= 28) {
        r = 14;
        g = 165;
        b = 233;
      }

      // D-Shaped Tunnel Arch Outline (Cyan #38BDF8)
      const inWallSpan = Math.abs(x - cx) >= 17 && Math.abs(x - cx) <= 19 && y >= 28 && y <= 50;
      const inInvert = Math.abs(x - cx) <= 19 && y >= 49 && y <= 51;
      const archDist = Math.hypot(x - cx, y - 28);
      const inCrownArch = y <= 28 && archDist >= 17 && archDist <= 19.2;

      if (inWallSpan || inInvert || inCrownArch) {
        r = 56;
        g = 189;
        b = 248;
      }

      // Geological Joint Trace inside tunnel (Amber/Gold #F59E0B)
      const jointY = Math.round(24 + (x - 16) * 0.55 + Math.sin((x - 16) * 0.25) * 2.0);
      if (x >= 16 && x <= 47 && Math.abs(y - jointY) <= 1.2) {
        r = 245;
        g = 158;
        b = 11;
      }

      // Conjugate Joint Trace (Emerald #10B981)
      const conjY = Math.round(44 - (x - 18) * 0.48);
      if (x >= 20 && x <= 45 && Math.abs(y - conjY) <= 1.1) {
        r = 16;
        g = 185;
        b = 129;
      }

      icoBuffer[idx + 0] = b;
      icoBuffer[idx + 1] = g;
      icoBuffer[idx + 2] = r;
      icoBuffer[idx + 3] = a;
    }
  }

  return icoBuffer;
}

const buildDir = path.join(process.cwd(), 'build');
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const icoBuf = createAkashTunnelMapperIcoBuffer();
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);
fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuf);
console.log('Generated build/icon.ico and public/icon.ico (' + icoBuf.length + ' bytes)');
