import type { MachineProfile, StockConfig, TrayConfig, TrayGenConfig } from "../types";
import { tSlotMachineYs } from "./tSlots";

export interface TrayGeometry {
  outerLength: number; // X
  outerWidth: number; // Y
  thickness: number;
  pocketLength: number;
  pocketWidth: number;
  pocketDepth: number;
  cornerRadius: number;
  outerCornerRadius: number;
  /** pocket centers, tray-local, origin at tray bottom-left corner */
  pockets: { cx: number; cy: number; index: number }[];
  /** mounting hole centers */
  holes: { cx: number; cy: number }[];
  holeDia: number;
}

export function buildTrayGeometry(
  stock: StockConfig,
  tray: TrayConfig,
  gen: TrayGenConfig,
  machine?: Pick<MachineProfile, "bedWidth" | "tSlotCount" | "tSlotSpacing" | "tSlotWidth">
): TrayGeometry {
  const pocketLength = stock.length + 2 * gen.pocketClearance;
  const pocketWidth = stock.width + 2 * gen.pocketClearance;

  const spanX = (tray.countX - 1) * tray.pitchX + pocketLength;
  const spanY = (tray.countY - 1) * tray.pitchY + pocketWidth;
  const outerLength = spanX + 2 * gen.margin;
  const outerWidth = spanY + 2 * gen.margin;

  const firstCx = gen.margin + pocketLength / 2;
  const firstCy = gen.margin + pocketWidth / 2;

  const pockets: TrayGeometry["pockets"] = [];
  let index = 1;
  for (let j = 0; j < tray.countY; j++) {
    for (let i = 0; i < tray.countX; i++) {
      pockets.push({ cx: firstCx + i * tray.pitchX, cy: firstCy + j * tray.pitchY, index: index++ });
    }
  }

  const holes: TrayGeometry["holes"] = [];
  if (gen.mountHoles) {
    const inset = gen.mountHoleInset;
    if (gen.mountHoleMode === "t-slots" && machine && machine.tSlotCount > 0) {
      // tray origin (bottom-left) in machine coords from the first-pocket anchor
      const originY = tray.firstPocketY - firstCy;
      for (const slotY of tSlotMachineYs(machine)) {
        const ly = slotY - originY;
        // hole must sit on the tray, inset from the front/back edges
        if (ly < inset || ly > outerWidth - inset) continue;
        // one hole at each end of the tray along X, on this slot's Y
        holes.push({ cx: inset, cy: ly }, { cx: outerLength - inset, cy: ly });
      }
    } else {
      holes.push(
        { cx: inset, cy: inset },
        { cx: outerLength - inset, cy: inset },
        { cx: outerLength - inset, cy: outerWidth - inset },
        { cx: inset, cy: outerWidth - inset }
      );
    }
  }

  const maxPocketRadius = Math.min(pocketLength, pocketWidth) / 2 - 0.001;
  return {
    outerLength,
    outerWidth,
    thickness: gen.thickness,
    pocketLength,
    pocketWidth,
    pocketDepth: Math.min(gen.pocketDepth, gen.thickness),
    cornerRadius: Math.max(0, Math.min(gen.cornerRadius, maxPocketRadius)),
    outerCornerRadius: Math.max(0, Math.min(gen.outerCornerRadius, Math.min(outerLength, outerWidth) / 2 - 0.001)),
    pockets,
    holes,
    holeDia: gen.mountHoleDia,
  };
}
