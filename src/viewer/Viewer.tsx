import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useApp } from "../store";
import { machineOf } from "../logic/program";
import { listCadFiles, cadFileUrl } from "../api";
import { loadStepMeshes, meshesToGroup } from "./stepLoader";
import { buildFixtureScene, disposeObject, type LoadedModels } from "./scene";
import { createViewCube } from "./viewCube";
import type { ModelKey } from "../types";

type SlotStatus = "loading" | "ok" | "missing" | "error" | "none";
type ModelStatus = Record<ModelKey, SlotStatus>;

const MODEL_KEYS: ModelKey[] = ["vise", "flipper", "gripper", "jaws1", "jaws2"];
/** keyword used to auto-pick a bundled STEP when no file is chosen; null = file required */
const AUTO_KEYWORDS: Record<ModelKey, string | null> = {
  vise: "vise",
  flipper: "flip",
  gripper: "gripper",
  jaws1: null,
  jaws2: null,
};

let cadListPromise: Promise<string[]> | null = null;
function getCadList(): Promise<string[]> {
  if (!cadListPromise) cadListPromise = listCadFiles().catch(() => []);
  return cadListPromise;
}

const groupCache = new Map<string, Promise<THREE.Group>>();
function loadModelGroup(rel: string): Promise<THREE.Group> {
  let p = groupCache.get(rel);
  if (!p) {
    p = loadStepMeshes(cadFileUrl(rel)).then(meshesToGroup);
    groupCache.set(rel, p);
  }
  return p;
}

export function Viewer({ extraObject }: { extraObject?: THREE.Object3D | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cubeMountRef = useRef<HTMLDivElement>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [status, setStatus] = useState<ModelStatus>({
    vise: "loading",
    flipper: "loading",
    gripper: "loading",
    jaws1: "none",
    jaws2: "none",
  });
  const [models, setModels] = useState<LoadedModels>({});
  const job = useApp((s) => s.job);

  // load STEP models per slot; explicit file choices win over keyword auto-detect
  const fileChoices = MODEL_KEYS.map((k) => job.fixture.models[k]?.file ?? "");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const files = await getCadList();
      const find = (kw: string) => files.find((f) => f.toLowerCase().includes(kw));
      const next: LoadedModels = {};
      const st = {} as ModelStatus;
      await Promise.all(
        MODEL_KEYS.map(async (key) => {
          const cfg = job.fixture.models[key];
          const kw = AUTO_KEYWORDS[key];
          const rel = cfg?.file || (kw ? find(kw) : undefined);
          if (!rel) {
            st[key] = kw ? "missing" : "none";
            return;
          }
          try {
            next[key] = await loadModelGroup(rel);
            st[key] = "ok";
          } catch {
            st[key] = "error";
          }
        })
      );
      if (alive) {
        setModels(next);
        setStatus(st);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, fileChoices);

  // one-time renderer setup
  useEffect(() => {
    const mount = mountRef.current;
    const cubeMount = cubeMountRef.current;
    if (!mount || !cubeMount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d23);
    sceneRef.current = scene;

    // frame the machine bed (scene is in machine coords: negative X/Y quadrant)
    const initialJob = useApp.getState().job;
    const bed = machineOf(initialJob);
    const cx = -bed.bedLength / 2;
    const cy = -bed.bedWidth / 2;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.up.set(0, 0, 1);
    camera.position.set(cx, cy - Math.max(34, bed.bedLength * 0.55), Math.max(26, bed.bedLength * 0.4));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, cy, 0);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xdde4ee, 0x30343c, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(20, -18, 30);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xaabbcc, 0.5);
    dir2.position.set(-15, 20, 12);
    scene.add(dir2);

    const gridSize = Math.ceil(Math.max(bed.bedLength, bed.bedWidth, 60) / 10) * 10 + 40;
    const grid = new THREE.GridHelper(gridSize, gridSize / 2, 0x39404b, 0x262b33);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(cx, cy, -initialJob.fixture.plateThickness - 0.45);
    scene.add(grid);

    const viewCube = createViewCube(cubeMount, camera, controls);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      viewCube.update();
    };
    animate();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      viewCube.dispose();
      controls.dispose();
      if (sceneGroupRef.current) {
        scene.remove(sceneGroupRef.current);
        disposeObject(sceneGroupRef.current);
      }
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // rebuild fixture group when the job (or model availability) changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const timer = setTimeout(() => {
      if (sceneGroupRef.current) {
        scene.remove(sceneGroupRef.current);
        disposeObject(sceneGroupRef.current);
      }
      const group = buildFixtureScene(job, models);
      sceneGroupRef.current = group;
      scene.add(group);
    }, 60);
    return () => clearTimeout(timer);
  }, [job, models]);

  // optional extra object (e.g. generated tray preview)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !extraObject) return;
    scene.add(extraObject);
    return () => {
      scene.remove(extraObject);
    };
  }, [extraObject]);

  const statusLabel = (s: SlotStatus) =>
    s === "ok" ? "loaded" : s === "loading" ? "loading..." : s === "missing" ? "file not found" : "parse error";

  return (
    <div className="viewer-wrap">
      <div ref={mountRef} className="viewer-canvas" />
      <div className="viewer-overlay">
        <span className={`badge badge-${status.vise}`}>Vise: {statusLabel(status.vise)}</span>
        <span className={`badge badge-${status.flipper}`}>Flipper: {statusLabel(status.flipper)}</span>
        <span className={`badge badge-${status.gripper}`}>Gripper: {statusLabel(status.gripper)}</span>
        {status.jaws1 !== "none" && (
          <span className={`badge badge-${status.jaws1}`}>Jaws 1: {statusLabel(status.jaws1)}</span>
        )}
        {status.jaws2 !== "none" && (
          <span className={`badge badge-${status.jaws2}`}>Jaws 2: {statusLabel(status.jaws2)}</span>
        )}
      </div>
      <div ref={cubeMountRef} className="viewer-cube" />
      <div className="viewer-legend">
        <span><i className="dot" style={{ background: "#ff5555" }} /> Vise 1 (Op1)</span>
        <span><i className="dot" style={{ background: "#5599ff" }} /> Vise 2 (Op2)</span>
        <span><i className="dot" style={{ background: "#ffcc44" }} /> Flipper</span>
        <span><i className="dot" style={{ background: "#ff2266" }} /> Datum</span>
        <span><i className="dot" style={{ background: "#d7a94b" }} /> Raw stock</span>
        <span><i className="dot" style={{ background: "#2e8a4d" }} /> Finished bin/tray</span>
      </div>
    </div>
  );
}
