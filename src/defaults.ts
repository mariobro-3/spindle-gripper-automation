import type {
  JobConfig,
  MachineProfile,
  ModelAlignment,
  TemplateKey,
} from "./types";

function defaultAlignment(): ModelAlignment {
  return { rotX: 0, rotY: 0, rotZ: 0, offX: 0, offY: 0, offZ: 0, visible: true };
}

/**
 * The Gimbel STEP files are modeled Y-up, so they lie on their side in the
 * Z-up scene: stand them up with rotX 90, then the flipper turns 90 on Z so
 * its nest faces the vises. Rotations apply X, then Y, then Z.
 */
export function defaultModelAlignments() {
  return {
    vise: { ...defaultAlignment(), rotX: 90 },
    flipper: { ...defaultAlignment(), rotX: 90, rotZ: 90 },
    gripper: { ...defaultAlignment(), rotX: 90, visible: false },
  };
}

/**
 * VF-9SS: Haas NGC Dual Programmable Air kit (see System Diagrams folder) -
 * vises are M70 Pn (clamp) / M71 Pn (unclamp), and the flipper grip fingers
 * are teed to the one-way tool air blast solenoid: M116 on = grip closed,
 * M117 off = grip open.
 *
 * Pre-NGC machines default to Gimbel's published example codes (M52/M62 style)
 * until their actual relay assignments are entered.
 * Everything is editable per machine in the Machine Config menu.
 */
function ngcDualAirMcodes() {
  return {
    gripperClose: "M55",
    gripperOpen: "M65",
    vise1Close: "M70 P1",
    vise1Open: "M71 P1",
    vise2Close: "M70 P2",
    vise2Open: "M71 P2",
    flipCW: "M64",
    flipCCW: "M54",
    flipGripMode: "dedicated" as const,
    flipGripClose: "M116",
    flipGripOpen: "M117",
  };
}

function gimbelExampleMcodes() {
  return {
    gripperClose: "M55",
    gripperOpen: "M65",
    vise1Close: "M62",
    vise1Open: "M52",
    vise2Close: "M63",
    vise2Open: "M53",
    flipCW: "M64",
    flipCCW: "M54",
    flipGripMode: "shared-vise1" as const,
    flipGripClose: "M66",
    flipGripOpen: "M56",
  };
}

const machineBase = {
  gripperTool: 17,
  gripperH: 17,
  chipFanTool: 1,
  chipFanH: 1,
  chipFanEnabled: false,
  positionFeed: 400,
  approachFeed: 250,
  insertFeed: 20,
};

/** Seed a new machine profile from a name + control type (M-codes / bed sized for that control). */
export function createMachineProfile(id: string, label: string, control: string): MachineProfile {
  // default T-slots: Haas 16mm @ 3.15" (VF-2/3/4 class)
  const slots = { tSlotWidth: 0.63, tSlotSpacing: 3.15, tSlotCount: 5 };
  if (control === "ngc") {
    return {
      id,
      label,
      control,
      mcodes: ngcDualAirMcodes(),
      bedLength: 48,
      bedWidth: 18,
      ...slots,
      ...structuredClone(machineBase),
    };
  }
  // pre-ngc and custom "Other" controls start from Gimbel example M-codes
  return {
    id,
    label,
    control,
    mcodes: gimbelExampleMcodes(),
    bedLength: 48,
    bedWidth: 18,
    ...slots,
    ...structuredClone(machineBase),
  };
}

export function defaultMachines(): MachineProfile[] {
  // Bed sizes = Haas table dimensions (not travel). T-slot specs from Haas published tables:
  // VF-3SS / VF-4SS: 16mm slots, 3.15" (80mm) centers, 5 slots
  // VF-9SS: 16mm slots, 4.92" (125mm) centers, 7 slots
  return [
    {
      id: "vf9ss",
      label: "VF-9SS (NGC, Dual Prog. Air)",
      control: "ngc",
      mcodes: ngcDualAirMcodes(),
      bedLength: 84,
      bedWidth: 36,
      tSlotWidth: 0.63,
      tSlotSpacing: 4.92,
      tSlotCount: 7,
      ...structuredClone(machineBase),
    },
    {
      id: "vf3ss",
      label: "VF-3SS (Pre-NGC)",
      control: "pre-ngc",
      mcodes: gimbelExampleMcodes(),
      bedLength: 48,
      bedWidth: 18,
      tSlotWidth: 0.63,
      tSlotSpacing: 3.15,
      tSlotCount: 5,
      ...structuredClone(machineBase),
    },
    {
      id: "vf4ss",
      label: "VF-4SS (Pre-NGC)",
      control: "pre-ngc",
      mcodes: gimbelExampleMcodes(),
      bedLength: 52,
      bedWidth: 19.5,
      tSlotWidth: 0.63,
      tSlotSpacing: 3.15,
      tSlotCount: 5,
      ...structuredClone(machineBase),
    },
  ];
}

/**
 * Macro templates, seeded from Gimbel Automation's published M97 Program Generator
 * code and extended for the two-op flip cycle. Tokens in {BRACES} are substituted
 * at build time from the machine profile / job config.
 *
 * Fixed line numbers (M97 targets):
 *   N200 load vise 1 (tray retrieval + vise deposit)
 *   N201 chip clearing
 *   N202 unload vise 1 (op1 part retrieval)
 *   N203 deposit finished part (bin or finished tray)
 *   N204 load flipper + close flipper grip
 *   N205 rotate flipper CCW
 *   N206 unload vise 2 (finished part retrieval)
 *   N207 unload flipper (grab flipped part)
 *   N208 load vise 2
 *   N209 rotate flipper CW (+ re-clamp vise 1 on shared line)
 *   N210 Haas chip fan table wash (from FAN.nc, optional per machine)
 *   N301+ tray pocket positions (generated)
 *   N401+ finished positions (generated)
 *   N500 op1 machining, N501 op2 machining
 */
export const defaultTemplates: Record<TemplateKey, string> = {
  beginning: `(TWO-OP SPINDLE GRIPPER AUTOMATION - {MACHINE})
(GENERATED {DATE} BY SPINDLE GRIPPER AUTOMATION APP)
G90 G94 G17 G20; (absolute, feed per min, xy plane, inch)
M31; (chip auger on)
G53 G0 Z0.; (move z to machine home)`,

  loadVise1: `N200; (LOAD VISE 1 - TRAY RETRIEVAL AND VISE DEPOSIT)
G90 G94 G17 G20; (settings)
T{GRIP_TOOL} M6; (get gripper)
G43 H{GRIP_H}; (activate gripper height offset)
{WCS_TRAY}; (tray work offset - xy set by pocket position macro)
G1 Z1.0 F{F_APPR}; (lower to z1.0 above tray z0)
G1 Z0. F{F_INS}; (lower onto stock in pocket)
{GRIP_CLOSE}; (close gripper)
G04 P1.0; (wait one second)
G1 Z1. F{F_INS}; (raise part to z1)
G53 G1 Z0. F{F_POS}; (raise part to machine z0)
{V1_OPEN}; (open vise 1 - opens flipper grip too if teed)
{WCS_V1}; (vise 1 work offset)
G1 X0. Y0. F{F_POS}; (center gripper over vise 1)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z-0.01 F{F_INS}; (seat stock in vise)
G04 P0.2; (wait)
{V1_CLOSE}; (close vise 1)
G04 P2.0; (wait for vise to close)
{GRIP_OPEN}; (open gripper)
G04 P0.2; (wait)
G1 Z1. F{F_INS}; (move to z1)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  chipClear: `N201; (CHIP CLEARING)
G90 G94 G17 G20; (settings)
G53 G0 Z0.; (move z to machine home)
T{FAN_TOOL} M6; (change to chip fan)
G43 H{FAN_H}; (chip fan height offset)
S500 M3; (start spindle slow)
G04 P2.0; (wait)
S2000 M3; (ramp up speed)
G04 P2.0; (wait)
S5000 M3; (full speed)
G53 G0 X-30. Y-15.;
G53 G0 Z-3.00; (lower chip fan)
G53 G0 X-5.;
G53 G0 Y-5.;
G53 G0 X-30.;
G53 G0 Z0.; (raise chip fan)
S1000 M3; (slow down)
G04 P2.0; (wait)
M5; (spindle off)
M99; (return to main program)`,

  chipFan: `N210; (HAAS CHIP FAN - TABLE WASH BEFORE PART HANDLING)
(ADAPTED FROM FAN.NC - VMC HAAS CHIPFAN TABLE WASH)
G90 G94 G17 G20; (settings)
G53 G0 Z0.; (z to machine home)
T{FAN_TOOL} M6; (change to chip fan)
G00 G17 G40 G49 G80 G90; (safe start)
M03 S1500; (start fan slow)
G04 P0.5; (wait)
M03 S5000; (fan up to full speed)
G00 {WCS_V1} X0. Y-2.5; (wash start point)
G43 H{FAN_H}; (fan height offset)
G00 Z3.; (z3. above work zero)
G90 G01 X5. F50.; (wash pass across the table)
G53 G00 Z0.; (z to machine home)
M05; (fan off)
M99; (return to main program)`,

  unloadVise1: `N202; (UNLOAD VISE 1 - GRAB OP1 PART)
G90 G94 G17 G20; (settings)
T{GRIP_TOOL} M6; (get gripper)
G43 H{GRIP_H}; (activate gripper height offset)
{WCS_V1}; (vise 1 work offset)
G1 X0. Y0. F{F_POS}; (center gripper over vise 1)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z{FACE_Z} F{F_INS}; (grip height - compensated for op1 facing)
G04 P0.2; (wait)
{GRIP_CLOSE}; (close gripper)
{V1_OPEN}; (open vise 1 - opens flipper grip too if teed)
G04 P2.0; (wait)
G1 Z1. F{F_INS}; (raise part)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  loadFlipper: `N204; (LOAD FLIPPER AND CLOSE FLIPPER GRIP)
G90 G94 G17 G20; (settings)
{WCS_FLIP}; (flipper work offset)
G1 X0. Y0. F{F_POS}; (center gripper over flipper nest)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z{FACE_Z} F{F_INS}; (place part in flipper)
G04 P0.2; (wait)
{FGRIP_CLOSE}; (close flipper grip)
G04 P1.0; (wait)
{GRIP_OPEN}; (release gripper)
G04 P0.2; (wait)
G1 Z1. F{F_INS}; (raise clear)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  flipCCW: `N205; (ROTATE FLIPPER CCW - FLIP PART)
{FLIP_CCW}; (rotate flipper ccw)
G04 P2.5; (wait for rotation to complete)
M99; (return to main program)`,

  unloadVise2: `N206; (UNLOAD VISE 2 - GRAB FINISHED PART)
G90 G94 G17 G20; (settings)
T{GRIP_TOOL} M6; (get gripper)
G43 H{GRIP_H}; (activate gripper height offset)
{WCS_V2}; (vise 2 work offset)
G1 X0. Y0. F{F_POS}; (center gripper over vise 2)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z0. F{F_INS}; (grip height)
G04 P0.2; (wait)
{GRIP_CLOSE}; (close gripper)
{V2_OPEN}; (open vise 2)
G04 P2.0; (wait)
G1 Z1. F{F_INS}; (raise part)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  depositFinished: `N203; (DEPOSIT FINISHED PART - XY SET BY POSITION MACRO)
G1 Z{DROP_Z} F{F_APPR}; (lower to drop height)
{GRIP_OPEN}; (release part)
G04 P1.0; (wait)
G53 G0 Z0.; (raise to machine z0)
M99; (return to main program)`,

  unloadFlipper: `N207; (UNLOAD FLIPPER - GRAB FLIPPED PART)
G90 G94 G17 G20; (settings)
{WCS_FLIP}; (flipper work offset)
G1 X0. Y0. F{F_POS}; (center gripper over flipper nest)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z0. F{F_INS}; (lower to part)
G04 P0.2; (wait)
{GRIP_CLOSE}; (grab part with gripper)
G04 P0.5; (wait)
{FGRIP_OPEN}; (open flipper grip - opens vise 1 too if teed)
G04 P0.5; (wait)
G1 Z1. F{F_INS}; (raise part clear of flipper)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  loadVise2: `N208; (LOAD VISE 2)
G90 G94 G17 G20; (settings)
{V2_OPEN}; (open vise 2)
{WCS_V2}; (vise 2 work offset)
G1 X0. Y0. F{F_POS}; (center gripper over vise 2)
G1 Z2. F{F_APPR}; (move to z2)
G1 Z1. F100.; (move to z1)
G1 Z-0.01 F{F_INS}; (seat part in vise)
G04 P0.2; (wait)
{V2_CLOSE}; (close vise 2)
G04 P2.0; (wait for vise to close)
{GRIP_OPEN}; (open gripper)
G04 P0.2; (wait)
G1 Z1. F{F_INS}; (raise clear)
G0 G53 Z0.; (rapid to machine z0)
M99; (return to main program)`,

  flipCW: `N209; (ROTATE FLIPPER BACK CW)
{FLIP_CW}; (rotate flipper cw to home)
G04 P2.5; (wait for rotation to complete)
{V1_CLOSE}; (ensure vise 1 clamped before machining)
G04 P1.0; (wait for clamp)
M99; (return to main program)`,

  ending: `G53 G0 Z0.; (go to z home)
M5; (spindle off)
M9; (coolant off)
M33; (chip auger off)
G53 G0 X0. Y0.; (go to machine home)
M30; (end program)`,
};

export const JOB_VERSION = 7;

export function defaultJob(): JobConfig {
  return {
    version: JOB_VERSION,
    name: "Untitled Job",
    machineId: "vf9ss",
    machines: defaultMachines(),
    fixture: {
      plateLength: 18,
      plateWidth: 8,
      plateThickness: 0.75,
      vise1X: 3.0,
      vise1Y: 4.0,
      vise2X: 15.0,
      vise2Y: 4.0,
      flipperX: 9.0,
      flipperY: 4.0,
      stepUnits: "mm",
      models: defaultModelAlignments(),
    },
    datum: {
      ref: "front-left",
      machineX: -20.0,
      machineY: -12.0,
      rotation: 0,
      zValues: { vise1: -18, tray: -20, vise2: -18, flipper: -16, finished: -20 },
    },
    wcs: { vise1: "G54", tray: "G55", vise2: "G56", flipper: "G57", finished: "G58" },
    stock: { length: 2.0, width: 2.0, height: 1.0 },
    stockTray: {
      firstPocketX: -35.0,
      firstPocketY: -10.0,
      countX: 4,
      countY: 3,
      pitchX: 2.5,
      pitchY: 2.5,
    },
    finished: {
      mode: "bin",
      bin: { x: -35.0, y: -3.0, length: 6, width: 6, height: 4, dropZ: 1.0 },
      tray: {
        firstPocketX: -35.0,
        firstPocketY: -2.0,
        countX: 4,
        countY: 3,
        pitchX: 2.5,
        pitchY: 2.5,
      },
    },
    trayGen: {
      pocketClearance: 0.01,
      pocketDepth: 0.375,
      thickness: 0.5,
      margin: 0.5,
      cornerRadius: 0.125,
      outerCornerRadius: 0.25,
      mountHoles: true,
      mountHoleMode: "t-slots",
      mountHoleDia: 0.257,
      mountHoleInset: 0.3,
    },
    templates: { ...defaultTemplates },
    op1Code: "",
    op2Code: "",
    options: {
      programNumber: "O01000",
      programComment: "TWO OP GRIPPER JOB",
      useChipClear: true,
      includeG10: false,
      faceRemovalOp1: 0,
    },
  };
}
