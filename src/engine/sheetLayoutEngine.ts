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

export interface SheetTableColumnMetric {
  key: string;
  label: string;
  x: number;
  width: number;
  maxChars: number;
  subMaxChars: number;
}

export interface SheetContentMetrics {
  fontScale: number;
  headerTitleFontSize: number;
  headerMetaFontSize: number;
  blockTitleFontSize: number;
  tableHeaderFontSize: number;
  tableCellFontSize: number;
  tableSubCellFontSize: number;
  tableRowHeight: number;
  maxVisibleJointSets: number;
  maxVisibleOverbreakZones: number;
  notesFontSize: number;
  notesLineSpacing: number;
  notesMaxCharsPerLine: number;
  legendFontSize: number;
  legendRowSpacing: number;
  maxLegendLithologyRows: number;
  compactMode: boolean;
  discontinuityColumns: SheetTableColumnMetric[];
  overbreakColumns: SheetTableColumnMetric[];
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
  contentMetrics: SheetContentMetrics;

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
 * Word-wraps a string into at most `maxLines` lines of `maxCharsPerLine` characters
 * so engineering sheet notes and descriptions never clip or overflow their box.
 */
export function wrapSheetTextLines(
  text: string,
  maxCharsPerLine: number,
  maxLines: number
): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return ['—'];
  const safeMaxChars = Math.max(24, maxCharsPerLine);
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= safeMaxChars) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        if (lines.length >= maxLines) {
          const last = lines[maxLines - 1];
          lines[maxLines - 1] =
            last.length > safeMaxChars - 1 ? `${last.slice(0, safeMaxChars - 1)}…` : `${last}…`;
          return lines;
        }
      }
      current = word.length > safeMaxChars ? word.slice(0, safeMaxChars) : word;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : ['—'];
}

/**
 * Content-Aware & Space-Aware Final Engineering Sheet Auto-Layout Engine.
 *
 * Automatically calculates required page layout from actual content, resizes/positions
 * photos, geological drawings, tables, legends, dimensions, and text, and reduces font
 * size / row height when content is dense without ever shrinking the main geological drawing.
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
  overbreakZoneCount?: number;
  notesTextLength?: number;
  placedSymbolCount?: number;
  controlPointCount?: number;
  sectionVolumeRowCount?: number;
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
    overbreakZoneCount = 0,
    notesTextLength = 0,
    placedSymbolCount = 0,
    controlPointCount = 0,
    sectionVolumeRowCount = 0,
  } = params;

  // Landscape A3 Engineering Sheet (1600 x 1130 high-resolution technical drawing space)
  const sheetW = 1600;
  const sheetH = 1130;
  const margin = 16;

  const showTitleAndTables =
    outputMode === 'FINAL_ENGINEERING_SHEET' ||
    outputMode === 'CLEAN_MAPPING_DRAWING' ||
    outputMode === 'ENGINEERING_QUANTITY_SHEET';

  // Content density analysis to automatically scale fonts, row heights, and block heights
  const uniqueLithologyCount = Math.max(
    1,
    new Set(lithologyRegions.map((r) => r.patternType)).size || 5
  );
  const activeSetCount = Math.max(1, jointSets.length);
  const activeZoneCount = Math.max(1, overbreakZoneCount);
  const activeRowCount =
    outputMode === 'ENGINEERING_QUANTITY_SHEET' ? activeZoneCount : activeSetCount;

  const totalContentLoad =
    activeRowCount * 1.45 +
    Math.min(12, joints.length) * 0.22 +
    Math.min(6, uniqueLithologyCount) * 0.35 +
    (notesTextLength > 240 ? 2.4 : notesTextLength > 120 ? 1.4 : 0) +
    (sectionVolumeRowCount > 2 ? 1.0 : 0);

  const compactMode = totalContentLoad > 8.0 || activeRowCount > 5 || notesTextLength > 180;
  const ultraDenseMode = totalContentLoad > 12.0 || activeRowCount > 8 || notesTextLength > 320;

  const fontScale = ultraDenseMode
    ? 0.82
    : activeRowCount > 7
    ? 0.86
    : activeRowCount > 5 || notesTextLength > 220
    ? 0.91
    : compactMode
    ? 0.95
    : 1.0;

  // Header Block (Priority 6: Project Information - compact when content is dense)
  const headerH = showTitleAndTables ? (ultraDenseMode ? 62 : compactMode ? 66 : 72) : 0;
  const headerBox: SheetRect = {
    x: margin + 4,
    y: margin + 4,
    width: sheetW - (margin + 4) * 2,
    height: headerH,
  };

  const contentTopY = showTitleAndTables ? headerBox.y + headerBox.height + 8 : margin + 10;
  const contentBottomY = sheetH - margin - 8;
  const availHeight = contentBottomY - contentTopY;

  // Right Column (Priorities 3, 4, 5, 7, 8)
  // Core Rule: Keep main geological drawing arena prominent while giving tables, legend, and stereonet generous space.
  const rightColW = showTitleAndTables ? (compactMode ? 542 : 552) : 0;
  const rightColX = sheetW - margin - 4 - rightColW;
  const rightColumnBox: SheetRect = {
    x: rightColX,
    y: contentTopY,
    width: rightColW,
    height: availHeight,
  };

  // Left/Center Main Drawing Arena (Priorities 1 & 2)
  const arenaLeftX = margin + 4;
  const arenaRightX = showTitleAndTables ? rightColX - 10 : sheetW - margin - 4;
  const drawingArenaBox: SheetRect = {
    x: arenaLeftX,
    y: contentTopY,
    width: arenaRightX - arenaLeftX,
    height: availHeight,
  };

  const showPerimeterPlan =
    arrangement !== 'MAXIMIZE_FACE' &&
    outputMode !== 'EXPORT_PHOTO_ONLY';

  const roundLen = Math.max(1.5, settings.roundLength || 3.5);
  // Strict Geometric Rule: The Developed Perimeter Crown length MUST equal the Tunnel Face Crown Arc Length (geometry.crownArcLength),
  // and each Developed Perimeter Side Wall width MUST equal the Tunnel Face Side Wall Height (geometry.wallHeight).
  const crownSpan = Math.max(geometry.width, geometry.crownArcLength);
  // Unfolded Left Wall + Crown Arc + Right Wall total horizontal span in meters (strictly follows fixed perimeter ratio)
  const totalDevelopedWidthMeters = geometry.wallHeight * 2 + crownSpan;

  // Reserve space for dimension lines & callout labels so nothing is ever clipped
  const hasDenseCallouts = joints.length + placedSymbolCount + controlPointCount > 8;
  const arenaPadW = hasDenseCallouts ? 102 : 90;
  const arenaPadH = hasDenseCallouts ? 114 : 102;

  // UNIFIED TRUE ENGINEERING SCALE:
  // Both the Developed Perimeter (Left Wall, Crown, Right Wall) AND the Tunnel Face
  // use the EXACT SAME pxPerMeter scale so that:
  //   1. Developed Crown length (crownW_px) === Tunnel Face Crown Arc Length (geometry.crownArcLength * facePxPerMeter)
  //   2. Developed Left & Right Wall width (wallW_px) === Tunnel Face Wall Height (geometry.wallHeight * facePxPerMeter)
  //   3. Round/Pull height (roundH_px) === roundLen * facePxPerMeter
  const totalHorizontalMeters = showPerimeterPlan ? totalDevelopedWidthMeters : geometry.width;
  const totalVerticalMeters = showPerimeterPlan ? roundLen + geometry.height : geometry.height;

  const availDrawingW = Math.max(380, drawingArenaBox.width - arenaPadW);
  const availDrawingH = Math.max(380, drawingArenaBox.height - arenaPadH);

  const unifiedPxPerMeter = Number(
    Math.min(
      availDrawingW / Math.max(1, totalHorizontalMeters),
      availDrawingH / Math.max(1, totalVerticalMeters)
    ).toFixed(3)
  );

  const facePxPerMeter = unifiedPxPerMeter;
  const perimeterPxPerMeter = unifiedPxPerMeter;

  const planCenterX = Number((drawingArenaBox.x + drawingArenaBox.width / 2).toFixed(1));
  const faceWidthPx = Number((geometry.width * facePxPerMeter).toFixed(2));
  const faceHeightPx = Number((geometry.height * facePxPerMeter).toFixed(2));

  // Exact 1:1 dimensional equality at unified engineering scale:
  // crownW_px === Face Crown Arc Length in pixels (crownSpan * unifiedPxPerMeter)
  // wallW_px  === Face Wall Height in pixels (geometry.wallHeight * unifiedPxPerMeter)
  const crownW_px = Number((crownSpan * perimeterPxPerMeter).toFixed(2));
  const wallW_px = Number((geometry.wallHeight * perimeterPxPerMeter).toFixed(2));
  const roundH_px = Number((roundLen * perimeterPxPerMeter).toFixed(2));

  // Vertically center the unified [Developed Perimeter + Projection Gap + Tunnel Face] assembly
  const interViewGapPx = showPerimeterPlan ? 54 : 0;
  const totalAssemblyHeightPx = (showPerimeterPlan ? roundH_px + interViewGapPx : 0) + faceHeightPx;
  const assemblyTopY =
    drawingArenaBox.y +
    Math.max(28, (drawingArenaBox.height - totalAssemblyHeightPx) / 2);

  const planTopY = Number(assemblyTopY.toFixed(1));
  const crownLeftX = Number((planCenterX - crownW_px / 2).toFixed(2));
  const leftWallLeftX = Number((crownLeftX - wallW_px).toFixed(2));
  const rightWallLeftX = Number((crownLeftX + crownW_px).toFixed(2));

  const faceCenterX = planCenterX;
  const faceTopY = Number(
    (showPerimeterPlan ? planTopY + roundH_px + interViewGapPx : assemblyTopY).toFixed(2)
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

  // ============================================================================
  // SPACE-AWARE & CONTENT-AWARE RIGHT COLUMN AUTO-EXPANSION:
  // When vertical space is available in the 1010px right column, automatically
  // increase the Stereographic Box, Legend Box, Table Box, and Q-Index/Notes Box
  // and scale up their internal content (stereonet radius, legend swatches/text,
  // table row height & cell fonts) so available space is utilized efficiently.
  // ============================================================================
  const gap = ultraDenseMode ? 6 : compactMode ? 7 : 8;
  const totalUsableRightH = availHeight - gap * 3;

  const maxLegendLithologyRows = Math.min(6, Math.max(5, uniqueLithologyCount));
  const maxVisibleJointSets = Math.min(12, Math.max(1, jointSets.length));
  const maxVisibleOverbreakZones = Math.min(10, Math.max(1, overbreakZoneCount));
  const targetRows =
    outputMode === 'ENGINEERING_QUANTITY_SHEET'
      ? maxVisibleOverbreakZones
      : maxVisibleJointSets;

  // Base minimum heights required by content
  const minOrientationH = ultraDenseMode ? 146 : compactMode ? 162 : 178;
  const minLegendH = ultraDenseMode ? 144 : compactMode ? 162 : 178;
  const minQBlockH =
    notesTextLength > 260
      ? 258
      : notesTextLength > 140
      ? 244
      : ultraDenseMode
      ? 218
      : compactMode
      ? 232
      : 246;
  const minRowH = targetRows <= 3 ? 42 : targetRows <= 5 ? 36 : targetRows <= 7 ? 30 : 23;
  const minTableH = Math.max(215, 44 + targetRows * minRowH);

  const baseSumH = minOrientationH + minLegendH + minTableH + minQBlockH;
  const surplusH = Math.max(0, totalUsableRightH - baseSumH);

  // Distribute any available surplus height across Stereographic (22%), Legend (22%), Table (34%), and Q/Notes (22%)
  const orientationH = Math.round(
    Math.min(216, minOrientationH + surplusH * 0.22)
  );
  const legendH = Math.round(
    Math.min(216, minLegendH + surplusH * 0.22)
  );
  const desiredTableH = Math.round(
    Math.min(
      totalUsableRightH - orientationH - legendH - minQBlockH,
      minTableH + surplusH * 0.34
    )
  );
  const actualTableH = Math.max(195, desiredTableH);
  const remainingForQ = Math.max(
    minQBlockH,
    totalUsableRightH - orientationH - legendH - actualTableH
  );

  // Dynamically scale Legend row spacing & font size based on expanded legendH
  const legendRowSpacing = Number(
    Math.max(20, Math.min(30, (legendH - 38) / Math.max(5, maxLegendLithologyRows))).toFixed(1)
  );
  const legendExpansionBoost = Math.max(1.0, Math.min(1.22, legendH / 152));

  // Dynamically scale Table row height & font size based on expanded actualTableH
  const computedRowH = Math.max(
    19,
    Math.min(54, Math.floor((actualTableH - 44) / Math.max(1, targetRows)))
  );
  const tableExpansionBoost =
    computedRowH >= 42
      ? 1.2
      : computedRowH >= 34
      ? 1.14
      : computedRowH >= 28
      ? 1.07
      : computedRowH < 22
      ? 0.86
      : 1.0;
  const effectiveTableFontScale = Number(
    Math.max(0.84, Math.min(1.22, fontScale * tableExpansionBoost)).toFixed(3)
  );

  // Compute responsive column metrics for Discontinuity-Set Table
  const colScale = rightColW / 506;
  const discBoundaries = [
    0,
    Math.round(46 * colScale),
    Math.round(142 * colScale),
    Math.round(216 * colScale),
    Math.round(280 * colScale),
    Math.round(350 * colScale),
    rightColW,
  ];
  const charPx = 4.65 * effectiveTableFontScale;
  const subCharPx = 4.15 * effectiveTableFontScale;

  const discontinuityColumns: SheetTableColumnMetric[] = [
    {
      key: 'set',
      label: 'SET',
      x: discBoundaries[0],
      width: discBoundaries[1] - discBoundaries[0],
      maxChars: 5,
      subMaxChars: 5,
    },
    {
      key: 'orientation',
      label: 'DIP DIR / DIP',
      x: discBoundaries[1],
      width: discBoundaries[2] - discBoundaries[1],
      maxChars: Math.floor((discBoundaries[2] - discBoundaries[1] - 8) / charPx),
      subMaxChars: Math.floor((discBoundaries[2] - discBoundaries[1] - 8) / subCharPx),
    },
    {
      key: 'spacing',
      label: 'SPACING',
      x: discBoundaries[2],
      width: discBoundaries[3] - discBoundaries[2],
      maxChars: Math.floor((discBoundaries[3] - discBoundaries[2] - 8) / charPx),
      subMaxChars: Math.floor((discBoundaries[3] - discBoundaries[2] - 8) / subCharPx),
    },
    {
      key: 'persistence',
      label: 'PERSIST.',
      x: discBoundaries[3],
      width: discBoundaries[4] - discBoundaries[3],
      maxChars: Math.floor((discBoundaries[4] - discBoundaries[3] - 8) / charPx),
      subMaxChars: Math.floor((discBoundaries[4] - discBoundaries[3] - 8) / subCharPx),
    },
    {
      key: 'aperture',
      label: 'APERTURE',
      x: discBoundaries[4],
      width: discBoundaries[5] - discBoundaries[4],
      maxChars: Math.floor((discBoundaries[5] - discBoundaries[4] - 8) / charPx),
      subMaxChars: Math.floor((discBoundaries[5] - discBoundaries[4] - 8) / subCharPx),
    },
    {
      key: 'roughness',
      label: 'ROUGHNESS / INFILL',
      x: discBoundaries[5],
      width: discBoundaries[6] - discBoundaries[5],
      maxChars: Math.floor((discBoundaries[6] - discBoundaries[5] - 10) / charPx),
      subMaxChars: Math.floor((discBoundaries[6] - discBoundaries[5] - 10) / subCharPx),
    },
  ];

  const obBoundaries = [
    0,
    Math.round(54 * colScale),
    Math.round(148 * colScale),
    Math.round(226 * colScale),
    Math.round(288 * colScale),
    rightColW,
  ];

  const overbreakColumns: SheetTableColumnMetric[] = [
    {
      key: 'zone',
      label: 'ZONE',
      x: obBoundaries[0],
      width: obBoundaries[1] - obBoundaries[0],
      maxChars: 6,
      subMaxChars: 6,
    },
    {
      key: 'sector',
      label: 'SECTOR',
      x: obBoundaries[1],
      width: obBoundaries[2] - obBoundaries[1],
      maxChars: Math.floor((obBoundaries[2] - obBoundaries[1] - 8) / charPx),
      subMaxChars: Math.floor((obBoundaries[2] - obBoundaries[1] - 8) / subCharPx),
    },
    {
      key: 'area',
      label: 'AREA / %',
      x: obBoundaries[2],
      width: obBoundaries[3] - obBoundaries[2],
      maxChars: Math.floor((obBoundaries[3] - obBoundaries[2] - 8) / charPx),
      subMaxChars: Math.floor((obBoundaries[3] - obBoundaries[2] - 8) / subCharPx),
    },
    {
      key: 'maxRad',
      label: 'MAX RAD.',
      x: obBoundaries[3],
      width: obBoundaries[4] - obBoundaries[3],
      maxChars: Math.floor((obBoundaries[4] - obBoundaries[3] - 8) / charPx),
      subMaxChars: Math.floor((obBoundaries[4] - obBoundaries[3] - 8) / subCharPx),
    },
    {
      key: 'reason',
      label: 'REASON CATEGORY & LINKED SETS',
      x: obBoundaries[4],
      width: obBoundaries[5] - obBoundaries[4],
      maxChars: Math.floor((obBoundaries[5] - obBoundaries[4] - 10) / charPx),
      subMaxChars: Math.floor((obBoundaries[5] - obBoundaries[4] - 10) / subCharPx),
    },
  ];

  const qExpansionBoost = Math.max(1.0, Math.min(1.18, remainingForQ / 225));
  const notesFontSize = Number((8.5 * fontScale * qExpansionBoost).toFixed(2));
  const notesLineSpacing = Number((Math.max(12.0, 15.2 * fontScale * qExpansionBoost)).toFixed(1));
  const notesMaxCharsPerLine = Math.floor((rightColW - 24) / (notesFontSize * 0.58));

  const contentMetrics: SheetContentMetrics = {
    fontScale,
    headerTitleFontSize: Number((14.4 * Math.max(0.9, fontScale)).toFixed(2)),
    headerMetaFontSize: Number((10.2 * Math.max(0.9, fontScale)).toFixed(2)),
    blockTitleFontSize: Number((10.6 * Math.max(0.9, fontScale * Math.min(1.12, legendExpansionBoost))).toFixed(2)),
    tableHeaderFontSize: Number((8.5 * effectiveTableFontScale).toFixed(2)),
    tableCellFontSize: Number((8.9 * effectiveTableFontScale).toFixed(2)),
    tableSubCellFontSize: Number((7.8 * effectiveTableFontScale).toFixed(2)),
    tableRowHeight: computedRowH,
    maxVisibleJointSets,
    maxVisibleOverbreakZones,
    notesFontSize,
    notesLineSpacing,
    notesMaxCharsPerLine,
    legendFontSize: Number((8.9 * Math.max(0.9, fontScale * legendExpansionBoost)).toFixed(2)),
    legendRowSpacing,
    maxLegendLithologyRows,
    compactMode,
    discontinuityColumns,
    overbreakColumns,
  };

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

  // Exact same world/canvas coordinate registration for photo transform on the sheet
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
    contentMetrics,
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
