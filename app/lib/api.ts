/**
 * Client API centralisé.
 *
 * Remplace les 5 occurrences de "http://localhost:8000" en dur qui existaient
 * dans page.tsx par NEXT_PUBLIC_API_URL, et adapte le contrat : l'API ne
 * renvoie plus l'image directement dans la réponse POST (elle bloquait le
 * process serveur le temps de l'inférence), mais un job qu'on poll jusqu'à
 * ce qu'il soit terminé — voir app/routes/jobs.py côté backend.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

export type JobStatus = "queued" | "running" | "done" | "failed" | "rejected";

export interface Job {
  id: string;
  mode: string;
  prompt: string;
  status: JobStatus;
  image_url: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  return API_KEY ? { ...extra, "X-API-Key": API_KEY } : extra;
}

async function parseJobResponse(res: Response): Promise<Job> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Erreur serveur (${res.status})`);
  }
  return res.json();
}

export async function submitTextJob(prompt: string, steps: number, turbo: boolean): Promise<Job> {
  const res = await fetch(`${API_URL}/jobs/text`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ character_name: prompt, steps, turbo_mode: turbo }),
  });
  return parseJobResponse(res);
}

export async function submitImageJob(path: "img2img" | "pose" | "inpaint", formData: FormData): Promise<Job> {
  const res = await fetch(`${API_URL}/jobs/${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  return parseJobResponse(res);
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${API_URL}/jobs/${id}`, { headers: authHeaders() });
  return parseJobResponse(res);
}

export async function listJobs(limit = 60): Promise<Job[]> {
  const res = await fetch(`${API_URL}/jobs?limit=${limit}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

const TERMINAL_STATUSES: JobStatus[] = ["done", "failed", "rejected"];

/** Interroge GET /jobs/{id} jusqu'à ce que le job atteigne un statut terminal. */
export async function pollJob(id: string): Promise<Job> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const job = await getJob(id);
    if (TERMINAL_STATUSES.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Délai dépassé en attendant la génération.");
}

/** Télécharge une image distante via un blob local, pour que l'attribut `download` fonctionne
 * même si l'image vient d'une autre origine (API séparée ou CDN). */
export async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}
