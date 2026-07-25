import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useApp } from "../store";
import { machineOf } from "../logic/program";
import { listCadFiles, cadFileUrl } from "../api";
import { loadStepMeshes, meshesToGroup } from "./stepLoader";
import { buildFixtureScene, disposeObject, type LoadedModels } from "./scene";
import { createViewCube } from "./viewCube";

type ModelStatus = Record<"vise" | "flipper" | "gripper", "loading" | "ok" | "missing" | "error">;

const models: LoadedModels = {};
let modelsPromise: Promise<void> | null = null;
const statusListeners = new Set<(s: ModelStatus) => void>();
const modelStatus: ModelStatus = { vise: "loading", flipper: "loading", gripper: "loading" };

function notifyStatus() {
  for (const l of statusListeners) l({ ...modelStatus });
}

function ensureModelsLoaded(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      let files: string[] = [];
      try {
        files = await listCadFiles();
      } catch {
        /* server offline - fall back to boxes */
      }
      const find = (kw: string) => files.find((f) => f.toLowerCase().includes(kw));
      const entries: [keyof LoadedModels, string | undefined][] = [
        ["vise", find("vise")],
        ["flipper", find("flip")],
        ["gripper", find("gripper")],
      ];
      await Promise.all(
        entries.map(async ([key, rel]) => {
          if (!rel) {
            modelStatus[key] = "missing";
            notifyStatus();
            return;
          }
          try {
            const meshes = await loadStepMeshes(cadFileUrl(rel));
            models[key] = meshesToGroup(meshes);
            modelStatus[key] = "ok";
          } catch {
            modelStatus[key] = "error";
          }
          notifyStatus();
        })
      );
    })();
  }
  return modelsPromise;
}

export function Viewer({ extraObject }: { extraObject?: THREE.Object3D | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cubeMountRef = useRef<HTMLDivElement>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [status, setStatus] = useState<ModelStatus>({ ...modelStatus });
  const [modelsReady, setModelsReady] = useState(0);
  const job = useApp((s) => s.job);

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

    const onStatus = (s: ModelStatus) => {
      setStatus(s);
      setModelsReady((n) => n + 1);
    };
    statusListeners.add(onStatus);
    void ensureModelsLoaded();

    return () => {
      statusListeners.delete(onStatus);
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
  }, [job, modelsReady]);

  // optional extra object (e.g. generated tray preview)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !extraObject) return;
    scene.add(extraObject);
    return () => {
      scene.remove(extraObject);
    };
  }, [extraObject]);

  const statusLabel = (s: ModelStatus[keyof ModelStatus]) =>
    s === "ok" ? "loaded" : s === "loading" ? "loading..." : s === "missing" ? "file not found" : "parse error";

  return (
    <div className="viewer-wrap">
      <div ref={mountRef} className="viewer-canvas" />
      <div className="viewer-overlay">
        <span className={`badge badge-${status.vise}`}>Vise: {statusLabel(status.vise)}</span>
        <span className={`badge badge-${status.flipper}`}>Flipper: {statusLabel(status.flipper)}</span>
        <span className={`badge badge-${status.gripper}`}>Gripper: {statusLabel(status.gripper)}</span>
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
