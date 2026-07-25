import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useApp } from "../store";
import { buildTrayGeometry, type TrayGeometry } from "../logic/trayModel";
import { trayToDxf } from "../logic/dxf";
import { machineOf } from "../logic/program";
import { requestTrayMesh, requestTrayStep } from "../viewer/trayMesher";
import type { TrayMeshData } from "../workers/replicadWorker";
import { downloadBlob, downloadText } from "../download";
import { CheckField, NumField, Section, SelectField } from "../ui";
import { fmt } from "../logic/offsets";

function TrayPreview({ mesh, size }: { mesh: TrayMeshData | null; size: { l: number; w: number } }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const trayObjRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d23);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xdde4ee, 0x30343c, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(10, -14, 20);
    scene.add(dir);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (trayObjRef.current) {
      scene.remove(trayObjRef.current);
      trayObjRef.current.geometry.dispose();
      trayObjRef.current = null;
    }
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
    if (mesh.normals) geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    else geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, metalness: 0.15, roughness: 0.6 });
    const obj = new THREE.Mesh(geo, mat);
    scene.add(obj);
    trayObjRef.current = obj;

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      const dist = Math.max(size.l, size.w) * 1.4;
      camera.position.set(0, -dist, dist * 0.8);
      controls.target.set(0, 0, 0);
    }
  }, [mesh, size.l, size.w]);

  return <div ref={mountRef} className="tray-preview-canvas" />;
}

export function TrayGenTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const [source, setSource] = useState<"stock" | "finished">("stock");
  const [mesh, setMesh] = useState<TrayMeshData | null>(null);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const machine = machineOf(job);
  const trayConfig = source === "stock" ? job.stockTray : job.finished.tray;
  const geometry: TrayGeometry = buildTrayGeometry(job.stock, trayConfig, job.trayGen, machine);
  const geomKey = JSON.stringify(geometry);

  useEffect(() => {
    let cancelled = false;
    setBuilding(true);
    const timer = setTimeout(() => {
      requestTrayMesh(JSON.parse(geomKey) as TrayGeometry)
        .then((m) => {
          if (!cancelled) {
            setMesh(m);
            setMeshError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setMeshError(String(e));
        })
        .finally(() => {
          if (!cancelled) setBuilding(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [geomKey]);

  const g = job.trayGen;
  const baseName = `tray-${source}-${trayConfig.countX}x${trayConfig.countY}`;

  return (
    <div className="page narrow">
      <h2>Tray Generator</h2>
      <div className="row">
        <div className="col">
          <Section title="Source Tray">
            <SelectField
              label="Generate for"
              value={source}
              options={[
                { value: "stock", label: `Stock tray (${job.stockTray.countX} x ${job.stockTray.countY})` },
                { value: "finished", label: `Finished tray (${job.finished.tray.countX} x ${job.finished.tray.countY})` },
              ]}
              onChange={setSource}
            />
            <p className="hint">
              Pocket counts and pitch come from Trays &amp; Stock; pocket size comes from the raw stock size plus
              clearance. The tray below is exactly what exports.
            </p>
          </Section>
          <Section title="Tray Parameters">
            <NumField label="Pocket clearance (per side)" value={g.pocketClearance} step={0.005} unit="in" onChange={(v) => update((j) => (j.trayGen.pocketClearance = v))} />
            <NumField label="Pocket depth" value={g.pocketDepth} step={0.0625} unit="in" onChange={(v) => update((j) => (j.trayGen.pocketDepth = v))} />
            <NumField label="Tray thickness" value={g.thickness} step={0.0625} unit="in" onChange={(v) => update((j) => (j.trayGen.thickness = v))} />
            <NumField label="Edge margin" value={g.margin} step={0.0625} unit="in" onChange={(v) => update((j) => (j.trayGen.margin = v))} />
            <NumField label="Pocket corner radius" value={g.cornerRadius} step={0.0625} unit="in" onChange={(v) => update((j) => (j.trayGen.cornerRadius = v))} />
            <NumField label="Outer corner radius" value={g.outerCornerRadius} step={0.0625} unit="in" onChange={(v) => update((j) => (j.trayGen.outerCornerRadius = v))} />
            <CheckField label="Mounting holes" value={g.mountHoles} onChange={(v) => update((j) => (j.trayGen.mountHoles = v))} />
            {g.mountHoles && (
              <>
                <SelectField
                  label="Hole placement"
                  value={g.mountHoleMode}
                  options={[
                    { value: "t-slots", label: "Auto from machine T-slots" },
                    { value: "corners", label: "4 corners" },
                  ]}
                  onChange={(v) => update((j) => (j.trayGen.mountHoleMode = v))}
                />
                <NumField label="Hole diameter" value={g.mountHoleDia} step={0.001} unit="in" onChange={(v) => update((j) => (j.trayGen.mountHoleDia = v))} />
                <NumField
                  label={g.mountHoleMode === "t-slots" ? "Inset from tray ends (X)" : "Hole inset from corner"}
                  value={g.mountHoleInset}
                  step={0.05}
                  unit="in"
                  onChange={(v) => update((j) => (j.trayGen.mountHoleInset = v))}
                />
                {g.mountHoleMode === "t-slots" && (
                  <p className="hint">
                    Using {machine.label}: {machine.tSlotCount} slots × {fmt(machine.tSlotSpacing)}&quot; spacing.
                    Holes appear where this tray (at its Trays &amp; Stock position) overlaps a T-slot —{" "}
                    {geometry.holes.length} hole{geometry.holes.length === 1 ? "" : "s"} right now
                    {geometry.holes.length === 0 ? " (move the tray over a slot, or widen it)" : ""}.
                  </p>
                )}
              </>
            )}
          </Section>
          <Section title="Export">
            <p className="hint">
              <b>DXF</b> - for laser cutting acrylic. Pockets export as through-cutouts: cut this layer, then bond
              it to a solid backer sheet. Layers: OUTLINE, POCKETS, HOLES.
              <br />
              <b>STEP</b> - a solid model with {fmt(geometry.pocketDepth)}&quot; deep pockets for machining.
            </p>
            <div className="btnrow">
              <button className="btn primary" onClick={() => downloadText(`${baseName}.dxf`, trayToDxf(geometry), "application/dxf")}>
                Export DXF (laser)
              </button>
              <button
                className="btn primary"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    const blob = await requestTrayStep(geometry);
                    downloadBlob(`${baseName}.step`, blob);
                  } catch (e) {
                    alert(`STEP export failed: ${e}`);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? "Building STEP..." : "Export STEP (machining)"}
              </button>
            </div>
          </Section>
        </div>
        <div className="col">
          <h3>
            Preview {building && <span className="hint">(rebuilding...)</span>}
          </h3>
          <TrayPreview mesh={mesh} size={{ l: geometry.outerLength, w: geometry.outerWidth }} />
          {meshError && <div className="warnbox bad">Solid preview failed: {meshError}</div>}
          <table className="data" style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <th>Overall size</th>
                <td className="num">
                  {fmt(geometry.outerLength)} x {fmt(geometry.outerWidth)} x {fmt(geometry.thickness)} in
                </td>
              </tr>
              <tr>
                <th>Pocket size</th>
                <td className="num">
                  {fmt(geometry.pocketLength)} x {fmt(geometry.pocketWidth)} x {fmt(geometry.pocketDepth)} in
                </td>
              </tr>
              <tr>
                <th>Pockets</th>
                <td className="num">
                  {trayConfig.countX} x {trayConfig.countY} = {geometry.pockets.length}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
