import { useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { buildProgram, sanitizeNc, tokenValues, machineOf } from "../logic/program";
import { defaultTemplates } from "../defaults";
import { CheckField, NumField, Section, SelectField, TextField } from "../ui";
import { downloadText } from "../download";
import type { TemplateKey } from "../types";

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  beginning: "Beginning code",
  loadVise1: "N200 - Load vise 1 (tray retrieval + deposit)",
  chipClear: "N201 - Chip clearing",
  chipFan: "N210 - Haas chip fan table wash",
  unloadVise1: "N202 - Unload vise 1 (op1 part)",
  depositFinished: "N203 - Deposit finished part",
  loadFlipper: "N204 - Load flipper + close grip",
  flipCCW: "N205 - Rotate flipper CCW",
  unloadVise2: "N206 - Unload vise 2 (finished part)",
  unloadFlipper: "N207 - Unload flipper (flipped part)",
  loadVise2: "N208 - Load vise 2",
  flipCW: "N209 - Rotate flipper CW + re-clamp",
  ending: "Ending code",
};

function OpInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sanitized = useMemo(() => sanitizeNc(value), [value]);
  return (
    <Section title={label}>
      <div className="btnrow">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Load file...
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".nc,.gcode,.tap,.txt,.mpf,.mpt,.hnc,.gcd,.eia"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange(await f.text());
            e.target.value = "";
          }}
        />
        {value && (
          <button className="btn danger" onClick={() => onChange("")}>
            Clear
          </button>
        )}
        <span className="hint">{value ? `${value.split("\n").length} lines loaded` : "paste or load posted CAM code"}</span>
      </div>
      <textarea
        className="code"
        rows={8}
        placeholder="(paste posted G-code here)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {sanitized.flagged.length > 0 && (
        <>
          <p className="hint">
            Sanitizer will change {sanitized.flagged.length} line(s) when the program is built (original text is
            left untouched here):
          </p>
          <div className="flagged-list">
            {sanitized.flagged.map((f, i) => (
              <div key={i} className={f.action === "removed" ? "rm" : "mod"}>
                L{f.lineNo}: {f.action === "removed" ? "-- " : "~~ "}
                {f.original.trim() || "(blank)"} &nbsp;({f.reason})
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function BuilderTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const [result, setResult] = useState<ReturnType<typeof buildProgram> | null>(null);
  const [editTemplate, setEditTemplate] = useState<TemplateKey>("loadVise1");

  const machine = machineOf(job);
  const tokens = tokenValues(job);
  const tokenList = Object.keys(tokens)
    .map((t) => `{${t}}`)
    .join("  ");

  const build = () => setResult(buildProgram(job));

  return (
    <div className="page">
      <h2>Program Builder</h2>
      <div className="row">
        <div className="col">
          <OpInput label="Op1 NC Code (machines in Vise 1)" value={job.op1Code} onChange={(v) => update((j) => (j.op1Code = v))} />
          <OpInput label="Op2 NC Code (machines in Vise 2)" value={job.op2Code} onChange={(v) => update((j) => (j.op2Code = v))} />
          <Section title="Program Options">
            <TextField label="Program number" value={job.options.programNumber} onChange={(v) => update((j) => (j.options.programNumber = v))} />
            <TextField label="Program comment" value={job.options.programComment} onChange={(v) => update((j) => (j.options.programComment = v))} />
            <CheckField label="Chip clearing between parts (N201)" value={job.options.useChipClear} onChange={(v) => update((j) => (j.options.useChipClear = v))} />
            <CheckField
              label="Include G10 offset lines in header"
              value={job.options.includeG10}
              title="Embeds the computed work offsets so the control is set from the program"
              onChange={(v) => update((j) => (j.options.includeG10 = v))}
            />
            <NumField
              label="Op1 facing removal"
              value={job.options.faceRemovalOp1}
              step={0.005}
              unit="in"
              title="Material faced off the top in Op1 - the gripper reaches this much lower when regripping (Gimbel's facing compensation)"
              onChange={(v) => update((j) => (j.options.faceRemovalOp1 = v))}
            />
          </Section>
          <Section title="Chip Fan Table Wash (N210)" defaultOpen={false}>
            {machine.chipFanEnabled ? (
              <p className="hint">
                <b>On</b> for {machine.label} (tool T{machine.chipFanTool}, H{machine.chipFanH}) - this wash
                program runs after each machining block, right before the gripper goes out to grab parts.
                Turn it off on the Machine Config page.
              </p>
            ) : (
              <p className="hint">
                <b>Off</b> for {machine.label} - the wash is not inserted into the program. Turn it on in the
                Chip Fan section of the Machine Config page.
              </p>
            )}
            <textarea
              className="code"
              rows={12}
              value={job.templates.chipFan}
              spellCheck={false}
              onChange={(e) => update((j) => (j.templates.chipFan = e.target.value))}
            />
            <div className="btnrow">
              <button className="btn danger" onClick={() => update((j) => (j.templates.chipFan = defaultTemplates.chipFan))}>
                Reset to FAN.nc default
              </button>
            </div>
            <p className="hint">
              Seeded from <b>NC add-ins\FAN.nc</b> (Haas chip fan table wash): fan up to S5000, one pass X0
              &rarr; X5 at Z3. above the vise 1 offset, F50. The O-number, M30 and the G53 Y0 table-forward
              move from the original file are omitted so it can run mid-cycle as an M97 macro.
            </p>
          </Section>
          <Section title="Macro Templates (advanced)" defaultOpen={false}>
            <p className="hint">
              Templates are seeded from Gimbel's published M97 generator code. Tokens are replaced at build time
              from the machine profile ({machine.label}). When Gimbel provides an official template, paste it
              here.
            </p>
            <SelectField
              label="Template"
              value={editTemplate}
              options={(Object.keys(TEMPLATE_LABELS) as TemplateKey[])
                .filter((k) => k !== "chipFan")
                .map((k) => ({ value: k, label: TEMPLATE_LABELS[k] }))}
              onChange={setEditTemplate}
            />
            <textarea
              className="code"
              rows={14}
              value={job.templates[editTemplate]}
              spellCheck={false}
              onChange={(e) => update((j) => (j.templates[editTemplate] = e.target.value))}
            />
            <div className="btnrow">
              <button className="btn danger" onClick={() => update((j) => (j.templates[editTemplate] = defaultTemplates[editTemplate]))}>
                Reset this template to default
              </button>
            </div>
            <p className="hint" style={{ wordBreak: "break-all" }}>
              Available tokens: {tokenList}
            </p>
          </Section>
        </div>
        <div className="col">
          <div className="btnrow">
            <button className="btn primary" onClick={build}>
              Build Program
            </button>
            {result && (
              <button
                className="btn"
                onClick={() => downloadText(`${job.options.programNumber.replace(/^O/i, "O")}-${job.name.replace(/\s+/g, "_")}.nc`, result.program)}
              >
                Download .nc
              </button>
            )}
            {result && (
              <button className="btn" onClick={() => void navigator.clipboard.writeText(result.program)}>
                Copy to clipboard
              </button>
            )}
          </div>
          {result && result.warnings.length > 0 && (
            <div className="warnbox">
              <b>Warnings:</b>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {result && result.warnings.length === 0 && (
            <div className="okbox">
              Program built clean: {result.pocketCount} parts through the full two-op flip cycle.
            </div>
          )}
          {result ? (
            <pre className="code" style={{ maxHeight: "calc(100vh - 260px)" }}>
              {result.program}
            </pre>
          ) : (
            <p className="hint">
              The build assembles your exact cycle order per pocket: unload vise 1 &rarr; load flipper &rarr;
              rotate CCW &rarr; unload vise 2 to {job.finished.mode} &rarr; load vise 1 from tray &rarr; unload
              flipper &rarr; load vise 2 &rarr; rotate CW &rarr; machine Op1 + Op2 &mdash; with prime and drain
              cycles handled automatically at the start and end of the tray.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
