import * as THREE from "three";
import type { OcctMeshData, OcctResponse } from "../workers/occtWorker";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (m: OcctMeshData[]) => void; reject: (e: Error) => void }>();
const cache = new Map<string, Promise<OcctMeshData[]>>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/occtWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<OcctResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.meshes ?? []);
    };
  }
  return worker;
}

export function loadStepMeshes(url: string): Promise<OcctMeshData[]> {
  let cached = cache.get(url);
  if (!cached) {
    cached = new Promise<OcctMeshData[]>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, url });
    });
    cache.set(url, cached);
  }
  return cached;
}

const DEFAULT_COLOR = new THREE.Color(0x8899aa);

export function meshesToGroup(meshes: OcctMeshData[]): THREE.Group {
  const group = new THREE.Group();
  for (const m of meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
    if (m.normal) geo.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (!m.normal) geo.computeVertexNormals();
    const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : DEFAULT_COLOR;
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = m.name;
    mesh.userData.shared = true; // cached geometry - never disposed by scene teardown
    group.add(mesh);
  }
  return group;
}
