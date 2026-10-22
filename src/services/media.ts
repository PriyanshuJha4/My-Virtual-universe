import type { MediaFile } from "../types/models";

export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "other";
export type Section = "image" | "video" | "doc" | "other";

const EXT: Record<Exclude<Kind, "other">, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"],
  video: ["mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv"],
  audio: ["mp3", "wav", "m4a", "ogg", "flac", "aac"],
  pdf: ["pdf"],
  text: ["txt", "md", "markdown", "csv", "json", "rtf", "html", "log"],
};

const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();

/** Decides what a file is from its extension first (reliable), then from its MIME type. */
export function fileKind(file: Pick<MediaFile, "originalName" | "mimeType">): Kind {
  const ext = extOf(file.originalName);
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind as Kind;
  const m = file.mimeType || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "other";
}

export function sectionOf(kind: Kind): Section {
  if (kind === "pdf" || kind === "text") return "doc";
  if (kind === "audio") return "other";
  return kind;
}

export const isDesktop = () => Boolean(window.universe?.importPaths);

export function prettyBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const isBrowserFile = (f: Pick<MediaFile, "relativePath">) => f.relativePath.startsWith("browser:");

/* ---------- Browser-only storage (IndexedDB), used when not running in the desktop app ---------- */
const DB_NAME = "pvu-media-store";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open browser file storage."));
  });
}
async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || new Error("Browser file storage failed."));
      tx.onabort = () => reject(tx.error || new Error("Browser file storage is full or blocked."));
    });
  } finally { db.close(); }
}
const putBlob = (id: string, blob: Blob) => withStore("readwrite", s => s.put({ id, blob }));
const removeBlob = (id: string) => withStore("readwrite", s => s.delete(id));
async function getBlob(id: string): Promise<Blob | undefined> {
  const row = await withStore<{ blob: Blob } | undefined>("readonly", s => s.get(id));
  return row?.blob;
}

/* ---------- URLs ---------- */
const blobUrls = new Map<string, string>();

/** Address the desktop app serves stored files from (handled by the Electron main process). */
export function desktopMediaUrl(relativePath: string) {
  return "pvu-media://file/" + relativePath.split(/[\\/]/).map(encodeURIComponent).join("/");
}

export async function resolveUrl(file: MediaFile): Promise<string | undefined> {
  if (isBrowserFile(file)) {
    const cached = blobUrls.get(file.id);
    if (cached) return cached;
    const blob = await getBlob(file.id);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    blobUrls.set(file.id, url);
    return url;
  }
  return window.universe ? desktopMediaUrl(file.relativePath) : undefined;
}

function forgetUrl(id: string) {
  const url = blobUrls.get(id);
  if (url) { URL.revokeObjectURL(url); blobUrls.delete(id); }
}

/* ---------- Import ---------- */
const TEXT_PREVIEW = 30_000;

async function importBrowser(characterId: string, files: File[]): Promise<MediaFile[]> {
  const out: MediaFile[] = [];
  for (const file of files) {
    const id = makeId();
    await putBlob(id, file);
    const item: MediaFile = {
      id, characterId,
      title: file.name.replace(/\.[^.]+$/, ""),
      originalName: file.name,
      relativePath: `browser:${id}`,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      addedAt: new Date().toISOString(),
    };
    if (fileKind(item) === "text" && file.size < 2_000_000) item.textContent = (await file.text()).slice(0, TEXT_PREVIEW);
    out.push(item);
  }
  return out;
}

/** Imports dropped or picked File objects (desktop copies them into the storage folder). */
export async function importFiles(characterId: string, characterName: string, files: File[]): Promise<MediaFile[]> {
  const api = window.universe;
  if (api?.importPaths) {
    const paths = files.map(f => api.getPathForFile(f)).filter(Boolean);
    if (!paths.length) throw new Error("Those items can't be imported. Drop files, not folders.");
    const r = await api.importPaths(characterId, characterName, paths);
    if (!r.ok) throw new Error(r.error);
    return r.files;
  }
  return importBrowser(characterId, files);
}

/** Desktop only: opens the system file dialog and imports the chosen files. */
export async function pickAndImportDesktop(characterId: string, characterName: string, imagesOnly = false): Promise<MediaFile[]> {
  const api = window.universe;
  if (!api?.importCharacterMedia) return [];
  const r = await api.importCharacterMedia(characterId, characterName, imagesOnly);
  if (!r.ok) throw new Error(r.error);
  return r.files;
}

/* ---------- Text, open, delete ---------- */
export async function readText(file: MediaFile): Promise<string> {
  if (isBrowserFile(file)) {
    const blob = await getBlob(file.id);
    if (!blob) throw new Error("The saved file data is missing.");
    return blob.text();
  }
  const r = await window.universe?.readTextMedia(file.relativePath);
  if (!r?.ok) throw new Error(r?.error || "Could not read this file.");
  return r.content;
}

export async function writeText(file: MediaFile, content: string): Promise<number> {
  const size = new Blob([content]).size;
  if (isBrowserFile(file)) {
    await putBlob(file.id, new Blob([content], { type: file.mimeType || "text/plain" }));
    forgetUrl(file.id);
  } else {
    const r = await window.universe?.writeTextMedia(file.relativePath, content);
    if (!r?.ok) throw new Error(r?.error || "Could not save this file.");
  }
  return size;
}

export async function openExternally(file: MediaFile, url?: string): Promise<void> {
  if (isBrowserFile(file) || !window.universe) {
    if (url) window.open(url, "_blank", "noopener");
    return;
  }
  const r = await window.universe.openMedia(file.relativePath);
  if (!r.ok) throw new Error(r.error);
}

export async function revealInFolder(file: MediaFile): Promise<void> {
  if (isBrowserFile(file) || !window.universe) return;
  const r = await window.universe.revealMedia(file.relativePath);
  if (!r.ok) throw new Error(r.error);
}

export async function deleteFile(file: MediaFile): Promise<void> {
  if (isBrowserFile(file)) { await removeBlob(file.id); forgetUrl(file.id); return; }
  const r = await window.universe?.deleteMediaFile(file.relativePath);
  if (r && !r.ok) throw new Error(r.error);
}

/* ---------- Profile pictures ---------- */
/** Shrinks any image to a small JPEG data URL so it is cheap to store and show. */
export function makeAvatar(sourceUrl: string, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Image canvas is unavailable.");
        ctx.fillStyle = "#11131c";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("That image could not be read. Try a PNG, JPG, GIF or WebP file."));
    img.src = sourceUrl;
  });
}
