import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { Viewer } from "../viewer/Viewer";
import { NumField, ResizablePanel, Section, SelectField, CheckField } from "../ui";
import { listCadFiles, uploadCadFile } from "../api";
import { computeOffsets, fmt, g10Lines } from "../logic/offsets";
import { downloadText } from "../download";
import { defaultModelSim } from "../defaults";
import type { PickGroup } from "../store";
import type { ModelAlignment, ModelKey, ModelSimConfig, StationKey } from "../types";

const STATION_SHORT: Record<StationKey, string> = {
  vise1: "Vise 1",
  flipper: "Flipper",
  vise2: "Vise 2",
  tray: "Stock tray",
  finished: "Finished",
};

function OffsetCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      step={0.001}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
    />
  );
}

function AlignmentFields({
  align,
  onChange,
}: {
  align: ModelAlignment;
  onChange: (mut: (a: ModelAlignment) => void) => void;
}) {
  return (
    <>
      <CheckField label="Visible" value={align.visible} onChange={(v) => onChange((a) => (a.visible = v))} />
      <NumField label="Rotate X" value={align.rotX} step={90} unit="deg" onChange={(v) => onChange((a) => (a.rotX = v))} />
      <NumField label="Rotate Y" value={align.rotY} step={90} unit="deg" onChange={(v) => onChange((a) => (a.rotY = v))} />
      <NumField label="Rotate Z" value={align.rotZ} step={90} unit="deg" onChange={(v) => onChange((a) => (a.rotZ = v))} />
      <NumField label="Offset X" value={align.offX} step={0.05} unit="in" onChange={(v) => onChange((a) => (a.offX = v))} />
      <NumField label="Offset Y" value={align.offY} step={0.05} unit="in" onChange={(v) => onChange((a) => (a.offY = v))} />
      <NumField label="Offset Z" value={align.offZ} step={0.05} unit="in" onChange={(v) => onChange((a) => (a.offZ = v))} />
    </>
  );
}

const PICK_MODEL_LABEL = { vise: "vise", flipper: "flipper", gripper: "gripper" } as const;

/**
 * Corner-datum control: click a corner of the model in the viewer and it
 * becomes the model's datum. The model does NOT move when picking - the
 * offset fields are rewritten to the corner's current position relative to
 * the station point, so all further offset edits measure from that corner.
 * Cleared = automatic bounding-box placement (offsets reset to 0).
 */
function DatumField({ model }: { model: "vise" | "flipper" | "gripper" }) {
  const datum = useApp((s) => s.job.fixture.models[model].datum);
  const sim = useApp((s) => s.job.fixture.models[model].sim);
  const pick = useApp((s) => s.pick);
  const setPick = useApp((s) => s.setPick);
  const requestDatumCenter = useApp((s) => s.requestDatumCenter);
  const update = useApp((s) => s.update);
  const active = pick?.model === model && pick.group === "datum";
  const hasJaws = (sim?.jawA?.length ?? 0) + (sim?.jawB?.length ?? 0) > 0;
  const centerLabel = model === "vise" ? "Center on jaws" : "Center on fingers";
  return (
    <>
      <div className="pickrow">
        <span className="pickrow-label">Datum</span>
        <span className="pickrow-count">
          {datum
            ? `(${datum.x.toFixed(2)}, ${datum.y.toFixed(2)}, ${datum.z.toFixed(2)})`
            : "auto (model center)"}
        </span>
        <button
          className={`btn small ${active ? "primary" : ""}`}
          onClick={() => setPick(active ? null : { model, group: "datum" })}
        >
          {active ? "Cancel" : "Pick corner"}
        </button>
        <button className="btn small" disabled={!hasJaws} onClick={() => requestDatumCenter(model)}>
          {centerLabel}
        </button>
        <button
          className="btn small"
          disabled={!datum}
          onClick={() =>
            update((j) => {
              const a = j.fixture.models[model];
              a.datum = null;
              a.offX = 0;
              a.offY = 0;
              a.offZ = 0;
            })
          }
        >
          Clear
        </button>
      </div>
      <p className="hint">
        The model never moves when the datum changes - the offsets above are rewritten to show where the
        datum sits relative to the station point, and further offset edits measure from it. Picking
        jaw/finger bodies re-centers the datum on them automatically (
        {model === "vise"
          ? "middle of the jaws, at their top surface"
          : "the point centered between the fingers"}
        ); "{centerLabel}" redoes that anytime. "Pick corner" instead snaps the datum to a clicked corner of
        the model. Clear returns to automatic centering and zeroes the offsets.
      </p>
    </>
  );
}

/**
 * Configure which STEP bodies articulate in the simulation. "Pick" enters a
 * viewer mode where clicking bodies toggles them in/out of the group.
 */
function SimBodiesEditor({ model }: { model: "vise" | "flipper" | "gripper" }) {
  const align = useApp((s) => s.job.fixture.models[model]);
  const pick = useApp((s) => s.pick);
  const setPick = useApp((s) => s.setPick);
  const update = useApp((s) => s.update);
  const sim = align.sim;

  // leave pick mode when this editor goes away (section collapsed / tab change)
  useEffect(
    () => () => {
      const p = useApp.getState().pick;
      if (p?.model === model) useApp.getState().setPick(null);
    },
    [model]
  );

  const ensure = (mut: (s: ModelSimConfig) => void) =>
    update((j) => {
      const a = j.fixture.models[model];
      if (!a.sim) a.sim = defaultModelSim();
      if (typeof a.sim.jawATravel !== "number") a.sim.jawATravel = defaultModelSim().jawATravel;
      if (typeof a.sim.jawBTravel !== "number") a.sim.jawBTravel = defaultModelSim().jawBTravel;
      mut(a.sim);
    });

  const row = (group: PickGroup, label: string) => {
    const count = sim?.[group]?.length ?? 0;
    const active = pick?.model === model && pick.group === group;
    return (
      <div className="pickrow">
        <span className="pickrow-label">{label}</span>
        <span className="pickrow-count">
          {count} {count === 1 ? "body" : "bodies"}
        </span>
        <button
          className={`btn small ${active ? "primary" : ""}`}
          onClick={() => setPick(active ? null : { model, group })}
        >
          {active ? "Done" : "Pick"}
        </button>
        <button className="btn small" disabled={count === 0} onClick={() => ensure((s) => (s[group] = []))}>
          Clear
        </button>
      </div>
    );
  };

  const travel = (field: "jawATravel" | "jawBTravel") => (
    <NumField
      label="Open travel"
      value={sim?.[field] ?? 0.25}
      step={0.05}
      min={0}
      unit="in"
      title="How far this finger/jaw opens. Direction is inferred from the picked bodies."
      onChange={(v) => ensure((s) => (s[field] = Math.max(0, v)))}
    />
  );

  return (
    <>
      <h4 className="subhead">Simulation Bodies</h4>
      <p className="hint">
        Click Pick, then click bodies in the 3D viewer (highlighted{" "}
        {model === "flipper" ? "orange = rotating head, green / purple = grip fingers" : "green / purple"}).
        {model === "flipper"
          ? " Pick the rotating head separately from the grip fingers - the fingers automatically flip with the head."
          : ""}{" "}
        Open travel is just a distance; the open direction is inferred from the finger geometry so rotating the
        whole gripper does not change it. Picking bodies never moves the model - the picked jaws only tell the
        simulation where parts sit.
      </p>
      {model === "flipper" && (
        <>
          {row("rotating", "Rotating head")}
          <SelectField
            label="Rotation axis (model)"
            value={sim?.rotAxis ?? "x"}
            options={[
              { value: "x", label: "Model X" },
              { value: "y", label: "Model Y" },
              { value: "z", label: "Model Z" },
            ]}
            onChange={(v) => ensure((s) => (s.rotAxis = v))}
          />
          {row("jawA", "Grip finger A")}
          {travel("jawATravel")}
          {row("jawB", "Grip finger B")}
          {travel("jawBTravel")}
        </>
      )}
      {model === "vise" && (
        <>
          {row("jawA", "Moving jaw")}
          {travel("jawATravel")}
          {row("jawB", "Second moving jaw (optional)")}
          {travel("jawBTravel")}
        </>
      )}
      {model === "gripper" && (
        <>
          {row("jawA", "Finger A")}
          {travel("jawATravel")}
          {row("jawB", "Finger B")}
          {travel("jawBTravel")}
        </>
      )}
    </>
  );
}

function ModelFileField({
  align,
  cadFiles,
  autoLabel,
  onChange,
}: {
  align: ModelAlignment;
  cadFiles: string[];
  /** label for the empty choice: "Auto (built-in)" for the standard slots, "None" for jaws */
  autoLabel: string;
  onChange: (file: string | undefined) => void;
}) {
  const current = align.file ?? "";
  // keep a stale selection visible even if the file disappeared from the library
  const options = [
    { value: "", label: autoLabel },
    ...cadFiles.map((f) => ({ value: f, label: f })),
    ...(current && !cadFiles.includes(current) ? [{ value: current, label: `${current} (missing)` }] : []),
  ];
  return (
    <SelectField
      label="STEP file"
      value={current}
      options={options}
      onChange={(v) => onChange(v || undefined)}
    />
  );
}

export function FixtureTab() {
  const job = useApp((s) => s.job);
  const fixture = useApp((s) => s.job.fixture);
  const datum = useApp((s) => s.job.datum);
  const update = useApp((s) => s.update);
  const offsetRows = computeOffsets(job);
  const g10 = g10Lines(job).join("\n");

  const [cadFiles, setCadFiles] = useState<string[]>([]);
  const [uploadMsg, setUploadMsg] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCadFiles().then(setCadFiles).catch(() => {});
  }, []);

  const modelFile = (key: ModelKey) => (file: string | undefined) =>
    update((j) => {
      j.fixture.models[key].file = file;
      if (file) j.fixture.models[key].visible = true;
    });

  const onUpload = async (f: File) => {
    try {
      const rel = await uploadCadFile(f.name, await f.arrayBuffer());
      setCadFiles(await listCadFiles());
      setUploadMsg(`Uploaded ${rel} - pick it in a STEP file selector below.`);
    } catch {
      setUploadMsg("Upload failed.");
    }
  };

  return (
    <div className="split">
      <div className="viewer-side">
        <Viewer />
      </div>
      <ResizablePanel>
        <Section title="Placement on Bed">
          <SelectField
            label="Datum reference point"
            value={datum.ref}
            options={[
              { value: "front-left", label: "Front-left corner" },
              { value: "front-right", label: "Front-right corner" },
              { value: "back-left", label: "Back-left corner" },
              { value: "back-right", label: "Back-right corner" },
              { value: "center", label: "Plate center" },
            ]}
            onChange={(v) => update((j) => (j.datum.ref = v))}
          />
          <NumField label="Datum machine X" value={datum.machineX} unit="in" onChange={(v) => update((j) => (j.datum.machineX = v))} />
          <NumField label="Datum machine Y" value={datum.machineY} unit="in" onChange={(v) => update((j) => (j.datum.machineY = v))} />
          <NumField label="Rotation (CCW)" value={datum.rotation} step={90} unit="deg" onChange={(v) => update((j) => (j.datum.rotation = v))} />
          <p className="hint">
            The gray area is the machine bed (size set per machine in Machine Config). The whole plate
            assembly - vises, flipper, and plate - moves and rotates together, pivoting at the datum point.
            These are the same datum values as on the Datum &amp; Offsets page, and all work offsets follow
            the rotation automatically.
          </p>
        </Section>
        <Section title="Offset Sheet">
          <p className="hint">
            Machine coordinates for every work offset - type them in directly (WCS codes are assigned on the
            Datum &amp; Offsets page).
          </p>
          <div className="table-scroll">
            <table className="data offset-sheet">
              <thead>
                <tr>
                  <th>WCS</th>
                  <th>Station</th>
                  <th>X</th>
                  <th>Y</th>
                  <th>Z</th>
                </tr>
              </thead>
              <tbody>
                {offsetRows.map((r) => {
                  const set = (axis: "x" | "y" | "z") => (v: number) =>
                    update((j) => (j.offsets[r.station as StationKey][axis] = v));
                  return (
                    <tr key={r.station}>
                      <td className="wcs">{r.wcs}</td>
                      <td title={`${r.label} - ${r.note}`}>{STATION_SHORT[r.station as StationKey]}</td>
                      <td className="num"><OffsetCell value={r.x} onChange={set("x")} /></td>
                      <td className="num"><OffsetCell value={r.y} onChange={set("y")} /></td>
                      <td className="num"><OffsetCell value={r.z} onChange={set("z")} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="btnrow">
            <button className="btn" onClick={() => window.print()}>
              Print offset sheet
            </button>
            <button
              className="btn"
              onClick={() => {
                const lines = offsetRows.map((r) => `${r.wcs}\t${r.label}\tX${fmt(r.x)}\tY${fmt(r.y)}\tZ${fmt(r.z)}`);
                void navigator.clipboard.writeText(lines.join("\n"));
              }}
            >
              Copy table
            </button>
            <button className="btn" onClick={() => void navigator.clipboard.writeText(g10)} title={g10}>
              Copy G10 lines
            </button>
            <button className="btn" onClick={() => downloadText("set-offsets.nc", g10)}>
              Download G10 .nc
            </button>
          </div>
        </Section>
        <Section title="Base Plate">
          <NumField label="Length (X)" value={fixture.plateLength} unit="in" onChange={(v) => update((j) => (j.fixture.plateLength = v))} />
          <NumField label="Width (Y)" value={fixture.plateWidth} unit="in" onChange={(v) => update((j) => (j.fixture.plateWidth = v))} />
          <NumField label="Thickness" value={fixture.plateThickness} unit="in" onChange={(v) => update((j) => (j.fixture.plateThickness = v))} />
          <p className="hint">
            Positions below are measured from the plate front-left corner. The vises open perpendicular to the
            plate length (jaw travel along Y).
          </p>
        </Section>
        <Section title="Vise 1 - Op1 (left end)">
          <NumField label="Center X" value={fixture.vise1X} unit="in" onChange={(v) => update((j) => (j.fixture.vise1X = v))} />
          <NumField label="Center Y" value={fixture.vise1Y} unit="in" onChange={(v) => update((j) => (j.fixture.vise1Y = v))} />
        </Section>
        <Section title="Flipper - QuickFlip180 (middle)">
          <NumField label="Center X" value={fixture.flipperX} unit="in" onChange={(v) => update((j) => (j.fixture.flipperX = v))} />
          <NumField label="Center Y" value={fixture.flipperY} unit="in" onChange={(v) => update((j) => (j.fixture.flipperY = v))} />
        </Section>
        <Section title="Vise 2 - Op2 (right end)">
          <NumField label="Center X" value={fixture.vise2X} unit="in" onChange={(v) => update((j) => (j.fixture.vise2X = v))} />
          <NumField label="Center Y" value={fixture.vise2Y} unit="in" onChange={(v) => update((j) => (j.fixture.vise2Y = v))} />
        </Section>
        <Section title="STEP Models" defaultOpen={false}>
          <SelectField
            label="STEP files modeled in"
            value={fixture.stepUnits}
            options={[
              { value: "mm", label: "Millimeters" },
              { value: "inch", label: "Inches" },
            ]}
            onChange={(v) => update((j) => (j.fixture.stepUnits = v))}
          />
          <div className="btnrow">
            <button className="btn" onClick={() => uploadRef.current?.click()}>
              Add STEP file...
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept=".step,.stp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = "";
              }}
            />
            {uploadMsg && <span className="hint">{uploadMsg}</span>}
          </div>
          <p className="hint">
            Upload your own STEP files (your vises, soft jaws, etc.) into the CAD library, then pick them in
            the model sections below. Units apply to all imported models together; everything else in the app
            (plate, spacings, trays, offsets, G-code) is always in inches.
          </p>
        </Section>
        <Section title="Model Alignment - Air Vise" defaultOpen={false}>
          <ModelFileField align={fixture.models.vise} cadFiles={cadFiles} autoLabel="Auto (bundled Gimbel vise)" onChange={modelFile("vise")} />
          <AlignmentFields align={fixture.models.vise} onChange={(mut) => update((j) => mut(j.fixture.models.vise))} />
          <DatumField model="vise" />
          <SimBodiesEditor model="vise" />
        </Section>
        <Section title="Soft Jaws - Vise 1" defaultOpen={false}>
          <p className="hint">Optional: your own soft jaw STEP model, shown at the vise 1 station.</p>
          <ModelFileField align={fixture.models.jaws1} cadFiles={cadFiles} autoLabel="None" onChange={modelFile("jaws1")} />
          <AlignmentFields align={fixture.models.jaws1} onChange={(mut) => update((j) => mut(j.fixture.models.jaws1))} />
        </Section>
        <Section title="Soft Jaws - Vise 2" defaultOpen={false}>
          <p className="hint">Optional: your own soft jaw STEP model, shown at the vise 2 station.</p>
          <ModelFileField align={fixture.models.jaws2} cadFiles={cadFiles} autoLabel="None" onChange={modelFile("jaws2")} />
          <AlignmentFields align={fixture.models.jaws2} onChange={(mut) => update((j) => mut(j.fixture.models.jaws2))} />
        </Section>
        <Section title="Model Alignment - Flipper" defaultOpen={false}>
          <ModelFileField align={fixture.models.flipper} cadFiles={cadFiles} autoLabel="Auto (bundled QuickFlip180)" onChange={modelFile("flipper")} />
          <AlignmentFields align={fixture.models.flipper} onChange={(mut) => update((j) => mut(j.fixture.models.flipper))} />
          <DatumField model="flipper" />
          <SimBodiesEditor model="flipper" />
        </Section>
        <Section title="Model Alignment - Gripper" defaultOpen={false}>
          <p className="hint">Shown floating above the flipper for reference only.</p>
          <ModelFileField align={fixture.models.gripper} cadFiles={cadFiles} autoLabel="Auto (bundled TSA gripper)" onChange={modelFile("gripper")} />
          <AlignmentFields align={fixture.models.gripper} onChange={(mut) => update((j) => mut(j.fixture.models.gripper))} />
          <DatumField model="gripper" />
          <SimBodiesEditor model="gripper" />
        </Section>
      </ResizablePanel>
    </div>
  );
}
