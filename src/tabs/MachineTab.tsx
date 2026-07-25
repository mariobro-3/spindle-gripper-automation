import { useState } from "react";
import { useApp } from "../store";
import { createMachineProfile } from "../defaults";
import { machineOf } from "../logic/program";
import { CheckField, NumField, Section, SelectField, TextField } from "../ui";
import type { MachineProfile } from "../types";

function uniqueMachineId(existing: MachineProfile[]): string {
  let n = existing.length + 1;
  let id = `machine-${n}`;
  while (existing.some((m) => m.id === id)) {
    n += 1;
    id = `machine-${n}`;
  }
  return id;
}

/** Matches the built-in Haas labels: "VF-3SS (Pre-NGC)", etc. */
function controlInParens(control: string): string {
  if (control === "ngc") return "NGC";
  if (control === "pre-ngc") return "Pre-NGC";
  return control;
}

export function MachineTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const machine = machineOf(job);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newControlChoice, setNewControlChoice] = useState<"" | "ngc" | "pre-ngc" | "other">("");
  const [otherControl, setOtherControl] = useState("");

  const upd = (mut: (m: MachineProfile) => void) =>
    update((j) => {
      const m = j.machines.find((x) => x.id === j.machineId);
      if (m) mut(m);
    });

  const startAdd = () => {
    setNewName("");
    setNewControlChoice("");
    setOtherControl("");
    setAdding(true);
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewName("");
    setNewControlChoice("");
    setOtherControl("");
  };

  const resolvedControl =
    newControlChoice === "other" ? otherControl.trim() : newControlChoice;

  const confirmAdd = () => {
    const name = newName.trim();
    if (!name || !resolvedControl) return;
    const label = `${name} (${controlInParens(resolvedControl)})`;
    update((j) => {
      const profile = createMachineProfile(uniqueMachineId(j.machines), label, resolvedControl);
      j.machines.push(profile);
      j.machineId = profile.id;
    });
    cancelAdd();
  };

  const deleteMachine = () =>
    update((j) => {
      if (j.machines.length <= 1) return;
      const idx = j.machines.findIndex((x) => x.id === j.machineId);
      if (idx < 0) return;
      j.machines.splice(idx, 1);
      j.machineId = j.machines[Math.max(0, idx - 1)].id;
    });

  const teed = machine.mcodes.flipGripMode === "shared-vise1";
  const canConfirmAdd = newName.trim().length > 0 && resolvedControl.length > 0;

  return (
    <div className="page narrow">
      <h2>Machine Configuration</h2>
      <div className="row">
        <div className="col">
          <Section title="Machine">
            <SelectField
              label="Active machine"
              value={job.machineId}
              options={job.machines.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => {
                cancelAdd();
                update((j) => (j.machineId = v));
              }}
            />
            {!adding ? (
              <>
                <div className="btnrow">
                  <button className="btn" onClick={startAdd}>
                    Add New Machine
                  </button>
                  <button
                    className="btn danger"
                    onClick={deleteMachine}
                    disabled={job.machines.length <= 1}
                    title={job.machines.length <= 1 ? "At least one machine is required" : "Delete the active machine"}
                  >
                    Delete Machine
                  </button>
                </div>
                <p className="hint">
                  Select a machine to edit its bed size, M-codes, tools, and feeds below. Settings are stored per
                  machine and saved with the job.
                </p>
              </>
            ) : (
              <>
                <TextField label="Name" value={newName} wide onChange={setNewName} title="Display name for the new machine" />
                <SelectField
                  label="Control"
                  value={newControlChoice}
                  options={[
                    { value: "", label: "Select control..." },
                    { value: "ngc", label: "Next Generation Control (NGC)" },
                    { value: "pre-ngc", label: "Pre-NGC" },
                    { value: "other", label: "Other..." },
                  ]}
                  onChange={setNewControlChoice}
                />
                {newControlChoice === "other" && (
                  <TextField
                    label="Control name"
                    value={otherControl}
                    wide
                    onChange={setOtherControl}
                    title="Type the control type name"
                  />
                )}
                <div className="btnrow">
                  <button className="btn primary" onClick={confirmAdd} disabled={!canConfirmAdd}>
                    Add Machine
                  </button>
                  <button className="btn" onClick={cancelAdd}>
                    Cancel
                  </button>
                </div>
                <p className="hint">
                  Enter a name and control type, then click Add Machine. NGC seeds Dual Programmable Air M-codes;
                  Pre-NGC and Other start from Gimbel example codes - edit them below after adding.
                </p>
              </>
            )}
          </Section>
          <Section title="Machine Bed">
            <NumField label="Bed length (X)" value={machine.bedLength} step={1} unit="in" onChange={(v) => upd((m) => (m.bedLength = v))} />
            <NumField label="Bed width (Y)" value={machine.bedWidth} step={1} unit="in" onChange={(v) => upd((m) => (m.bedWidth = v))} />
            <NumField
              label="T-slot width"
              value={machine.tSlotWidth}
              step={0.001}
              unit="in"
              title="Opening width of each T-slot (Haas 16mm ≈ 0.63 in)"
              onChange={(v) => upd((m) => (m.tSlotWidth = v))}
            />
            <NumField
              label="T-slot spacing"
              value={machine.tSlotSpacing}
              step={0.01}
              unit="in"
              title="Center-to-center distance between T-slots along Y"
              onChange={(v) => upd((m) => (m.tSlotSpacing = v))}
            />
            <NumField
              label="Number of T-slots"
              value={machine.tSlotCount}
              step={1}
              min={0}
              title="Slots are centered on the bed width and run the length of the table (X)"
              onChange={(v) => upd((m) => (m.tSlotCount = Math.max(0, Math.round(v))))}
            />
            <p className="hint">
              Gray area in Fixture Setup = table, X0 to -{machine.bedLength}, Y0 to -{machine.bedWidth} (Haas:
              machine zero at back-right). T-slots run along X, spaced across Y, centered on the bed. Haas
              defaults: VF-3SS/VF-4SS = 0.63&quot; × 3.15&quot; × 5; VF-9SS = 0.63&quot; × 4.92&quot; × 7. Tray generator can
              auto-place mount holes on slots the tray covers.
            </p>
          </Section>
          <Section title="Gripper (through-spindle air)">
            <TextField label="Gripper close" value={machine.mcodes.gripperClose} onChange={(v) => upd((m) => (m.mcodes.gripperClose = v))} />
            <TextField label="Gripper open" value={machine.mcodes.gripperOpen} onChange={(v) => upd((m) => (m.mcodes.gripperOpen = v))} />
            <NumField label="Gripper tool number" value={machine.gripperTool} step={1} onChange={(v) => upd((m) => (m.gripperTool = Math.round(v)))} />
            <NumField label="Gripper H offset" value={machine.gripperH} step={1} onChange={(v) => upd((m) => (m.gripperH = Math.round(v)))} />
            <CheckField
              label="Different gripper for Op2 side"
              value={machine.gripper2Enabled}
              title="Use a second gripper tool for the flipped part: unload flipper, load/unload vise 2, and finished deposit"
              onChange={(v) => upd((m) => (m.gripper2Enabled = v))}
            />
            {machine.gripper2Enabled && (
              <>
                <NumField label="Op2 gripper tool number" value={machine.gripper2Tool} step={1} onChange={(v) => upd((m) => (m.gripper2Tool = Math.round(v)))} />
                <NumField label="Op2 gripper H offset" value={machine.gripper2H} step={1} onChange={(v) => upd((m) => (m.gripper2H = Math.round(v)))} />
                <p className="hint">
                  The op1 gripper (T{machine.gripperTool}) handles raw stock and the op1 part; the op2 gripper
                  (T{machine.gripper2Tool}) takes over at the flipper and handles the flipped part through vise 2
                  and the finished drop. The generator adds the extra tool changes automatically.
                </p>
              </>
            )}
          </Section>
          <Section title="Air Vises">
            <TextField label="Vise 1 (Op1) close" value={machine.mcodes.vise1Close} onChange={(v) => upd((m) => (m.mcodes.vise1Close = v))} />
            <TextField label="Vise 1 (Op1) open" value={machine.mcodes.vise1Open} onChange={(v) => upd((m) => (m.mcodes.vise1Open = v))} />
            <TextField label="Vise 2 (Op2) close" value={machine.mcodes.vise2Close} onChange={(v) => upd((m) => (m.mcodes.vise2Close = v))} />
            <TextField label="Vise 2 (Op2) open" value={machine.mcodes.vise2Open} onChange={(v) => upd((m) => (m.mcodes.vise2Open = v))} />
          </Section>
        </div>
        <div className="col">
          <Section title="Flipper (QuickFlip180)">
            <TextField label="Rotate CW" value={machine.mcodes.flipCW} onChange={(v) => upd((m) => (m.mcodes.flipCW = v))} />
            <TextField label="Rotate CCW" value={machine.mcodes.flipCCW} onChange={(v) => upd((m) => (m.mcodes.flipCCW = v))} />
            <SelectField
              label="Flipper grip air supply"
              value={machine.mcodes.flipGripMode}
              options={[
                { value: "dedicated", label: "Own solenoid / M-codes" },
                { value: "shared-vise1", label: "Teed to Vise 1 line" },
              ]}
              onChange={(v) => upd((m) => (m.mcodes.flipGripMode = v))}
            />
            {teed ? (
              <p className="hint">
                The flipper grip fingers share the Vise 1 air lines: <b>{machine.mcodes.vise1Close}</b> clamps
                both, <b>{machine.mcodes.vise1Open}</b> releases both. The program generator sequences the cycle
                around this and re-clamps Vise 1 after unloading the flipper.
              </p>
            ) : (
              <>
                <TextField label="Flipper grip close (on)" value={machine.mcodes.flipGripClose} onChange={(v) => upd((m) => (m.mcodes.flipGripClose = v))} />
                <TextField label="Flipper grip open (off)" value={machine.mcodes.flipGripOpen} onChange={(v) => upd((m) => (m.mcodes.flipGripOpen = v))} />
                <p className="hint">
                  Use this when the grip runs on its own one-way solenoid - e.g. teed to the Haas tool air
                  blast: <b>M116</b> on (grip closed), <b>M117</b> off (grip open).
                </p>
              </>
            )}
          </Section>
          <Section title="Chip Fan">
            <CheckField
              label="Haas chip fan table wash (N210)"
              value={machine.chipFanEnabled}
              title="Runs the chip fan program (from FAN.nc) after each machining block, before the gripper grabs parts"
              onChange={(v) => upd((m) => (m.chipFanEnabled = v))}
            />
            <NumField label="Chip fan tool number" value={machine.chipFanTool} step={1} onChange={(v) => upd((m) => (m.chipFanTool = Math.round(v)))} />
            <NumField label="Chip fan H offset" value={machine.chipFanH} step={1} onChange={(v) => upd((m) => (m.chipFanH = Math.round(v)))} />
            <p className="hint">
              {machine.chipFanEnabled
                ? "The table wash program is inserted before every part-handling sequence. Edit the wash pass in the Program Builder's Chip Fan section."
                : "Off - no chip fan wash is inserted. The wash program itself is editable in the Program Builder's Chip Fan section."}
            </p>
          </Section>
          <Section title="Default Feeds">
            <NumField label="Positioning feed" value={machine.positionFeed} step={10} unit="ipm" onChange={(v) => upd((m) => (m.positionFeed = v))} />
            <NumField label="Approach feed" value={machine.approachFeed} step={10} unit="ipm" onChange={(v) => upd((m) => (m.approachFeed = v))} />
            <NumField label="Insert / grip feed" value={machine.insertFeed} step={5} unit="ipm" onChange={(v) => upd((m) => (m.insertFeed = v))} />
          </Section>
          <div className="warnbox">
            Air circuit summary: vise 1 and vise 2 each on a two-way solenoid
            ({machine.mcodes.vise1Close}/{machine.mcodes.vise1Open} and {machine.mcodes.vise2Close}/
            {machine.mcodes.vise2Open}), flipper grip{" "}
            {teed
              ? `teed to the vise 1 line`
              : `on the one-way solenoid ${machine.mcodes.flipGripClose} on / ${machine.mcodes.flipGripOpen} off`}
            , flipper rotation on {machine.mcodes.flipCW} / {machine.mcodes.flipCCW}.
          </div>
        </div>
      </div>
    </div>
  );
}
