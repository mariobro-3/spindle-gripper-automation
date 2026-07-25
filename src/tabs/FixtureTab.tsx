import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { Viewer } from "../viewer/Viewer";
import { NumField, Section, SelectField, CheckField } from "../ui";
import { listCadFiles, uploadCadFile } from "../api";
import type { ModelAlignment, ModelKey } from "../types";

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
  const fixture = useApp((s) => s.job.fixture);
  const datum = useApp((s) => s.job.datum);
  const update = useApp((s) => s.update);

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
      <div className="panel-side">
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
        </Section>
        <Section title="Model Alignment - Gripper" defaultOpen={false}>
          <p className="hint">Shown floating above the flipper for reference only.</p>
          <ModelFileField align={fixture.models.gripper} cadFiles={cadFiles} autoLabel="Auto (bundled TSA gripper)" onChange={modelFile("gripper")} />
          <AlignmentFields align={fixture.models.gripper} onChange={(mut) => update((j) => mut(j.fixture.models.gripper))} />
        </Section>
      </div>
    </div>
  );
}
