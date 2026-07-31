import { useApp } from "../store";
import { Viewer } from "../viewer/Viewer";
import { NumField, ResizablePanel, Section, SelectField } from "../ui";
import type { TrayConfig } from "../types";

function TrayFields({
  tray,
  onChange,
}: {
  tray: TrayConfig;
  onChange: (mut: (t: TrayConfig) => void) => void;
}) {
  return (
    <>
      <NumField
        label="First pocket machine X"
        value={tray.firstPocketX}
        unit="in"
        title="Machine coordinate of the bottom-left pocket center (Gimbel 'Tray First Pocket')"
        onChange={(v) => onChange((t) => (t.firstPocketX = v))}
      />
      <NumField label="First pocket machine Y" value={tray.firstPocketY} unit="in" onChange={(v) => onChange((t) => (t.firstPocketY = v))} />
      <NumField label="Pockets in X" value={tray.countX} step={1} min={1} onChange={(v) => onChange((t) => (t.countX = Math.max(1, Math.round(v))))} />
      <NumField label="Pockets in Y" value={tray.countY} step={1} min={1} onChange={(v) => onChange((t) => (t.countY = Math.max(1, Math.round(v))))} />
      <NumField label="Pitch X" value={tray.pitchX} unit="in" onChange={(v) => onChange((t) => (t.pitchX = v))} />
      <NumField label="Pitch Y" value={tray.pitchY} unit="in" onChange={(v) => onChange((t) => (t.pitchY = v))} />
    </>
  );
}

export function TraysTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const totalPockets = job.stockTray.countX * job.stockTray.countY;

  return (
    <div className="split">
      <div className="viewer-side">
        <Viewer />
      </div>
      <ResizablePanel>
        <Section title="Raw Stock">
          <NumField label="Length (X)" value={job.stock.length} unit="in" onChange={(v) => update((j) => (j.stock.length = v))} />
          <NumField label="Width (Y)" value={job.stock.width} unit="in" onChange={(v) => update((j) => (j.stock.width = v))} />
          <NumField label="Height (Z)" value={job.stock.height} unit="in" onChange={(v) => update((j) => (j.stock.height = v))} />
        </Section>
        <Section title={`Stock Tray (${totalPockets} pockets)`}>
          <p className="hint">
            Pocket positions follow Gimbel's first-pocket matrix: the tray WCS X0 Y0 is the bottom-left pocket,
            and the program steps through the grid by pitch.
          </p>
          <TrayFields tray={job.stockTray} onChange={(mut) => update((j) => mut(j.stockTray))} />
        </Section>
        <Section title="Finished Parts Destination">
          <SelectField
            label="Destination"
            value={job.finished.mode}
            options={[
              { value: "bin", label: "Bin (drop parts)" },
              { value: "tray", label: "Finished parts tray" },
            ]}
            onChange={(v) => update((j) => (j.finished.mode = v))}
          />
          {job.finished.mode === "bin" ? (
            <>
              <NumField label="Bin center machine X" value={job.finished.bin.x} unit="in" onChange={(v) => update((j) => (j.finished.bin.x = v))} />
              <NumField label="Bin center machine Y" value={job.finished.bin.y} unit="in" onChange={(v) => update((j) => (j.finished.bin.y = v))} />
              <NumField label="Bin length (X)" value={job.finished.bin.length} unit="in" onChange={(v) => update((j) => (j.finished.bin.length = v))} />
              <NumField label="Bin width (Y)" value={job.finished.bin.width} unit="in" onChange={(v) => update((j) => (j.finished.bin.width = v))} />
              <NumField label="Bin height (Z)" value={job.finished.bin.height} unit="in" onChange={(v) => update((j) => (j.finished.bin.height = v))} />
              <NumField
                label="Drop height above bin WCS Z0"
                value={job.finished.bin.dropZ}
                unit="in"
                title="The gripper lowers to this Z in the finished WCS before releasing the part"
                onChange={(v) => update((j) => (j.finished.bin.dropZ = v))}
              />
            </>
          ) : (
            <TrayFields tray={job.finished.tray} onChange={(mut) => update((j) => mut(j.finished.tray))} />
          )}
        </Section>
      </ResizablePanel>
    </div>
  );
}
