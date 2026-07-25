import type { DatumRef, JobConfig, StationKey, WcsCode } from "../types";

export interface StationOffset {
  station: StationKey;
  label: string;
  wcs: WcsCode;
  x: number;
  y: number;
  z: number;
  note: string;
}

/** plate-local coordinates of the datum reference point (origin = front-left corner) */
export function datumLocal(ref: DatumRef, plateLength: number, plateWidth: number): { x: number; y: number } {
  switch (ref) {
    case "front-left":
      return { x: 0, y: 0 };
    case "front-right":
      return { x: plateLength, y: 0 };
    case "back-left":
      return { x: 0, y: plateWidth };
    case "back-right":
      return { x: plateLength, y: plateWidth };
    case "center":
      return { x: plateLength / 2, y: plateWidth / 2 };
  }
}

export function fmt(n: number): string {
  const r = Math.round(n * 10000) / 10000;
  let s = r.toFixed(4).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s;
}

/**
 * Machine XY of a plate-local point, given the probed datum. The whole fixture
 * assembly may be rotated on the bed (datum.rotation, degrees CCW); rotation
 * pivots at the datum point, so the datum itself always maps to machineX/Y.
 */
export function plateToMachine(job: JobConfig, localX: number, localY: number): { x: number; y: number } {
  const { fixture, datum } = job;
  const d = datumLocal(datum.ref, fixture.plateLength, fixture.plateWidth);
  const rad = ((datum.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = localX - d.x;
  const ry = localY - d.y;
  return {
    x: datum.machineX + cos * rx - sin * ry,
    y: datum.machineY + sin * rx + cos * ry,
  };
}

export function computeOffsets(job: JobConfig): StationOffset[] {
  const { fixture, datum, wcs, stockTray, finished } = job;

  const v1 = plateToMachine(job, fixture.vise1X, fixture.vise1Y);
  const v2 = plateToMachine(job, fixture.vise2X, fixture.vise2Y);
  const fl = plateToMachine(job, fixture.flipperX, fixture.flipperY);

  const finishedPos =
    finished.mode === "bin"
      ? { x: finished.bin.x, y: finished.bin.y }
      : { x: finished.tray.firstPocketX, y: finished.tray.firstPocketY };

  const rows: StationOffset[] = [
    {
      station: "vise1",
      label: "Vise 1 (Op1) part center",
      wcs: wcs.vise1,
      ...v1,
      z: datum.zValues.vise1,
      note: "Z = bottom of stock in clamped position",
    },
    {
      station: "flipper",
      label: "Flipper nest center",
      wcs: wcs.flipper,
      ...fl,
      z: datum.zValues.flipper,
      note: "Z = bottom of part seated in flipper grip",
    },
    {
      station: "vise2",
      label: "Vise 2 (Op2) part center",
      wcs: wcs.vise2,
      ...v2,
      z: datum.zValues.vise2,
      note: "Z = bottom of part in clamped position",
    },
    {
      station: "tray",
      label: "Stock tray first pocket",
      wcs: wcs.tray,
      x: stockTray.firstPocketX,
      y: stockTray.firstPocketY,
      z: datum.zValues.tray,
      note: "XY center + Z bottom of first (bottom-left) pocket",
    },
    {
      station: "finished",
      label: finished.mode === "bin" ? "Finished parts bin (drop point)" : "Finished tray first pocket",
      wcs: wcs.finished,
      ...finishedPos,
      z: datum.zValues.finished,
      note: finished.mode === "bin" ? "Drop point over bin center" : "XY center + Z bottom of first pocket",
    },
  ];
  return rows;
}

const WCS_P: Record<WcsCode, number> = { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 };

export function g10Lines(job: JobConfig): string[] {
  const rows = computeOffsets(job);
  const lines = ["(SET WORK OFFSETS FROM PROGRAM)", "G90;"];
  for (const r of rows) {
    lines.push(
      `G10 L2 P${WCS_P[r.wcs]} X${fmt(r.x)} Y${fmt(r.y)} Z${fmt(r.z)}; (${r.label.toUpperCase()})`
    );
  }
  return lines;
}

export interface WcsConflict {
  wcs: WcsCode;
  stations: string[];
}

export function wcsConflicts(job: JobConfig): WcsConflict[] {
  const byWcs = new Map<WcsCode, string[]>();
  for (const r of computeOffsets(job)) {
    const arr = byWcs.get(r.wcs) ?? [];
    arr.push(r.label);
    byWcs.set(r.wcs, arr);
  }
  return [...byWcs.entries()]
    .filter(([, stations]) => stations.length > 1)
    .map(([wcs, stations]) => ({ wcs, stations }));
}
