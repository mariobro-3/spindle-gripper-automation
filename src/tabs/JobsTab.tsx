import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { deleteJobFile, listJobs, loadJobFile, saveJobFile, type JobListEntry } from "../api";
import { TextField } from "../ui";
import { downloadText } from "../download";

export function JobsTab() {
  const job = useApp((s) => s.job);
  const update = useApp((s) => s.update);
  const loadJob = useApp((s) => s.loadJob);
  const resetJob = useApp((s) => s.resetJob);
  const markSaved = useApp((s) => s.markSaved);
  const [jobs, setJobs] = useState<JobListEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    listJobs()
      .then(setJobs)
      .catch(() => setStatus("Could not reach the local server for the jobs folder."));
  };
  useEffect(refresh, []);

  const save = async () => {
    try {
      await saveJobFile(job.name, job);
      markSaved();
      setStatus(`Saved "${job.name}" to the jobs folder.`);
      refresh();
    } catch (e) {
      setStatus(`Save failed: ${e}`);
    }
  };

  return (
    <div className="page narrow">
      <h2>Jobs</h2>
      <p className="hint">
        A job stores everything: machine profiles and M-codes, fixture spacing, datum, trays, stock, bin,
        templates, and the loaded Op1/Op2 code. Jobs save as JSON files in the <code>jobs/</code> folder next to
        the app. Your work also autosaves to the browser between sessions.
      </p>
      <div className="btnrow">
        <TextField label="Job name" value={job.name} onChange={(v) => update((j) => (j.name = v))} width={260} />
        <button className="btn primary" onClick={() => void save()}>
          Save job
        </button>
        <button className="btn" onClick={() => downloadText(`${job.name.replace(/\s+/g, "_")}.json`, JSON.stringify(job, null, 2), "application/json")}>
          Export JSON
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import JSON...
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                loadJob(JSON.parse(await f.text()));
                setStatus(`Imported "${f.name}".`);
              } catch (err) {
                setStatus(`Import failed: ${err}`);
              }
            }
            e.target.value = "";
          }}
        />
        <button
          className="btn danger"
          onClick={() => {
            if (confirm("Reset everything to defaults? Unsaved changes will be lost.")) resetJob();
          }}
        >
          New job (reset)
        </button>
      </div>
      {status && <div className="okbox">{status}</div>}
      <h3>Saved jobs</h3>
      {jobs.length === 0 && <p className="hint">No saved jobs yet.</p>}
      <ul className="joblist">
        {jobs.map((j) => (
          <li key={j.name}>
            <span className="name">{j.name}</span>
            <span className="date">{new Date(j.modified).toLocaleString()}</span>
            <button
              className="btn"
              onClick={async () => {
                try {
                  loadJob(await loadJobFile(j.name));
                  setStatus(`Loaded "${j.name}".`);
                } catch (e) {
                  setStatus(`Load failed: ${e}`);
                }
              }}
            >
              Load
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (confirm(`Delete job "${j.name}"?`)) {
                  await deleteJobFile(j.name);
                  refresh();
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
