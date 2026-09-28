import {
  Joint,
  JointSet,
  LithologyRegion,
  OutputSheetMode,
  PhotoSurface,
  Point2D,
  SurfaceTransform,
  SurfaceType,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';

export type SheetLayoutArrangement = 'AUTO_INTELLIGENT' | 'MAXIMIZE_FACE';

export interface SheetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetLayoutComputation {
  sheetW: number;
  sheetH: number;
  margin: number;
  showTitleAndTables: boolean;
  showPerimeterPlan: boolean;
  headerBox: SheetRect;
  drawingArenaBox: SheetRect;
  rightColumnBox: SheetRect;

  // Priority 1: Main Tunnel-Face Geological Mapping Viewport
  facePxPerMeter: number;
  faceCenterX: number;
  faceTopY: number;
  faceBottomY: number;
  faceWidthPx: number;
  faceHeightPx: number;
  faceSurfaceRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };

  // Priority 2: Developed Perimeter Mapping Viewport (Left Wall | Crown | Right Wall)
  perimeterPxPerMeter: number;
  planCenterX: number;
  planTopY: number;
  crownW_px: number;
  roundH_px: number;
  wallW_px: number;
  crownLeftX: number;
  leftWallLeftX: number;
  rightWallLeftX: number;
  roundLen: number;
  crownSpan: number;

  // Right Column Non-Overlapping Blocks (Priorities 3, 4, 5, 7, 8)
  orientationBlock: SheetRect;
  legendBlock: SheetRect;
  jointTableBlock: SheetRect;
  qIndexAndNotesBlock: SheetRect;

  // Coordinate & Photo Registration Helpers (Identical world/canvas coordinate mapping)
  surfacePointToSheetXY: (pt: Point2D, surface: SurfaceType) => { x: number; y: number };
  getSurfaceSheetRect: (surface: SurfaceType) => {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    pxPerMeter: number;
  };
  getSheetPhotoSvgTransform: (surface: SurfaceType, transform: SurfaceTransform) => string;
}

/**
 * Sections 1, 2, 3, 4, 16: Final Engineering Sheet Auto-Layout Engine.
 *
 * Calculates the available printable page area and fits the tunnel mapping
 * prominently without distorting aspect ratio or leaving large unused space.
 */
export function computeFinalSheetAutoLayout(params: {
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  photos: Record<SurfaceType, PhotoSurface>;
  joints: Joint[];
  jointSets: JointSet[];
  lithologyRegions: LithologyRegion[];
  outputMode: OutputSheetMode;
  arrangement?: SheetLayoutArrangement;
}): SheetLayoutComputation {
  const {
    geometry,
    settings,
    photos,
    joints,
    jointSets,
    lithologyRegions,
    outputMode,
    arrangement = 'AUTO_INTELLIGENT',
  } = params;

  // Landscape A3 Engineering Sheet (1600 x 1130 high-resolution technical drawing space)
  const sheetW = 1600;
  const sheetH = 1130;
  const margin = 18;

  const showTitleAndTables =
    outputMode === 'FINAL_ENGINEERING_SHEET' ||
    outputMode === 'CLEAN_MAPPING_DRAWING' ||
    outputMode === 'ENGINEERING_QUANTITY_SHEET';

  // Header Block (Priority 6: Project Information)
  const headerH = showTitleAndTables ? 74 : 0;
  const headerBox: SheetRect = {
    x: margin + 4,
    y: margin + 4,
    width: sheetW - (margin + 4) * 2,
    height: headerH,
  };

  const contentTopY = showTitleAndTables ? headerBox.y + headerBox.height + 10 : margin + 12;
  const contentBottomY = sheetH - margin - 10;
  const availHeight = contentBottomY - contentTopY;

  // Right Column (Priorities 3, 4, 5, 7, 8)
  const rightColW = showTitleAndTables ? 510 : 0;
  const rightColX = sheetW - margin - 4 - rightColW;
  const rightColumnBox: SheetRect = {
    x: rightColX,
    y: contentTopY,
    width: rightColW,
    height: availHeight,
  };

  // Left/Center Main Drawing Arena (Priorities 1 & 2)
  const arenaLeftX = margin + 4;
  const arenaRightX = showTitleAndTables ? rightColX - 12 : sheetW - margin - 4;
  const drawingArenaBox: SheetRect = {
    x: arenaLeftX,
    y: contentTopY,
    width: arenaRightX - arenaLeftX,
    height: availHeight,
  };

  // Determine whether Developed Perimeter has active photos or mapped features
  const hasPerimeterContent =
    Boolean(photos.crown.image) ||
    Boolean(photos.leftWall.image) ||
    Boolean(photos.rightWall.image) ||
    joints.some((j) => j.surface !== 'face') ||
    lithologyRegions.some((r) => r.surface !== 'face');

  const showPerimeterPlan =
    arrangement !== 'MAXIMIZE_FACE' &&
    outputMode !== 'EXPORT_PHOTO_ONLY';

  const roundLen = Math.max(1.5, settings.roundLength || 3.5);
  const crownSpan = Math.max(geometry.width, geometry.crownArcLength);
  const totalDevelopedWidthMeters = geometry.wallHeight * 2 + crownSpan;

  // Allocate vertical space inside drawingArenaBox:
  // Priority 1: Main Tunnel-Face Geological Mapping gets 68% - 82% of the arena height!
  const perimeterAllocRatio = !showPerimeterPlan
    ? 0
    : hasPerimeterContent
    ? 0.27
    : 0.19;

  const perimeterZoneH = showPerimeterPlan
    ? Math.round(drawingArenaBox.height * perimeterAllocRatio)
    : 0;
  const faceZoneTopY = drawingArenaBox.y + perimeterZoneH;
  const faceZoneH = drawingArenaBox.height - perimeterZoneH;

  // Compute uniform scale for Developed Perimeter (`perimeterPxPerMeter`)
  const perimeterAvailW = Math.max(200, drawingArenaBox.width - 150);
  const perimeterAvailH = Math.max(70, perimeterZoneH - 48);
  const perimeterPxPerMeter = showPerimeterPlan
    ? Number(
        Math.min(
          perimeterAvailW / Math.max(4, totalDevelopedWidthMeters),
          perimeterAvailH / Math.max(1.5, roundLen),
          68
        ).toFixed(3)
      )
    : 32;

  const planCenterX = Number((drawingArenaBox.x + drawingArenaBox.width / 2).toFixed(1));
  const crownW_px = Number((crownSpan * perimeterPxPerMeter).toFixed(2));
  const roundH_px = Number((roundLen * perimeterPxPerMeter).toFixed(2));
  const wallW_px = Number((geometry.wallHeight * perimeterPxPerMeter).toFixed(2));
  const planTopY = Number((drawingArenaBox.y + 30).toFixed(1));

  const crownLeftX = Number((planCenterX - crownW_px / 2).toFixed(2));
  const leftWallLeftX = Number((crownLeftX - wallW_px).toFixed(2));
  const rightWallLeftX = Number((crownLeftX + crownW_px).toFixed(2));

  // Priority 1: Compute UNIFORM scale (`facePxPerMeter`) for Main Tunnel Face Mapping
  // Reserve padding strictly for dimension lines & callout labels so the Tunnel Face fills the arena prominently!
  const facePadW = 140;
  const facePadH = 86;
  const faceAvailW = Math.max(300, drawingArenaBox.width - facePadW);
  const faceAvailH = Math.max(300, faceZoneH - facePadH);

  const facePxPerMeter = Number(
    Math.min(
      faceAvailW / Math.max(1, geometry.width),
      faceAvailH / Math.max(1, geometry.height)
    ).toFixed(3)
  );

  const faceWidthPx = Number((geometry.width * facePxPerMeter).toFixed(2));
  const faceHeightPx = Number((geometry.height * facePxPerMeter).toFixed(2));
  const faceCenterX = planCenterX;
  const faceTopY = Number(
    (faceZoneTopY + (faceZoneH - faceHeightPx) / 2 + 4).toFixed(2)
  );
  const faceBottomY = Number((faceTopY + faceHeightPx).toFixed(2));

  const faceSurfaceRect = {
    x: Number((faceCenterX - faceWidthPx / 2).toFixed(2)),
    y: faceTopY,
    width: faceWidthPx,
    height: faceHeightPx,
    centerX: faceCenterX,
    centerY: Number((faceTopY + faceHeightPx / 2).toFixed(2)),
  };

  // Auto-calculate Right Column non-overlapping block heights based on content density
  const orientationH = 146;
  const legendH = 158;
  const setRows = Math.max(1, Math.min(7, jointSets.length));
  const desiredTableH = Math.max(265, Math.min(410, 82 + setRows * 38 + Math.min(6, joints.length) * 18));
  const gap = 8;
  const remainingForQ = Math.max(
    220,
    availHeight - orientationH - legendH - desiredTableH - gap * 3
  );
  const actualTableH = availHeight - orientationH - legendH - remainingForQ - gap * 3;

  const orientationBlock: SheetRect = {
    x: rightColX,
    y: contentTopY,
    width: rightColW,
    height: orientationH,
  };

  const legendBlock: SheetRect = {
    x: rightColX,
    y: orientationBlock.y + orientationBlock.height + gap,
    width: rightColW,
    height: legendH,
  };

  const jointTableBlock: SheetRect = {
    x: rightColX,
    y: legendBlock.y + legendBlock.height + gap,
    width: rightColW,
    height: actualTableH,
  };

  const qIndexAndNotesBlock: SheetRect = {
    x: rightColX,
    y: jointTableBlock.y + jointTableBlock.height + gap,
    width: rightColW,
    height: remainingForQ,
  };

  const getSurfaceSheetRect = (surface: SurfaceType) => {
    if (surface === 'face') {
      return {
        ...faceSurfaceRect,
        pxPerMeter: facePxPerMeter,
      };
    }
    if (surface === 'crown') {
      return {
        x: crownLeftX,
        y: planTopY,
        width: crownW_px,
        height: roundH_px,
        centerX: crownLeftX + crownW_px / 2,
        centerY: planTopY + roundH_px / 2,
        pxPerMeter: perimeterPxPerMeter,
      };
    }
    if (surface === 'leftWall') {
      return {
        x: leftWallLeftX,
        y: planTopY,
        width: wallW_px,
        height: roundH_px,
        centerX: leftWallLeftX + wallW_px / 2,
        centerY: planTopY + roundH_px / 2,
        pxPerMeter: perimeterPxPerMeter,
      };
    }
    return {
      x: rightWallLeftX,
      y: planTopY,
      width: wallW_px,
      height: roundH_px,
      centerX: rightWallLeftX + wallW_px / 2,
      centerY: planTopY + roundH_px / 2,
      pxPerMeter: perimeterPxPerMeter,
    };
  };

  // Section 3: Exact same world/canvas coordinate registration for photo transform on the sheet
  const getSheetPhotoSvgTransform = (
    surface: SurfaceType,
    transform: SurfaceTransform
  ): string => {
    const rect = getSurfaceSheetRect(surface);
    const dxPx = (transform.offsetX || 0) * rect.pxPerMeter;
    const dyPx = -(transform.offsetY || 0) * rect.pxPerMeter;
    const zoom = transform.zoom ?? 1;
    const sx = (transform.scaleX || 1) * zoom;
    const sy = (transform.scaleY || 1) * zoom;
    const rot = transform.rotation || 0;

    return `translate(${rect.centerX + dxPx}, ${rect.centerY + dyPx}) rotate(${rot}) scale(${sx}, ${sy}) translate(${-rect.centerX}, ${-rect.centerY})`;
  };

  // Convert real-world tunnel meters on any surface to sheet SVG (x, y)
  const surfacePointToSheetXY = (
    pt: Point2D,
    surface: SurfaceType
  ): { x: number; y: number } => {
    if (surface === 'face') {
      return {
        x: Number((faceCenterX + pt.x * facePxPerMeter).toFixed(2)),
        y: Number((faceBottomY - pt.y * facePxPerMeter).toFixed(2)),
      };
    }
    if (surface === 'crown') {
      return {
        x: Number((planCenterX + pt.x * perimeterPxPerMeter).toFixed(2)),
        y: Number((planTopY + roundH_px - pt.y * perimeterPxPerMeter).toFixed(2)),
      };
    }
    if (surface === 'leftWall') {
      const normAlongRound = Math.max(0, Math.min(1, pt.x / roundLen));
      const normHeight = Math.max(0, Math.min(1, pt.y / Math.max(0.5, geometry.wallHeight)));
      return {
        x: Number((leftWallLeftX + normHeight * wallW_px).toFixed(2)),
        y: Number((planTopY + roundH_px - normAlongRound * roundH_px).toFixed(2)),
      };
    }
    const normAlongRound = Math.max(0, Math.min(1, pt.x / roundLen));
    const normHeight = Math.max(0, Math.min(1, pt.y / Math.max(0.5, geometry.wallHeight)));
    return {
      x: Number((rightWallLeftX + (1 - normHeight) * wallW_px).toFixed(2)),
      y: Number((planTopY + roundH_px - normAlongRound * roundH_px).toFixed(2)),
    };
  };

  return {
    sheetW,
    sheetH,
    margin,
    showTitleAndTables,
    showPerimeterPlan,
    headerBox,
    drawingArenaBox,
    rightColumnBox,
    facePxPerMeter,
    faceCenterX,
    faceTopY,
    faceBottomY,
    faceWidthPx,
    faceHeightPx,
    faceSurfaceRect,
    perimeterPxPerMeter,
    planCenterX,
    planTopY,
    crownW_px,
    roundH_px,
    wallW_px,
    crownLeftX,
    leftWallLeftX,
    rightWallLeftX,
    roundLen,
    crownSpan,
    orientationBlock,
    legendBlock,
    jointTableBlock,
    qIndexAndNotesBlock,
    surfacePointToSheetXY,
    getSurfaceSheetRect,
    getSheetPhotoSvgTransform,
  };
}
