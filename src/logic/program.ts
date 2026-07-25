import type { JobConfig, MachineProfile, TemplateKey } from "./../types";
import { fmt, g10Lines } from "./offsets";

// ---------------------------------------------------------------------------
// NC sanitizer
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  clean: string;
  /** lines that were removed or altered, with reasons, for the diff display */
  flagged: { lineNo: number; original: string; action: "removed" | "modified"; result?: string; reason: string }[];
}

/**
 * Cleans a CAM-posted program so it can be embedded as an M97 macro section:
 * - strips %, O-numbers, M30/M99/M02 (would end/return early)
 * - strips G28/G30 and G53 home moves (would crash into fixtures mid-cycle)
 * - strips N line numbers (would collide with the M97 target numbering)
 */
export function sanitizeNc(code: string): SanitizeResult {
  const flagged: SanitizeResult["flagged"] = [];
  const out: string[] = [];
  const lines = code.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw.trimEnd();
    const bare = line.trim();

    if (bare === "%" || bare === "") {
      if (bare === "%") flagged.push({ lineNo, original: raw, action: "removed", reason: "program start/end marker" });
      if (bare === "") out.push("");
      return;
    }
    if (/^O\d+/i.test(bare)) {
      flagged.push({ lineNo, original: raw, action: "removed", reason: "O-number (program number) not allowed inside a macro section" });
      return;
    }
    // strip leading N numbers but keep the rest of the line
    const nMatch = bare.match(/^N\d+\s*/i);
    if (nMatch) {
      const rest = bare.slice(nMatch[0].length);
      if (rest === "") {
        flagged.push({ lineNo, original: raw, action: "removed", reason: "bare N line number collides with M97 targets" });
        return;
      }
      line = rest;
      flagged.push({ lineNo, original: raw, action: "modified", result: line, reason: "N line number stripped (collides with M97 targets)" });
    }

    const upper = line.toUpperCase();
    if (/\bM30\b|\bM0?2\b(?![0-9])/.test(upper)) {
      flagged.push({ lineNo, original: raw, action: "removed", reason: "M30/M02 would end the whole program mid-cycle" });
      return;
    }
    if (/\bM99\b/.test(upper)) {
      flagged.push({ lineNo, original: raw, action: "removed", reason: "M99 is added automatically at the end of the section" });
      return;
    }
    if (/\bG28\b|\bG30\b/.test(upper)) {
      flagged.push({ lineNo, original: raw, action: "removed", reason: "G28/G30 home move removed (machine home handled by the template)" });
      return;
    }
    if (/\bG53\b/.test(upper) && /\bX|\bY/.test(upper)) {
      flagged.push({ lineNo, original: raw, action: "removed", reason: "G53 XY home move removed (would leave the work area mid-cycle)" });
      return;
    }
    out.push(line);
  });

  // trim trailing blank lines
  while (out.length && out[out.length - 1] === "") out.pop();
  return { clean: out.join("\n"), flagged };
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export function machineOf(job: JobConfig): MachineProfile {
  return job.machines.find((m) => m.id === job.machineId) ?? job.machines[0];
}

export function tokenValues(job: JobConfig): Record<string, string> {
  const m = machineOf(job);
  const teed = m.mcodes.flipGripMode === "shared-vise1";
  const dropZ = job.finished.mode === "bin" ? job.finished.bin.dropZ : 0.05;
  return {
    PROG_NUM: job.options.programNumber.replace(/^O/i, ""),
    PROG_COMMENT: job.options.programComment.toUpperCase(),
    MACHINE: m.label.toUpperCase(),
    DATE: new Date().toLocaleDateString(),
    GRIP_TOOL: String(m.gripperTool),
    GRIP_H: String(m.gripperH),
    FAN_TOOL: String(m.chipFanTool),
    FAN_H: String(m.chipFanH),
    GRIP_CLOSE: m.mcodes.gripperClose,
    GRIP_OPEN: m.mcodes.gripperOpen,
    V1_CLOSE: m.mcodes.vise1Close,
    V1_OPEN: m.mcodes.vise1Open,
    V2_CLOSE: m.mcodes.vise2Close,
    V2_OPEN: m.mcodes.vise2Open,
    FLIP_CW: m.mcodes.flipCW,
    FLIP_CCW: m.mcodes.flipCCW,
    FGRIP_CLOSE: teed ? m.mcodes.vise1Close : m.mcodes.flipGripClose,
    FGRIP_OPEN: teed ? m.mcodes.vise1Open : m.mcodes.flipGripOpen,
    WCS_V1: job.wcs.vise1,
    WCS_TRAY: job.wcs.tray,
    WCS_V2: job.wcs.vise2,
    WCS_FLIP: job.wcs.flipper,
    WCS_FIN: job.wcs.finished,
    F_POS: `${fmt(m.positionFeed)}`,
    F_APPR: `${fmt(m.approachFeed)}`,
    F_INS: `${fmt(m.insertFeed)}`,
    FACE_Z: fmt(0 - job.options.faceRemovalOp1),
    DROP_Z: fmt(dropZ),
  };
}

export function resolveTemplate(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{([A-Z0-9_]+)\}/g, (whole, key: string) => tokens[key] ?? whole);
}

/** tokens present in a template that we don't know how to resolve */
export function unknownTokens(text: string, tokens: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{([A-Z0-9_]+)\}/g)) {
    if (!(m[1] in tokens)) found.add(m[1]);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Program assembly — two-op pipelined flip cycle
// ---------------------------------------------------------------------------

export interface BuildResult {
  program: string;
  warnings: string[];
  pocketCount: number;
}

interface Pocket {
  index: number; // 1-based
  x: number; // relative to first pocket (tray WCS X0 Y0)
  y: number;
}

function trayPockets(countX: number, countY: number, pitchX: number, pitchY: number): Pocket[] {
  const pockets: Pocket[] = [];
  let idx = 1;
  for (let j = 0; j < countY; j++) {
    for (let i = 0; i < countX; i++) {
      pockets.push({ index: idx++, x: i * pitchX, y: j * pitchY });
    }
  }
  return pockets;
}

const CALL = {
  loadVise1: 200,
  chipClear: 201,
  chipFan: 210,
  unloadVise1: 202,
  depositFinished: 203,
  loadFlipper: 204,
  flipCCW: 205,
  unloadVise2: 206,
  unloadFlipper: 207,
  loadVise2: 208,
  flipCW: 209,
  op1: 500,
  op2: 501,
};

export function buildProgram(job: JobConfig): BuildResult {
  const warnings: string[] = [];
  const tokens = tokenValues(job);
  const m = machineOf(job);
  const teed = m.mcodes.flipGripMode === "shared-vise1";

  const pockets = trayPockets(
    job.stockTray.countX,
    job.stockTray.countY,
    job.stockTray.pitchX,
    job.stockTray.pitchY
  );
  const n = pockets.length;
  if (n === 0) warnings.push("Stock tray has zero pockets.");
  if (n > 98) warnings.push(`Tray has ${n} pockets; only 98 are supported by the N301+ numbering scheme.`);

  const finishedPockets =
    job.finished.mode === "tray"
      ? trayPockets(
          job.finished.tray.countX,
          job.finished.tray.countY,
          job.finished.tray.pitchX,
          job.finished.tray.pitchY
        )
      : [];
  if (job.finished.mode === "tray" && finishedPockets.length < n) {
    warnings.push(
      `Finished tray has ${finishedPockets.length} pockets but the stock tray has ${n} - not every finished part will have a pocket.`
    );
  }

  // template checks
  for (const key of Object.keys(job.templates) as TemplateKey[]) {
    const unk = unknownTokens(job.templates[key], tokens);
    if (unk.length) warnings.push(`Template "${key}" has unknown tokens: ${unk.join(", ")}`);
  }

  // teed-circuit safety check: after unloadFlipper (which opens vise 1 via the
  // shared line), vise 1 must be re-clamped before machining. The default
  // flipCW template does this; warn if the user edited it away.
  if (teed) {
    const resolvedFlipCW = resolveTemplate(job.templates.flipCW, tokens).toUpperCase();
    const resolvedUnloadFlipper = resolveTemplate(job.templates.unloadFlipper, tokens).toUpperCase();
    const v1close = m.mcodes.vise1Close.toUpperCase();
    if (
      resolvedUnloadFlipper.includes(m.mcodes.vise1Open.toUpperCase()) &&
      !resolvedFlipCW.includes(v1close)
    ) {
      warnings.push(
        `Flipper grip is teed to vise 1: unloading the flipper opens vise 1, but the "flipCW" template does not re-clamp vise 1 (${m.mcodes.vise1Close}) before machining. Parts will be machined unclamped!`
      );
    }
  }

  const op1 = sanitizeNc(job.op1Code);
  const op2 = sanitizeNc(job.op2Code);
  if (!op1.clean.trim()) warnings.push("Op1 machining code is empty.");
  if (!op2.clean.trim()) warnings.push("Op2 machining code is empty.");

  const L: string[] = [];
  const t = (key: TemplateKey) => resolveTemplate(job.templates[key], tokens);
  const call = (p: number, comment: string) => L.push(`M97 P${p}; (${comment})`);
  const posPocket = (i: number, comment: string) => call(300 + i, comment);
  const posFinished = (i: number, comment: string) =>
    call(job.finished.mode === "bin" ? 401 : 400 + i, comment);

  // ---- header
  L.push("%");
  L.push(`O${tokens.PROG_NUM} (${tokens.PROG_COMMENT})`);
  L.push(t("beginning"));
  if (job.options.includeG10) {
    L.push("");
    L.push(...g10Lines(job));
  }

  const chipClear = () => {
    if (job.options.useChipClear) call(CALL.chipClear, "clear chips");
  };

  // Haas chip fan table wash (N210): runs after each machining block, right
  // before the gripper goes out to grab parts, so chips are blown off first.
  const fanWash = () => {
    if (m.chipFanEnabled) call(CALL.chipFan, "chip fan table wash before part handling");
  };

  // ---- main loop (unrolled pipeline)
  // part i: tray pocket i -> vise 1 (op1) -> flipper (flip) -> vise 2 (op2) -> finished
  L.push("");
  L.push("(=== MAIN SEQUENCE ===)");

  if (n >= 1) {
    L.push("");
    L.push(`(--- CYCLE 1 OF ${n}: PRIME - LOAD PART 1, MACHINE OP1 ---)`);
    posPocket(1, "position over tray pocket 1");
    call(CALL.loadVise1, "get stock 1, load vise 1");
    call(CALL.op1, "machine op1 on part 1");
  }

  for (let k = 2; k <= n; k++) {
    L.push("");
    L.push(`(--- CYCLE ${k} OF ${n} ---)`);
    fanWash();
    call(CALL.unloadVise1, `unload vise 1 - part ${k - 1} op1 done`);
    call(CALL.loadFlipper, `load part ${k - 1} into flipper, close grip`);
    call(CALL.flipCCW, "rotate flipper ccw - flip part");
    if (k >= 3) {
      call(CALL.unloadVise2, `unload vise 2 - part ${k - 2} finished`);
      posFinished(k - 2, `position over finished location ${job.finished.mode === "bin" ? "(bin)" : k - 2}`);
      call(CALL.depositFinished, `drop finished part ${k - 2}`);
    }
    posPocket(k, `position over tray pocket ${k}`);
    call(CALL.loadVise1, `get stock ${k}, load vise 1`);
    call(CALL.unloadFlipper, `grab flipped part ${k - 1} from flipper`);
    call(CALL.loadVise2, `load part ${k - 1} into vise 2`);
    call(CALL.flipCW, "rotate flipper home cw, re-clamp vise 1");
    chipClear();
    call(CALL.op1, `machine op1 on part ${k}`);
    call(CALL.op2, `machine op2 on part ${k - 1}`);
  }

  // ---- drain: after cycle N, vise1 holds op1(part N), vise2 holds op2(part N-1)
  if (n >= 2) {
    L.push("");
    L.push(`(--- DRAIN: FLIP AND FINISH PART ${n} ---)`);
    fanWash();
    call(CALL.unloadVise1, `unload vise 1 - part ${n} op1 done`);
    call(CALL.loadFlipper, `load part ${n} into flipper, close grip`);
    call(CALL.flipCCW, "rotate flipper ccw - flip part");
    call(CALL.unloadVise2, `unload vise 2 - part ${n - 1} finished`);
    posFinished(n - 1, "position over finished location");
    call(CALL.depositFinished, `drop finished part ${n - 1}`);
    call(CALL.unloadFlipper, `grab flipped part ${n} from flipper`);
    call(CALL.loadVise2, `load part ${n} into vise 2`);
    call(CALL.flipCW, "rotate flipper home cw");
    chipClear();
    call(CALL.op2, `machine op2 on part ${n}`);
    L.push("");
    L.push(`(--- UNLOAD LAST PART ---)`);
    fanWash();
    call(CALL.unloadVise2, `unload vise 2 - part ${n} finished`);
    posFinished(n, "position over finished location");
    call(CALL.depositFinished, `drop finished part ${n}`);
  } else if (n === 1) {
    // single part: flip through vise 2 without a second stock load
    L.push("");
    L.push("(--- SINGLE PART: FLIP AND MACHINE OP2 ---)");
    fanWash();
    call(CALL.unloadVise1, "unload vise 1 - part 1 op1 done");
    call(CALL.loadFlipper, "load part 1 into flipper, close grip");
    call(CALL.flipCCW, "rotate flipper ccw - flip part");
    call(CALL.unloadFlipper, "grab flipped part 1 from flipper");
    call(CALL.loadVise2, "load part 1 into vise 2");
    call(CALL.flipCW, "rotate flipper home cw");
    chipClear();
    call(CALL.op2, "machine op2 on part 1");
    fanWash();
    call(CALL.unloadVise2, "unload vise 2 - part 1 finished");
    posFinished(1, "position over finished location");
    call(CALL.depositFinished, "drop finished part 1");
  }

  L.push("");
  L.push("(=== END OF SEQUENCE ===)");
  L.push(t("ending"));

  // ---- macro sections
  L.push("");
  L.push("(##################################################)");
  L.push("(### MACRO SECTIONS - M97 TARGETS              ###)");
  L.push("(##################################################)");

  const sections: TemplateKey[] = [
    "loadVise1",
    "unloadVise1",
    "loadFlipper",
    "flipCCW",
    "unloadVise2",
    "depositFinished",
    "unloadFlipper",
    "loadVise2",
    "flipCW",
  ];
  if (job.options.useChipClear) sections.splice(1, 0, "chipClear");
  if (m.chipFanEnabled) sections.push("chipFan");
  for (const key of sections) {
    L.push("");
    L.push(t(key));
  }

  // ---- pocket position macros
  L.push("");
  L.push("(### STOCK TRAY POCKET POSITIONS ###)");
  for (const p of pockets) {
    L.push(
      `N${300 + p.index}; (tray pocket ${p.index})`,
      `G90 ${tokens.WCS_TRAY} G0 X${fmt(p.x)} Y${fmt(p.y)};`,
      "M99;"
    );
  }

  L.push("");
  if (job.finished.mode === "bin") {
    L.push("(### FINISHED PART BIN POSITION ###)");
    L.push("N401; (bin drop point)", `G90 ${tokens.WCS_FIN} G0 X0. Y0.;`, "M99;");
  } else {
    L.push("(### FINISHED TRAY POCKET POSITIONS ###)");
    for (const p of finishedPockets.slice(0, Math.max(n, 1))) {
      L.push(
        `N${400 + p.index}; (finished pocket ${p.index})`,
        `G90 ${tokens.WCS_FIN} G0 X${fmt(p.x)} Y${fmt(p.y)};`,
        "M99;"
      );
    }
  }

  // ---- machining sections
  L.push("");
  L.push("(### OP1 MACHINING CODE ###)");
  L.push(`N${CALL.op1}; (op1 machining)`);
  L.push(op1.clean || "(NO OP1 CODE LOADED)");
  L.push("M99; (return to main program)");
  L.push("");
  L.push("(### OP2 MACHINING CODE ###)");
  L.push(`N${CALL.op2}; (op2 machining)`);
  L.push(op2.clean || "(NO OP2 CODE LOADED)");
  L.push("M99; (return to main program)");
  L.push("%");

  return { program: L.join("\n"), warnings, pocketCount: n };
}
