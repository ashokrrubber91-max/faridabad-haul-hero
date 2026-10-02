type QueueKind = "driver_location" | "pod_upload";

export type OfflineQueueItem = {
  id: string;
  kind: QueueKind;
  createdAt: number;
  attempts: number;
  payload: Record<string, unknown>;
  blob?: Blob;
  /** LocalStorage fallback cannot persist Blob objects, so keep a data URL copy. */
  blobDataUrl?: string;
};

const DB_NAME = "miniport-offline";
const STORE = "queue";
const KEY = "miniport-offline-queue-v1";
let flushing = false;

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not serialize offline file"));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueOffline(
  item: Omit<OfflineQueueItem, "id" | "createdAt" | "attempts">,
): Promise<string> {
  const row: OfflineQueueItem = { ...item, id: uuid(), createdAt: Date.now(), attempts: 0 };
  try {
    if (typeof indexedDB !== "undefined") {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      const rows = JSON.parse(localStorage.getItem(KEY) || "[]") as OfflineQueueItem[];
      const fallbackRow = { ...row, blob: undefined } as OfflineQueueItem;
      if (row.blob) fallbackRow.blobDataUrl = await blobToDataUrl(row.blob);
      rows.push(fallbackRow);
      localStorage.setItem(KEY, JSON.stringify(rows));
    }
  } catch {
    try {
      const rows = JSON.parse(localStorage.getItem(KEY) || "[]") as OfflineQueueItem[];
      const fallbackRow = { ...row, blob: undefined } as OfflineQueueItem;
      if (row.blob) fallbackRow.blobDataUrl = await blobToDataUrl(row.blob);
      rows.push(fallbackRow);
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch {}
  }
  return row.id;
}

export async function listOfflineQueue(): Promise<OfflineQueueItem[]> {
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openDb();
      return await new Promise<OfflineQueueItem[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result || []) as OfflineQueueItem[]);
        req.onerror = () => reject(req.error);
      });
    } catch {}
  }
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]") as OfflineQueueItem[];
    return await Promise.all(
      rows.map(async (row) => {
        if (!row.blob && row.blobDataUrl) {
          try {
            return { ...row, blob: await dataUrlToBlob(row.blobDataUrl) };
          } catch {}
        }
        return row;
      }),
    );
  } catch {
    return [];
  }
}

async function removeOffline(id: string) {
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {}
  }
  const rows = await listOfflineQueue();
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.filter((r) => r.id !== id)));
  } catch {}
}

export async function flushOfflineQueue(
  sender: (item: OfflineQueueItem) => Promise<void>,
): Promise<{ sent: number; pending: number }> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { sent: 0, pending: (await listOfflineQueue()).length };
  }
  flushing = true;
  let sent = 0;
  try {
    for (const item of await listOfflineQueue()) {
      try {
        await sender(item);
        await removeOffline(item.id);
        sent += 1;
      } catch {
        item.attempts += 1;
        const delay = Math.min(60_000, 1_000 * 2 ** Math.min(item.attempts, 6));
        await new Promise((resolve) => setTimeout(resolve, delay));
        break;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, pending: (await listOfflineQueue()).length };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    window.dispatchEvent(new CustomEvent("miniport:offline-ready"));
  });
}
