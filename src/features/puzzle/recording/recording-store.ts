import type { RecordingSession } from "./game-recording";

const PREFIX = "tetris-predictor.recording";
const ACTIVE_KEY = `${PREFIX}.active`;
const INDEX_KEY = `${PREFIX}.sessions`;
const sessionKey = (id: string) => `${PREFIX}.session.${id}`;

/** Served by the dev server (see `recordingsPlugin` in vite.config.ts); writes `recordings/<id>.json`. */
export const RECORDINGS_ENDPOINT = "/__recordings";

export type DiskStatus = "saved" | "unavailable" | "error";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function listSessionIds(): string[] {
  return read<string[]>(INDEX_KEY) ?? [];
}

export function loadSession(id: string): RecordingSession | null {
  return read<RecordingSession>(sessionKey(id));
}

export function loadAllSessions(): RecordingSession[] {
  return listSessionIds().flatMap((id) => loadSession(id) ?? []);
}

export function activeSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Without storage the session still records in memory and to disk.
  }
}

/** Saves to browser storage. Returns false when storage is unavailable or full. */
export function saveSessionLocally(session: RecordingSession): boolean {
  try {
    localStorage.setItem(sessionKey(session.id), JSON.stringify(session));
    const ids = listSessionIds();
    if (!ids.includes(session.id)) localStorage.setItem(INDEX_KEY, JSON.stringify([...ids, session.id]));
    return true;
  } catch {
    return false;
  }
}

let diskQueue: Promise<unknown> = Promise.resolve();

/** Best effort: only the dev server accepts recordings. Saves run in order, so the newest wins. */
export function saveSessionToDisk(session: RecordingSession): Promise<DiskStatus> {
  const saved = diskQueue.then(() => postSession(session));
  diskQueue = saved;
  return saved;
}

async function postSession(session: RecordingSession): Promise<DiskStatus> {
  try {
    const response = await fetch(`${RECORDINGS_ENDPOINT}/${encodeURIComponent(session.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    });
    if (response.ok) return "saved";
    return response.status === 404 ? "unavailable" : "error";
  } catch {
    return "unavailable";
  }
}

export function deleteAllSessions(): void {
  try {
    for (const id of listSessionIds()) localStorage.removeItem(sessionKey(id));
    localStorage.removeItem(INDEX_KEY);
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Nothing stored.
  }
}

export function downloadSessions(sessions: RecordingSession[]): void {
  const payload = { exportedAt: new Date().toISOString(), sessions };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tetris-recordings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
