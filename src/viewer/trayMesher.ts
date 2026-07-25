import type { ReplicadResponse, TrayMeshData } from "../workers/replicadWorker";
import type { TrayGeometry } from "../logic/trayModel";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: ReplicadResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/replicadWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ReplicadResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
  }
  return worker;
}

function request(geometry: TrayGeometry, want: "mesh" | "step"): Promise<ReplicadResponse> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, geometry, want });
  });
}

export async function requestTrayMesh(geometry: TrayGeometry): Promise<TrayMeshData> {
  const res = await request(geometry, "mesh");
  if (!res.mesh) throw new Error("no mesh returned");
  return res.mesh;
}

export async function requestTrayStep(geometry: TrayGeometry): Promise<Blob> {
  const res = await request(geometry, "step");
  if (!res.step) throw new Error("no step returned");
  return res.step;
}
