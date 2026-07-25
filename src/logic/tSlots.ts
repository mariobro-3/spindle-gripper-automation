import type { MachineProfile } from "../types";

export type TSlotMachine = Pick<MachineProfile, "bedWidth" | "tSlotCount" | "tSlotSpacing" | "tSlotWidth">;

/**
 * Machine Y of each T-slot center. Slots run along X and are spaced across Y,
 * centered on the bed (Haas layout: symmetrical about table center).
 */
export function tSlotMachineYs(machine: TSlotMachine): number[] {
  const n = Math.max(0, Math.round(machine.tSlotCount));
  if (n <= 0 || machine.tSlotSpacing <= 0) return [];
  const centerY = -machine.bedWidth / 2;
  const first = centerY - ((n - 1) * machine.tSlotSpacing) / 2;
  return Array.from({ length: n }, (_, i) => first + i * machine.tSlotSpacing);
}
