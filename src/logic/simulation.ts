import type { JobConfig } from "../types";
import { plateToMachine } from "./offsets";
import { machineOf } from "./program";

/**
 * Kinematic simulation of the two-op flip cycle. The timeline is generated
 * from the same cycle logic as buildProgram (not by parsing G-code), using
 * viewer/machine coordinates, the actuation delay table, and the spindle
 * orient settings. A pure evaluator (stateAt) turns elapsed time into a
 * scene state, which makes play/pause/scrub trivial.
 */

export type SimDevice = "vise1" | "vise2" | "flipGrip" | "gripper";

export type SimEvent =
  | { kind: "move"; x: number; y: number; z: number }
  | { kind: "dwell" }
  | { kind: "state"; device: SimDevice; closed: boolean }
  | { kind: "orient"; deg: number }
  | { kind: "flip"; deg: number }
  | { kind: "pick"; part: number }
  | { kind: "place"; part: number; x: number; y: number; z: number };

export interface SimStep {
  event: SimEvent;
  start: number; // ms
  duration: number; // ms
  label: string;
}

export interface SimTimeline {
  steps: SimStep[];
  total: number;
  partCount: number;
  /** initial resting position of each part (tray pockets) */
  initialParts: { x: number; y: number; z: number }[];
  home: { x: number; y: number; z: number };
  partHeight: number;
}

// viewer-space constants (machine coords, plate top = z0)
const SAFE_Z = 10;
const APPROACH = 1.2; // hover height above the grab point
const VISE_PART_Z = 2.1; // fallback part center height in a vise
const FLIP_PART_Z = 3.2; // fallback part center height in the flipper nest
const RAPID_IPS = 22; // in/s XY travel
const PLUNGE_IPS = 7; // in/s Z plunge/retract
const MIN_MOVE_MS = 120;

/** grip plane heights derived from the picked jaw/finger bodies in the scene */
export interface SimHeights {
  /** top surface of the vise jaws (part center rides here) */
  vise?: number | null;
  /** center between the flipper grip fingers */
  flipper?: number | null;
}

export function buildSimTimeline(job: JobConfig, heights?: SimHeights): SimTimeline {
  const m = machineOf(job);
  const d = m.delays;
  const so = job.spindleOrient;
  const fx = job.fixture;
  const h = job.stock.height;
  const visePartZ = heights?.vise ?? VISE_PART_Z;
  const flipPartZ = heights?.flipper ?? FLIP_PART_Z;

  const v1 = plateToMachine(job, fx.vise1X, fx.vise1Y);
  const v2 = plateToMachine(job, fx.vise2X, fx.vise2Y);
  const fl = plateToMachine(job, fx.flipperX, fx.flipperY);
  const tableZ = -fx.plateThickness;
  const trayPartZ = tableZ + job.trayGen.thickness - job.trayGen.pocketDepth + h / 2;

  const pockets: { x: number; y: number }[] = [];
  for (let j = 0; j < job.stockTray.countY; j++) {
    for (let i = 0; i < job.stockTray.countX; i++) {
      pockets.push({
        x: job.stockTray.firstPocketX + i * job.stockTray.pitchX,
        y: job.stockTray.firstPocketY + j * job.stockTray.pitchY,
      });
    }
  }
  const n = pockets.length;

  const finishedPos = (i: number): { x: number; y: number; z: number } => {
    if (job.finished.mode === "tray") {
      const t = job.finished.tray;
      const idx = Math.min(i - 1, t.countX * t.countY - 1);
      return {
        x: t.firstPocketX + (idx % t.countX) * t.pitchX,
        y: t.firstPocketY + Math.floor(idx / t.countX) * t.pitchY,
        z: trayPartZ,
      };
    }
    const b = job.finished.bin;
    // scatter parts slightly in the bin so they stay visible
    return {
      x: b.x + ((i % 3) - 1) * 0.6,
      y: b.y + ((Math.floor(i / 3) % 3) - 1) * 0.6,
      z: tableZ + 0.4 + h / 2 + Math.floor(i / 9) * h,
    };
  };

  const steps: SimStep[] = [];
  let t = 0;
  const cur = { x: 0, y: 0, z: SAFE_Z + 4 };
  const home = { ...cur };
  let curOrient = 0;
  let curTool = m.gripperTool;

  const push = (event: SimEvent, duration: number, label: string) => {
    steps.push({ event, start: t, duration, label });
    t += duration;
  };

  const moveTo = (x: number, y: number, z: number, label: string) => {
    const dist = Math.hypot(x - cur.x, y - cur.y, z - cur.z);
    const xy = Math.hypot(x - cur.x, y - cur.y);
    const speed = xy > 0.01 ? RAPID_IPS : PLUNGE_IPS;
    push({ kind: "move", x, y, z }, Math.max(MIN_MOVE_MS, (dist / speed) * 1000), label);
    cur.x = x;
    cur.y = y;
    cur.z = z;
  };

  const travel = (x: number, y: number, label: string) => {
    if (cur.z < SAFE_Z) moveTo(cur.x, cur.y, SAFE_Z, "retract to safe Z");
    moveTo(x, y, SAFE_Z, label);
  };

  const dwell = (ms: number, label: string) => {
    if (ms > 0) push({ kind: "dwell" }, ms, label);
  };

  const orient = (deg: number, label: string) => {
    if (!so.enabled || deg === curOrient) return;
    push({ kind: "orient", deg }, 500, label);
    curOrient = deg;
  };

  const setState = (device: SimDevice, closed: boolean, label: string) => {
    push({ kind: "state", device, closed }, 160, label);
  };

  const ensureTool = (tool: number, what: string) => {
    if (tool === curTool) return;
    travel(home.x, home.y, `tool change - to spindle home`);
    moveTo(home.x, home.y, home.z, "raise for tool change");
    dwell(1200, `tool change: T${tool} (${what})`);
    curTool = tool;
  };

  const grip2Tool = m.gripper2Enabled ? m.gripper2Tool : m.gripperTool;

  /** pick a part: approach, pre-dwell, close gripper, post-dwell, attach, retract */
  const pick = (part: number, x: number, y: number, partZ: number, openDevice: SimDevice | null, what: string) => {
    const topZ = partZ + h / 2;
    travel(x, y, `move over ${what}`);
    moveTo(x, y, topZ + APPROACH, `lower to approach`);
    moveTo(x, y, topZ, `down to grip height`);
    dwell(d.gripperBefore, "dwell before gripper");
    setState("gripper", true, "close gripper");
    if (openDevice === "vise1") setState("vise1", false, "open vise 1");
    if (openDevice === "vise2") setState("vise2", false, "open vise 2");
    if (openDevice === "flipGrip") setState("flipGrip", false, "open flipper grip");
    dwell(
      openDevice === "vise1" ? d.vise1After : openDevice === "vise2" ? d.vise2After : openDevice === "flipGrip" ? d.flipGripAfter : d.gripperAfter,
      "dwell - air actuation"
    );
    push({ kind: "pick", part }, 0, `part ${part} in gripper`);
    moveTo(x, y, SAFE_Z, "raise part clear");
  };

  /** place a part: approach, seat, close device, dwell, open gripper, detach, retract */
  const place = (
    part: number,
    x: number,
    y: number,
    partZ: number,
    closeDevice: SimDevice | null,
    what: string
  ) => {
    const topZ = partZ + h / 2;
    travel(x, y, `carry part ${part} to ${what}`);
    moveTo(x, y, topZ + APPROACH, "lower to approach");
    moveTo(x, y, topZ, `seat part in ${what}`);
    if (closeDevice === "vise1") {
      dwell(d.vise1Before, "dwell before vise 1");
      setState("vise1", true, "close vise 1");
      dwell(d.vise1After, "dwell after vise 1");
    }
    if (closeDevice === "vise2") {
      dwell(d.vise2Before, "dwell before vise 2");
      setState("vise2", true, "close vise 2");
      dwell(d.vise2After, "dwell after vise 2");
    }
    if (closeDevice === "flipGrip") {
      dwell(d.flipGripBefore, "dwell before flipper grip");
      setState("flipGrip", true, "close flipper grip");
      dwell(d.flipGripAfter, "dwell after flipper grip");
    }
    setState("gripper", false, "open gripper");
    push({ kind: "place", part, x, y, z: partZ }, 0, `part ${part} placed`);
    dwell(d.gripperAfter, "dwell after gripper");
    moveTo(x, y, SAFE_Z, "raise clear");
  };

  const flip = (toDeg: number, label: string) => {
    push({ kind: "flip", deg: toDeg }, 900, label);
    dwell(d.flipRotateAfter, "dwell after rotation");
  };

  const machining = (op: 1 | 2, part: number) => {
    travel(home.x, home.y, "clear for machining");
    moveTo(home.x, home.y, home.z, "spindle to home");
    dwell(2500, `machining op${op} on part ${part}`);
  };

  // ---- macro-level sequences (mirror buildProgram)
  const loadVise1 = (part: number) => {
    ensureTool(m.gripperTool, "gripper 1");
    orient(so.tray, "orient for tray pick");
    const p = pockets[part - 1];
    pick(part, p.x, p.y, trayPartZ, null, `tray pocket ${part}`);
    orient(so.vise1, "orient for vise 1");
    setState("vise1", false, "open vise 1");
    place(part, v1.x, v1.y, visePartZ, "vise1", "vise 1");
  };

  const unloadVise1 = (part: number) => {
    ensureTool(m.gripperTool, "gripper 1");
    orient(so.vise1, "orient for vise 1");
    pick(part, v1.x, v1.y, visePartZ, "vise1", `vise 1 (part ${part})`);
  };

  const loadFlipper = (part: number) => {
    orient(so.flipper, "orient for flipper");
    place(part, fl.x, fl.y, flipPartZ, "flipGrip", "flipper nest");
  };

  const unloadVise2 = (part: number) => {
    ensureTool(grip2Tool, "op2 gripper");
    orient(so.vise2, "orient for vise 2");
    pick(part, v2.x, v2.y, visePartZ, "vise2", `vise 2 (part ${part})`);
  };

  const deposit = (part: number) => {
    orient(so.finished, "orient for finished drop");
    const p = finishedPos(part);
    place(part, p.x, p.y, p.z, null, job.finished.mode === "bin" ? "finished bin" : "finished tray");
  };

  const unloadFlipper = (part: number) => {
    ensureTool(grip2Tool, "op2 gripper");
    orient(so.flipper, "orient for flipper");
    pick(part, fl.x, fl.y, flipPartZ, "flipGrip", `flipper (part ${part})`);
  };

  const loadVise2 = (part: number) => {
    orient(so.vise2, "orient for vise 2");
    setState("vise2", false, "open vise 2");
    place(part, v2.x, v2.y, visePartZ, "vise2", "vise 2");
  };

  // ---- the two-op pipelined cycle
  if (n >= 1) {
    dwell(400, `cycle 1 of ${n}: prime - load part 1`);
    loadVise1(1);
    machining(1, 1);
  }

  for (let k = 2; k <= n; k++) {
    dwell(400, `cycle ${k} of ${n}`);
    unloadVise1(k - 1);
    loadFlipper(k - 1);
    flip(180, "rotate flipper CCW - flip part");
    if (k >= 3) {
      unloadVise2(k - 2);
      deposit(k - 2);
    }
    loadVise1(k);
    unloadFlipper(k - 1);
    loadVise2(k - 1);
    flip(0, "rotate flipper home CW");
    machining(1, k);
    machining(2, k - 1);
  }

  if (n >= 2) {
    dwell(400, `drain: flip and finish part ${n}`);
    unloadVise1(n);
    loadFlipper(n);
    flip(180, "rotate flipper CCW - flip part");
    unloadVise2(n - 1);
    deposit(n - 1);
    unloadFlipper(n);
    loadVise2(n);
    flip(0, "rotate flipper home CW");
    machining(2, n);
    unloadVise2(n);
    deposit(n);
  } else if (n === 1) {
    dwell(400, "single part: flip and machine op2");
    unloadVise1(1);
    loadFlipper(1);
    flip(180, "rotate flipper CCW - flip part");
    unloadFlipper(1);
    loadVise2(1);
    flip(0, "rotate flipper home CW");
    machining(2, 1);
    unloadVise2(1);
    deposit(1);
  }

  travel(home.x, home.y, "cycle complete - return home");
  moveTo(home.x, home.y, home.z, "spindle to home");
  dwell(600, "done - all parts finished");

  return {
    steps,
    total: t,
    partCount: n,
    initialParts: pockets.map((p) => ({ x: p.x, y: p.y, z: trayPartZ })),
    home,
    partHeight: h,
  };
}

// ---------------------------------------------------------------------------
// Pure state evaluation (replay up to time t)
// ---------------------------------------------------------------------------

export interface SimState {
  gripper: { x: number; y: number; z: number };
  orientDeg: number;
  flipDeg: number;
  devices: Record<SimDevice, boolean>; // true = closed/clamped
  parts: { x: number; y: number; z: number }[];
  attached: number | null;
  label: string;
}

export function stateAt(tl: SimTimeline, time: number): SimState {
  const s: SimState = {
    gripper: { ...tl.home },
    orientDeg: 0,
    flipDeg: 0,
    devices: { vise1: false, vise2: false, flipGrip: false, gripper: false },
    parts: tl.initialParts.map((p) => ({ ...p })),
    attached: null,
    label: "ready",
  };

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  for (const step of tl.steps) {
    const e = step.event;
    if (time >= step.start + step.duration) {
      // apply fully
      switch (e.kind) {
        case "move":
          s.gripper = { x: e.x, y: e.y, z: e.z };
          break;
        case "state":
          s.devices[e.device] = e.closed;
          break;
        case "orient":
          s.orientDeg = e.deg;
          break;
        case "flip":
          s.flipDeg = e.deg;
          break;
        case "pick":
          s.attached = e.part;
          break;
        case "place":
          s.attached = null;
          s.parts[e.part - 1] = { x: e.x, y: e.y, z: e.z };
          break;
      }
      continue;
    }
    if (time <= step.start) break;
    // partially through this step
    const f = step.duration > 0 ? (time - step.start) / step.duration : 1;
    s.label = step.label;
    switch (e.kind) {
      case "move":
        s.gripper = {
          x: lerp(s.gripper.x, e.x, f),
          y: lerp(s.gripper.y, e.y, f),
          z: lerp(s.gripper.z, e.z, f),
        };
        break;
      case "orient":
        s.orientDeg = lerp(s.orientDeg, e.deg, f);
        break;
      case "flip":
        s.flipDeg = lerp(s.flipDeg, e.deg, f);
        break;
      default:
        break;
    }
    break;
  }

  // label = the step containing (or nearest before) time
  for (let i = tl.steps.length - 1; i >= 0; i--) {
    if (tl.steps[i].start <= time) {
      s.label = tl.steps[i].label;
      break;
    }
  }
  if (time >= tl.total) s.label = "done - all parts finished";

  // an attached part rides just under the gripper tip (tip = part top)
  if (s.attached !== null) {
    s.parts[s.attached - 1] = { x: s.gripper.x, y: s.gripper.y, z: s.gripper.z - tl.partHeight / 2 };
  }
  return s;
}
