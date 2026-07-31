import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useApp } from "../store";
import { machineOf } from "../logic/program";
import { listCadFiles, cadFileUrl } from "../api";
import { loadStepMeshes, meshesToGroup } from "./stepLoader";
import {
  buildFixtureScene,
  disposeObject,
  type ArticulationHandles,
  type LoadedModels,
  type SimHandles,
} from "./scene";
import { createViewCube } from "./viewCube";
import { buildSimTimeline, stateAt, type SimState, type SimTimeline } from "../logic/simulation";
import { defaultModelSim } from "../defaults";
import type { PickTarget } from "../store";
import type { JobConfig, ModelKey } from "../types";

const SIM_CLOSED = 0x35d073;
const SIM_OPEN = 0xffb347;

/** open/close a pair of articulated jaw groups */
function applyJaws(art: ArticulationHandles | null, open: boolean) {
  if (!art) return;
  if (art.jawA) {
    if (open) art.jawA.position.set(art.jawAOpen.x, art.jawAOpen.y, art.jawAOpen.z);
    else art.jawA.position.set(0, 0, 0);
  }
  if (art.jawB) {
    if (open) art.jawB.position.set(art.jawBOpen.x, art.jawBOpen.y, art.jawBOpen.z);
    else art.jawB.position.set(0, 0, 0);
  }
}

function setRotation(art: ArticulationHandles, deg: number) {
  const rad = THREE.MathUtils.degToRad(deg);
  art.rotPivot!.rotation.set(
    art.rotAxis === "x" ? rad : 0,
    art.rotAxis === "y" ? rad : 0,
    art.rotAxis === "z" ? rad : 0
  );
}

function applySim(handles: SimHandles, st: SimState) {
  handles.gripper.visible = true;
  handles.gripper.position.set(st.gripper.x, st.gripper.y, st.gripper.z);
  handles.gripper.rotation.z = THREE.MathUtils.degToRad(st.orientDeg);
  // flipper rotation: picked head bodies if configured, else the whole model
  if (handles.flipperArt?.rotPivot) setRotation(handles.flipperArt, st.flipDeg);
  else if (handles.flipperPivot) handles.flipperPivot.rotation.y = THREE.MathUtils.degToRad(st.flipDeg);
  // articulated jaws (devices store closed=true; jaws travel when open)
  applyJaws(handles.vise1Art, !st.devices.vise1);
  applyJaws(handles.vise2Art, !st.devices.vise2);
  applyJaws(handles.flipperArt, !st.devices.flipGrip);
  applyJaws(handles.gripperArt, !st.devices.gripper);
  st.parts.forEach((p, i) => {
    const mesh = handles.parts[i];
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(p.x, p.y, p.z);
  });
  for (const o of handles.trayStock) o.visible = false;
  const tint = (mesh: THREE.Mesh, closed: boolean) =>
    (mesh.material as THREE.MeshBasicMaterial).color.set(closed ? SIM_CLOSED : SIM_OPEN);
  tint(handles.markers.vise1, st.devices.vise1);
  tint(handles.markers.vise2, st.devices.vise2);
  tint(handles.markers.flipper, st.devices.flipGrip);
  (handles.gripDot.material as THREE.MeshBasicMaterial).color.set(st.devices.gripper ? SIM_CLOSED : SIM_OPEN);
}

function resetSim(handles: SimHandles) {
  handles.gripper.visible = false;
  for (const p of handles.parts) p.visible = false;
  for (const o of handles.trayStock) o.visible = true;
  if (handles.flipperPivot) handles.flipperPivot.rotation.y = 0;
  if (handles.flipperArt?.rotPivot) setRotation(handles.flipperArt, 0);
  applyJaws(handles.vise1Art, false);
  applyJaws(handles.vise2Art, false);
  applyJaws(handles.flipperArt, false);
  applyJaws(handles.gripperArt, false);
  for (const mesh of [handles.markers.vise1, handles.markers.vise2, handles.markers.flipper]) {
    (mesh.material as THREE.MeshBasicMaterial).color.set(mesh.userData.baseColor as number);
  }
}

/**
 * Move the model datum to the grip point of its picked jaw/finger bodies:
 * vise = middle of the jaws at their TOP surface, flipper/gripper = the point
 * centered between the fingers. The model NEVER moves - the offsets are
 * rewritten to the datum's current position relative to the station point,
 * so only the reference (and the numbers) change.
 */
function autoCenterDatum(model: PickTarget["model"], wrapper: THREE.Group) {
  const state = useApp.getState();
  const sim = state.job.fixture.models[model].sim;
  const idx = new Set([...(sim?.jawA ?? []), ...(sim?.jawB ?? [])]);
  if (!idx.size) return;
  const inner = wrapper.userData.alignedInner as THREE.Group | undefined;
  if (!inner) return;
  // bounds of the picked bodies in RAW model coords, straight from geometry -
  // independent of the current simulation pose (flip angle, jaw travel)
  const rawBox = new THREE.Box3();
  wrapper.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !idx.has(m.userData.bodyIndex as number) || !m.geometry) return;
    m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) rawBox.union(m.geometry.boundingBox);
  });
  if (rawBox.isEmpty()) return;
  // raw -> wrapper space via the alignment transform (scale, rotation, position)
  const alignMatrix = new THREE.Matrix4().compose(
    inner.position,
    new THREE.Quaternion().setFromEuler(inner.rotation),
    inner.scale
  );
  const localBox = rawBox.clone().applyMatrix4(alignMatrix);
  const local = localBox.getCenter(new THREE.Vector3());
  if (model === "vise") local.z = localBox.max.z; // vise datum sits on top of the jaws
  // wrapper-local -> RAW model coords: undo the alignment transform
  const raw = local.clone().applyMatrix4(alignMatrix.clone().invert());
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  state.update((j) => {
    const a = j.fixture.models[model];
    a.datum = { x: r4(raw.x), y: r4(raw.y), z: r4(raw.z) };
    a.offX = r4(local.x);
    a.offY = r4(local.y);
    a.offZ = r4(local.z);
  });
}

// body-pick highlight materials (per group, shared across meshes)
const MAT_PICK: Record<"rotating" | "jawA" | "jawB", THREE.Material> = {
  rotating: new THREE.MeshStandardMaterial({ color: 0xff8c2a, emissive: 0x5a2c00, metalness: 0.3, roughness: 0.5 }),
  jawA: new THREE.MeshStandardMaterial({ color: 0x35d073, emissive: 0x0c4423, metalness: 0.3, roughness: 0.5 }),
  jawB: new THREE.MeshStandardMaterial({ color: 0xba6bff, emissive: 0x3a1466, metalness: 0.3, roughness: 0.5 }),
};

/** tint the selected bodies of the picked model; fresh clones restore originals on rebuild */
function applyPickHighlight(handles: SimHandles, pick: PickTarget | null, job: JobConfig) {
  if (!pick) return;
  const sim = job.fixture.models[pick.model].sim;
  const sel = {
    rotating: new Set(sim?.rotating ?? []),
    jawA: new Set(sim?.jawA ?? []),
    jawB: new Set(sim?.jawB ?? []),
  };
  for (const g of handles.pickGroups[pick.model]) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      const idx = m.userData.bodyIndex as number | undefined;
      if (!m.isMesh || idx === undefined) return;
      if (sel.rotating.has(idx)) m.material = MAT_PICK.rotating;
      else if (sel.jawA.has(idx)) m.material = MAT_PICK.jawA;
      else if (sel.jawB.has(idx)) m.material = MAT_PICK.jawB;
    });
  }
  // the animated gripper is normally hidden - show it while picking its bodies
  if (pick.model === "gripper") handles.gripper.visible = true;
}

interface SimRef {
  on: boolean;
  playing: boolean;
  speed: number;
  t: number;
  timeline: SimTimeline | null;
  lastLabel: string;
  lastUiT: number;
  sync: (() => void) | null;
}

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
  const pick = useApp((s) => s.pick);
  const datumCenter = useApp((s) => s.datumCenter);
  const pickRef = useRef<PickTarget | null>(null);
  pickRef.current = pick;
  const [, setUiTick] = useState(0);
  const simRef = useRef<SimRef>({
    on: false,
    playing: false,
    speed: 2,
    t: 0,
    timeline: null,
    lastLabel: "",
    lastUiT: -1,
  sync: null,
  });

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

    simRef.current.sync = () => setUiTick((n) => n + 1);

    // body picking: a click (not a drag) toggles the hit body in the active group
    const raycaster = new THREE.Raycaster();
    let downX = 0;
    let downY = 0;
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const p = pickRef.current;
      const handles = sceneGroupRef.current?.userData.simHandles as SimHandles | undefined;
      if (!p || !handles) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        ),
        camera
      );
      const hits = raycaster.intersectObjects(handles.pickGroups[p.model], true);
      // the aligned wrapper this hit belongs to; its origin is the station point
      const wrapperOf = (obj: THREE.Object3D): THREE.Group | undefined =>
        handles.pickGroups[p.model].find((g) => {
          let o: THREE.Object3D | null = obj;
          while (o) {
            if (o === g) return true;
            o = o.parent;
          }
          return false;
        });
      if (p.group === "datum") {
        // datum pick: snap to the nearest corner of the clicked triangle. The
        // MODEL MUST NOT MOVE - only the datum moves to the corner. So the
        // offsets are rewritten to the corner's current position relative to
        // the station point, which keeps the placement identical while all
        // future offset edits measure from the picked corner.
        for (const h of hits) {
          const mesh = h.object as THREE.Mesh;
          if (!mesh.isMesh || !h.face) continue;
          const posAttr = mesh.geometry.getAttribute("position");
          let best: THREE.Vector3 | null = null;
          let bestDist = Infinity;
          for (const vi of [h.face.a, h.face.b, h.face.c]) {
            const raw = new THREE.Vector3().fromBufferAttribute(posAttr, vi);
            const world = raw.clone().applyMatrix4(mesh.matrixWorld);
            const dist = world.distanceTo(h.point);
            if (dist < bestDist) {
              bestDist = dist;
              best = raw;
            }
          }
          if (!best) continue;
          const wrapper = wrapperOf(h.object);
          if (!wrapper) continue;
          const cornerNow = wrapper.worldToLocal(best.clone().applyMatrix4(mesh.matrixWorld));
          const r4 = (n: number) => Math.round(n * 10000) / 10000;
          const v = best;
          useApp.getState().update((j) => {
            const a = j.fixture.models[p.model];
            a.datum = { x: v.x, y: v.y, z: v.z };
            a.offX = r4(cornerNow.x);
            a.offY = r4(cornerNow.y);
            a.offZ = r4(cornerNow.z);
          });
          useApp.getState().setPick(null); // one-shot: exit datum mode
          break;
        }
        return;
      }
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && o.userData.bodyIndex === undefined) o = o.parent;
        if (!o) continue;
        const idx = o.userData.bodyIndex as number;
        const group = p.group;
        useApp.getState().update((j) => {
          const align = j.fixture.models[p.model];
          if (!align.sim) align.sim = defaultModelSim();
          const arr = align.sim[group];
          const at = arr.indexOf(idx);
          if (at >= 0) arr.splice(at, 1);
          else arr.push(idx);
        });
        // jaw/finger picks re-center the datum on the picked bodies
        if (group !== "rotating") {
          const wrapper = wrapperOf(h.object);
          if (wrapper) autoCenterDatum(p.model, wrapper);
        }
        break;
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let raf = 0;
    let last = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = now - last;
      last = now;

      const sim = simRef.current;
      const handles = sceneGroupRef.current?.userData.simHandles as SimHandles | undefined;
      // while picking bodies, hold the scene at rest so newly assigned
      // jaws/fingers don't jump to the paused simulation's pose
      if (sim.on && sim.timeline && handles && !pickRef.current) {
        if (sim.playing) {
          sim.t = Math.min(sim.timeline.total, sim.t + dt * sim.speed);
          if (sim.t >= sim.timeline.total) sim.playing = false;
        }
        const st = stateAt(sim.timeline, sim.t);
        applySim(handles, st);
        if (st.label !== sim.lastLabel || Math.abs(sim.t - sim.lastUiT) > 150) {
          sim.lastLabel = st.label;
          sim.lastUiT = sim.t;
          sim.sync?.();
        }
      }

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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
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
      const handles = group.userData.simHandles as SimHandles;
      applyPickHighlight(handles, pick, job);
      // job changed while simulating: rebuild the timeline against the new job
      const sim = simRef.current;
      if (sim.on) {
        sim.timeline = buildSimTimeline(job, handles.gripPoints);
        sim.t = Math.min(sim.t, sim.timeline.total);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [job, models, pick]);

  // on-demand "center datum on jaws/fingers" request from the side panel
  useEffect(() => {
    if (!datumCenter) return;
    const handles = sceneGroupRef.current?.userData.simHandles as SimHandles | undefined;
    const wrapper = handles?.pickGroups[datumCenter]?.[0];
    if (wrapper) autoCenterDatum(datumCenter, wrapper);
    useApp.setState({ datumCenter: null });
  }, [datumCenter]);

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

  const sim = simRef.current;
  const toggleSim = () => {
    if (sim.on) {
      sim.on = false;
      sim.playing = false;
      const handles = sceneGroupRef.current?.userData.simHandles as SimHandles | undefined;
      if (handles) resetSim(handles);
    } else {
      const handles = sceneGroupRef.current?.userData.simHandles as SimHandles | undefined;
      sim.timeline = buildSimTimeline(job, handles?.gripPoints);
      sim.t = 0;
      sim.on = true;
      sim.playing = true;
    }
    setUiTick((n) => n + 1);
  };
  const fmtClock = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

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
      {pick && (
        <div className="pick-banner">
          {pick.group === "datum" ? (
            <>
              <b>Datum pick mode:</b> click a corner on the {pick.model} model - it snaps to the nearest
              vertex and becomes the model's datum
            </>
          ) : (
            <>
              <b>Body pick mode:</b> click {pick.model} bodies to add / remove them from "
              {pick.group === "rotating" ? "Rotating head" : pick.group === "jawA" ? "Moving group A" : "Moving group B"}
              "
            </>
          )}
          <button className="btn" onClick={() => useApp.getState().setPick(null)}>
            {pick.group === "datum" ? "Cancel" : "Done"}
          </button>
        </div>
      )}
      <div className="sim-bar">
        <button className={`btn ${sim.on ? "danger" : "primary"}`} onClick={toggleSim}>
          {sim.on ? "Exit Sim" : "Simulate"}
        </button>
        {sim.on && sim.timeline && (
          <>
            <button
              className="btn"
              onClick={() => {
                if (!sim.playing && sim.t >= sim.timeline!.total) sim.t = 0;
                sim.playing = !sim.playing;
                setUiTick((n) => n + 1);
              }}
            >
              {sim.playing ? "Pause" : "Play"}
            </button>
            <select
              value={sim.speed}
              onChange={(e) => {
                sim.speed = Number(e.target.value);
                setUiTick((n) => n + 1);
              }}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
            </select>
            <input
              type="range"
              min={0}
              max={sim.timeline.total}
              step={100}
              value={Math.min(sim.t, sim.timeline.total)}
              onChange={(e) => {
                sim.t = Number(e.target.value);
                setUiTick((n) => n + 1);
              }}
            />
            <span className="sim-clock">
              {fmtClock(sim.t)} / {fmtClock(sim.timeline.total)}
            </span>
            <span className="sim-label">{sim.lastLabel}</span>
          </>
        )}
      </div>
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
