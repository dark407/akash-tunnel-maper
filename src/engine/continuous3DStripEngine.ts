import {
  Joint,
  LithologyRegion,
  PlacedGeologicalSymbol,
  Point2D,
  SavedProjectRecord,
  TunnelGeometry,
  TunnelSettings,
} from '../types/tunnel';

export type StripRockTypeId =
  | 'Quartzite'
  | 'Phyllite'
  | 'Metasandstone'
  | 'Mica Schist'
  | 'Quartzitic Phyllite'
  | 'Phyllitic Quartzite'
  | 'Siltstone'
  | 'Shale'
  | 'Quartz veins'
  | 'Dolerite';

export type StripFillingThicknessId =
  | 'None'
  | 'Clay Coated'
  | '2~5cm'
  | '5~10cm'
  | '>10cm';

export type StripStructureTypeId =
  | 'JS1 - Foliation'
  | 'JS2 - Main Joint'
  | 'JS3 - Main Joint'
  | 'Secondary Joint'
  | 'Shear Joint (5-30mm)'
  | 'Shear Zone'
  | 'Fault'
  | 'Gouge/Clay Seam'
  | 'Vertical Joint'
  | 'Geological Boundary'
  | 'Lithological Boundary'
  | 'Bedding'
  | 'Joint'
  | 'Foliation'
  | 'Joint Plane/Surface'
  | 'Fractured';

export type StripGroundwaterId =
  | 'Dry'
  | 'Moist/Damp'
  | 'Wet'
  | 'Dripping'
  | 'Flowing';

export interface ContinuousStripTrace {
  id: string;
  structureType: StripStructureTypeId;
  setId: string;
  /** Dip direction (0-360) and dip range label e.g. "205/70-75" or "065/45" */
  orientationLabel: string;
  dipDirectionDeg: number;
  dipDeg: number;
  fillingThickness: StripFillingThicknessId;
  /** Current active points (or AI-aligned points when AI align is committed) */
  points: Point2D[];
  /** Original raw photo-traced points before AI trend alignment (shows kinks/offsets across pulls) */
  rawPoints?: Point2D[];
  /** AI trend-aligned smooth points across pull boundaries */
  aiAlignedPoints?: Point2D[];
  colorHex?: string;
}

export interface ContinuousStripLithologyZone {
  id: string;
  rockType: StripRockTypeId;
  codeSymbol?: string; // e.g. 'Qtz', 'Ph', 'Mm', 'Ms', 'QP', 'PQ'
  label: string;
  polygon: Point2D[];
  isIntrusionBody?: boolean;
  isFracturedZone?: boolean;
}

export interface ContinuousStripWaterSymbol {
  id: string;
  condition: StripGroundwaterId;
  position: Point2D;
  label?: string;
}

export interface ContinuousPullRecord {
  id: string;
  fromRd: number;
  toRd: number;
  /** True field drive azimuth (0-360 deg N, supports 1° turns) */
  driveAzimuthDeg: number;
  /** Tunnel gradient in % e.g. 0.166 */
  gradientPct?: number;
  /** Opposite/reference wall azimuth */
  leftBoundaryAzimuthDeg: number;
  /** Convergence-Divergence max recorded (mm), e.g. "-2mm" */
  convergenceMm?: string;
  rockType: string;
  rockDescription?: string;
  rockClass: string;
  weatheringCondition: string;
  ucsRangeMpa: string;
  rmrValue?: number;
  rqdValue?: number;
  seepageCondition: string;
  structureDescription?: string;
  foliationCharacteristics?: string;
  overbreakVolumeM3?: number;
  excavationDefiningNo?: string;
  excavationDate?: string;
  supportClass?: string;
  shotcreteInstalled?: string;
  wireMeshInstalled?: string;
  rockBoltsInstalled?: string;
  steelRibsInstalled?: string;
  forepolingInstalled?: string;
  photoRollNo?: string;
  photoNegativeNo?: string;
  remarks?: string;
  supportDescription: string;
  status: 'MAPPED' | 'MISSING_GAP';
  linkedSavedProjectId?: string;
  dateMapped?: string;
}

export interface SheetCustomizationConfig {
  logoPlacement: 'TITLE_BLOCK' | 'TOP_BANNER' | 'BOTH';
  clientLogoText: string;
  clientSubtitle: string;
  projectTitleLine1: string;
  projectTitleLine2: string;
  consultantName: string;
  contractorName: string;
  clientLogoUrl?: string;
  consultantLogoUrl?: string;
  contractorLogoUrl?: string;
  drawingScaleLabel: string;
  drawingNumber: string;
  compiledBy: string;
  drawnBy: string;
  checkedBy: string;
  approvedBy: string;
  showConvergenceRow: boolean;
  showRmrRqdGraph: boolean;
  showOverbreakRow: boolean;
  showSupportDetailsRows: boolean;
  showPhotoRecordsRow: boolean;
  showKeyPlan: boolean;
  autoAdaptRowHeights: boolean;
}

export interface TunnelIntersectionConfig {
  /** ID of the parent/main tunnel dataset that this branch/adit/slashing connects to */
  parentDatasetId: string;
  /** Chainage (m) on the parent tunnel where this branch tunnel intersects */
  parentJunctionRd: number;
  /** Which wall/boundary of the parent strip this tunnel attaches to */
  attachWall: 'RIGHT_WALL' | 'LEFT_WALL' | 'PARALLEL_SEAM';
  /** Own chainage (m) at the junction portal (usually 0) */
  ownJunctionRd: number;
  /** Portal collar width in meters along the parent tunnel wall */
  portalWidthM: number;
  /** Label shown at the intersection portal ring */
  junctionLabel?: string;
}

export interface ContinuousTunnelStripDataset {
  id: string;
  projectName: string;
  tunnelLocationName: string;
  clientName: string;
  contractorName: string;
  geologistContractor: string;
  geologistClient: string;
  upperZoneLabel: string;
  lowerZoneLabel: string;
  upperZoneWidthM: number;
  lowerZoneWidthM: number;
  tunnelDiameterWidthM?: number;
  tunnelArchHeightM?: number;
  viewFromRd: number;
  viewToRd: number;
  leftCornerAzimuthLabel: string;
  rightCornerAzimuthLabel: string;
  pulls: ContinuousPullRecord[];
  traces: ContinuousStripTrace[];
  lithologyZones: ContinuousStripLithologyZone[];
  waterSymbols: ContinuousStripWaterSymbol[];
  narrativeBullets: string[];
  sheetConfig?: SheetCustomizationConfig;
  intersectionConfig?: TunnelIntersectionConfig;
  updatedAt: string;
}

const STORAGE_KEY = 'eswa_continuous_3d_strip_datasets_v5_clean';

export function getDefaultSheetConfig(
  dataset?: Partial<ContinuousTunnelStripDataset>
): SheetCustomizationConfig {
  return {
    logoPlacement: 'TITLE_BLOCK',
    clientLogoText: dataset?.clientName || '',
    clientSubtitle: '',
    projectTitleLine1: dataset?.projectName || '',
    projectTitleLine2: '',
    consultantName: '',
    contractorName: dataset?.contractorName || '',
    drawingScaleLabel: '1:100',
    drawingNumber: '',
    compiledBy: '',
    drawnBy: '',
    checkedBy: '',
    approvedBy: '',
    showConvergenceRow: true,
    showRmrRqdGraph: true,
    showOverbreakRow: true,
    showSupportDetailsRows: true,
    showPhotoRecordsRow: true,
    showKeyPlan: true,
    autoAdaptRowHeights: true,
  };
}

/**
 * Clean blank default workspace dataset (No example or demo records)
 */
export function createFreshDefaultStripDataset(): ContinuousTunnelStripDataset {
  return {
    id: 'dataset-fresh-workspace',
    projectName: 'New Tunnel Project',
    tunnelLocationName: 'Main Tunnel Heading',
    clientName: '',
    contractorName: '',
    geologistContractor: '',
    geologistClient: '',
    upperZoneLabel: 'LEFT WALL TO CROWN (SPRING LINE)',
    lowerZoneLabel: 'CROWN TO RIGHT WALL (SPRING LINE)',
    upperZoneWidthM: 7.5,
    lowerZoneWidthM: 7.5,
    tunnelDiameterWidthM: 8.4,
    tunnelArchHeightM: 7.2,
    viewFromRd: 0,
    viewToRd: 30,
    leftCornerAzimuthLabel: '180°N',
    rightCornerAzimuthLabel: '000°N',
    pulls: [],
    traces: [],
    lithologyZones: [],
    waterSymbols: [],
    narrativeBullets: [],
    sheetConfig: getDefaultSheetConfig({
      projectName: 'New Tunnel Project',
      tunnelLocationName: 'Main Tunnel Heading',
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pre-loaded Dataset 1: Power Tunnel Ch. 250m to 300m (Matches the user's uploaded PDF template)
 */
export function createPowerTunnelReferenceDataset(): ContinuousTunnelStripDataset {
  const pulls: ContinuousPullRecord[] = [
    {
      id: 'pt-250-255',
      fromRd: 250,
      toRd: 255,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '0 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO LIGHT YELLOW, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: '156.20 MPa (VERY STRONG)',
      rmrValue: 61,
      rqdValue: 74,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS FRACTURED & BLOCKY DUE TO CLOSELY SPACED JOINTS. SLABS ARE FORMED ON THE CROWN. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. SHEARED JOINTS ALONG JS1 WITH 0.5-2.5cm THICK CRUSHED ROCK AND CLAY ARE OBSERVED.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.2-1mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0,
      excavationDefiningNo: '2',
      excavationDate: '18/3/03',
      supportClass: '2/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '60/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '105',
      photoNegativeNo: '11-15',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 60/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-18',
    },
    {
      id: 'pt-255-260',
      fromRd: 255,
      toRd: 260,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '-1 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO LIGHT YELLOW, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: '156.20 MPa (VERY STRONG)',
      rmrValue: 61,
      rqdValue: 74,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS FRACTURED & BLOCKY DUE TO CLOSELY SPACED JOINTS. SLABS ARE FORMED ON THE CROWN. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. SHEARED JOINTS ALONG JS1 WITH 0.5-2.5cm THICK CRUSHED ROCK AND CLAY ARE OBSERVED.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.2-1mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0.448,
      excavationDefiningNo: '2',
      excavationDate: '18/3/03',
      supportClass: '2/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '60/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '105',
      photoNegativeNo: '29-30',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 60/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-18',
    },
    {
      id: 'pt-260-265',
      fromRd: 260,
      toRd: 265,
      driveAzimuthDeg: 161, // 1° smooth curve turn
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 341,
      convergenceMm: '-1 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO GREENISH GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: 'VERY STRONG (100-250 MPa)',
      rmrValue: 53,
      rqdValue: 61,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. JS1, JS2, JS3 & SECONDARY JOINTS ARE PROMINENT. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. TWO SHEARED ZONES ARE ALONG JS2 AND SECONDARY JOINTS WITH 2-10cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.2-1mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 1.009,
      excavationDefiningNo: '2',
      excavationDate: '18/3/03',
      supportClass: '2/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '60/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '',
      photoNegativeNo: '',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 60/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-19',
    },
    {
      id: 'pt-265-270',
      fromRd: 265,
      toRd: 270,
      driveAzimuthDeg: 161,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 341,
      convergenceMm: '-2 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO GREENISH GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: 'VERY STRONG (100-250 MPa)',
      rmrValue: 53,
      rqdValue: 61,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. JS1, JS2, JS3 & SECONDARY JOINTS ARE PROMINENT. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. TWO SHEARED ZONES ARE ALONG JS2 AND SECONDARY JOINTS WITH 2-10cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.2-1mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0.587,
      excavationDefiningNo: '2',
      excavationDate: '18/3/03',
      supportClass: '2/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '60/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '',
      photoNegativeNo: '',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 60/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-20',
    },
    {
      id: 'pt-270-275',
      fromRd: 270,
      toRd: 275,
      driveAzimuthDeg: 162, // Another 1° smooth turn
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 342,
      convergenceMm: '-2 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO GREENISH GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: 'VERY STRONG (100-250 MPa)',
      rmrValue: 51,
      rqdValue: 59,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. JS1, JS2, JS3 & SECONDARY JOINTS ARE PROMINENT. TWO SHEARED ZONES ARE ALONG JS2 AND SECONDARY JOINTS WITH 2-10cm THICK CRUSHED ROCK AND CLAY. ROCKMASS SHATTERED ALONG THE SHEARED ZONE.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0.552,
      excavationDefiningNo: '2',
      excavationDate: '18/3/03',
      supportClass: '2/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '60/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '106',
      photoNegativeNo: '12-14, 4-7',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 60/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-21',
    },
    {
      id: 'pt-275-280',
      fromRd: 275,
      toRd: 280,
      driveAzimuthDeg: 161,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 341,
      convergenceMm: '-1 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO GREENISH GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: 'VERY STRONG (100-250 MPa)',
      rmrValue: 58,
      rqdValue: 68,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. JS1, JS2, JS3 & SECONDARY JOINTS ARE PROMINENT. TWO SHEARED ZONES ARE ALONG JS2 AND SECONDARY JOINTS WITH 2-10cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 1.145,
      excavationDefiningNo: '2',
      excavationDate: '25/3/03',
      supportClass: '1/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '107',
      photoNegativeNo: '8, 9',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-25',
    },
    {
      id: 'pt-280-285',
      fromRd: 280,
      toRd: 285,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '0 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO GREENISH GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W2',
      ucsRangeMpa: 'VERY STRONG (100-250 MPa)',
      rmrValue: 58,
      rqdValue: 68,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. JS1, JS2, JS3 & SECONDARY JOINTS ARE PROMINENT.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0.073,
      excavationDefiningNo: '2',
      excavationDate: '25/3/03',
      supportClass: '1/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '108',
      photoNegativeNo: '30-33',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-25',
    },
    {
      id: 'pt-285-290',
      fromRd: 285,
      toRd: 290,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '0 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO LIGHT GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W1 - W2',
      ucsRangeMpa: '151.70 MPa (VERY STRONG)',
      rmrValue: 60,
      rqdValue: 66,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. SHEARED PLANES ARE ALONG SECONDARY JOINTS WITH 0.5-1cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0,
      excavationDefiningNo: '2',
      excavationDate: '25/3/03',
      supportClass: '1/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '',
      photoNegativeNo: '',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-26',
    },
    {
      id: 'pt-290-295',
      fromRd: 290,
      toRd: 295,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '0 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO LIGHT GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W1 - W2',
      ucsRangeMpa: '151.70 MPa (VERY STRONG)',
      rmrValue: 60,
      rqdValue: 66,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. SHEARED PLANES ARE ALONG SECONDARY JOINTS WITH 0.5-1cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0,
      excavationDefiningNo: '2',
      excavationDate: '25/3/03',
      supportClass: '1/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '109',
      photoNegativeNo: '1, 2',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-27',
    },
    {
      id: 'pt-295-300',
      fromRd: 295,
      toRd: 300,
      driveAzimuthDeg: 160,
      gradientPct: 0.166,
      leftBoundaryAzimuthDeg: 340,
      convergenceMm: '0 mm',
      rockType: 'Qtz - Quartzite',
      rockDescription:
        'REDDISH BROWN TO LIGHT GREY, MEDIUM GRAINED, VERY STRONG QUARTZITE.',
      rockClass: 'II',
      weatheringCondition: 'W1 - W2',
      ucsRangeMpa: '151.70 MPa (VERY STRONG)',
      rmrValue: 60,
      rqdValue: 66,
      seepageCondition: 'DRY',
      structureDescription:
        'ROCKMASS IS JOINTED & FRACTURED. SLABS ARE FORMED ON THE CROWN. IRON STAINS & CLAY ARE COMMONLY FOUND ON JS1 & JS2. SHEARED PLANES ARE ALONG SECONDARY JOINTS WITH 0.5-1cm THICK CRUSHED ROCK AND CLAY.',
      foliationCharacteristics:
        'FOLIATION JOINTS ARE VERY CLOSELY TO MEDIUM SPACED, CONTINUOUS, APERTURE 0.1-2mm, SLIGHTLY ROUGH TO SMOOTH WITH SILT AND CLAY FILLINGS.',
      overbreakVolumeM3: 0,
      excavationDefiningNo: '2',
      excavationDate: '25/3/03',
      supportClass: '1/3a',
      shotcreteInstalled: '10cm WET',
      wireMeshInstalled: '3.01 (kg/m²) 1 Layer',
      rockBoltsInstalled: '40/3m',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      photoRollNo: '110',
      photoNegativeNo: '8-11',
      remarks: '',
      supportDescription: '10cm Wet Shotcrete, 1 Layer Wire Mesh, 40/3m Rock Bolts',
      status: 'MAPPED',
      dateMapped: '2003-03-28',
    },
  ];

  const lithologyZones: ContinuousStripLithologyZone[] = [
    {
      id: 'pt-lith-qtz-1',
      rockType: 'Quartzite',
      codeSymbol: 'Qtz',
      label: 'Qtz - Reddish Brown to Light Yellow Very Strong Quartzite',
      polygon: [
        { x: 250, y: 0 },
        { x: 263, y: 0 },
        { x: 261, y: 18 },
        { x: 250, y: 18 },
      ],
    },
    {
      id: 'pt-lith-qtz-2',
      rockType: 'Quartzite',
      codeSymbol: 'Qtz',
      label: 'Qtz - Reddish Brown to Greenish Grey Very Strong Quartzite',
      polygon: [
        { x: 263, y: 0 },
        { x: 287, y: 0 },
        { x: 285, y: 18 },
        { x: 261, y: 18 },
      ],
    },
    {
      id: 'pt-lith-qtz-3',
      rockType: 'Quartzite',
      codeSymbol: 'Qtz',
      label: 'Qtz - Reddish Brown to Light Grey Very Strong Quartzite',
      polygon: [
        { x: 287, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 18 },
        { x: 285, y: 18 },
      ],
    },
    {
      id: 'pt-vein-1',
      rockType: 'Quartz veins',
      codeSymbol: '+ + +',
      label: 'Quartz Vein Band (+ + +)',
      isIntrusionBody: true,
      polygon: [
        { x: 262.0, y: 0.4 },
        { x: 264.2, y: 0.4 },
        { x: 281.5, y: 8.6 },
        { x: 279.8, y: 9.4 },
      ],
    },
    {
      id: 'pt-fractured-1',
      rockType: 'Phyllitic Quartzite',
      codeSymbol: 'PQ',
      label: 'Fractured / Shattered Rockmass along Shear Zone',
      isFracturedZone: true,
      polygon: [
        { x: 273.0, y: 5.5 },
        { x: 282.5, y: 10.2 },
        { x: 281.0, y: 12.6 },
        { x: 271.5, y: 7.8 },
      ],
    },
  ];

  // Note: rawPoints represent unaligned photo-traced segments with seam kinks/offsets across 5m pulls;
  // aiAlignedPoints / points represent the AI Trend-Aligned continuous structural trajectories!
  const traces: ContinuousStripTrace[] = [
    {
      id: 'pt-shear-zone-main',
      structureType: 'Shear Zone',
      setId: 'SZ-1',
      orientationLabel: '055/45',
      dipDirectionDeg: 55,
      dipDeg: 45,
      fillingThickness: '5~10cm',
      rawPoints: [
        { x: 256.5, y: 0.2 },
        { x: 260.0, y: 2.3 },
        { x: 260.4, y: 1.5 }, // photo seam kink at Ch. 260
        { x: 265.0, y: 4.1 },
        { x: 270.0, y: 6.9 },
        { x: 270.5, y: 5.8 }, // photo seam kink at Ch. 270
        { x: 275.0, y: 8.4 },
        { x: 285.5, y: 12.4 },
      ],
      aiAlignedPoints: [
        { x: 256.5, y: 0.2 },
        { x: 260.0, y: 1.9 },
        { x: 265.0, y: 4.3 },
        { x: 270.0, y: 6.7 },
        { x: 275.0, y: 9.1 },
        { x: 285.5, y: 12.4 },
      ],
      points: [
        { x: 256.5, y: 0.2 },
        { x: 260.0, y: 1.9 },
        { x: 265.0, y: 4.3 },
        { x: 270.0, y: 6.7 },
        { x: 275.0, y: 9.1 },
        { x: 285.5, y: 12.4 },
      ],
    },
    {
      id: 'pt-js1-fol-1',
      structureType: 'JS1 - Foliation',
      setId: 'JS1',
      orientationLabel: '050/50',
      dipDirectionDeg: 50,
      dipDeg: 50,
      fillingThickness: 'Clay Coated',
      rawPoints: [
        { x: 250.2, y: 14.5 },
        { x: 255.0, y: 8.8 },
        { x: 255.3, y: 9.9 }, // photo offset at Ch. 255
        { x: 260.0, y: 3.6 },
        { x: 263.2, y: 0.3 },
      ],
      aiAlignedPoints: [
        { x: 250.2, y: 14.5 },
        { x: 255.0, y: 9.1 },
        { x: 260.0, y: 3.7 },
        { x: 263.2, y: 0.3 },
      ],
      points: [
        { x: 250.2, y: 14.5 },
        { x: 255.0, y: 9.1 },
        { x: 260.0, y: 3.7 },
        { x: 263.2, y: 0.3 },
      ],
    },
    {
      id: 'pt-js1-fol-2',
      structureType: 'JS1 - Foliation',
      setId: 'JS1',
      orientationLabel: '052/48',
      dipDirectionDeg: 52,
      dipDeg: 48,
      fillingThickness: 'Clay Coated',
      rawPoints: [
        { x: 256.0, y: 17.6 },
        { x: 260.0, y: 13.4 },
        { x: 265.0, y: 7.5 },
        { x: 265.4, y: 8.6 }, // photo offset at Ch. 265
        { x: 271.5, y: 1.4 },
      ],
      aiAlignedPoints: [
        { x: 256.0, y: 17.6 },
        { x: 260.0, y: 13.3 },
        { x: 265.0, y: 8.0 },
        { x: 271.5, y: 1.4 },
      ],
      points: [
        { x: 256.0, y: 17.6 },
        { x: 260.0, y: 13.3 },
        { x: 265.0, y: 8.0 },
        { x: 271.5, y: 1.4 },
      ],
    },
    {
      id: 'pt-js2-joint-1',
      structureType: 'JS2 - Main Joint',
      setId: 'JS2',
      orientationLabel: '235/68',
      dipDirectionDeg: 235,
      dipDeg: 68,
      fillingThickness: '2~5cm',
      rawPoints: [
        { x: 264.0, y: 17.8 },
        { x: 270.0, y: 12.1 },
        { x: 270.4, y: 13.3 }, // photo offset at Ch. 270
        { x: 275.0, y: 7.4 },
        { x: 281.8, y: 1.2 },
      ],
      aiAlignedPoints: [
        { x: 264.0, y: 17.8 },
        { x: 270.0, y: 12.2 },
        { x: 275.0, y: 7.5 },
        { x: 281.8, y: 1.2 },
      ],
      points: [
        { x: 264.0, y: 17.8 },
        { x: 270.0, y: 12.2 },
        { x: 275.0, y: 7.5 },
        { x: 281.8, y: 1.2 },
      ],
    },
    {
      id: 'pt-js3-joint-1',
      structureType: 'JS3 - Main Joint',
      setId: 'JS3',
      orientationLabel: '315/72',
      dipDirectionDeg: 315,
      dipDeg: 72,
      fillingThickness: 'Clay Coated',
      rawPoints: [
        { x: 276.0, y: 0.4 },
        { x: 280.0, y: 3.5 },
        { x: 285.0, y: 6.9 },
        { x: 285.5, y: 5.8 }, // photo offset at Ch. 285
        { x: 292.0, y: 11.2 },
        { x: 298.8, y: 15.8 },
      ],
      aiAlignedPoints: [
        { x: 276.0, y: 0.4 },
        { x: 280.0, y: 3.1 },
        { x: 285.0, y: 6.5 },
        { x: 292.0, y: 11.2 },
        { x: 298.8, y: 15.8 },
      ],
      points: [
        { x: 276.0, y: 0.4 },
        { x: 280.0, y: 3.1 },
        { x: 285.0, y: 6.5 },
        { x: 292.0, y: 11.2 },
        { x: 298.8, y: 15.8 },
      ],
    },
    {
      id: 'pt-shear-joint-2',
      structureType: 'Shear Joint (5-30mm)',
      setId: 'SJ-2',
      orientationLabel: '140/65',
      dipDirectionDeg: 140,
      dipDeg: 65,
      fillingThickness: '2~5cm',
      rawPoints: [
        { x: 283.5, y: 17.5 },
        { x: 290.0, y: 11.8 },
        { x: 290.4, y: 12.9 }, // photo offset at Ch. 290
        { x: 295.0, y: 6.8 },
        { x: 299.6, y: 1.8 },
      ],
      aiAlignedPoints: [
        { x: 283.5, y: 17.5 },
        { x: 290.0, y: 11.2 },
        { x: 295.0, y: 6.3 },
        { x: 299.6, y: 1.8 },
      ],
      points: [
        { x: 283.5, y: 17.5 },
        { x: 290.0, y: 11.2 },
        { x: 295.0, y: 6.3 },
        { x: 299.6, y: 1.8 },
      ],
    },
  ];

  return {
    id: 'dataset-power-tunnel-250-300',
    projectName: 'MIDDLE MARSYANGDI HYDROELECTRIC PROJECT',
    tunnelLocationName: 'POWER TUNNEL (HRT)',
    clientName: 'Nepal Electricity Authority',
    contractorName: 'DYWIDAG — DRAGADOS — CWE JV',
    geologistContractor: 'B. R. Mahtee',
    geologistClient: 'Dr. Gunasekara (FJV)',
    upperZoneLabel: 'LEFT WALL TO CROWN (SPRING LINE)',
    lowerZoneLabel: 'CROWN TO RIGHT WALL (SPRING LINE)',
    upperZoneWidthM: 9.0,
    lowerZoneWidthM: 9.0,
    tunnelDiameterWidthM: 6.4,
    tunnelArchHeightM: 6.4,
    viewFromRd: 250,
    viewToRd: 300,
    leftCornerAzimuthLabel: '340°N',
    rightCornerAzimuthLabel: '160°N',
    pulls,
    traces,
    lithologyZones,
    waterSymbols: [],
    narrativeBullets: [
      'REPRESENTATIVE JOINTS ARE SHOWN IN THE MAP, THEIR NUMBERS BEING LIMITED BY THE SCALE OF MAP.',
      'INFORMATION FROM DAILY TUNNEL MAPPING/DOCUMENTATION (INCLUDING FACE MAPS) HAS BEEN USED AS THE BASIS FOR THIS DOCUMENT.',
      'STEEL RIBS USED IN POWER TUNNEL IS HEB-120. PROJECTION OF THE TUNNEL MAP IS DONE AS VIEWED FROM INSIDE THE TUNNEL.',
      '"-" REPRESENTS CONVERGENCE AND "+" REPRESENTS DIVERGENCE.',
    ],
    sheetConfig: getDefaultSheetConfig({
      projectName: 'MIDDLE MARSYANGDI HYDROELECTRIC PROJECT',
      tunnelLocationName: 'POWER TUNNEL (HRT)',
      clientName: 'Nepal Electricity Authority',
      contractorName: 'DYWIDAG — DRAGADOS — CWE JOINT VENTURE (CONTRACTORS)',
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pre-loaded Dataset 2: Gandikota Pumped Storage Project — Powerhouse RHS Slashing (RD 0m to 30m)
 */
export function createAdaniRithwikReferenceDataset(): ContinuousTunnelStripDataset {
  const pulls: ContinuousPullRecord[] = [
    {
      id: 'pull-0-5',
      fromRd: 0,
      toRd: 5,
      driveAzimuthDeg: 70,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 250,
      convergenceMm: '0 mm',
      rockType: 'Siltstone',
      rockDescription: 'Medium grained, reddish brown and grey colored Siltstone.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 64,
      rqdValue: 78,
      overbreakVolumeM3: 0.35,
      excavationDefiningNo: '1',
      excavationDate: '21/09/26',
      supportClass: 'Class II',
      structureDescription:
        'Bedding planes 045/08-12 and sub-vertical joint sets J1 (224/70-75) & F1 (320/70-75) observed.',
      foliationCharacteristics:
        'Joints closely to moderately spaced, continuous, clay coated to 2-5cm filling.',
      status: 'MAPPED',
      dateMapped: '2026-09-21',
    },
    {
      id: 'pull-5-10',
      fromRd: 5,
      toRd: 10,
      driveAzimuthDeg: 70,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 250,
      convergenceMm: '-1 mm',
      rockType: 'Siltstone',
      rockDescription: 'Medium grained, reddish brown and grey colored Siltstone.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 62,
      rqdValue: 75,
      overbreakVolumeM3: 0.42,
      excavationDefiningNo: '1',
      excavationDate: '22/09/26',
      supportClass: 'Class II',
      structureDescription:
        'Bedding planes and C-shaped quartz vein shear body encountered on crown/upper slashing.',
      foliationCharacteristics:
        'Slightly rough to smooth planar surfaces with thin clay coating.',
      status: 'MAPPED',
      dateMapped: '2026-09-22',
    },
    {
      id: 'pull-10-15',
      fromRd: 10,
      toRd: 15,
      driveAzimuthDeg: 70,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 250,
      convergenceMm: '-1 mm',
      rockType: 'Siltstone',
      rockDescription: 'Medium grained, reddish brown and grey colored Siltstone.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 60,
      rqdValue: 72,
      overbreakVolumeM3: 0.51,
      excavationDefiningNo: '1',
      excavationDate: '23/09/26',
      supportClass: 'Class II',
      structureDescription:
        'Lithological transition contact at RD 14.2~15.0m between Siltstone and Dolerite/Quartzite.',
      foliationCharacteristics:
        'Continuous joint traces 203/70-75 and 314/70-75 extending across pull seam.',
      status: 'MAPPED',
      dateMapped: '2026-09-23',
    },
    {
      id: 'pull-15-20',
      fromRd: 15,
      toRd: 20,
      driveAzimuthDeg: 71,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 251,
      convergenceMm: '-1 mm',
      rockType: 'QUARTZITE / Dolerite',
      rockDescription: 'Very strong Quartzite with upper Dolerite intrusion.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W1-W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 65,
      rqdValue: 80,
      overbreakVolumeM3: 0.28,
      excavationDefiningNo: '2',
      excavationDate: '24/09/26',
      supportClass: 'Class II',
      structureDescription:
        '1° tunnel drive alignment turn to 071°N. Joint sets 350/70-75 and 203/70-75 prominent.',
      foliationCharacteristics: 'Tight to 2-5cm filled joints, slightly rough planar.',
      status: 'MAPPED',
      dateMapped: '2026-09-24',
    },
    {
      id: 'pull-20-25',
      fromRd: 20,
      toRd: 25,
      driveAzimuthDeg: 71,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 251,
      convergenceMm: '0 mm',
      rockType: 'QUARTZITE / Dolerite',
      rockDescription: 'Very strong Quartzite with upper Dolerite intrusion.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W1-W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 66,
      rqdValue: 82,
      overbreakVolumeM3: 0.19,
      excavationDefiningNo: '2',
      excavationDate: '25/09/26',
      supportClass: 'Class II',
      structureDescription: 'Joint sets 205/70-75 and 314/70-75 observed.',
      foliationCharacteristics: 'Moderately spaced, continuous.',
      status: 'MAPPED',
      dateMapped: '2026-09-25',
    },
    {
      id: 'pull-25-30',
      fromRd: 25,
      toRd: 30,
      driveAzimuthDeg: 70,
      gradientPct: 0.1,
      leftBoundaryAzimuthDeg: 250,
      convergenceMm: '0 mm',
      rockType: 'QUARTZITE / Dolerite',
      rockDescription: 'Very strong Quartzite with upper Dolerite intrusion.',
      rockClass: 'II',
      supportDescription: '150mm THK. SFRS, Wire mesh, 8/10m length 32mm Dia SN Rock bolts',
      shotcreteInstalled: '150mm SFRS',
      wireMeshInstalled: '1 Layer Wire Mesh',
      rockBoltsInstalled: '8/10m 32mm Dia SN Bolts',
      steelRibsInstalled: '-',
      forepolingInstalled: '-',
      seepageCondition: 'DRY TO WET',
      weatheringCondition: 'W1-W2 (SL~UN WEATHERED)',
      ucsRangeMpa: '100~200 MPa',
      rmrValue: 68,
      rqdValue: 84,
      overbreakVolumeM3: 0.15,
      excavationDefiningNo: '2',
      excavationDate: '26/09/26',
      supportClass: 'Class II',
      structureDescription: 'Massive to blocky Quartzite and Dolerite.',
      foliationCharacteristics: 'Tight, unweathered joints.',
      status: 'MAPPED',
      dateMapped: '2026-09-26',
    },
  ];

  const lithologyZones: ContinuousStripLithologyZone[] = [
    {
      id: 'lith-siltstone-zone',
      rockType: 'Siltstone',
      codeSymbol: 'Slt',
      label: 'Siltstone (RD 0.0~15.0m)',
      polygon: [
        { x: 0, y: 0 },
        { x: 15.2, y: 0 },
        { x: 13.8, y: 18 },
        { x: 0, y: 18 },
      ],
    },
    {
      id: 'lith-dolerite-upper',
      rockType: 'Dolerite',
      codeSymbol: 'Dol',
      label: 'Dolerite Intrusion (RD 15.0~30.0m)',
      polygon: [
        { x: 14.2, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 9.2 },
        { x: 19.5, y: 8.5 },
      ],
    },
    {
      id: 'lith-quartzite-lower',
      rockType: 'Quartzite',
      codeSymbol: 'Qtz',
      label: 'Quartzite (RD 14.0~30.0m)',
      polygon: [
        { x: 14.2, y: 8.5 },
        { x: 30, y: 9.2 },
        { x: 30, y: 18 },
        { x: 13.8, y: 18 },
      ],
    },
    {
      id: 'lith-c-intrusion',
      rockType: 'Quartz veins',
      codeSymbol: '+ + +',
      label: 'C-Shaped Shear / Quartz Vein Body',
      isIntrusionBody: true,
      polygon: [
        { x: 3.1, y: 3.1 },
        { x: 7.4, y: 2.3 },
        { x: 7.6, y: 3.5 },
        { x: 4.6, y: 4.3 },
        { x: 4.5, y: 6.2 },
        { x: 7.2, y: 6.7 },
        { x: 7.4, y: 8.1 },
        { x: 3.4, y: 7.5 },
        { x: 2.6, y: 5.2 },
      ],
    },
  ];

  const traces: ContinuousStripTrace[] = [
    {
      id: 'tr-bed-045',
      structureType: 'Bedding',
      setId: 'J0',
      orientationLabel: '045/08-12',
      dipDirectionDeg: 45,
      dipDeg: 10,
      fillingThickness: 'Clay Coated',
      rawPoints: [
        { x: 0.0, y: 2.8 },
        { x: 5.0, y: 2.5 },
        { x: 5.3, y: 1.5 }, // photo kink
        { x: 10.0, y: 1.3 },
        { x: 15.5, y: 0.4 },
      ],
      aiAlignedPoints: [
        { x: 0.0, y: 2.8 },
        { x: 7.5, y: 1.6 },
        { x: 15.5, y: 0.4 },
      ],
      points: [
        { x: 0.0, y: 2.8 },
        { x: 7.5, y: 1.6 },
        { x: 15.5, y: 0.4 },
      ],
    },
    {
      id: 'tr-j-203',
      structureType: 'JS1 - Foliation',
      setId: 'JS1',
      orientationLabel: '203/70-75',
      dipDirectionDeg: 203,
      dipDeg: 73,
      fillingThickness: 'Clay Coated',
      rawPoints: [
        { x: 8.2, y: 1.4 },
        { x: 15.0, y: 8.6 },
        { x: 15.3, y: 7.1 }, // photo offset at pull boundary RD 15m
        { x: 20.0, y: 12.6 },
        { x: 24.5, y: 16.5 },
      ],
      aiAlignedPoints: [
        { x: 8.2, y: 1.4 },
        { x: 15.0, y: 7.7 },
        { x: 20.0, y: 12.3 },
        { x: 24.5, y: 16.5 },
      ],
      points: [
        { x: 8.2, y: 1.4 },
        { x: 15.0, y: 7.7 },
        { x: 20.0, y: 12.3 },
        { x: 24.5, y: 16.5 },
      ],
    },
    {
      id: 'tr-j-314-a',
      structureType: 'JS2 - Main Joint',
      setId: 'JS2',
      orientationLabel: '314/70-75',
      dipDirectionDeg: 314,
      dipDeg: 73,
      fillingThickness: '2~5cm',
      rawPoints: [
        { x: 3.5, y: 17.4 },
        { x: 10.0, y: 14.8 },
        { x: 10.4, y: 13.5 }, // photo offset at RD 10m
        { x: 20.0, y: 9.9 },
        { x: 20.3, y: 8.8 }, // photo offset at RD 20m
        { x: 30.0, y: 4.5 },
      ],
      aiAlignedPoints: [
        { x: 3.5, y: 17.4 },
        { x: 10.0, y: 14.2 },
        { x: 20.0, y: 9.4 },
        { x: 30.0, y: 4.5 },
      ],
      points: [
        { x: 3.5, y: 17.4 },
        { x: 10.0, y: 14.2 },
        { x: 20.0, y: 9.4 },
        { x: 30.0, y: 4.5 },
      ],
    },
    {
      id: 'tr-j-320',
      structureType: 'Fault',
      setId: 'F1',
      orientationLabel: '320/70-75',
      dipDirectionDeg: 320,
      dipDeg: 74,
      fillingThickness: '>10cm',
      rawPoints: [
        { x: 0.2, y: 11.4 },
        { x: 5.0, y: 10.2 },
        { x: 5.3, y: 9.0 },
        { x: 18.0, y: 5.0 },
      ],
      aiAlignedPoints: [
        { x: 0.2, y: 11.4 },
        { x: 8.5, y: 8.4 },
        { x: 18.0, y: 5.0 },
      ],
      points: [
        { x: 0.2, y: 11.4 },
        { x: 8.5, y: 8.4 },
        { x: 18.0, y: 5.0 },
      ],
    },
  ];

  const waterSymbols: ContinuousStripWaterSymbol[] = [
    {
      id: 'ws-1',
      condition: 'Moist/Damp',
      position: { x: 11.5, y: 11.0 },
      label: 'Damp',
    },
    {
      id: 'ws-2',
      condition: 'Dripping',
      position: { x: 22.0, y: 12.8 },
      label: 'Dripping',
    },
  ];

  return {
    id: 'dataset-gandikota-rhs-slashing',
    projectName: 'Gandikota Pumped Storage Project (Civil & Hydro-Mechanical Works)',
    tunnelLocationName: 'POWERHOUSE RHS SLASHING',
    clientName: 'adani',
    contractorName: 'RITHWIK',
    geologistContractor: 'Geologist - RPPL',
    geologistClient: 'Geologist - ADANI',
    upperZoneLabel: 'CENTRAL GULLET',
    lowerZoneLabel: 'RHS SLASHING',
    upperZoneWidthM: 8.5,
    lowerZoneWidthM: 9.5,
    tunnelDiameterWidthM: 8.4,
    tunnelArchHeightM: 6.5,
    viewFromRd: 0,
    viewToRd: 30,
    leftCornerAzimuthLabel: '250°N',
    rightCornerAzimuthLabel: '070°N',
    pulls,
    traces,
    lithologyZones,
    waterSymbols,
    narrativeBullets: [
      'Rock type encountered in POWER HOUSE RHS SLASHING in the zone of RD 0.0 ~ 15.0m is mainly Siltstone, Medium grained, reddish brown and grey colored, and from 15.0m to 30.0m is Dolerite & Quartzite. Ground water condition is almost found as Dry to Damp.',
      'Other than Bedding planes, there are other joints observed during excavation of Powerhouse Tunnel, these are with directions 230°~245° with true dip 70°~75°, 160°~180° with true dip 70°~75°, 310~315°/70~75°, 340~350°/70~85°, and 260°/70~75°.',
      'Weathering condition is mostly Unweathered to slightly weathered and UCS is observed to be 100~200Mpa.',
    ],
    sheetConfig: getDefaultSheetConfig({
      projectName: 'Gandikota Pumped Storage Project (Civil & Hydro-Mechanical Works)',
      tunnelLocationName: 'POWERHOUSE RHS SLASHING',
      clientName: 'ADANI GREEN ENERGY',
      contractorName: 'RITHWIK PROJECTS PVT LTD (RPPL)',
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * AI Structural Trend & Seam Alignment Engine:
 * - Preserves `rawPoints` (from photo-based round mapping)
 * - Stitches disconnected trace segments belonging to the same Set & Orientation across pull seams
 * - Smooths photo-perspective kinks along the dominant strike/dip trajectory (`aiAlignedPoints`)
 */
export function runAiTrendAlignmentOnDataset(
  dataset: ContinuousTunnelStripDataset
): {
  updatedDataset: ContinuousTunnelStripDataset;
  alignedCount: number;
  stitchedSeamsCount: number;
} {
  let alignedCount = 0;
  let stitchedSeamsCount = 0;

  // Step 1: Ensure every trace preserves its rawPoints before alignment
  const workingTraces: ContinuousStripTrace[] = dataset.traces.map((tr) => {
    const raw = tr.rawPoints && tr.rawPoints.length >= 2 ? tr.rawPoints : tr.points;
    return {
      ...tr,
      rawPoints: raw.map((p) => ({ ...p })),
    };
  });

  // Step 2: Check for collinear segments across pull seams with matching setId & similar dipDirection
  const mergedTraces: ContinuousStripTrace[] = [];
  const consumedIds = new Set<string>();

  for (let i = 0; i < workingTraces.length; i++) {
    const tA = workingTraces[i];
    if (consumedIds.has(tA.id)) continue;

    let combinedRaw = [...(tA.rawPoints || tA.points)].sort((a, b) => a.x - b.x);

    for (let j = i + 1; j < workingTraces.length; j++) {
      const tB = workingTraces[j];
      if (consumedIds.has(tB.id)) continue;
      if (tB.setId !== tA.setId) continue;

      const ptsB = [...(tB.rawPoints || tB.points)].sort((a, b) => a.x - b.x);
      const endA = combinedRaw[combinedRaw.length - 1];
      const startB = ptsB[0];
      const rdGap = Math.abs(startB.x - endA.x);
      const perimGap = Math.abs(startB.y - endA.y);

      if (rdGap <= 1.8 && perimGap <= 2.2) {
        // Stitch across pull seam!
        combinedRaw = [...combinedRaw, ...ptsB];
        consumedIds.add(tB.id);
        stitchedSeamsCount++;
      }
    }

    // Step 3: Compute least-squares trend-guided smooth polyline for combinedRaw
    const n = combinedRaw.length;
    if (n >= 2) {
      const first = combinedRaw[0];
      const last = combinedRaw[n - 1];
      const totalDx = last.x - first.x;
      const totalDy = last.y - first.y;

      const alignedPts: Point2D[] = combinedRaw.map((pt, idx) => {
        if (idx === 0 || idx === n - 1) {
          return { x: Number(pt.x.toFixed(2)), y: Number(pt.y.toFixed(2)) };
        }
        const frac =
          Math.abs(totalDx) > 0.05
            ? (pt.x - first.x) / totalDx
            : idx / Math.max(1, n - 1);
        const trendY = first.y + frac * totalDy;
        // Blend 82% structural strike/dip trend line + 18% local geological curvature
        const smoothY = trendY * 0.82 + pt.y * 0.18;
        return {
          x: Number(pt.x.toFixed(2)),
          y: Number(smoothY.toFixed(2)),
        };
      });

      // Remove duplicate/clustered seam kink points that are < 0.6m apart in RD
      const filteredAligned: Point2D[] = [alignedPts[0]];
      for (let k = 1; k < alignedPts.length - 1; k++) {
        const prev = filteredAligned[filteredAligned.length - 1];
        if (Math.abs(alignedPts[k].x - prev.x) >= 0.75) {
          filteredAligned.push(alignedPts[k]);
        }
      }
      filteredAligned.push(alignedPts[alignedPts.length - 1]);

      alignedCount++;
      mergedTraces.push({
        ...tA,
        rawPoints: combinedRaw,
        aiAlignedPoints: filteredAligned,
        points: filteredAligned,
      });
    } else {
      mergedTraces.push(tA);
    }
  }

  return {
    updatedDataset: {
      ...dataset,
      traces: mergedTraces,
      updatedAt: new Date().toISOString(),
    },
    alignedCount,
    stitchedSeamsCount,
  };
}

/**
 * Smooth Ribbon Warping Engine:
 * Converts any (rd, perimOffset) coordinate into a smooth, non-brittle curved ribbon SVG coordinate
 * by continuously integrating the tunnel drive azimuth with cosine smoothing across pull boundaries.
 */
export interface SmoothRibbonSample {
  rd: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  azimuthDeg: number;
  deltaDeg: number;
}

export function buildSmoothRibbonTransform(
  pulls: ContinuousPullRecord[],
  viewStartRd: number,
  viewEndRd: number,
  totalPerimM: number,
  startX: number,
  centerY: number,
  pxPerRdM: number,
  stripHeightPx: number,
  angularExaggeration = 3.2
) {
  const stepM = 0.25;
  const spanM = Math.max(1, viewEndRd - viewStartRd);
  const numSteps = Math.ceil(spanM / stepM) + 1;
  const baseAz = pulls[0]?.driveAzimuthDeg ?? 160;

  // Helper to get raw pull azimuth at any RD
  const getRawAzAtRd = (rd: number): number => {
    for (const p of pulls) {
      if (rd >= p.fromRd && rd <= p.toRd) return p.driveAzimuthDeg;
    }
    if (pulls.length === 0) return baseAz;
    if (rd < pulls[0].fromRd) return pulls[0].driveAzimuthDeg;
    return pulls[pulls.length - 1].driveAzimuthDeg;
  };

  // Smooth azimuth using a +/- 2.0m Gaussian/Cosine window so pull transitions bend smoothly without brittle corners
  const getSmoothAzAtRd = (rd: number): number => {
    const windowRadius = 2.2;
    const samples = 9;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < samples; i++) {
      const frac = (i / (samples - 1)) * 2 - 1; // -1 .. +1
      const sampleRd = rd + frac * windowRadius;
      const w = Math.cos((frac * Math.PI) / 2); // Smooth cosine bell
      weightedSum += getRawAzAtRd(sampleRd) * w;
      weightTotal += w;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : getRawAzAtRd(rd);
  };

  const samples: SmoothRibbonSample[] = [];
  let curX = startX;
  let curY = centerY;

  for (let i = 0; i < numSteps; i++) {
    const rd = Math.min(viewEndRd, viewStartRd + i * stepM);
    const smoothAz = getSmoothAzAtRd(rd);
    const deltaDeg = smoothAz - baseAz;
    const angleRad = ((deltaDeg * angularExaggeration) * Math.PI) / 180;
    const tx = Math.cos(angleRad);
    const ty = Math.sin(angleRad);
    const nx = -Math.sin(angleRad);
    const ny = Math.cos(angleRad);

    samples.push({
      rd,
      cx: curX,
      cy: curY,
      tx,
      ty,
      nx,
      ny,
      azimuthDeg: smoothAz,
      deltaDeg,
    });

    if (i < numSteps - 1) {
      const nextRd = Math.min(viewEndRd, viewStartRd + (i + 1) * stepM);
      const dRd = nextRd - rd;
      curX += tx * dRd * pxPerRdM;
      curY += ty * dRd * pxPerRdM;
    }
  }

  const getSampleAtRd = (rd: number): SmoothRibbonSample => {
    const clamped = Math.max(viewStartRd, Math.min(viewEndRd, rd));
    const idxFloat = (clamped - viewStartRd) / stepM;
    const i0 = Math.max(0, Math.min(samples.length - 1, Math.floor(idxFloat)));
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = idxFloat - i0;
    const s0 = samples[i0];
    const s1 = samples[i1];
    if (!s0) {
      return {
        rd: clamped,
        cx: startX,
        cy: centerY,
        tx: 1,
        ty: 0,
        nx: 0,
        ny: 1,
        azimuthDeg: baseAz,
        deltaDeg: 0,
      };
    }
    if (i0 === i1) return s0;
    return {
      rd: clamped,
      cx: s0.cx + (s1.cx - s0.cx) * frac,
      cy: s0.cy + (s1.cy - s0.cy) * frac,
      tx: s0.tx + (s1.tx - s0.tx) * frac,
      ty: s0.ty + (s1.ty - s0.ty) * frac,
      nx: s0.nx + (s1.nx - s0.nx) * frac,
      ny: s0.ny + (s1.ny - s0.ny) * frac,
      azimuthDeg: s0.azimuthDeg + (s1.azimuthDeg - s0.azimuthDeg) * frac,
      deltaDeg: s0.deltaDeg + (s1.deltaDeg - s0.deltaDeg) * frac,
    };
  };

  const mapRdPerimToSvg = (rd: number, perimM: number): Point2D => {
    const s = getSampleAtRd(rd);
    const normPerim = perimM / Math.max(1, totalPerimM) - 0.5; // -0.5 (top) to +0.5 (bottom)
    const offsetPx = normPerim * stripHeightPx;
    return {
      x: s.cx + s.nx * offsetPx,
      y: s.cy + s.ny * offsetPx,
    };
  };

  return {
    samples,
    baseAz,
    getSampleAtRd,
    mapRdPerimToSvg,
  };
}

export function loadAllContinuousStripDatasets(): ContinuousTunnelStripDataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaults = [createFreshDefaultStripDataset()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw) as ContinuousTunnelStripDataset[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createFreshDefaultStripDataset()];
    }
    return parsed;
  } catch {
    return [createFreshDefaultStripDataset()];
  }
}

export function saveAllContinuousStripDatasets(
  datasets: ContinuousTunnelStripDataset[]
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
  } catch {
    // ignore storage quota errors
  }
}

export function parsePullIntervalFromRecord(
  chainageStr: string,
  faceChainageStr: string,
  roundLengthM: number
): { fromRd: number; toRd: number } {
  const rangeMatch = chainageStr.match(/(\d+(?:\.\d+)?)\s*m?\s*[-–~to]+\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    if (!isNaN(a) && !isNaN(b) && Math.abs(b - a) > 0.05) {
      return { fromRd: Math.min(a, b), toRd: Math.max(a, b) };
    }
  }
  const numMatch = (faceChainageStr || chainageStr).match(/(\d+(?:\.\d+)?)/);
  const faceM = numMatch ? parseFloat(numMatch[1]) : 0;
  const pull = Math.max(1.0, roundLengthM || 3.5);
  const start = Math.max(0, Number((faceM - pull).toFixed(2)));
  return { fromRd: start, toRd: Number((start + pull).toFixed(2)) };
}

export function syncSavedProjectsIntoStripDatasets(
  existingDatasets: ContinuousTunnelStripDataset[],
  savedProjects: SavedProjectRecord[],
  activeSettings?: TunnelSettings,
  activeGeometry?: TunnelGeometry,
  _activeJoints?: Joint[],
  _activeLithology?: LithologyRegion[],
  _activeSymbols?: PlacedGeologicalSymbol[]
): ContinuousTunnelStripDataset[] {
  let list =
    existingDatasets.length > 0
      ? [...existingDatasets]
      : [createFreshDefaultStripDataset()];

  // If only the blank default workspace exists and the user entered a project/location name in setup, sync those names
  if (
    list.length === 1 &&
    list[0].id === 'dataset-fresh-workspace' &&
    list[0].pulls.length === 0 &&
    list[0].traces.length === 0
  ) {
    const activeProj = activeSettings?.projectName?.trim();
    const activeLoc =
      activeSettings?.locationName?.trim() || activeSettings?.tunnelName?.trim();
    if (activeProj || activeLoc) {
      list[0] = {
        ...list[0],
        projectName: activeProj || list[0].projectName,
        tunnelLocationName: activeLoc || list[0].tunnelLocationName,
        tunnelDiameterWidthM: activeGeometry?.width || list[0].tunnelDiameterWidthM,
        tunnelArchHeightM: activeGeometry?.height || list[0].tunnelArchHeightM,
      };
    }
  }

  const allRecords: SavedProjectRecord[] = [...savedProjects];

  const groups = new Map<string, SavedProjectRecord[]>();
  for (const rec of allRecords) {
    const pName = (rec.projectName || rec.settings?.projectName || 'Underground Project').trim();
    const tName = (rec.tunnelName || rec.location || 'Main Tunnel').trim();
    const key = `${pName}:::${tName}`;
    const arr = groups.get(key) || [];
    arr.push(rec);
    groups.set(key, arr);
  }

  groups.forEach((records, key) => {
    const [projectName, tunnelLocationName] = key.split(':::');
    let dataset = list.find(
      (d) =>
        d.projectName.trim().toLowerCase() === projectName.toLowerCase() &&
        d.tunnelLocationName.trim().toLowerCase() === tunnelLocationName.toLowerCase()
    );

    const firstGeom = records[0]?.geometry;
    const upperW = Number(
      ((firstGeom?.leftWallArcLength || 4.2) + (firstGeom?.crownArcLength || 6.0) * 0.5).toFixed(1)
    );
    const lowerW = Number(
      ((firstGeom?.rightWallArcLength || 4.2) + (firstGeom?.crownArcLength || 6.0) * 0.5).toFixed(1)
    );
    const totalPerimM = upperW + lowerW;

    if (!dataset) {
      const driveDeg = Math.round(records[0]?.settings?.driveDirection ?? 0);
      const oppDeg = (driveDeg + 180) % 360;
      dataset = {
        id: `ds-${projectName.replace(/\s+/g, '_')}-${tunnelLocationName.replace(/\s+/g, '_')}`,
        projectName,
        tunnelLocationName,
        clientName: records[0]?.settings?.sheetConfig?.clientName || '',
        contractorName: records[0]?.settings?.sheetConfig?.contractorName || '',
        geologistContractor: records[0]?.settings?.mappedBy || '',
        geologistClient: '',
        upperZoneLabel: 'LEFT WALL TO CROWN (SPRING LINE)',
        lowerZoneLabel: 'CROWN TO RIGHT WALL (SPRING LINE)',
        upperZoneWidthM: upperW,
        lowerZoneWidthM: lowerW,
        tunnelDiameterWidthM: firstGeom?.width || 8.4,
        tunnelArchHeightM: firstGeom?.height || 7.2,
        viewFromRd: 0,
        viewToRd: 30,
        leftCornerAzimuthLabel: `${String(oppDeg).padStart(3, '0')}°N`,
        rightCornerAzimuthLabel: `${String(driveDeg).padStart(3, '0')}°N`,
        pulls: [],
        traces: [],
        lithologyZones: [],
        waterSymbols: [],
        narrativeBullets: [],
        sheetConfig: getDefaultSheetConfig({
          projectName,
          tunnelLocationName,
        }),
        updatedAt: new Date().toISOString(),
      };
      list.push(dataset);
    }

    for (const rec of records) {
      const interval = parsePullIntervalFromRecord(
        rec.chainage,
        rec.faceChainage,
        rec.settings?.roundLength || 3.5
      );
      const existingPullIdx = dataset.pulls.findIndex(
        (p) => Math.abs(p.fromRd - interval.fromRd) < 0.2 && Math.abs(p.toRd - interval.toRd) < 0.2
      );
      const driveAz = Number((rec.settings?.driveDirection ?? 0).toFixed(1));
      const oppAz = Number(((driveAz + 180) % 360).toFixed(1));

      const pullObj: ContinuousPullRecord = {
        id: existingPullIdx >= 0 ? dataset.pulls[existingPullIdx].id : `pull-${interval.fromRd}-${interval.toRd}`,
        fromRd: interval.fromRd,
        toRd: interval.toRd,
        driveAzimuthDeg: driveAz,
        gradientPct: 0,
        leftBoundaryAzimuthDeg: oppAz,
        convergenceMm: '0 mm',
        rockType: rec.rockMassSummary?.rockType || rec.settings?.lithology || '-',
        rockDescription: rec.rockMassSummary?.geologistRemarks || '',
        rockClass: rec.rockMassSummary?.rockUnit || '-',
        supportDescription: rec.rockMassSummary?.installedSupport || '-',
        shotcreteInstalled: '-',
        wireMeshInstalled: '-',
        rockBoltsInstalled: '-',
        steelRibsInstalled: '-',
        forepolingInstalled: '-',
        seepageCondition: rec.rockMassSummary?.groundwaterCondition || '-',
        weatheringCondition: rec.rockMassSummary?.weatheringGrade || '-',
        ucsRangeMpa: rec.rockMassSummary?.strengthGrade || '-',
        rmrValue: rec.rmrParams?.intactStrengthRating ? 60 : undefined,
        rqdValue: rec.qIndexParams?.rqd,
        overbreakVolumeM3: rec.quantitySummary?.overbreakVolumeM3 || 0,
        excavationDefiningNo: '-',
        excavationDate: rec.date,
        supportClass: '-',
        structureDescription: rec.rockMassSummary?.geologistRemarks || '',
        foliationCharacteristics: '',
        status: 'MAPPED',
        linkedSavedProjectId: rec.id,
        dateMapped: rec.date,
      };

      if (existingPullIdx >= 0) {
        dataset.pulls[existingPullIdx] = {
          ...dataset.pulls[existingPullIdx],
          ...pullObj,
          status: 'MAPPED',
        };
      } else {
        dataset.pulls.push(pullObj);
      }

      const pullSpan = Math.max(1, interval.toRd - interval.fromRd);
      for (const j of rec.joints || []) {
        const traceId = `sync-${rec.id}-${j.id}`;
        if (dataset.traces.some((t) => t.id === traceId)) continue;
        if (!j.geometry || j.geometry.length < 2) continue;
        const structMap: Record<string, StripStructureTypeId> = {
          bedding: 'Bedding',
          fault: 'Fault',
          shear: 'Shear Zone',
          foliation: 'JS1 - Foliation',
          fracture: 'Fractured',
          joint: 'JS2 - Main Joint',
        };
        const mappedPts: Point2D[] = j.geometry.map((pt, idx) => {
          const fracX = idx / Math.max(1, j.geometry.length - 1);
          const rdX = Number((interval.fromRd + fracX * pullSpan).toFixed(2));
          const perimY = Number(
            Math.max(
              0.4,
              Math.min(
                totalPerimM - 0.4,
                totalPerimM * 0.5 + (pt.y - (rec.geometry?.height || 7) * 0.5) * 1.4
              )
            ).toFixed(2)
          );
          return { x: rdX, y: perimY };
        });
        dataset.traces.push({
          id: traceId,
          structureType: structMap[j.featureType || 'joint'] || 'JS2 - Main Joint',
          setId: j.set || 'JS1',
          orientationLabel: `${String(Math.round(j.dipDirection)).padStart(3, '0')}/${Math.round(j.dip)}`,
          dipDirectionDeg: Math.round(j.dipDirection),
          dipDeg: Math.round(j.dip),
          fillingThickness: 'Clay Coated',
          rawPoints: mappedPts,
          points: mappedPts,
        });
      }
    }

    dataset.pulls = normalizePullsWithMissingGaps(dataset.pulls);
    if (dataset.pulls.length > 0) {
      dataset.viewFromRd = Math.min(dataset.viewFromRd, dataset.pulls[0].fromRd);
      dataset.viewToRd = Math.max(
        dataset.viewToRd,
        dataset.pulls[dataset.pulls.length - 1].toRd
      );
    }
  });

  return list;
}

export function normalizePullsWithMissingGaps(
  rawPulls: ContinuousPullRecord[]
): ContinuousPullRecord[] {
  const mappedOnly = rawPulls
    .filter((p) => p.status === 'MAPPED')
    .sort((a, b) => a.fromRd - b.fromRd);

  if (mappedOnly.length === 0) return rawPulls;

  const result: ContinuousPullRecord[] = [];
  for (let i = 0; i < mappedOnly.length; i++) {
    const curr = mappedOnly[i];
    if (i > 0) {
      const prev = mappedOnly[i - 1];
      const gap = Number((curr.fromRd - prev.toRd).toFixed(2));
      if (gap > 0.25) {
        result.push({
          id: `gap-${prev.toRd}-${curr.fromRd}`,
          fromRd: prev.toRd,
          toRd: curr.fromRd,
          driveAzimuthDeg: prev.driveAzimuthDeg,
          gradientPct: prev.gradientPct || 0.166,
          leftBoundaryAzimuthDeg: prev.leftBoundaryAzimuthDeg,
          rockType: 'UNMAPPED PULL SPACE',
          rockDescription: 'Pending Excavation / Field Mapping',
          rockClass: '-',
          supportDescription: 'Pending Excavation / Field Mapping',
          seepageCondition: '-',
          weatheringCondition: '-',
          ucsRangeMpa: '-',
          status: 'MISSING_GAP',
        });
      }
    }
    result.push(curr);
  }
  return result;
}

export function exportContinuousStripToDXF(dataset: ContinuousTunnelStripDataset): string {
  const lines: string[] = [];
  const push = (code: number, val: string | number) => {
    lines.push(String(code));
    lines.push(String(val));
  };

  push(0, 'SECTION');
  push(2, 'HEADER');
  push(9, '$INSUNITS');
  push(70, 6);
  push(0, 'ENDSEC');

  push(0, 'SECTION');
  push(2, 'ENTITIES');

  const totalH = dataset.upperZoneWidthM + dataset.lowerZoneWidthM;
  const startRd = dataset.viewFromRd;
  const endRd = dataset.viewToRd;

  const framePts: Point2D[] = [
    { x: startRd, y: 0 },
    { x: endRd, y: 0 },
    { x: endRd, y: totalH },
    { x: startRd, y: totalH },
  ];
  for (let i = 0; i < framePts.length; i++) {
    const a = framePts[i];
    const b = framePts[(i + 1) % framePts.length];
    push(0, 'LINE');
    push(8, 'STRIP_FRAME');
    push(62, 7);
    push(10, a.x.toFixed(3));
    push(20, (totalH - a.y).toFixed(3));
    push(30, '0.0');
    push(11, b.x.toFixed(3));
    push(21, (totalH - b.y).toFixed(3));
    push(31, '0.0');
  }

  // 1-Meter Chainage Ticks in DXF
  for (let m = Math.ceil(startRd); m <= Math.floor(endRd); m++) {
    push(0, 'LINE');
    push(8, 'CHAINAGE_1M_SCALE');
    push(62, 8);
    push(10, m.toFixed(3));
    push(20, totalH.toFixed(3));
    push(30, '0.0');
    push(11, m.toFixed(3));
    push(21, (totalH + (m % 2 === 0 ? 0.5 : 0.25)).toFixed(3));
    push(31, '0.0');

    if (m % 2 === 0) {
      push(0, 'TEXT');
      push(8, 'CHAINAGE_LABELS');
      push(62, 7);
      push(10, (m - 0.3).toFixed(3));
      push(20, (totalH + 0.65).toFixed(3));
      push(30, '0.0');
      push(40, '0.35');
      push(1, `${m}`);
    }
  }

  for (const p of dataset.pulls) {
    if (p.fromRd < startRd || p.toRd > endRd) continue;
    push(0, 'LINE');
    push(8, p.status === 'MISSING_GAP' ? 'PULL_MISSING_GAP' : 'PULL_SEAMS');
    push(62, p.status === 'MISSING_GAP' ? 1 : 8);
    push(10, p.toRd.toFixed(3));
    push(20, '0.0');
    push(30, '0.0');
    push(11, p.toRd.toFixed(3));
    push(21, totalH.toFixed(3));
    push(31, '0.0');
  }

  for (const tr of dataset.traces) {
    for (let i = 0; i < tr.points.length - 1; i++) {
      const p1 = tr.points[i];
      const p2 = tr.points[i + 1];
      push(0, 'LINE');
      push(8, `TRACE_${tr.structureType.toUpperCase().replace(/\W+/g, '_')}`);
      push(62, tr.structureType.includes('Fault') || tr.structureType.includes('Shear') ? 1 : 2);
      push(10, p1.x.toFixed(3));
      push(20, (totalH - p1.y).toFixed(3));
      push(30, '0.0');
      push(11, p2.x.toFixed(3));
      push(21, (totalH - p2.y).toFixed(3));
      push(31, '0.0');
    }
    if (tr.points.length >= 2) {
      const mid = tr.points[Math.floor(tr.points.length / 2)];
      push(0, 'TEXT');
      push(8, 'TRACE_ORIENTATION_LABELS');
      push(62, 7);
      push(10, mid.x.toFixed(3));
      push(20, (totalH - mid.y + 0.25).toFixed(3));
      push(30, '0.0');
      push(40, '0.35');
      push(1, tr.orientationLabel);
    }
  }

  push(0, 'ENDSEC');
  push(0, 'EOF');
  return lines.join('\n');
}
