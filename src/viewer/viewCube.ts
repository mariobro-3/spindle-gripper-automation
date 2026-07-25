import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * AutoCAD-style view cube for a Z-up scene (Haas machine coords).
 * FRONT = operator side (-Y), BACK = +Y toward machine zero,
 * RIGHT = +X, LEFT = -X, TOP = +Z.
 */
export interface ViewCubeHandle {
  update: () => void;
  dispose: () => void;
}

interface SnapView {
  label: string;
  /** camera offset direction from the orbit target */
  dir: THREE.Vector3;
  up: THREE.Vector3;
}

const FACES: { label: string; dir: THREE.Vector3; up: THREE.Vector3; color: number }[] = [
  { label: "TOP", dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), color: 0x3a4554 },
  { label: "BOTTOM", dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), color: 0x2e3642 },
  { label: "FRONT", dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), color: 0x3a4554 },
  { label: "BACK", dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1), color: 0x3a4554 },
  { label: "RIGHT", dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1), color: 0x3a4554 },
  { label: "LEFT", dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1), color: 0x3a4554 },
];

function makeFaceTexture(label: string, color: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#9aa3b2";
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = "#e8ecf2";
  ctx.font = "bold 26px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Orient a +Z-facing plane so its outward normal is `dir` and its local +Y is `up`. */
function orientOutward(mesh: THREE.Object3D, dir: THREE.Vector3, up: THREE.Vector3): void {
  const z = dir.clone().normalize();
  const y = up.clone().normalize();
  // if up is parallel to the face normal, pick a fallback
  if (Math.abs(z.dot(y)) > 0.99) y.set(0, 1, 0);
  if (Math.abs(z.dot(y)) > 0.99) y.set(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  y.crossVectors(z, x).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function buildCube(): THREE.Group {
  const g = new THREE.Group();
  const half = 0.5;

  for (const face of FACES) {
    const mat = new THREE.MeshBasicMaterial({
      map: makeFaceTexture(face.label, face.color),
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.copy(face.dir).multiplyScalar(half + 0.001);
    orientOutward(mesh, face.dir, face.up);
    mesh.userData.snap = { label: face.label, dir: face.dir, up: face.up } satisfies SnapView;
    mesh.userData.pick = "face";
    g.add(mesh);
  }

  // solid cube body so you don't see through between faces
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.98, 0.98),
    new THREE.MeshBasicMaterial({ color: 0x252a33 })
  );
  body.userData.pick = null;
  g.add(body);

  // corner hotspots for isometric snaps
  const cornerMat = new THREE.MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.9 });
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const corner = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), cornerMat.clone());
        corner.position.set(x * half, y * half, z * half);
        const dir = new THREE.Vector3(x, y, z).normalize();
        let up = new THREE.Vector3(0, 0, 1);
        if (Math.abs(dir.dot(up)) > 0.9) up = new THREE.Vector3(0, 1, 0);
        corner.userData.snap = { label: "ISO", dir, up } satisfies SnapView;
        corner.userData.pick = "corner";
        g.add(corner);
      }
    }
  }

  return g;
}

function animateCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  dir: THREE.Vector3,
  up: THREE.Vector3,
  duration = 320
): () => void {
  const startPos = camera.position.clone();
  const startUp = camera.up.clone();
  const target = controls.target.clone();
  const dist = Math.max(startPos.distanceTo(target), 1);
  const endPos = target.clone().add(dir.clone().normalize().multiplyScalar(dist));
  const endUp = up.clone().normalize();
  const t0 = performance.now();
  let cancelled = false;

  // disable damping during the snap so OrbitControls doesn't fight the lerp
  const wasDamping = controls.enableDamping;
  controls.enableDamping = false;

  const step = () => {
    if (cancelled) return;
    const u = Math.min(1, (performance.now() - t0) / duration);
    const e = 1 - (1 - u) * (1 - u);
    camera.position.lerpVectors(startPos, endPos, e);
    camera.up.lerpVectors(startUp, endUp, e).normalize();
    camera.lookAt(target);
    controls.update();
    if (u < 1) requestAnimationFrame(step);
    else controls.enableDamping = wasDamping;
  };
  requestAnimationFrame(step);
  return () => {
    cancelled = true;
    controls.enableDamping = wasDamping;
  };
}

export function createViewCube(
  mount: HTMLElement,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls
): ViewCubeHandle {
  const size = 112;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.cursor = "default";
  renderer.domElement.title = "Click a face or corner to snap the view";

  const scene = new THREE.Scene();
  const cubeCam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const cube = buildCube();
  scene.add(cube);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let cancelAnim: (() => void) | null = null;
  let hover: THREE.Mesh | null = null;

  const setHover = (obj: THREE.Object3D | null) => {
    const mesh = obj instanceof THREE.Mesh ? obj : null;
    if (hover === mesh) return;
    if (hover) {
      const m = hover.material as THREE.MeshBasicMaterial;
      if (hover.userData.pick === "corner") m.color.setHex(0xe8a33d);
      else m.color.setHex(0xffffff);
    }
    hover = mesh;
    if (hover) {
      const m = hover.material as THREE.MeshBasicMaterial;
      if (hover.userData.pick === "corner") m.color.setHex(0xffd080);
      else m.color.setHex(0xffe0a0);
    }
    renderer.domElement.style.cursor = mesh ? "pointer" : "default";
  };

  const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, cubeCam);
    const hits = raycaster.intersectObjects(cube.children, false);
    return hits.find((h) => h.object.userData.pick)?.object ?? null;
  };

  const onMove = (e: PointerEvent) => setHover(pick(e.clientX, e.clientY));
  const onLeave = () => setHover(null);
  const onClick = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const obj = pick(e.clientX, e.clientY);
    if (!obj) return;
    const snap = obj.userData.snap as SnapView;
    cancelAnim?.();
    cancelAnim = animateCamera(camera, controls, snap.dir.clone(), snap.up.clone());
  };

  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", onLeave);
  renderer.domElement.addEventListener("pointerdown", onClick);

  return {
    update: () => {
      const offset = camera.position.clone().sub(controls.target);
      if (offset.lengthSq() < 1e-8) return;
      cubeCam.position.copy(offset.normalize().multiplyScalar(3.4));
      cubeCam.up.copy(camera.up);
      cubeCam.lookAt(0, 0, 0);
      renderer.render(scene, cubeCam);
    },
    dispose: () => {
      cancelAnim?.();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onClick);
      cube.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mat = m as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    },
  };
}
