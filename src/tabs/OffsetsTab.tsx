import { useApp } from "../store";
import { STATION_INFO, wcsConflicts } from "../logic/offsets";
import { NumField, Section, SelectField } from "../ui";
import type { WcsCode } from "../types";

const WCS_OPTIONS: { value: WcsCode; label: WcsCode }[] = (["G54", "G55", "G56", "G57", "G58", "G59"] as WcsCode[]).map(
  (w) => ({ value: w, label: w })
);

export function OffsetsTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const conflicts = wcsConflicts(job);

  return (
    <div className="page narrow">
      <h2>Datum &amp; Work Offsets</h2>
      <div className="row">
        <div className="col">
          <Section title="Base Plate Datum">
            <p className="hint">
              The datum places the whole fixture assembly (plate, vises, flipper) on the bed in the 3D
              viewer. Pick which point of the plate you reference and where it sits in machine coordinates.
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
              Work offset coordinates are typed directly into the Offset Sheet on the Fixture Setup page.
            </p>
          </Section>
        </div>
        <div className="col">
          <Section title="WCS Assignments">
            {STATION_INFO.map((info) => (
              <SelectField
                key={info.station}
                label={info.label}
                value={job.wcs[info.station]}
                options={WCS_OPTIONS}
                onChange={(v) => update((j) => (j.wcs[info.station] = v))}
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
          <Section title="Spindle Orientation at Each Station">
            <p className="hint">
              Gripper jaw direction (M19) at each work offset. Enable/disable and set the tray and finished
              drop angles in Program Builder &gt; Spindle Orientation -{" "}
              {job.spindleOrient.enabled ? <b>currently on</b> : <b>currently off</b>}.
            </p>
            <NumField label="Vise 1 orient" value={job.spindleOrient.vise1} step={90} unit="deg" onChange={(v) => update((j) => (j.spindleOrient.vise1 = v))} />
            <NumField label="Flipper orient" value={job.spindleOrient.flipper} step={90} unit="deg" onChange={(v) => update((j) => (j.spindleOrient.flipper = v))} />
            <NumField label="Vise 2 orient" value={job.spindleOrient.vise2} step={90} unit="deg" onChange={(v) => update((j) => (j.spindleOrient.vise2 = v))} />
          </Section>
        </div>
      </div>
    </div>
  );
}
