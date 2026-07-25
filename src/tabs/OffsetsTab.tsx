import { useApp } from "../store";
import { computeOffsets, fmt, g10Lines, wcsConflicts } from "../logic/offsets";
import { NumField, Section, SelectField } from "../ui";
import type { StationKey, WcsCode } from "../types";
import { downloadText } from "../download";

const WCS_OPTIONS: { value: WcsCode; label: WcsCode }[] = (["G54", "G55", "G56", "G57", "G58", "G59"] as WcsCode[]).map(
  (w) => ({ value: w, label: w })
);

const Z_LABELS: Record<StationKey, string> = {
  vise1: "Vise 1 Z (bottom of stock, clamped)",
  flipper: "Flipper Z (bottom of part in grip)",
  vise2: "Vise 2 Z (bottom of part, clamped)",
  tray: "Tray Z (bottom of first pocket)",
  finished: "Finished Z (pocket bottom / drop ref)",
};

export function OffsetsTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const rows = computeOffsets(job);
  const conflicts = wcsConflicts(job);
  const g10 = g10Lines(job).join("\n");

  return (
    <div className="page narrow">
      <h2>Datum &amp; Work Offsets</h2>
      <div className="row">
        <div className="col">
          <Section title="Base Plate Datum">
            <p className="hint">
              Probe one point on the base plate and enter its machine coordinates. All vise and flipper offsets
              are computed from the spacings defined in Fixture Setup.
            </p>
            <SelectField
              label="Datum reference point"
              value={job.datum.ref}
              options={[
                { value: "front-left", label: "Front-left corner" },
                { value: "front-right", label: "Front-right corner" },
                { value: "back-left", label: "Back-left corner" },
                { value: "back-right", label: "Back-right corner" },
                { value: "center", label: "Plate center" },
              ]}
              onChange={(v) => update((j) => (j.datum.ref = v))}
            />
            <NumField label="Datum machine X" value={job.datum.machineX} unit="in" onChange={(v) => update((j) => (j.datum.machineX = v))} />
            <NumField label="Datum machine Y" value={job.datum.machineY} unit="in" onChange={(v) => update((j) => (j.datum.machineY = v))} />
            <NumField
              label="Rotation (CCW)"
              value={job.datum.rotation}
              step={90}
              unit="deg"
              title="Orientation of the whole fixture assembly on the bed, pivoting at the datum point"
              onChange={(v) => update((j) => (j.datum.rotation = v))}
            />
            <p className="hint">
              Rotation orients the whole fixture assembly on the bed, pivoting at the datum point. All
              station offsets below follow it automatically.
            </p>
          </Section>
          <Section title="Station Z Values (probed)">
            <p className="hint">Z values are probed individually per Gimbel's procedure and entered here for the offset sheet.</p>
            {(Object.keys(Z_LABELS) as StationKey[]).map((k) => (
              <NumField
                key={k}
                label={Z_LABELS[k]}
                value={job.datum.zValues[k]}
                unit="in"
                onChange={(v) => update((j) => (j.datum.zValues[k] = v))}
              />
            ))}
          </Section>
          <Section title="WCS Assignments">
            {rows.map((r) => (
              <SelectField
                key={r.station}
                label={r.label}
                value={job.wcs[r.station]}
                options={WCS_OPTIONS}
                onChange={(v) => update((j) => (j.wcs[r.station] = v))}
              />
            ))}
            {conflicts.length > 0 && (
              <div className="warnbox bad">
                {conflicts.map((c) => (
                  <div key={c.wcs}>
                    <b>{c.wcs}</b> is assigned to multiple stations: {c.stations.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
        <div className="col">
          <h3>Offset Sheet</h3>
          <table className="data">
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
              {rows.map((r) => (
                <tr key={r.station}>
                  <td className="wcs">{r.wcs}</td>
                  <td title={r.note}>{r.label}</td>
                  <td className="num">{fmt(r.x)}</td>
                  <td className="num">{fmt(r.y)}</td>
                  <td className="num">{fmt(r.z)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btnrow">
            <button className="btn" onClick={() => window.print()}>
              Print offset sheet
            </button>
            <button
              className="btn"
              onClick={() => {
                const lines = rows.map((r) => `${r.wcs}\t${r.label}\tX${fmt(r.x)}\tY${fmt(r.y)}\tZ${fmt(r.z)}`);
                void navigator.clipboard.writeText(lines.join("\n"));
              }}
            >
              Copy table
            </button>
          </div>
          <h3>G10 L2 Program Lines</h3>
          <p className="hint">
            Optionally set all work offsets from the program instead of typing them at the control. Enable
            "Include G10 offset lines" in the Program Builder to embed these automatically.
          </p>
          <pre className="code">{g10}</pre>
          <div className="btnrow">
            <button className="btn" onClick={() => void navigator.clipboard.writeText(g10)}>
              Copy G10 lines
            </button>
            <button className="btn" onClick={() => downloadText("set-offsets.nc", g10)}>
              Download .nc
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
