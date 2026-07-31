import type { TrayGeometry } from "./trayModel";

/**
 * Minimal DXF R12 writer - POLYLINE with bulge arcs + CIRCLE entities.
 * R12 with plain POLYLINE/VERTEX is the most widely compatible dialect for
 * laser cutter software (LightBurn, RDWorks, etc).
 */

interface Vertex {
  x: number;
  y: number;
  bulge: number;
}

const ARC_BULGE = Math.tan(Math.PI / 8); // 90-degree arc

function roundedRectVertices(x0: number, y0: number, x1: number, y1: number, r: number): Vertex[] {
  if (r <= 0.0001) {
    return [
      { x: x0, y: y0, bulge: 0 },
      { x: x1, y: y0, bulge: 0 },
      { x: x1, y: y1, bulge: 0 },
      { x: x0, y: y1, bulge: 0 },
    ];
  }
  return [
    { x: x0 + r, y: y0, bulge: 0 },
    { x: x1 - r, y: y0, bulge: ARC_BULGE },
    { x: x1, y: y0 + r, bulge: 0 },
    { x: x1, y: y1 - r, bulge: ARC_BULGE },
    { x: x1 - r, y: y1, bulge: 0 },
    { x: x0 + r, y: y1, bulge: ARC_BULGE },
    { x: x0, y: y1 - r, bulge: 0 },
    { x: x0, y: y0 + r, bulge: ARC_BULGE },
  ];
}

function polyline(vertices: Vertex[], layer: string): string[] {
  const lines: string[] = ["0", "POLYLINE", "8", layer, "66", "1", "70", "1"];
  for (const v of vertices) {
    lines.push("0", "VERTEX", "8", layer, "10", v.x.toFixed(6), "20", v.y.toFixed(6), "30", "0.0");
    if (v.bulge !== 0) lines.push("42", v.bulge.toFixed(6));
  }
  lines.push("0", "SEQEND");
  return lines;
}

function circle(cx: number, cy: number, r: number, layer: string): string[] {
  return ["0", "CIRCLE", "8", layer, "10", cx.toFixed(6), "20", cy.toFixed(6), "30", "0.0", "40", r.toFixed(6)];
}

/**
 * Generates the tray as a DXF for laser cutting. Pockets are through-cutouts
 * (for acrylic, cut a pocket layer and bond it to a solid backer layer).
 * Layers: OUTLINE (outer boundary), POCKETS (pocket cutouts), HOLES (mounting holes).
 */
export function trayToDxf(g: TrayGeometry): string {
  const e: string[] = [];

  e.push(...polyline(roundedRectVertices(0, 0, g.outerLength, g.outerWidth, g.outerCornerRadius), "OUTLINE"));

  for (const p of g.pockets) {
    e.push(
      ...polyline(
        roundedRectVertices(
          p.cx - g.pocketLength / 2,
          p.cy - g.pocketWidth / 2,
          p.cx + g.pocketLength / 2,
          p.cy + g.pocketWidth / 2,
          g.cornerRadius
        ),
        "POCKETS"
      )
    );
    if (g.cornerReliefDia > 0) {
      // over-round corner relief circles, centered on the sharp corner points
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          e.push(
            ...circle(
              p.cx + (sx * g.pocketLength) / 2,
              p.cy + (sy * g.pocketWidth) / 2,
              g.cornerReliefDia / 2,
              "POCKETS"
            )
          );
        }
      }
    }
  }

  for (const h of g.holes) {
    e.push(...circle(h.cx, h.cy, g.holeDia / 2, "HOLES"));
  }

  const dxf = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "1", // inches
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "OUTLINE", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "POCKETS", "70", "0", "62", "1", "6", "CONTINUOUS",
    "0", "LAYER", "2", "HOLES", "70", "0", "62", "3", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    ...e,
    "0", "ENDSEC",
    "0", "EOF",
  ];
  return dxf.join("\r\n");
}
