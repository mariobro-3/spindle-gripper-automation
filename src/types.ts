export type WcsCode = "G54" | "G55" | "G56" | "G57" | "G58" | "G59";

export type StationKey = "vise1" | "tray" | "vise2" | "flipper" | "finished";

/** dedicated = own solenoid / M-codes; shared-viseN = teed onto that vise's air lines */
export type AirSupplyMode = "dedicated" | "shared-vise1" | "shared-vise2";

export interface McodeMap {
  gripperClose: string;
  gripperOpen: string;
  vise1Close: string;
  vise1Open: string;
  vise2Close: string;
  vise2Open: string;
  flipCW: string;
  flipCCW: string;
  /** flipper rotation air supply; when teed, vise close = rotate CW, vise open = rotate CCW */
  flipRotateMode: AirSupplyMode;
  /** flipper grip air supply; when teed, vise close = grip closed, vise open = grip open */
  flipGripMode: AirSupplyMode;
  flipGripClose: string;
  flipGripOpen: string;
}

/** actuation dwell times in milliseconds, emitted as integer G04 P values */
export interface DelayConfig {
  gripperBefore: number;
  gripperAfter: number;
  vise1Before: number;
  vise1After: number;
  vise2Before: number;
  vise2After: number;
  flipGripBefore: number;
  flipGripAfter: number;
  flipRotateAfter: number;
}

export interface MachineProfile {
  id: string;
  label: string;
  /** "ngc", "pre-ngc", or a custom control name entered via Other */
  control: string;
  mcodes: McodeMap;
  gripperTool: number;
  gripperH: number;
  /** use a different gripper tool for the flipped (Op2-side) part */
  gripper2Enabled: boolean;
  gripper2Tool: number;
  gripper2H: number;
  chipFanTool: number;
  chipFanH: number;
  /** run the Haas chip fan table wash (N210) before the gripper grabs parts */
  chipFanEnabled: boolean;
  /** machine bed / table drawn from machine zero into negative X (inches) */
  bedLength: number;
  /** machine bed / table drawn from machine zero into negative Y (inches) */
  bedWidth: number;
  /** T-slot opening width (inches). Haas 16mm slots ≈ 0.63 */
  tSlotWidth: number;
  /** T-slot center-to-center spacing along Y (inches) */
  tSlotSpacing: number;
  /** number of T-slots, centered on the bed width; 0 = none */
  tSlotCount: number;
  positionFeed: number;
  approachFeed: number;
  insertFeed: number;
  /** G04 dwell table for air actuations */
  delays: DelayConfig;
}

/** Alignment tweaks applied to an imported STEP model in the viewer */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Which STEP bodies articulate in the simulation. Body indices are the solid
 * order inside the STEP file (stable for a given file). Picked by clicking
 * bodies in the 3D viewer.
 *
 * For the flipper: pick the rotating head separately from the grip fingers.
 * Fingers automatically ride with the head when it flips - you do not need to
 * add them to the rotating set.
 *
 * Jaw open direction is inferred from the picked bodies (along the line between
 * finger A and finger B, or away from the model center for a single jaw). You
 * only enter how far they open - rotation / orientation of the whole gripper
 * does not change that.
 */
export interface ModelSimConfig {
  /** bodies that rotate 180 deg (flipper head); pivot = their combined bounding-box center */
  rotating: number[];
  /** rotation axis in model-local coordinates (before alignment rotations) */
  rotAxis: "x" | "y" | "z";
  /** moving jaw / finger group A */
  jawA: number[];
  /** how far jaw A opens (inches); direction is inferred from geometry */
  jawATravel: number;
  /** moving jaw / finger group B (e.g. the opposite gripper finger) */
  jawB: number[];
  /** how far jaw B opens (inches); opposite side of the inferred axis from A */
  jawBTravel: number;
}

export interface ModelAlignment {
  rotX: number; // degrees
  rotY: number;
  rotZ: number;
  offX: number; // inches, applied after auto bottom-center placement
  offY: number;
  offZ: number;
  visible: boolean;
  /** STEP file (relative path in the CAD library); empty = built-in auto-detect */
  file?: string;
  /** simulation articulation: which bodies move and how */
  sim?: ModelSimConfig;
  /**
   * user-picked datum corner in RAW model coordinates (as imported, before
   * units scale / rotation). When set, this point lands on the station point
   * (at plate top) and offX/offY/offZ measure from it. When null/undefined
   * the model auto-places by bounding-box center / bottom.
   */
  datum?: Vec3 | null;
}

export type ModelKey = "vise" | "flipper" | "gripper" | "jaws1" | "jaws2";

export interface FixtureConfig {
  plateLength: number; // X, 18
  plateWidth: number; // Y, 8
  plateThickness: number; // 0.75
  vise1X: number; // station centers in plate-local coords (origin = front-left corner of plate)
  vise1Y: number;
  vise2X: number;
  vise2Y: number;
  flipperX: number;
  flipperY: number;
  /** native units the STEP files were modeled in - applies to all imported models */
  stepUnits: "mm" | "inch";
  models: Record<ModelKey, ModelAlignment>;
}

/**
 * Spindle orientation (M19) per station: the gripper jaw direction at each
 * pick/place. Because the spindle can re-orient while carrying a part, the
 * tray angle and vise angle can differ - that is how you choose which way
 * the stock goes into the vise.
 */
export interface SpindleOrientConfig {
  enabled: boolean;
  tray: number; // degrees at each station
  vise1: number;
  flipper: number;
  vise2: number;
  finished: number;
}

export type DatumRef = "front-left" | "front-right" | "back-left" | "back-right" | "center";

export interface DatumConfig {
  ref: DatumRef;
  machineX: number; // machine coordinate of the probed datum point
  machineY: number;
  /** whole-fixture orientation on the bed: degrees CCW about the datum point */
  rotation: number;
  /** per-station Z values (machine coords) recorded for the offset sheet / G10 output */
  zValues: Record<StationKey, number>;
}

export interface StockConfig {
  length: number; // along machine X
  width: number; // along machine Y
  height: number;
}

export interface TrayConfig {
  /** machine coordinates of the FIRST pocket center (bottom-left pocket, per Gimbel) */
  firstPocketX: number;
  firstPocketY: number;
  countX: number;
  countY: number;
  pitchX: number;
  pitchY: number;
}

export interface BinConfig {
  x: number; // machine coordinate of the drop point (bin center)
  y: number;
  length: number;
  width: number;
  height: number;
  dropZ: number; // drop height above the finished WCS Z0, in the finished WCS
}

export interface FinishedConfig {
  mode: "bin" | "tray";
  bin: BinConfig;
  tray: TrayConfig;
}

export interface TrayGenConfig {
  pocketClearance: number; // added around stock on each side
  pocketDepth: number;
  thickness: number;
  margin: number; // material around outer pockets
  cornerRadius: number; // pocket corner radius
  outerCornerRadius: number;
  mountHoles: boolean;
  /** corners = 4 corner holes; t-slots = holes where the tray overlaps machine T-slots */
  mountHoleMode: "corners" | "t-slots";
  mountHoleDia: number;
  mountHoleInset: number;
}

export type TemplateKey =
  | "beginning"
  | "loadVise1"
  | "chipClear"
  | "chipFan"
  | "unloadVise1"
  | "depositFinished"
  | "loadFlipper"
  | "flipCCW"
  | "unloadVise2"
  | "unloadFlipper"
  | "loadVise2"
  | "flipCW"
  | "ending";

export interface ProgramOptions {
  programNumber: string;
  programComment: string;
  useChipClear: boolean;
  includeG10: boolean;
  faceRemovalOp1: number; // material faced off in op1, lowers regrip Z
}

/** manually entered machine coordinates for one work offset */
export interface StationXYZ {
  x: number;
  y: number;
  z: number;
}

export interface JobConfig {
  version: number;
  name: string;
  machineId: string;
  machines: MachineProfile[];
  fixture: FixtureConfig;
  datum: DatumConfig;
  wcs: Record<StationKey, WcsCode>;
  /** offset sheet values - fully manual, seeded once from the fixture layout */
  offsets: Record<StationKey, StationXYZ>;
  stock: StockConfig;
  stockTray: TrayConfig;
  finished: FinishedConfig;
  trayGen: TrayGenConfig;
  spindleOrient: SpindleOrientConfig;
  templates: Record<TemplateKey, string>;
  op1Code: string;
  op2Code: string;
  options: ProgramOptions;
}
