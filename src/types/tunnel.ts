export type SurfaceType = 'face' | 'leftWall' | 'rightWall' | 'crown';

export type ProfileType =
  | 'd_shaped'
  | 'horseshoe'
  | 'circular'
  | 'flat_arch'
  | 'custom_cad'
  | 'freeform_custom'
  | 'powerhouse_cavern'
  | 'transformer_hall'
  | 'cavern_junction'
  | 'asymmetric_cavern';

export type TraceFitMode = 'smart_fit' | 'linear';

export type MasterSurfaceCategory =
  | 'FACE'
  | 'LEFT_WALL'
  | 'RIGHT_WALL'
  | 'CROWN'
  | 'OTHER_CUSTOM_SURFACE';

export interface Point2D {
  x: number; // In meters within the surface's real-world coordinate frame
  y: number; // In meters within the surface's real-world coordinate frame
}

export type CustomSegmentType = 'line' | 'arc' | 'bezier';

export type ControlPointRole =
  | 'corner'
  | 'smooth_tangent'
  | 'left_invert'
  | 'left_wall_top'
  | 'crown_apex'
  | 'right_wall_top'
  | 'right_invert'
  | 'step_corner';

export type BoundaryZoneRole = 'leftWall' | 'crown' | 'rightWall' | 'invert';

export interface ProfileControlPoint {
  id: string;
  label: string;        // e.g., 'P1', 'P2', 'P3'...
  x: number;            // Authoritative local/tunnel transverse coordinate in meters (0 = centerline or datum)
  y: number;            // Authoritative local/tunnel vertical elevation coordinate in meters (0 = invert datum)
  role?: ControlPointRole;
  locked?: boolean;     // If locked, parametric resizing preserves this point's exact coordinate
  surveyControlPointId?: string; // Optional link to SurveyControlPoint ID (CP1, CP2...) so moving CP updates geometry
}

export interface ProfileSegment {
  id: string;
  fromPointId: string;
  toPointId: string;
  type: CustomSegmentType; // 'line' | 'arc' | 'bezier'
  zoneRole?: BoundaryZoneRole; // 'leftWall' | 'crown' | 'rightWall' | 'invert'
  // For 'arc' segments:
  // arcBulge = tan(theta/4); positive = curves outward/convex, negative = concave
  arcBulge?: number;
  arcRadiusMeters?: number;
  arcConvexOutward?: boolean;
  // For 'bezier' (cubic or quadratic smooth curve) segments:
  // Control handles in authoritative local profile meters (x, y)
  cp1?: Point2D;
  cp2?: Point2D;
  // Optional locked segment length constraint (m)
  lockedLengthMeters?: number;
}

export interface ReferenceTracingImageConfig {
  dataUrl: string;
  fileName: string;
  opacity: number;             // 0..100
  visible: boolean;
  // Scale calibration points in local canvas/image space or meters
  scalePointA?: Point2D;
  scalePointB?: Point2D;
  knownDistanceMeters: number; // e.g., 9.486 m
  originPoint?: Point2D;       // Position of (x=0, y=0) tunnel datum
  widthMeters: number;         // Displayed width of reference image in profile meters
  heightMeters: number;        // Displayed height of reference image in profile meters
  offsetX: number;             // Center X offset in profile meters
  offsetY: number;             // Center Y offset in profile meters
  rotationDeg?: number;
}

export interface CustomTunnelProfileDefinition {
  id: string;
  name: string;
  category:
    | 'freeform'
    | 'powerhouse_cavern'
    | 'transformer_hall'
    | 'cavern_junction'
    | 'enlarged_chamber'
    | 'asymmetric_section'
    | 'stepped_wall'
    | 'traced_drawing'
    | 'dxf_import';
  controlPoints: ProfileControlPoint[];
  segments: ProfileSegment[];
  isClosed: boolean;
  version: string;
  updatedAt: string;
  referenceImage?: ReferenceTracingImageConfig | null;
}

export interface ChainageProfileSegmentRecord {
  id: string;
  profileId: string;
  profileName: string;
  tunnelName: string;
  location: string;
  rdStartMeters: number;
  rdEndMeters: number;
  sectionType:
    | 'REGULAR_TUNNEL'
    | 'TRANSITION'
    | 'POWERHOUSE_CAVERN'
    | 'TRANSFORMER_HALL'
    | 'CAVERN_JUNCTION'
    | 'ENLARGED_CHAMBER'
    | 'REDUCED_SECTION'
    | 'CUSTOM_IRREGULAR';
  isTransition?: boolean;
  transitionFromProfileId?: string;
  transitionToProfileId?: string;
  geometry: TunnelGeometry;
  version: string;
  date: string;
  notes?: string;
}

export interface Point3D {
  // Master Tunnel Coordinate System:
  // X = tunnel transverse direction (m), Y = tunnel vertical direction (m), Z = tunnel drive/chainage direction (m)
  x?: number;
  y?: number;
  z?: number;
  // Global 3D coordinates rotated by tunnel drive azimuth (m)
  east: number;
  north: number;
  up: number;
  // Unit surface normal vector in Master Tunnel Coordinate System
  normal?: { nx: number; ny: number; nz: number };
  surfaceCategory?: MasterSurfaceCategory;
  // Triangulation closest-point skew-ray residual in meters
  triangulationResidualMeters?: number;
}

export interface TunnelGeometry {
  width: number;          // Real-world tunnel span/width (m)
  height: number;         // Real-world total tunnel height (m)
  wallHeight: number;     // Vertical or reference side wall height up to springline (m)
  leftWallHeight?: number;     // Explicit Left Wall vertical height (m) for asymmetric profiles
  rightWallHeight?: number;    // Explicit Right Wall vertical height (m) for asymmetric profiles
  leftWallArcLength?: number;  // True developed curvilinear length of Left Wall (m)
  rightWallArcLength?: number; // True developed curvilinear length of Right Wall (m)
  invertLength?: number;       // True developed floor/invert length (m)
  totalPerimeterMeters?: number; // True closed vector perimeter (m)
  designAreaSqMeters?: number;   // True cross-sectional design area (m²)
  minX?: number;          // Leftmost X coordinate in meters (supports asymmetric profiles)
  maxX?: number;          // Rightmost X coordinate in meters
  minY?: number;          // Lowest Y elevation in meters
  maxY?: number;          // Highest Y elevation in meters
  crownSlopeDeg?: number; // Crown slope angle (deg) for sloping crowns
  crownGeometry: ProfileType;
  crownRadius: number;    // Crown arch radius (m)
  units: 'm';
  source: 'manual' | 'dxf' | 'dwg' | 'freeform' | 'traced_image' | 'template_cavern';
  cadFileName?: string;
  profileId?: string;
  profileName?: string;
  profileVersion?: string;
  rdStartMeters?: number;
  rdEndMeters?: number;
  isAuthoritativeCustom?: boolean;
  customProfile?: CustomTunnelProfileDefinition;
  // Real-world cross-section boundary polygon in meters:
  crossSectionPoints: Point2D[];
  // Developed crown arc length (m) calculated deterministically from cross-section arch/boundary
  crownArcLength: number;
  // Optional Plane-Surface Joint Mapping flag & configuration
  isPlaneSurface?: boolean;
  planeSurfaceConfig?: PlaneSurfaceConfig;
}

export type MappingWorkspaceMode = 'TUNNEL_PROFILE' | 'PLANE_SURFACE' | 'tunnel_profile' | 'plane_surface';

export interface PlaneSurfaceConfig {
  enabled: boolean;
  planeName: string;            // e.g. "Portal Cut Wall / Bench Face B-1"
  widthMeters: number;          // Plane horizontal span (m)
  heightMeters: number;         // Plane vertical/slope height (m)
  planeStrikeDeg: number;       // 0 - 360° Right-Hand Rule strike of plane surface
  planeDipDirectionDeg: number; // 0 - 360° Dip direction / outward face azimuth
  planeDipDeg: number;          // 0 - 90° Plane dip angle (90° = vertical wall, <90° = inclined slope)
  elevationMeters?: number;     // Base elevation (m)
  location?: string;
}

export interface TunnelSettings {
  tunnelName: string;
  location?: string;           // Project location / Adit / Heading (e.g. "Adit-II Main Portal")
  locationName?: string;       // Alias for project location
  driveDirectionInput: string; // e.g. "N 070°", "070°", "250°"
  driveDirection: number;      // Normalized 0 - 360° azimuth
  chainage: string;            // e.g. "RD 1420.00m - 1423.50m"
  faceChainage: string;        // e.g. "RD 1423.50m"
  roundLength: number;         // Pull / round length in meters (e.g. 3.5)
  date: string;
  mappedBy: string;
  lithology: string;           // e.g. "Quartzite / Phyllite with Shear Seam"
}

export interface CameraCalibration {
  focalLengthMm: number;       // 35mm equivalent or physical focal length (mm)
  focalLengthPx: number;       // Focal length in pixels
  principalPoint: { u: number; v: number }; // Normalized principal point (default 0.5, 0.5)
  radialDistortionK1: number;  // Brown-Conrady k1 radial distortion coefficient
  radialDistortionK2: number;  // Brown-Conrady k2 radial distortion coefficient
  tangentialDistortionP1?: number; // Brown-Conrady p1 tangential distortion coefficient
  tangentialDistortionP2?: number; // Brown-Conrady p2 tangential distortion coefficient
  imageWidth: number;
  imageHeight: number;
  cameraPitchDeg: number;      // Estimated camera tilt angle relative to surface normal
  cameraYawDeg: number;        // Estimated camera horizontal obliquity angle
  cameraRollDeg: number;       // Estimated camera roll angle
  // Camera optical center position in Master Tunnel Coordinates (X, Y, Z in meters)
  cameraPosition?: { x: number; y: number; z: number };
  source: 'EXIF_METADATA' | 'ESTIMATED_FROM_GEOMETRY';
  lensCorrectionApplied: boolean;
  cameraModel?: string;
  stereoBaselineMeters?: number;
  stereoBaselineWeak?: boolean;
}

export interface ImageQualityReport {
  width: number;
  height: number;
  brightness: number;          // 0-255
  contrast: number;            // RMS contrast
  sharpnessScore: number;      // Laplacian variance metric
  BoundaryDetected: boolean;
  detectedArchApexRatio: number;
  warnings: string[];
}

export interface MeshControlPoint {
  id: string;
  label: string;               // e.g. 'C1', 'C2', ...
  srcU: number;                // Original normalized image coordinate U in [0, 1]
  srcV: number;                // Original normalized image coordinate V in [0, 1]
  dstU: number;                // Warped normalized surface coordinate U in [-0.2, 1.2]
  dstV: number;                // Warped normalized surface coordinate V in [-0.2, 1.2]
}

export interface SurfaceTransform {
  offsetX: number;             // Meters shift X (move / pan)
  offsetY: number;             // Meters shift Y (move / pan)
  scaleX: number;              // 1.0 = exact fit to master surface width (stretch / shrink X)
  scaleY: number;              // 1.0 = exact fit to master surface height (stretch / shrink Y)
  zoom?: number;               // Uniform zoom factor (default 1.0)
  rotation: number;            // Degrees (-180 to 180)
  flipH?: boolean;             // Horizontal flip
  flipV?: boolean;             // Vertical flip
  // Rectangular & Custom Crop margins in normalized image space [0..0.45]
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
  // Skew / Shear & Horizontal/Vertical Perspective adjustments
  skewX?: number;              // Degrees (-40 to +40)
  skewY?: number;              // Degrees (-40 to +40)
  perspH?: number;             // Horizontal keystone perspective (-0.4 to +0.4)
  perspV?: number;             // Vertical keystone perspective (-0.4 to +0.4)
  // 4-point homography / perspective corner offsets in normalized surface space (-0.45 to +0.45)
  // Order: [TopLeft, TopRight, BottomRight, BottomLeft]
  perspectiveCorners: [Point2D, Point2D, Point2D, Point2D];
  // 4-edge midpoint offsets in normalized surface space: [Top, Right, Bottom, Left]
  edgeOffsets?: [Point2D, Point2D, Point2D, Point2D];
  // Piecewise / Mesh-based local deformation control points
  meshControlPoints?: MeshControlPoint[];
  // Custom Polygon / Irregular Tunnel Boundary Mask (P1, P2, P3, P4, P5, P6, P7... in surface meters)
  useCustomMask?: boolean;
  customMaskPoints?: Point2D[];
  // 3x3 Projective Homography matrix (row-major 9 elements) mapping undistorted UV -> normalized surface
  homographyMatrix?: number[];
  cropToGeometry: boolean;
}

/**
 * Supporting Photograph (0-5 additional photos per mapping area).
 * Used ONLY as supporting evidence by AI + CV to verify features, improve continuity,
 * reject shadow/construction artifacts, and constrain 3D orientation.
 * NEVER replaces or merges visually with the MAIN PHOTO (Sections 1, 2, 3, 4).
 */
export interface SupportingPhoto {
  id: string;
  image: string;               // Lens-corrected Data URL
  originalImage?: string;
  fileName: string;
  calibration?: CameraCalibration;
  baselineMeters?: number;
}

export interface PhotoSurface {
  type: SurfaceType;
  originalImage: string | null; // Raw untouched MAIN PHOTO Data URL
  image: string | null;         // Lens-distortion corrected MAIN PHOTO Data URL (Always primary output base)
  warpedImage?: string | null;  // Piecewise mesh-warped & perspective-fitted Data URL for exact tunnel shape fitting
  fileName?: string;
  // 0-5 Additional Supporting Photographs (Sections 1-4)
  supportingPhotos?: SupportingPhoto[];
  // Legacy alias for first supporting stereo photo
  stereoImage?: string | null;
  stereoFileName?: string;
  stereoCalibration?: CameraCalibration;
  stereoBaselineMeters?: number;
  stereoBaselineWarning?: string;
  transform: SurfaceTransform;
  scale: number;                // Real-world px-per-meter calibration
  opacity: number;              // 0 to 100% continuous opacity
  autoFitted: boolean;
  calibration?: CameraCalibration;
  qualityReport?: ImageQualityReport;
  draftSavedAt?: string;
}

export type GeologicalFeatureType =
  | 'joint'
  | 'fracture'
  | 'fault'
  | 'shear'
  | 'shear_zone'
  | 'vein'
  | 'dyke'
  | 'clay_band'
  | 'clay_infill'
  | 'seam'
  | 'bedding'
  | 'foliation'
  | 'schistosity'
  | 'lineation'
  | 'cleavage'
  | 'contact'
  | 'lithological_contact'
  | 'discontinuity'
  | 'slickenside'
  | 'shear_plane'
  | 'fold'
  | 'fold_axis'
  | 'anticline'
  | 'syncline'
  | 'shale_band'
  | 'dolerite'
  | 'infilling'
  | 'water_seepage'
  | 'water_flow'
  | 'open_joint'
  | 'closed_joint'
  | 'weathered_zone'
  | 'breccia_zone'
  | 'crushed_zone';

export type GeologicalSymbolType =
  | 'joint'
  | 'fracture'
  | 'fault'
  | 'shear_zone'
  | 'bedding'
  | 'foliation'
  | 'schistosity'
  | 'lineation'
  | 'cleavage'
  | 'fold_axis'
  | 'anticline'
  | 'syncline'
  | 'vein'
  | 'dyke'
  | 'contact'
  | 'lithological_contact'
  | 'discontinuity'
  | 'slickenside'
  | 'shear_plane'
  | 'water_seepage'
  | 'water_flow'
  | 'clay_infill'
  | 'open_joint'
  | 'closed_joint'
  | 'weathered_zone'
  | 'breccia_zone'
  | 'crushed_zone';

export interface PlacedGeologicalSymbol {
  id: string;
  surface: SurfaceType;
  symbolType: GeologicalSymbolType;
  point: Point2D; // Authoritative tunnel/world coordinate in meters
  imageUV?: { u: number; v: number };
  strikeDeg: number; // 0 - 360° strike azimuth
  dipDirectionDeg: number; // 0 - 360° dip direction azimuth
  dipDeg: number; // 0 - 90° dip angle
  rotationDeg: number; // 2D symbol orientation angle on canvas (degrees)
  scale: number; // Symbol size multiplier (0.5 to 2.5, default 1.0)
  label: string; // Editable symbol callout label
  notes?: string;
  color?: string;
  uncertainOrientation?: boolean;
  visible?: boolean;
  locked?: boolean;
}

export interface VectorLayerVisibility {
  photo: boolean;
  overbreakUndercut?: boolean;
  controlPoints?: boolean;
  joints: boolean;
  fractures: boolean;
  faults: boolean;
  bedding: boolean;
  foliation: boolean;
  lithology: boolean;
  otherStructures: boolean;
  annotations: boolean;
}

export type OrientationStatus =
  | 'DIRECTLY_MEASURED'         // Field-measured or explicitly confirmed by geologist
  | 'STEREO_TRIANGULATED'       // Triangulated in 3D from calibrated supporting/stereo or multi-view rays
  | 'GEOMETRICALLY_CALCULATED'  // Derived mathematically from 3D curved surface or multi-surface intersection
  | 'APPARENT_ORIENTATION'      // Single-plane trace where only apparent angle is mathematically certain
  | 'ESTIMATED'                 // Estimated from surface plane + structural constraint
  | 'INSUFFICIENT_3D_CONSTRAINT'// Single flat plane without sufficient 3D depth relief
  | 'REQUIRES_CONFIRMATION'     // Requires geologist verification due to low 3D relief or confidence
  | 'CONFIRMED';                // Alias kept for compatibility with confirmed state

export type GeometricConfidenceLevel =
  | 'HIGH_GEOMETRIC_CONFIDENCE'
  | 'MEDIUM_GEOMETRIC_CONFIDENCE'
  | 'LOW_GEOMETRIC_CONFIDENCE';

export type TraceContinuityStatus = 'OBSERVED' | 'SUPPORTED' | 'INFERRED' | 'UNCERTAIN';

export type TraceTerminationType =
  | 'ROCK_TERMINATION'        // Genuine termination inside the exposed rock mass
  | 'BOUNDARY_EXIT'           // Continues beyond the tunnel excavation boundary
  | 'JOINT_ABUTMENT'          // Terminates against / merges with another discontinuity
  | 'OCCLUDED';               // Partially hidden by shadow, debris, or shotcrete

export interface JointConfidenceBreakdown {
  detection: number;          // 0 - 100% AI + CV discontinuity segmentation confidence
  trace: number;              // 0 - 100% edge gradient & ridge continuity confidence
  geometric: number;          // 0 - 100% camera calibration, homography & triangulation confidence
  orientation: number;        // 0 - 100% 3D plane-fit / multi-view mathematical certainty
}

export interface JointTopologyNode {
  jointId: string;
  point: Point2D;
  type: 'X_INTERSECTION' | 'T_ABUTMENT' | 'Y_BRANCH';
  angleBetweenDeg: number;
}

export interface Joint {
  id: string;
  surface: SurfaceType;
  // Multi-point geological discontinuity polyline in real-world surface coordinates (meters) registered to MAIN PHOTO:
  // P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7 ... (NEVER artificially straightened into a 2-point CAD line)
  geometry: Point2D[];
  // Original AI-predicted geometry before user correction (preserved for Daily Learning Loop - Section 26)
  aiOriginalGeometry?: Point2D[];
  aiOriginalFeatureType?: GeologicalFeatureType;
  aiOriginalDip?: number;
  aiOriginalDipDirection?: number;
  // 3D tunnel coordinates (X, Y, Z + East, North, Up in meters) computed from tunnel geometry & triangulation
  points3D?: Point3D[];
  // Local apparent angle (0-180°) along each consecutive segment P_i -> P_{i+1}
  localAnglesDeg?: number[];
  // Natural undulation / waviness range in degrees across segments (max - min local angle)
  wavinessAngleDeg?: number;
  // Variable visual trace width / relative aperture multiplier at each vertex (thin -> wider -> thin)
  vertexWidths?: number[];
  // Genuine geological termination state at start (P1) and end (Pn) of trace
  terminationStart?: TraceTerminationType;
  terminationEnd?: TraceTerminationType;
  // A. Raw Image Trace Angle in pixel space (0-180°)
  imageTraceAngleDeg?: number;
  // B. Surface-Mapped Trace Angle on the tunnel surface plane (0-180°)
  traceAngle: number;
  apparentDip?: number;        // Apparent dip angle on the 2D observation surface (0-90°)
  // C. 3D Geological Orientation
  strike: number;              // 0-360° Right-Hand Rule strike azimuth
  dip: number;                 // 0-90° true or estimated dip angle
  dipDirection: number;        // 0-360° dip direction azimuth
  // Propagated Angular Uncertainty: e.g., Dip = 72° ± 3°
  dipUncertaintyDeg?: number;
  dipDirectionUncertaintyDeg?: number;
  // Triangulation & Multi-View Reprojection Validation Metrics
  triangulationResidualMeters?: number; // e.g., 0.012 m
  reprojectionErrorPx?: number;         // e.g., 1.4 px on Main Photo
  reprojectionErrorByView?: { viewLabel: string; errorPx: number }[];
  numObservingViews?: number;           // 1 (Main Photo only) or 2..6 (Main + Supporting Photos)
  supportingPhotosCorroborated?: number;// Number of supporting photos confirming this feature
  geometricConfidenceLevel?: GeometricConfidenceLevel;
  continuityStatus?: TraceContinuityStatus;
  topologyIntersections?: JointTopologyNode[];
  orientationStatus: OrientationStatus;
  set: string;                 // 'J0' (Bedding/Foliation), 'J1', 'J2', 'J3', 'J4', 'J5', 'F1' (Fault/Shear)
  featureType: GeologicalFeatureType;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceScore: number;     // 0.0 to 1.0
  confidenceBreakdown: JointConfidenceBreakdown;
  lowConfidenceReason?: string;
  source: 'AI_HYBRID' | 'CV_PIPELINE' | 'MANUAL';
  accepted: boolean;
  persistenceMeters: number;   // Calculated real-world curvilinear trace length in meters
  isCurved?: boolean;          // True if naturally curved/undulating geological trace
  linkedJointIds?: string[];   // IDs of corresponding traces matched across adjacent tunnel surfaces
  apertureMm?: string;         // Separate Joint Aperture Measurement (e.g. "1-4 mm (Variable)")
  roughness?: string;
  infilling?: string;
  weathering?: string;         // Weathering grade along joint wall (e.g. "Slightly Weathered (W2)")
  waterCondition?: 'Dry' | 'Damp' | 'Wet' | 'Dripping' | 'Flowing';
  annotationNote?: string;     // Optional custom geologist field annotation
  jointNumber?: string;        // Editable joint number (e.g., "J-1", "J-2")
  customLabel?: string;        // Editable custom label override
  symbolScale?: number;        // Dip/orientation symbol scale factor (default 1.0)
  // Advanced Photogrammetry & Quantitative Structural Geology Fields (Additive / Non-Destructive)
  reliefDepthMeters?: number[]; // Photogrammetric 3D depth relief delta-Z (m) along each vertex
  jrcValue?: number;           // Barton's Joint Roughness Coefficient (0.5 - 20.0) calculated via Z2 profile derivative
  z2RootMeanSquare?: number;   // Tse & Cruden (1979) Z2 RMS first derivative of joint trace profile
  roughnessProfileIndexRp?: number; // El-Soudani Rp ratio (true arc length / chord length)
  subPixelResidualPx?: number; // Steger parabolic Taylor sub-pixel centerline precision (px)
  phaseCongruencyScore?: number; // Multi-orientation Log-Gabor illumination-invariant phase congruency [0..1]
  terzaghiWeight?: number;     // Terzaghi (1965) angular blind-zone bias correction weight (1.0 - 5.0)
  jcsStrengthMPa?: number;     // Estimated Joint Wall Compressive Strength JCS (MPa)
}

export interface JointSet {
  id: string;                  // e.g., 'J0', 'J1', 'J2', 'J3', 'J4'
  label: string;               // e.g., 'J0 (Bedding / Foliation)', 'J1', 'J2'
  color: string;               // Technical pen color
  orientation: string;         // e.g., "135° / 68° ± 3°"
  avgStrike: number | null;
  avgDip: number | null;
  avgDipDirection: number | null;
  dipDispersionDeg?: number;   // Robust dispersion / variation across joints in the set
  jointCount?: number;         // Number of mapped joints in this set
  spacing: string;             // e.g., "0.35 m (200-600 mm)"
  persistence: string;         // e.g., "2.8 m (Medium)"
  aperture: string;            // e.g., "1-3 mm" or "Tight (<0.5 mm)"
  roughness: string;           // e.g., "Rough / Undulating"
  infilling: string;           // e.g., "Quartz / Clay coating" or "None (Clean)"
  water: string;               // e.g., "Damp"
}

export interface QualityIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category:
    | 'geometry'
    | 'registration'
    | 'orientation'
    | 'trace'
    | 'duplicate'
    | 'camera'
    | 'suspicious_line'
    | 'disconnected'
    | 'triangulation'
    | 'reprojection';
  message: string;
  jointId?: string;
  surface?: SurfaceType;
}

export interface VerifiedCorrectionRecord {
  id: string;
  timestamp: string;
  tunnelName: string;
  surface: SurfaceType;
  scope: 'GENERAL_GEOLOGY' | 'PROJECT_SPECIFIC';
  correctionType:
    | 'DELETED_FALSE_POSITIVE'
    | 'ADDED_MISSED_JOINT'
    | 'RESHAPED_CURVED_TRACE'
    | 'RECLASSIFIED_STRUCTURE'
    | 'CONFIRMED_ORIENTATION';
  aiPredictionSummary: string;
  userApprovedSummary: string;
  featureType: GeologicalFeatureType;
  traceAngle: number;
  dip: number;
  dipDirection: number;
  set: string;
  confidence: number;
}

export interface AIModelVersionInfo {
  version: string;             // e.g. "AKASH AI Model 1.2"
  updatedAt: string;           // e.g. "2026-09-27"
  trainingDataCount: number;
  verifiedExamplesCount: number;
  correctionsLearnedCount: number;
  validationScorePct: number;  // e.g. 94.2%
  majorChanges: string;
}

export interface SessionLearningMemory {
  rejectedAngleRanges: { surface: SurfaceType; angleDeg: number; tolerance: number }[];
  confirmedOrientations: {
    surface: SurfaceType;
    traceAngle: number;
    dip: number;
    dipDirection: number;
    set: string;
  }[];
  // Continuous Daily Learning Dataset (Section 26)
  trainingSamplesTotal?: number;
  verifiedExamplesCount?: number;
  correctionsLearnedCount?: number;
  lastUpdatedDate?: string;
  currentModelVersion?: string;
  modelHistory?: AIModelVersionInfo[];
  verifiedRecords?: VerifiedCorrectionRecord[];
}

export type OutputSheetMode =
  | 'FINAL_ENGINEERING_SHEET'
  | 'PHOTO_AND_AI_TRACING'
  | 'CLEAN_MAPPING_DRAWING'
  | 'VECTOR_MAPPING_ONLY'
  | 'EXPORT_PHOTO_ONLY'
  | 'ENGINEERING_QUANTITY_SHEET';

/**
 * Barton's Q-System (NGI Tunnelling Quality Index) Parameters & Rock Mass Summary
 * Q = (RQD / Jn) * (Jr / Ja) * (Jw / SRF)
 */
export interface QIndexParameters {
  rqd: number;                  // Rock Quality Designation (10 to 100%)
  jn: number;                   // Joint Set Number (0.5 to 20)
  jnDescription: string;
  jr: number;                   // Joint Roughness Number (0.5 to 4)
  jrDescription: string;
  ja: number;                   // Joint Alteration Number (0.75 to 20)
  jaDescription: string;
  jw: number;                   // Joint Water Reduction Factor (0.05 to 1.0)
  jwDescription: string;
  srf: number;                  // Stress Reduction Factor (0.5 to 200)
  srfDescription: string;
  esr: number;                  // Excavation Support Ratio (default 1.0)
  isIntersection?: boolean;     // 3.0 x Jn multiplier per Barton NGI rules
  isPortal?: boolean;           // 2.0 x Jn multiplier per Barton NGI rules
  volumetricJointCountJv?: number;
  // Parameter availability & confirmation tracking (No Invented Values rule)
  missingFields?: ('rqd' | 'jn' | 'jr' | 'ja' | 'jw' | 'srf')[];
  suggestedFields?: ('rqd' | 'jn' | 'jr' | 'ja' | 'jw' | 'srf')[];
  userConfirmed?: boolean;
  confirmedAt?: string;
}

export type RockMassClassificationMethodId =
  | 'RMR'
  | 'Q_SYSTEM'
  | 'BOTH_RMR_AND_Q'
  | 'GSI';

export type RmrMethodologyVersion = 'RMR89' | 'RMR76';

export type ParameterInputStatus =
  | 'USER_ENTERED'
  | 'USER_CONFIRMED'
  | 'AI_SUGGESTED_UNCONFIRMED'
  | 'MISSING';

export type RmrParamKey =
  | 'intactStrength'
  | 'rqd'
  | 'spacing'
  | 'condition'
  | 'groundwater'
  | 'orientationAdjustment';

export type QSystemParamKey = 'rqd' | 'jn' | 'jr' | 'ja' | 'jw' | 'srf';

export interface RmrDiscontinuityConditionSubRatings {
  useDetailedSubRatings: boolean;
  persistenceValue: string;     // e.g. "1–3 m (Medium)"
  persistenceRating: number;    // 0 to 6
  apertureValue: string;        // e.g. "0.1–1.0 mm"
  apertureRating: number;       // 0 to 6
  roughnessValue: string;       // e.g. "Slightly rough"
  roughnessRating: number;      // 0 to 6
  infillingValue: string;       // e.g. "Hard filling < 5 mm"
  infillingRating: number;      // 0 to 6
  weatheringValue: string;      // e.g. "Slightly weathered"
  weatheringRating: number;     // 0 to 6
}

export interface RmrParameters {
  version: RmrMethodologyVersion;
  // 1. Strength of Intact Rock Material (UCS or Point Load Index)
  strengthInputType: 'UCS_MPA' | 'POINT_LOAD_MPA';
  intactStrengthValueMPa: number | null; // e.g. 110 MPa (null if missing)
  intactStrengthDescription: string;
  intactStrengthRating: number | null;   // 0 to 15
  // 2. Rock Quality Designation (RQD %)
  rqdPercent: number | null;             // 0 to 100% (null if missing)
  rqdDescription: string;
  rqdRating: number | null;              // 3 to 20
  // 3. Spacing of Discontinuities
  spacingMeters: number | null;          // e.g. 0.35 m (null if missing)
  spacingDescription: string;            // e.g. "0.2 – 0.6 m (Moderate)"
  spacingRating: number | null;          // 5 to 20
  // 4. Condition of Discontinuities
  conditionDescription: string;          // e.g. "Slightly rough surfaces, separation < 1 mm, slightly weathered walls"
  conditionRating: number | null;        // 0 to 30
  conditionSubRatings: RmrDiscontinuityConditionSubRatings;
  // 5. Groundwater Conditions
  groundwaterInflowLPerMin10m: number | null;
  groundwaterDescription: string;        // e.g. "Damp (< 10 L/min per 10m)"
  groundwaterRating: number | null;      // 0 to 15
  // 6. Orientation Adjustment for Tunnel Drive
  orientationFavourability:
    | 'Very Favorable'
    | 'Favorable'
    | 'Fair'
    | 'Unfavorable'
    | 'Very Unfavorable'
    | 'Not Assessed';
  orientationAdjustmentRating: number | null; // 0, -2, -5, -10, -12
  // Per-parameter status tracking (USER_ENTERED, USER_CONFIRMED, AI_SUGGESTED_UNCONFIRMED, MISSING)
  paramStatus: Record<RmrParamKey, ParameterInputStatus>;
  userConfirmed: boolean;
  confirmedAt?: string;
}

export interface RmrCalculationResult {
  version: RmrMethodologyVersion;
  isComplete: boolean;
  hasUnconfirmedSuggestions: boolean;
  missingParamLabels: string[];
  unconfirmedParamLabels: string[];
  r1StrengthRating: number | null;
  r2RqdRating: number | null;
  r3SpacingRating: number | null;
  r4ConditionRating: number | null;
  r5GroundwaterRating: number | null;
  basicRmr: number | null;               // R1 + R2 + R3 + R4 + R5 (0 to 100)
  orientationAdjustment: number | null;  // -12 to 0
  finalRmr: number | null;               // Clamped 0 to 100
  rockMassClassNumber: 'I' | 'II' | 'III' | 'IV' | 'V' | 'INCOMPLETE';
  rockMassClassLabel: string;            // e.g. "CLASS II — GOOD ROCK"
  rockQualityDescription: string;        // e.g. "Good rock"
  colorHex: string;
  averageStandUpTime: string;            // e.g. "1 year for 10 m span"
  cohesionKPa: string;                   // e.g. "300 – 400 kPa"
  frictionAngleDeg: string;              // e.g. "35° – 45°"
  deformationModulusGPa: number | null;  // Serafim & Pereira / Bieniawski Em (GPa)
  recommendedSupportGuidelines: string;
  calculationSummaryFormula: string;
}

export interface GsiParameters {
  structureCategory:
    | 'INTACT_OR_MASSIVE'
    | 'BLOCKY'
    | 'VERY_BLOCKY'
    | 'BLOCKY_DISTURBED_SEAMY'
    | 'DISINTEGRATED'
    | 'LAMINATED_SHEARED'
    | 'MISSING';
  structureRating: number | null;        // 10 to 90
  surfaceConditionCategory:
    | 'VERY_GOOD'
    | 'GOOD'
    | 'FAIR'
    | 'POOR'
    | 'VERY_POOR'
    | 'MISSING';
  surfaceConditionRating: number | null; // 10 to 90
  blastDamageFactorD: number | null;     // 0.0 (excellent/TBM) to 0.8 (poor blasting)
  intactUcsMPa: number | null;           // sigma_ci (MPa)
  miHoekBrownConstant: number | null;    // mi (e.g. 10 to 32)
  paramStatus: {
    structure: ParameterInputStatus;
    surfaceCondition: ParameterInputStatus;
    intactUcs: ParameterInputStatus;
  };
  userConfirmed: boolean;
  confirmedAt?: string;
}

export interface GsiCalculationResult {
  isComplete: boolean;
  hasUnconfirmedSuggestions: boolean;
  missingParamLabels: string[];
  unconfirmedParamLabels: string[];
  gsiValue: number | null;               // 5 to 95
  gsiRangeLabel: string;                 // e.g. "60 – 65"
  rockMassClassLabel: string;
  colorHex: string;
  mbReducedConstant: number | null;
  sConstant: number | null;
  aConstant: number | null;
  deformationModulusGPa: number | null;
  recommendedSupportGuidelines: string;
  calculationSummaryFormula: string;
}

export interface StationClassificationStorageRecord {
  project: string;
  tunnel: string;
  location: string;
  chainageRd: string;
  surfaceSection: string;
  selectedMethod: RockMassClassificationMethodId;
  qParamStatus: Record<QSystemParamKey, ParameterInputStatus>;
  qUserConfirmed: boolean;
  qConfirmedAt?: string;
  rmrParams: RmrParameters;
  gsiParams: GsiParameters;
  dateVersion: string;
}

export interface RockMassSummaryTable {
  rockType: string;
  rockUnit: string;
  weatheringGrade: string;      // e.g., "W2 (Slightly Weathered)"
  strengthGrade: string;        // e.g., "R3–R4 (Medium to Strong, 50–100 MPa)"
  foliationBeddingSpacing: string;
  groundwaterCondition: string; // e.g., "Damp to local dripping (< 5 L/min)"
  overbreakCondition: string;   // e.g., "Minor wedge overbreak at crown arch (0.2–0.4m)"
  installedSupport: string;     // e.g., "SFRS 75mm + Systematic Rock Bolts L=4.0m @ 1.5m c/c"
  geologistRemarks: string;
}

/**
 * Sections 11, 12, 13, 14: User-Selected Lithology Regions, Subtle Geological Visualization,
 * Region Editing (Resize, Reshape, Split, Merge, Delete), and AI Geological Description
 */
export type LithologyPatternType =
  | 'granite'
  | 'granodiorite'
  | 'gabbro'
  | 'basalt'
  | 'dolerite'
  | 'quartzite'
  | 'sandstone'
  | 'shale'
  | 'slate'
  | 'limestone'
  | 'marble'
  | 'dolomite'
  | 'schist'
  | 'gneiss'
  | 'phyllite'
  | 'quartzitic_phyllite'
  | 'conglomerate'
  | 'breccia'
  | 'clay_zone'
  | 'weathered_rock'
  | 'highly_weathered_rock'
  | 'fractured_crushed_rock'
  | 'fault_gouge'
  | 'shear_zone'
  | 'custom_lithology';

export interface LithologyRegion {
  id: string;
  surface: SurfaceType;
  // User-selected / drawn polygon vertices in real-world surface coordinates (meters)
  polygon: Point2D[];
  polygonPoints?: Point2D[];
  // Editable lithology name (e.g. "Quartzite", "Quartzitic Phyllite", "Dolerite Dyke")
  lithologyName: string;
  lithologyType?: string;
  patternType: LithologyPatternType;
  colorHex: string;
  // Subtle visual geological representation opacity (0.05 to 0.40, default 0.16)
  opacity: number;
  // Section 14 structured fields (AI-suggested -> User-edited & approved)
  description: string;
  structuralFeatures: string;
  notes?: string;
  aiSuggestedDescription?: string;
  aiSuggestedStructuralFeatures?: string;
  userApproved: boolean;
  supportingPhotosAnalyzed?: number;
  confidence?: number;
  source?: 'MANUAL' | 'AI_ASSISTED';
}

export interface SurveyControlPoint {
  id: string;
  label: string; // e.g., 'CP1', 'CP2'
  surface: SurfaceType;
  point: Point2D; // Authoritative tunnel/world coordinate in meters
  imageUV?: { u: number; v: number }; // Registered normalized photo UV [0..1]
  note?: string;
  color?: string;
  visible?: boolean; // Hide/show support (default true)
  locked?: boolean;  // Lock/unlock support (default false)
}

export type OverbreakReasonCategory = 'GEOLOGICAL' | 'MECHANICAL_EXCAVATION';

export interface OverbreakZoneReasonOverride {
  zoneId: string;
  category: OverbreakReasonCategory;
  reasonDetail: string;
  linkedJointSets: string;
  notes?: string;
}

export interface ConnectedSurveyProfile {
  surface: SurfaceType;
  // Ordered sequence of SurveyControlPoint IDs (CP1 -> CP2 -> CP3 -> ...) defining the surveyed/as-built boundary
  orderedControlPointIds: string[];
  isClosed: boolean;
  visible: boolean;
  locked: boolean;
  // Pull / chainage interval (m) for volume calculation. If null or <= 0 or !useValidPullInterval, volume is not calculated.
  pullIntervalMeters: number | null;
  useValidPullInterval: boolean;
  zoneReasonOverrides: Record<string, OverbreakZoneReasonOverride>;
  overallOverbreakCategory: OverbreakReasonCategory;
  overallOverbreakReason: string;
  overallUndercutCategory: OverbreakReasonCategory;
  overallUndercutReason: string;
}

export interface OverbreakUndercutRegion {
  id: string; // e.g., 'OB-1', 'OB-2', 'UC-1'
  type: 'OVERBREAK' | 'UNDERCUT';
  polygon: Point2D[]; // Vector region polygon in authoritative tunnel world coordinates (m)
  areaSqMeters: number;
  percentageOfDesign: number;
  maxRadialMeters: number;
  minRadialMeters: number;
  avgRadialMeters: number;
  affectedPerimeterMeters: number;
  locationLabel: string; // e.g., 'Crown Arch', 'Right Shoulder', 'Left Wall', 'Invert'
  chainage: string;
  centroid: Point2D;
  maxDeviationPoint: Point2D;
  maxRadialPoint: Point2D;
  designReferencePoint: Point2D;
  reasonCategory: OverbreakReasonCategory;
  reasonDetail: string;
  linkedJointSets: string;
}

export interface OverbreakUndercutAnalysis {
  surface: SurfaceType;
  hasConnectedProfile: boolean;
  hasValidSurveyProfile: boolean;
  connectedPointsCount: number;
  connectedPolyline: Point2D[];
  surveyedPolygon: Point2D[];
  closedAsBuiltPolygon: Point2D[];
  designAreaSqMeters: number;
  surveyedAreaSqMeters: number;
  designPerimeterMeters: number;
  surveyedPerimeterMeters: number;
  // Overbreak metrics
  overbreakAreaSqMeters: number;
  overbreakPercentage: number;
  overbreakPercent: number;
  maxRadialOverbreakMeters: number;
  minRadialOverbreakMeters: number;
  avgRadialOverbreakMeters: number;
  overbreakPerimeterMeters: number;
  affectedOverbreakPerimeterMeters: number;
  overbreakVolumeCubicMeters: number | null;
  // Undercut metrics
  undercutAreaSqMeters: number;
  undercutPercentage: number;
  undercutPercent: number;
  maxRadialUndercutMeters: number;
  minRadialUndercutMeters: number;
  avgRadialUndercutMeters: number;
  undercutPerimeterMeters: number;
  affectedUndercutPerimeterMeters: number;
  undercutVolumeCubicMeters: number | null;
  // Volume validity & overall reasons
  hasValidVolumeInterval: boolean;
  effectivePullIntervalMeters: number | null;
  pullIntervalMeters: number | null;
  designVolumeCubicMeters: number | null;
  surveyedVolumeCubicMeters: number | null;
  overallOverbreakCategory: OverbreakReasonCategory;
  overallOverbreakReason: string;
  overallUndercutCategory: OverbreakReasonCategory;
  overallUndercutReason: string;
  volumeStatusMessage: string;
  chainageLocation: string;
  // Individual overbreak and undercut vector zones
  overbreakRegions: OverbreakUndercutRegion[];
  undercutRegions: OverbreakUndercutRegion[];
}

export interface SavedDesignGeometryRecord {
  id: string;
  name: string;
  tunnelName: string;
  location: string;
  chainage: string;
  savedAt: string;
  geometry: TunnelGeometry;
}

export interface SavedProjectRecord {
  id: string;
  tunnelName: string;
  location: string;
  chainage: string;
  faceChainage: string;
  numericChainageMeters: number | null;
  date: string;
  savedAt: string;
  mappingMode: MappingWorkspaceMode;
  planeSurfaceConfig?: PlaneSurfaceConfig;
  geometry: TunnelGeometry;
  settings: TunnelSettings;
  photos: Record<SurfaceType, PhotoSurface>;
  joints: Joint[];
  customJointSetOverrides: Record<string, Partial<JointSet>>;
  qIndexParams: QIndexParameters;
  selectedClassificationMethod?: RockMassClassificationMethodId;
  rmrParams?: RmrParameters;
  gsiParams?: GsiParameters;
  qParamStatus?: Record<QSystemParamKey, ParameterInputStatus>;
  stationClassificationRecord?: StationClassificationStorageRecord;
  rockMassSummary: RockMassSummaryTable;
  lithologyRegions: LithologyRegion[];
  controlPoints: SurveyControlPoint[];
  surveyProfile: ConnectedSurveyProfile;
  placedSymbols: PlacedGeologicalSymbol[];
  quantitySummary: {
    designAreaSqM: number;
    surveyedAreaSqM: number;
    overbreakAreaSqM: number;
    undercutAreaSqM: number;
    overbreakPct: number;
    undercutPct: number;
    maxOverbreakM: number;
    maxUndercutM: number;
    pullIntervalM: number | null;
    overbreakVolumeM3: number | null;
    undercutVolumeM3: number | null;
  };
}

export interface SectionToSectionVolumeRow {
  id: string;
  fromSectionId: string;
  toSectionId: string;
  fromChainageLabel: string;
  toChainageLabel: string;
  fromRdMeters: number;
  toRdMeters: number;
  intervalLengthMeters: number;
  designVolumeM3: number;
  designVolumeCubicMeters: number;
  surveyedVolumeM3: number;
  surveyedVolumeCubicMeters: number;
  overbreakVolumeAvgEndAreaM3: number;
  overbreakVolumeAvgEndAreaCubicMeters: number;
  overbreakVolumePrismoidalM3: number;
  overbreakVolumePrismoidalCubicMeters: number;
  undercutVolumeAvgEndAreaM3: number;
  undercutVolumeAvgEndAreaCubicMeters: number;
  undercutVolumePrismoidalM3: number;
  undercutVolumePrismoidalCubicMeters: number;
  primaryOverbreakReason: string;
}

export interface BartonJRCProfileResult {
  jointId: string;
  set: string;
  surface: SurfaceType;
  z2RmsDerivative: number;
  rpRoughnessIndex: number;
  jrc0LabScale: number;        // Lab-scale JRC0 (100mm reference)
  jrcNFieldScale: number;      // Barton-Bandis field-scale corrected JRCn
  jcsMPa: number;              // Joint wall compressive strength (MPa)
  peakFrictionAngleDeg: number;// Barton-Bandis peak shear friction angle at 0.5 MPa normal stress
  isrmRoughnessClass: string;  // e.g., "Class III: Rough / Undulating (JRC 12–14)"
}

export interface KinematicWedgeCandidate {
  id: string;
  pairLabel: string;           // e.g., "J1 × J2" or "J1 × F1" or "J0 (Planar)"
  failureMode: 'CROWN_GRAVITY_WEDGE' | 'SIDEWALL_SLIDING_WEDGE' | 'PLANAR_SLIDING' | 'FLEXURAL_TOPPLING';
  affectedSurface: 'Crown Arch' | 'Left Wall' | 'Right Wall' | 'Tunnel Face';
  intersectionPlungeDeg: number;
  intersectionTrendDeg: number;
  wedgeApexHeightMeters: number;
  estimatedVolumeM3: number;
  estimatedMassTonnes: number;
  factorOfSafetyDry: number;
  factorOfSafetyWater: number;
  riskLevel: 'CRITICAL' | 'MODERATE' | 'STABLE';
  recommendedBoltLengthM: number;
  recommendedBoltSpacingM: number;
  mobilizedShearStrengthKPa: number;
}

export interface PhotogrammetricPoint3D {
  x: number;
  y: number;
  z: number;
  east: number;
  north: number;
  up: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  surface: SurfaceType;
  jointId?: string;
  setId?: string;
}

export interface PhotogrammetricStructuralSummary {
  totalTracesAnalyzed: number;
  meanSubPixelResidualPx: number;
  meanPhaseCongruency: number;
  meanReprojectionErrorPx: number;
  meanTriangulationResidualM: number;
  arealFractureIntensityP21: number;       // m / m^2
  volumetricFractureIntensityP32: number;  // m^2 / m^3
  mauldonTrueMeanLengthMeters: number;     // Mauldon (1998) censored window corrected trace length (m)
  estimatedBlockVolumeM3: number;          // Palmstrom Vb (m^3)
  terzaghiCorrectedRqdPct: number;         // Bias-corrected RQD (%)
  meanBartonJrc: number;
  jrcProfiles: BartonJRCProfileResult[];
  kinematicWedges: KinematicWedgeCandidate[];
  pointCloudCount: number;
}





