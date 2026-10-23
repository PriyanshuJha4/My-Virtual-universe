import type { Character, Library, MediaCollection, MediaFile } from "../types/models";
import { UNGROUPED } from "../types/models";

const KEY = "pvu.library.v3";
// Keys used by earlier versions. They are read once for migration and never deleted.
const LEGACY_CHARACTERS = "pvu.characters.v1";
const LEGACY_GROUPS = "pvu.character-groups.v1";
const LEGACY_MEDIA = "pvu.character-media.v2";
const legacyAvatarKey = (id: string) => `pvu.avatar.${id}`;

export const emptyLibrary = (): Library => ({ version: 4, characters: [], groups: [], media: [], collections: [] });

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object";

/** Turns untrusted stored data into a valid Library. Never throws. */
export function normalizeLibrary(input: unknown): Library {
  const raw: Obj = isObj(input) ? input : {};
  const now = new Date().toISOString();

  const characters: Character[] = (Array.isArray(raw.characters) ? raw.characters : [])
    .filter((c): c is Obj => isObj(c) && typeof c.id === "string")
    .map(c => ({
      id: c.id as string,
      kind: (["real", "fictional", "ai_character", "self"].includes(str(c.kind)) ? c.kind : "fictional") as Character["kind"],
      name: str(c.name, "Untitled"),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [],
      description: str(c.description),
      biography: str(c.biography),
      avatarUrl: typeof c.avatarUrl === "string" && c.avatarUrl ? c.avatarUrl : undefined,
      groupName: str(c.groupName).trim(),
      isArchived: c.isArchived === true,
      createdAt: str(c.createdAt, now),
      updatedAt: str(c.updatedAt, now),
    }));

  const media: MediaFile[] = (Array.isArray(raw.media) ? raw.media : [])
    .filter((m): m is Obj => isObj(m) && typeof m.id === "string" && typeof m.relativePath === "string")
    .map(m => ({
      id: m.id as string,
      characterId: str(m.characterId),
      title: str(m.title, str(m.originalName)),
      originalName: str(m.originalName, "file"),
      relativePath: m.relativePath as string,
      mimeType: str(m.mimeType, "application/octet-stream"),
      fileSize: typeof m.fileSize === "number" ? m.fileSize : 0,
      addedAt: str(m.addedAt, now),
      textContent: typeof m.textContent === "string" ? m.textContent : undefined,
    }));

  const collections: MediaCollection[] = (Array.isArray(raw.collections) ? raw.collections : [])
    .filter((c): c is Obj => isObj(c) && typeof c.id === "string" && typeof c.characterId === "string" && (c.kind === "album" || c.kind === "playlist"))
    .map(c => ({
      id: c.id as string,
      characterId: c.characterId as string,
      kind: c.kind as MediaCollection["kind"],
      name: str(c.name, "Untitled collection"),
      mediaIds: Array.isArray(c.mediaIds) ? c.mediaIds.filter((id): id is string => typeof id === "string") : [],
      thumbnailMediaId: typeof c.thumbnailMediaId === "string" ? c.thumbnailMediaId : undefined,
      createdAt: str(c.createdAt, now),
      updatedAt: str(c.updatedAt, now),
    }));

  // Groups: keep the user's order, drop duplicates, and make sure every group used by a character exists.
  const groups: string[] = [];
  const addGroup = (g: string) => {
    const name = g.trim();
    if (name && name !== UNGROUPED && !groups.some(x => x.toLowerCase() === name.toLowerCase())) groups.push(name);
  };
  (Array.isArray(raw.groups) ? raw.groups : []).forEach(g => typeof g === "string" && addGroup(g));
  characters.forEach(c => addGroup(c.groupName || ""));
  // Point characters at the canonical spelling of their group ("Ungrouped" becomes empty).
  characters.forEach(c => { c.groupName = groups.find(g => g.toLowerCase() === (c.groupName || "").toLowerCase()) || ""; });

  const mediaIds = new Set(media.map(m => m.id));
  const validCollections = collections.map(c => ({
    ...c,
    mediaIds: [...new Set(c.mediaIds)].filter(id => mediaIds.has(id)),
    thumbnailMediaId: c.thumbnailMediaId && mediaIds.has(c.thumbnailMediaId) ? c.thumbnailMediaId : undefined,
  })).filter(c => characters.some(ch => ch.id === c.characterId));

  return { version: 4, characters, groups, media, collections: validCollections };
}

function readBrowserLibrary(): Library | null {
  const current = readJson(KEY);
  if (current) return normalizeLibrary(current);
  // Migrate from earlier versions that used several separate keys.
  const characters = readJson(LEGACY_CHARACTERS);
  if (!Array.isArray(characters) || characters.length === 0) return null;
  const lib = normalizeLibrary({ characters, groups: readJson(LEGACY_GROUPS), media: readJson(LEGACY_MEDIA) });
  for (const c of lib.characters) {
    if (!c.avatarUrl) {
      try { c.avatarUrl = localStorage.getItem(legacyAvatarKey(c.id)) || undefined; } catch { /* ignore */ }
    }
  }
  return lib;
}

export type LoadResult = { ok: true; library: Library; needsSave: boolean } | { ok: false; error: string };

export async function loadLibrary(): Promise<LoadResult> {
  const api = window.universe;
  if (api?.loadLibrary) {
    let result;
    try { result = await api.loadLibrary(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not read the library." }; }
    if (!result.ok) return { ok: false, error: result.error };
    if (result.data) {
      try { return { ok: true, library: normalizeLibrary(JSON.parse(result.data)), needsSave: false }; }
      catch { return { ok: false, error: "The library file is damaged." }; }
    }
    // First run of this version on desktop: bring over anything saved by older versions.
    const migrated = readBrowserLibrary();
    return { ok: true, library: migrated ?? emptyLibrary(), needsSave: migrated !== null };
  }
  return { ok: true, library: readBrowserLibrary() ?? emptyLibrary(), needsSave: false };
}

export async function saveLibrary(lib: Library): Promise<{ ok: boolean; error?: string }> {
  const json = JSON.stringify(lib);
  const api = window.universe;
  if (api?.saveLibrary) {
    try { const r = await api.saveLibrary(json); return r.ok ? { ok: true } : { ok: false, error: r.error }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not save." }; }
  }
  try { localStorage.setItem(KEY, json); return { ok: true }; }
  catch { return { ok: false, error: "Browser storage is full or blocked, so your changes could not be saved." }; }
}
