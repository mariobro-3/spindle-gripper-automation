/// <reference lib="webworker" />
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC, drawRoundedRectangle, drawCircle, type Shape3D } from "replicad";
import type { TrayGeometry } from "../logic/trayModel";

export interface TrayMeshData {
  vertices: Float32Array;
  triangles: Uint32Array;
  normals?: Float32Array;
}

export interface ReplicadRequest {
  id: number;
  geometry: TrayGeometry;
  want: "mesh" | "step";
}

export interface ReplicadResponse {
  id: number;
  mesh?: TrayMeshData;
  step?: Blob;
  error?: string;
}

let ready: Promise<void> | null = null;
function init(): Promise<void> {
  if (!ready) {
    ready = (opencascade as unknown as (o: object) => Promise<unknown>)({
      locateFile: () => opencascadeWasm,
    }).then((oc) => {
      setOC(oc as Parameters<typeof setOC>[0]);
    });
  }
  return ready;
}

/** Builds the tray solid. Tray-local origin (bottom-left corner) maps to
 *  (-L/2, -W/2) since replicad rectangles are centered on the origin. */
function buildTray(g: TrayGeometry): Shape3D {
  let solid = drawRoundedRectangle(g.outerLength, g.outerWidth, g.outerCornerRadius)
    .sketchOnPlane("XY")
    .extrude(g.thickness) as Shape3D;

  const ox = -g.outerLength / 2;
  const oy = -g.outerWidth / 2;

  for (const p of g.pockets) {
    const pocket = drawRoundedRectangle(g.pocketLength, g.pocketWidth, g.cornerRadius)
      .sketchOnPlane("XY", g.thickness - g.pocketDepth)
      .extrude(g.pocketDepth + 0.05)
      .translate([ox + p.cx, oy + p.cy, 0]) as Shape3D;
    solid = solid.cut(pocket);
  }

  for (const h of g.holes) {
    const hole = drawCircle(g.holeDia / 2)
      .sketchOnPlane("XY", -0.05)
      .extrude(g.thickness + 0.1)
      .translate([ox + h.cx, oy + h.cy, 0]) as Shape3D;
    solid = solid.cut(hole);
  }

  return solid;
}

self.onmessage = async (e: MessageEvent<ReplicadRequest>) => {
  const { id, geometry, want } = e.data;
  try {
    await init();
    const solid = buildTray(geometry);

    if (want === "step") {
      const step = solid.blobSTEP();
      (self as unknown as Worker).postMessage({ id, step } satisfies ReplicadResponse);
    } else {
      const m = solid.mesh({ tolerance: 0.005, angularTolerance: 15 });
      const mesh: TrayMeshData = {
        vertices: new Float32Array(m.vertices),
        triangles: new Uint32Array(m.triangles),
        normals: m.normals ? new Float32Array(m.normals) : undefined,
      };
      const transfer: Transferable[] = [mesh.vertices.buffer, mesh.triangles.buffer];
      if (mesh.normals) transfer.push(mesh.normals.buffer);
      (self as unknown as Worker).postMessage({ id, mesh } satisfies ReplicadResponse, transfer);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies ReplicadResponse);
  }
};
