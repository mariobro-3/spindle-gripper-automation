import type { JobConfig } from "./types";

export interface JobListEntry {
  name: string;
  modified: number;
}

export async function listJobs(): Promise<JobListEntry[]> {
  const res = await fetch("/api/jobs");
  if (!res.ok) throw new Error("failed to list jobs");
  return res.json();
}

export async function loadJobFile(name: string): Promise<Partial<JobConfig>> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`job "${name}" not found`);
  return res.json();
}

export async function saveJobFile(name: string, job: JobConfig): Promise<void> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job, null, 2),
  });
  if (!res.ok) throw new Error("failed to save job");
}

export async function deleteJobFile(name: string): Promise<void> {
  await fetch(`/api/jobs/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function listCadFiles(): Promise<string[]> {
  const res = await fetch("/api/cad");
  if (!res.ok) return [];
  return res.json();
}

export function cadFileUrl(relPath: string): string {
  return `/cad/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Upload a user STEP file into the CAD library. Returns its relative path. */
export async function uploadCadFile(name: string, data: ArrayBuffer): Promise<string> {
  const res = await fetch(`/api/cad/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
  if (!res.ok) throw new Error("failed to upload STEP file");
  const body = (await res.json()) as { path: string };
  return body.path;
}
