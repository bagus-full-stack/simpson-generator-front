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

const CLIENT_ID_KEY = "simpsons.clientId";
let memoryClientId: string | null = null; // si localStorage est indisponible : l'id vit le temps de l'onglet

/** Identifiant secret de ce navigateur : le back ne liste que les jobs créés avec lui. */
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return (memoryClientId ??= crypto.randomUUID());
  }
}

/** Reprend l'identifiant d'un autre appareil (lien `?code=`) pour y retrouver ses créations. */
export function adoptClientId(id: string): void {
  if (!/^[\w-]{8,64}$/.test(id)) return;
  memoryClientId = id;
  try { localStorage.setItem(CLIENT_ID_KEY, id); } catch { /* idem */ }
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const headers: Record<string, string> = { ...(extra as Record<string, string>), "X-Client-Id": getClientId() };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

async function parseJobResponse(res: Response): Promise<Job> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // FastAPI renvoie `detail` en liste d'objets pour une erreur de validation (422) : pas un texte.
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new Error(detail || (res.status === 422 ? "Requête invalide (vérifiez la description)." : `Erreur serveur (${res.status})`));
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
// Large : un job peut attendre derrière d'autres dans la file du serveur (un seul à la fois),
// et sur un serveur CPU une génération dure ~7 min.
const POLL_TIMEOUT_MS = 900_000;

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
