/// <reference lib="webworker" />
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

export interface OcctMeshData {
  name: string;
  color?: [number, number, number];
  position: Float32Array;
  normal?: Float32Array;
  index: Uint32Array;
}

export interface OcctRequest {
  id: number;
  url: string;
}

export interface OcctResponse {
  id: number;
  meshes?: OcctMeshData[];
  error?: string;
}

const occtPromise = occtimportjs({
  locateFile: () => wasmUrl,
});

self.onmessage = async (e: MessageEvent<OcctRequest>) => {
  const { id, url } = e.data;
  try {
    const occt = await occtPromise;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    const result = occt.ReadStepFile(buffer, null);
    if (!result.success) throw new Error("STEP parse failed");

    const meshes: OcctMeshData[] = result.meshes.map(
      (m: {
        name: string;
        color?: number[];
        attributes: { position: { array: number[] }; normal?: { array: number[] } };
        index: { array: number[] };
      }) => ({
        name: m.name,
        color: m.color as [number, number, number] | undefined,
        position: new Float32Array(m.attributes.position.array),
        normal: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : undefined,
        index: new Uint32Array(m.index.array),
      })
    );

    const transfer: Transferable[] = [];
    for (const m of meshes) {
      transfer.push(m.position.buffer, m.index.buffer);
      if (m.normal) transfer.push(m.normal.buffer);
    }
    (self as unknown as Worker).postMessage({ id, meshes } satisfies OcctResponse, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies OcctResponse);
  }
};
