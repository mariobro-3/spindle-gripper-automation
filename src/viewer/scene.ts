import * as THREE from "three";
import type { JobConfig, ModelAlignment, ModelKey } from "../types";
import { datumLocal } from "../logic/offsets";
import { machineOf } from "../logic/program";
import { buildTrayGeometry, type TrayGeometry } from "../logic/trayModel";
import { tSlotMachineYs } from "../logic/tSlots";

export type LoadedModels = Partial<Record<ModelKey, THREE.Group>>;

/** live object handles for the kinematic simulation, stored on root.userData.simHandles */
export interface SimHandles {
  gripper: THREE.Group;
  gripDot: THREE.Mesh;
  parts: THREE.Mesh[];
  flipperPivot: THREE.Group | null;
  markers: { vise1: THREE.Mesh; vise2: THREE.Mesh; flipper: THREE.Mesh };
  trayStock: THREE.Object3D[];
}

/** height of the flipper rotation axis above the plate top (viewer approximation) */
export const FLIP_AXIS_Z = 3.2;

const MM_TO_IN = 1 / 25.4;

const matPlate = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.35 });
const matTable = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.3, roughness: 0.8 });
const matTSlot = new THREE.MeshStandardMaterial({ color: 0x1e2228, metalness: 0.2, roughness: 0.9 });
const matHole = new THREE.MeshBasicMaterial({ color: 0x111418 });
const matStock = new THREE.MeshStandardMaterial({ color: 0xd7a94b, metalness: 0.4, roughness: 0.5 });
const matTray = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, metalness: 0.2, roughness: 0.7 });
const matTrayFin = new THREE.MeshStandardMaterial({ color: 0x4a8a5f, metalness: 0.2, roughness: 0.7 });
const matFallback = new THREE.MeshStandardMaterial({ color: 0x777d88, metalness: 0.4, roughness: 0.6 });
const matBin = new THREE.MeshStandardMaterial({
  color: 0x2e8a4d,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
});

function applyAlignment(model: THREE.Group, align: ModelAlignment, scale: number): THREE.Group {
  const wrapper = new THREE.Group();
  const inner = model.clone();
  inner.scale.setScalar(scale);
  // 'ZYX' applies X first, then Y, then Z - matches "stand the model up, then turn it"
  inner.rotation.set(
    THREE.MathUtils.degToRad(align.rotX),
    THREE.MathUtils.degToRad(align.rotY),
    THREE.MathUtils.degToRad(align.rotZ),
    "ZYX"
  );
  wrapper.add(inner);
  // auto-place: center XY on origin, bottom at z=0, then user offsets
  const box = new THREE.Box3().setFromObject(inner);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    inner.position.set(-center.x + align.offX, -center.y + align.offY, -box.min.z + align.offZ);
  }
  return wrapper;
}

function fallbackBox(l: number, w: number, h: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(l, w, h), mat);
  mesh.position.z = h / 2;
  g.add(mesh);
  return g;
}

function stationMarker(color: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.18, 0.28, 32);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.z = 0.012;
  ring.userData.baseColor = color;
  return ring;
}

/** trays sit on the bed and are positioned directly in machine coordinates */
function trayObject(
  job: JobConfig,
  geometry: TrayGeometry,
  firstPocketMachineX: number,
  firstPocketMachineY: number,
  baseMat: THREE.Material,
  withStock: boolean,
  tableZ: number
): THREE.Group {
  const g = new THREE.Group();
  const originX = firstPocketMachineX - (geometry.pockets[0]?.cx ?? 0);
  const originY = firstPocketMachineY - (geometry.pockets[0]?.cy ?? 0);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(geometry.outerLength, geometry.outerWidth, geometry.thickness),
    baseMat
  );
  base.position.set(
    originX + geometry.outerLength / 2,
    originY + geometry.outerWidth / 2,
    tableZ + geometry.thickness / 2
  );
  g.add(base);

  const pocketFloorZ = tableZ + geometry.thickness - geometry.pocketDepth;
  const edges = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(geometry.pocketLength, geometry.pocketWidth, geometry.pocketDepth)
  );
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111418 });
  for (const p of geometry.pockets) {
    const outline = new THREE.LineSegments(edges, lineMat);
    outline.position.set(originX + p.cx, originY + p.cy, tableZ + geometry.thickness - geometry.pocketDepth / 2);
    g.add(outline);
    if (withStock) {
      const stock = new THREE.Mesh(
        new THREE.BoxGeometry(job.stock.length, job.stock.width, job.stock.height),
        matStock
      );
      stock.position.set(originX + p.cx, originY + p.cy, pocketFloorZ + job.stock.height / 2);
      stock.userData.trayStock = true; // hidden while the simulation runs its own parts
      g.add(stock);
    }
  }

  // mount holes (through markers on the tray top)
  if (geometry.holes.length > 0 && geometry.holeDia > 0) {
    for (const h of geometry.holes) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(geometry.holeDia / 2, 20), matHole);
      hole.position.set(originX + h.cx, originY + h.cy, tableZ + geometry.thickness + 0.01);
      g.add(hole);
    }
  }
  return g;
}

/**
 * The scene is built in MACHINE coordinates (Haas-style: work area in the
 * negative X/Y quadrant, machine zero at the back-right of the bed). The
 * fixture (plate + vises + flipper) is one assembly group placed by the
 * probed datum and rotated about it; trays and the bin are independent
 * items positioned directly in machine coordinates.
 */
export function buildFixtureScene(job: JobConfig, models: LoadedModels): THREE.Group {
  const root = new THREE.Group();
  const fx = job.fixture;
  const machine = machineOf(job);
  const tableZ = -fx.plateThickness;
  const stepScale = fx.stepUnits === "mm" ? MM_TO_IN : 1;

  // machine bed: spans X [-bedLength, 0], Y [-bedWidth, 0]
  const bed = new THREE.Mesh(new THREE.BoxGeometry(machine.bedLength, machine.bedWidth, 0.4), matTable);
  bed.position.set(-machine.bedLength / 2, -machine.bedWidth / 2, tableZ - 0.2);
  root.add(bed);
  const bedEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(machine.bedLength, machine.bedWidth, 0.4)),
    new THREE.LineBasicMaterial({ color: 0x565e6a })
  );
  bedEdges.position.copy(bed.position);
  root.add(bedEdges);

  // T-slots: run the table length (X), spaced across Y, centered on the bed
  const slotWidth = Math.max(0.05, machine.tSlotWidth);
  for (const slotY of tSlotMachineYs(machine)) {
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(machine.bedLength - 0.1, slotWidth, 0.08),
      matTSlot
    );
    slot.position.set(-machine.bedLength / 2, slotY, tableZ + 0.005);
    root.add(slot);
  }

  // machine zero (X0 Y0) marker at the bed corner
  const zero = new THREE.AxesHelper(3);
  zero.position.set(0, 0, tableZ);
  root.add(zero);

  // fixture assembly, built in plate-local coords (origin = plate front-left
  // corner, plate top = z0), then placed on the bed as one unit below
  const assembly = new THREE.Group();

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(fx.plateLength, fx.plateWidth, fx.plateThickness),
    matPlate
  );
  plate.position.set(fx.plateLength / 2, fx.plateWidth / 2, -fx.plateThickness / 2);
  assembly.add(plate);

  // stations on the plate
  const stations: {
    key: "vise1" | "vise2" | "flipper";
    x: number;
    y: number;
    model?: THREE.Group;
    align: ModelAlignment;
    fallback: [number, number, number];
    marker: number;
  }[] = [
    { key: "vise1", x: fx.vise1X, y: fx.vise1Y, model: models.vise, align: fx.models.vise, fallback: [4, 5, 3], marker: 0xff5555 },
    { key: "vise2", x: fx.vise2X, y: fx.vise2Y, model: models.vise, align: fx.models.vise, fallback: [4, 5, 3], marker: 0x5599ff },
    { key: "flipper", x: fx.flipperX, y: fx.flipperY, model: models.flipper, align: fx.models.flipper, fallback: [5, 4, 4], marker: 0xffcc44 },
  ];

  const markers = {} as SimHandles["markers"];
  let flipperPivot: THREE.Group | null = null;

  for (const s of stations) {
    let obj: THREE.Group;
    if (s.model && s.align.visible) {
      obj = applyAlignment(s.model, s.align, stepScale);
    } else if (s.align.visible) {
      obj = fallbackBox(...s.fallback, matFallback);
    } else {
      obj = new THREE.Group();
    }
    if (s.key === "flipper") {
      // wrap in a pivot at the nest axis so the simulation can swing it 180
      const pivot = new THREE.Group();
      pivot.position.set(s.x, s.y, FLIP_AXIS_Z);
      obj.position.set(0, 0, -FLIP_AXIS_Z);
      pivot.add(obj);
      assembly.add(pivot);
      flipperPivot = pivot;
    } else {
      obj.position.set(s.x, s.y, 0);
      assembly.add(obj);
    }
    const marker = stationMarker(s.marker);
    marker.position.set(s.x, s.y, 0.012);
    assembly.add(marker);
    markers[s.key] = marker;
  }

  // soft jaws (user STEP files) sitting at the vise stations
  const jawSlots: [ModelKey, number, number][] = [
    ["jaws1", fx.vise1X, fx.vise1Y],
    ["jaws2", fx.vise2X, fx.vise2Y],
  ];
  for (const [key, x, y] of jawSlots) {
    const align = fx.models[key];
    const model = models[key];
    if (model && align?.visible) {
      const obj = applyAlignment(model, align, stepScale);
      obj.position.set(x, y, 0);
      assembly.add(obj);
    }
  }

  // gripper model floating above the flipper for reference
  if (models.gripper && fx.models.gripper.visible) {
    const grip = applyAlignment(models.gripper, fx.models.gripper, stepScale);
    grip.position.set(fx.flipperX, fx.flipperY, 7);
    assembly.add(grip);
  }

  // datum marker: on the plate at the datum reference point (the rotation
  // pivot, so it always lands exactly at datum.machineX/Y in the scene)
  const d = datumLocal(job.datum.ref, fx.plateLength, fx.plateWidth);
  const datumMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff2266 })
  );
  datumMark.position.set(d.x, d.y, 0.15);
  assembly.add(datumMark);

  // place the assembly: rotate about the datum point, datum -> machineX/Y
  const rad = THREE.MathUtils.degToRad(job.datum.rotation ?? 0);
  assembly.rotation.z = rad;
  assembly.position.set(
    job.datum.machineX - (Math.cos(rad) * d.x - Math.sin(rad) * d.y),
    job.datum.machineY - (Math.sin(rad) * d.x + Math.cos(rad) * d.y),
    0
  );
  root.add(assembly);

  // stock tray (with raw stock in pockets)
  const stockGeom = buildTrayGeometry(job.stock, job.stockTray, job.trayGen, machine);
  root.add(
    trayObject(job, stockGeom, job.stockTray.firstPocketX, job.stockTray.firstPocketY, matTray, true, tableZ)
  );

  // finished destination
  if (job.finished.mode === "tray") {
    const finGeom = buildTrayGeometry(job.stock, job.finished.tray, job.trayGen, machine);
    root.add(
      trayObject(
        job,
        finGeom,
        job.finished.tray.firstPocketX,
        job.finished.tray.firstPocketY,
        matTrayFin,
        false,
        tableZ
      )
    );
  } else {
    const bin = job.finished.bin;
    const box = new THREE.Mesh(new THREE.BoxGeometry(bin.length, bin.width, bin.height), matBin);
    box.position.set(bin.x, bin.y, tableZ + bin.height / 2);
    root.add(box);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bin.length, bin.width, bin.height)),
      new THREE.LineBasicMaterial({ color: 0x2e8a4d })
    );
    edges.position.copy(box.position);
    root.add(edges);
  }

  // ---- simulation objects (hidden until the simulation runs) ----
  // animated gripper: group origin = grip tip (bottom center of the model)
  const simGripper = new THREE.Group();
  const gripBody = models.gripper
    ? applyAlignment(models.gripper, fx.models.gripper, stepScale)
    : fallbackBox(1.4, 1.4, 4, matFallback);
  simGripper.add(gripBody);
  const gripDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb347 })
  );
  gripDot.position.set(0, 0, 0.1);
  simGripper.add(gripDot);
  simGripper.visible = false;
  root.add(simGripper);

  // simulated parts (one box per tray pocket, moved along the timeline)
  const partGeo = new THREE.BoxGeometry(job.stock.length, job.stock.width, job.stock.height);
  const simParts: THREE.Mesh[] = [];
  const partCount = job.stockTray.countX * job.stockTray.countY;
  for (let i = 0; i < partCount; i++) {
    const mesh = new THREE.Mesh(partGeo, matStock);
    mesh.visible = false;
    root.add(mesh);
    simParts.push(mesh);
  }

  const trayStock: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.trayStock) trayStock.push(o);
  });

  const handles: SimHandles = {
    gripper: simGripper,
    gripDot,
    parts: simParts,
    flipperPivot,
    markers,
    trayStock,
  };
  root.userData.simHandles = handles;

  return root;
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !mesh.userData.shared) mesh.geometry.dispose();
  });
}
