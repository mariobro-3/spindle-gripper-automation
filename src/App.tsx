import { useState } from "react";
import { useApp } from "./store";
import { FixtureTab } from "./tabs/FixtureTab";
import { OffsetsTab } from "./tabs/OffsetsTab";
import { MachineTab } from "./tabs/MachineTab";
import { TraysTab } from "./tabs/TraysTab";
import { TrayGenTab } from "./tabs/TrayGenTab";
import { BuilderTab } from "./tabs/BuilderTab";
import { JobsTab } from "./tabs/JobsTab";

const TABS = [
  { id: "fixture", label: "Fixture Setup" },
  { id: "offsets", label: "Datum & Offsets" },
  { id: "machine", label: "Machine Config" },
  { id: "trays", label: "Trays & Stock" },
  { id: "traygen", label: "Tray Generator" },
  { id: "builder", label: "Program Builder" },
  { id: "jobs", label: "Jobs" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("fixture");
  const jobName = useApp((s) => s.job.name);
  const dirty = useApp((s) => s.dirty);

  return (
    <div className="app">
      <div className="header">
        <h1>SPINDLE GRIPPER AUTOMATION</h1>
        <span className="jobname">
          {jobName}
          {dirty && <span className="dirty"> *</span>}
        </span>
        <span className="spacer" />
        <div className="header-credit" title="Miltech Manufacturing">
          <span className="header-credit-text">made by Cole Studer · Miltech Manufacturing</span>
          <img src="/miltech-logo.png" alt="" className="header-credit-logo" />
        </div>
      </div>
      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === "fixture" && <FixtureTab />}
        {tab === "offsets" && <OffsetsTab />}
        {tab === "machine" && <MachineTab />}
        {tab === "trays" && <TraysTab />}
        {tab === "traygen" && <TrayGenTab />}
        {tab === "builder" && <BuilderTab />}
        {tab === "jobs" && <JobsTab />}
      </div>
    </div>
  );
}
