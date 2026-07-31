import { create } from "zustand";
import type { JobConfig, ModelKey } from "./types";
import { defaultDelays, defaultJob, defaultMachines, defaultModelAlignments, defaultTemplates, JOB_VERSION } from "./defaults";
import { autoOffsets } from "./logic/offsets";

/** upgrade legacy jaw open fields (Vec3 or {axis,travel}) to a plain inch distance */
function normalizeJawTravel(sim: Record<string, unknown>, key: "jawA" | "jawB", fallback: number): number {
  const travelKey = key === "jawA" ? "jawATravel" : "jawBTravel";
  const openKey = key === "jawA" ? "jawAOpen" : "jawBOpen";
  const direct = sim[travelKey];
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.abs(direct);
  const raw = sim[openKey];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.abs(raw);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.travel === "number") return Math.abs(o.travel);
    const x = Number(o.x) || 0;
    const y = Number(o.y) || 0;
    const z = Number(o.z) || 0;
    const mag = Math.hypot(x, y, z);
    if (mag > 0) return mag;
  }
  return fallback;
}

/** deep-merge loaded job over defaults so older job files gain new fields */
function mergeJob(loaded: Partial<JobConfig>): JobConfig {
  const base = defaultJob();
  function merge<T>(target: T, src: unknown): T {
    if (src === null || src === undefined) return target;
    if (Array.isArray(target) || Array.isArray(src)) return src as T;
    if (typeof target === "object" && target !== null && typeof src === "object") {
      const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        out[k] = k in out ? merge(out[k], v) : v;
      }
      return out as T;
    }
    return src as T;
  }
  const merged = merge(base, loaded);
  // ensure all template keys exist
  merged.templates = { ...defaultTemplates, ...merged.templates };
  // v1/v2 -> v3: model alignment defaults changed (STEP files are Y-up) and
  // per-model units were replaced by a single fixture-wide stepUnits setting
  if ((loaded.version ?? 1) < 3) {
    merged.fixture.models = defaultModelAlignments();
    merged.fixture.stepUnits = "mm";
  }
  // v3 -> v4: VF-9SS M-codes updated to the real Dual Programmable Air kit
  // (M70/M71 Pn vises, flipper grip on tool air blast M116/M117)
  if ((loaded.version ?? 1) < 4) {
    merged.machines = defaultMachines();
  }
  // v4 -> v5: chip fan; v5 -> v6: bed size; v6 -> v7: T-slot size/spacing/count
  // (machines array is replaced wholesale on merge, so older jobs are missing
  // the new fields - backfill from the matching default machine)
  const machineDefaults = defaultMachines();
  for (const m of merged.machines) {
    const d = machineDefaults.find((x) => x.id === m.id);
    m.chipFanEnabled ??= false;
    m.bedLength ??= d?.bedLength ?? 48;
    m.bedWidth ??= d?.bedWidth ?? 18;
    m.tSlotWidth ??= d?.tSlotWidth ?? 0.63;
    m.tSlotSpacing ??= d?.tSlotSpacing ?? 3.15;
    m.tSlotCount ??= d?.tSlotCount ?? 5;
    // v7 -> v8: optional second gripper for the op2 side
    m.gripper2Enabled ??= false;
    m.gripper2Tool ??= m.gripperTool;
    m.gripper2H ??= m.gripperH;
    // v8 -> v9: gripper on through-tool air blast (M73/M74); update machines
    // still on the old defaults, leave custom codes alone
    if (m.mcodes.gripperClose === "M55") m.mcodes.gripperClose = "M73";
    if (m.mcodes.gripperOpen === "M65") m.mcodes.gripperOpen = "M74";
    // v8 -> v9: flipper rotation air supply mode + actuation delay table
    m.mcodes.flipRotateMode ??= d?.mcodes.flipRotateMode ?? "dedicated";
    m.delays ??= defaultDelays();
  }
  // v6 -> v7: tray mount holes can auto-align to T-slots
  merged.trayGen.mountHoleMode ??= "t-slots";
  // Refresh built-in Haas table/T-slot dims when upgrading from pre-v7
  if ((loaded.version ?? 1) < 7) {
    for (const m of merged.machines) {
      const d = machineDefaults.find((x) => x.id === m.id);
      if (!d) continue;
      m.bedLength = d.bedLength;
      m.bedWidth = d.bedWidth;
      m.tSlotWidth = d.tSlotWidth;
      m.tSlotSpacing = d.tSlotSpacing;
      m.tSlotCount = d.tSlotCount;
    }
  }
  // v7 -> v8: templates gained {ORIENT_*} and {GRIP2_*} tokens;
  // v8 -> v9: templates gained {D_*} delay tokens - refresh stored templates
  // so the new features work (custom edits are replaced; the Program Builder
  // warns if a needed token is missing afterwards)
  if ((loaded.version ?? 1) < 9) {
    merged.templates = { ...defaultTemplates };
  }
  // v8 -> v9: manual offset sheet - seed once from the computed fixture layout
  if (!loaded.offsets) {
    merged.offsets = autoOffsets(merged);
  }
  // normalize simulation jaw travel to a plain inch distance
  for (const key of Object.keys(merged.fixture.models) as ModelKey[]) {
    const sim = merged.fixture.models[key].sim as (typeof merged.fixture.models)[ModelKey]["sim"] &
      Record<string, unknown> | undefined;
    if (!sim) continue;
    sim.jawATravel = normalizeJawTravel(sim as Record<string, unknown>, "jawA", 0.25);
    sim.jawBTravel = normalizeJawTravel(sim as Record<string, unknown>, "jawB", 0.25);
    delete (sim as Record<string, unknown>).jawAOpen;
    delete (sim as Record<string, unknown>).jawBOpen;
  }
  merged.version = JOB_VERSION;
  return merged;
}

/** viewer body-pick mode: which model slot and articulation group is being edited */
export type PickGroup = "rotating" | "jawA" | "jawB";
export interface PickTarget {
  model: "vise" | "flipper" | "gripper";
  /** articulation group to toggle bodies in, or "datum" = click a corner to set the model datum */
  group: PickGroup | "datum";
}

interface AppState {
  job: JobConfig;
  dirty: boolean;
  /** when set, clicking bodies in the 3D viewer toggles them in the target group */
  pick: PickTarget | null;
  /** one-shot request, processed by the Viewer: center the model datum on its picked jaw/finger bodies */
  datumCenter: PickTarget["model"] | null;
  update: (mutator: (job: JobConfig) => void) => void;
  setPick: (pick: PickTarget | null) => void;
  requestDatumCenter: (model: PickTarget["model"]) => void;
  loadJob: (job: Partial<JobConfig>) => void;
  resetJob: () => void;
  markSaved: () => void;
}

const AUTOSAVE_KEY = "spindle-gripper-autosave";

function loadAutosave(): JobConfig {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return mergeJob(JSON.parse(raw));
  } catch {
    /* fall through to default */
  }
  return defaultJob();
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(job: JobConfig) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(job));
    } catch {
      /* storage full - ignore */
    }
  }, 800);
}

export const useApp = create<AppState>((set, get) => ({
  job: loadAutosave(),
  dirty: false,
  pick: null,
  setPick: (pick) => set({ pick }),
  datumCenter: null,
  requestDatumCenter: (model) => set({ datumCenter: model }),
  update: (mutator) => {
    const next = structuredClone(get().job);
    mutator(next);
    scheduleAutosave(next);
    set({ job: next, dirty: true });
  },
  loadJob: (job) => {
    const merged = mergeJob(job);
    scheduleAutosave(merged);
    set({ job: merged, dirty: false });
  },
  resetJob: () => {
    const job = defaultJob();
    scheduleAutosave(job);
    set({ job, dirty: false });
  },
  markSaved: () => set({ dirty: false }),
}));
