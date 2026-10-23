import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { CheckSquare, ChevronLeft, ChevronRight, Copy, ExternalLink, File as FileIcon, FileText, Film, FolderOpen, Image as ImageIcon, Images, ListVideo, MoveRight, Music2, Pencil, Plus, Search, Star, Trash2, Upload, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { Character, MediaCollection, MediaFile } from "../types/models";
import { deleteFile, ensureMediaCollectionFolder, fileKind, importFiles, isDesktop, makeAvatar, makeId, moveMediaToLibraryRoot, openExternally, organizeMediaFile, pickAndImportDesktop, prettyBytes, readText, renameMediaCollectionFolder, resolveUrl, revealInFolder, sectionOf, writeText } from "../services/media";
import type { Kind, Section } from "../services/media";
import { Modal, useUi } from "./Ui";

const TABS: { id: "all" | Section; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "doc", label: "Documents" },
  { id: "other", label: "Others" },
];

function KindIcon({ kind, size = 28 }: { kind: Kind; size?: number }) {
  switch (kind) {
    case "image": return <ImageIcon size={size} />;
    case "video": return <Film size={size} />;
    case "audio": return <Music2 size={size} />;
    case "pdf": case "text": return <FileText size={size} />;
    default: return <FileIcon size={size} />;
  }
}

const KIND_LABEL: Record<Kind, string> = { image: "Image", video: "Video", audio: "Audio", pdf: "PDF", text: "Text", other: "File" };

interface Props {
  character: Character;
  files: MediaFile[];
  collections: MediaCollection[];
  onCollectionsChange: (collections: MediaCollection[]) => void;
  onAdd: (files: MediaFile[]) => void;
  onChange: (id: string, patch: Partial<MediaFile>) => void;
  onRemove: (id: string) => void;
  onAvatar: (dataUrl: string) => void;
}

export default function CharacterMediaPanel({ character, files, collections, onCollectionsChange, onAdd, onChange, onRemove, onAvatar }: Props) {
  const ui = useUi();
  const [tab, setTab] = useState<"all" | Section>("all");
  const [query, setQuery] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargetId, setBulkTargetId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSelectRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number; started: boolean; startedOnPreview: boolean; additive: boolean; baseSelected: Set<string> } | null>(null);
  const suppressCardClickRef = useRef(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const [viewId, setViewId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState<MediaFile | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Resolve a viewable address for each file (instant on desktop, from browser storage otherwise).
  useEffect(() => {
    const missing = files.filter(f => !urlsRef.current[f.id]);
    if (!missing.length) return;
    let off = false;
    Promise.all(missing.map(async f => [f.id, await resolveUrl(f).catch(() => undefined)] as const)).then(pairs => {
      if (off) return;
      setUrls(prev => {
        const next = { ...prev };
        for (const [id, url] of pairs) if (url) next[id] = url;
        return next;
      });
    });
    return () => { off = true; };
  }, [files]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: files.length, image: 0, video: 0, doc: 0, other: 0 };
    for (const f of files) c[sectionOf(fileKind(f))]++;
    return c;
  }, [files]);

  const collectionKind = tab === "image" ? "album" : tab === "video" ? "playlist" : null;
  const activeCollection = collections.find(c => c.id === activeCollectionId && c.kind === collectionKind) ?? null;
  const visibleCollections = collectionKind ? collections.filter(c => c.kind === collectionKind) : [];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...files].filter(f => tab === "all" || sectionOf(fileKind(f)) === tab);
    if (activeCollection) {
      list = activeCollection.mediaIds.map(id => list.find(f => f.id === id)).filter((f): f is MediaFile => Boolean(f));
    } else list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return list.filter(f => !q || `${f.title} ${f.originalName}`.toLowerCase().includes(q));
  }, [files, tab, query, activeCollection]);

  const selectedFiles = shown.filter(file => selectedIds.has(file.id));
  useEffect(() => { setSelectedIds(new Set()); setBulkTargetId(""); }, [tab, activeCollectionId]);

  // File-manager style marquee selection: drag across cards to select multiple items.
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragSelectRef.current;
      const grid = gridRef.current;
      if (!drag || !grid) return;
      drag.currentX = event.clientX;
      drag.currentY = event.clientY;
      if (!drag.started && Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) < 5) return;
      drag.started = true;
      const gridRect = grid.getBoundingClientRect();
      const left = Math.min(drag.startX, drag.currentX);
      const right = Math.max(drag.startX, drag.currentX);
      const top = Math.min(drag.startY, drag.currentY);
      const bottom = Math.max(drag.startY, drag.currentY);
      setMarquee({ x: left - gridRect.left, y: top - gridRect.top, width: right - left, height: bottom - top });
      const hitIds = new Set<string>();
      grid.querySelectorAll<HTMLElement>(".media-card[data-media-id]").forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
          const id = card.dataset.mediaId;
          if (id) hitIds.add(id);
        }
      });
      setSelectedIds(drag.additive ? new Set([...drag.baseSelected, ...hitIds]) : hitIds);
      event.preventDefault();
    }
    function onPointerUp() {
      const drag = dragSelectRef.current;
      if (drag?.started && drag.startedOnPreview) suppressCardClickRef.current = true;
      dragSelectRef.current = null;
      setMarquee(null);
    }
    function onPointerCancel() {
      dragSelectRef.current = null;
      setMarquee(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const gallery = useMemo(() => shown.filter(f => { const k = fileKind(f); return (k === "image" || k === "video") && urls[f.id]; }), [shown, urls]);
  const viewIndex = viewId ? gallery.findIndex(f => f.id === viewId) : -1;
  const viewing = viewIndex >= 0 ? gallery[viewIndex] : null;

  useEffect(() => { setZoom(1); }, [viewId]);

  const step = useCallback((dir: 1 | -1) => {
    if (!gallery.length || viewIndex < 0) return;
    setViewId(gallery[(viewIndex + dir + gallery.length) % gallery.length].id);
  }, [gallery, viewIndex]);

  useEffect(() => {
    if (!viewing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "Escape") setViewId(null);
      else if (e.key === "+" || e.key === "=") setZoom(z => Math.min(4, Number((z + 0.25).toFixed(2))));
      else if (e.key === "-") setZoom(z => Math.max(1, Number((z - 0.25).toFixed(2))));
      else if (e.key === "0") setZoom(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, step]);

  async function run(label: string, task: () => Promise<void>) {
    try { await task(); } catch (e) { ui.toast(e instanceof Error && e.message ? e.message : label, 9000); }
  }

  function updateFileLocation(file: MediaFile, relativePath: string, fileSize: number) {
    onChange(file.id, { relativePath, fileSize });
    void resolveUrl({ ...file, relativePath, fileSize }).then(url => {
      if (url) setUrls(previous => ({ ...previous, [file.id]: url }));
    }).catch(() => undefined);
  }

  async function addFromList(list: File[]) {
    if (!list.length) return;
    setBusy(true);
    await run("Could not add files.", async () => {
      const added = await importFiles(character.id, character.name, list);
      if (added.length) { onAdd(added); ui.toast(`${added.length} file${added.length === 1 ? "" : "s"} added`); }
    });
    setBusy(false);
  }

  async function addFiles() {
    if (isDesktop()) {
      setBusy(true);
      await run("Could not add files.", async () => {
        const added = await pickAndImportDesktop(character.id, character.name);
        if (added.length) { onAdd(added); ui.toast(`${added.length} file${added.length === 1 ? "" : "s"} added`); }
      });
      setBusy(false);
    } else picker.current?.click();
  }

  function onDragOver(e: DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addFromList(Array.from(e.dataTransfer.files));
  }

  async function setAsPhoto(file: MediaFile) {
    await run("Could not set the profile picture.", async () => {
      const url = urls[file.id] ?? await resolveUrl(file);
      if (!url) throw new Error("This image is not available.");
      onAvatar(await makeAvatar(url));
      ui.toast("Profile picture updated");
    });
  }

  function detachDeletedFiles(ids: Set<string>) {
    onCollectionsChange(collections.map(c => ({
      ...c,
      mediaIds: c.mediaIds.filter(id => !ids.has(id)),
      thumbnailMediaId: ids.has(c.thumbnailMediaId ?? "") ? undefined : c.thumbnailMediaId,
      updatedAt: ids.size ? new Date().toISOString() : c.updatedAt,
    })));
    setUrls(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.has(id))));
    setSelectedIds(previous => { const next = new Set(previous); ids.forEach(id => next.delete(id)); return next; });
  }

  async function remove(file: MediaFile) {
    const ok = await ui.confirm(`PERMANENTLY delete “${file.originalName}” from this computer’s disk? The original file will be deleted from File Explorer too; this is not just removing it from PVU. This cannot be undone.`, { title: "Permanently delete file from disk?", confirmLabel: "Delete permanently", danger: true });
    if (!ok) return;
    await run("Could not delete the file.", async () => {
      await deleteFile(file);
      onRemove(file.id);
      detachDeletedFiles(new Set([file.id]));
      if (viewId === file.id) setViewId(null);
      ui.toast("File permanently deleted");
    });
  }

  async function bulkDeleteSelected() {
    if (!selectedFiles.length) return;
    const count = selectedFiles.length;
    const ok = await ui.confirm(`PERMANENTLY delete ${count} selected file${count === 1 ? "" : "s"} from this computer’s disk? The original files will be deleted from File Explorer too; this is not just removing them from PVU. This cannot be undone.`, { title: `Permanently delete ${count} file${count === 1 ? "" : "s"} from disk?`, confirmLabel: "Delete permanently", danger: true });
    if (!ok) return;
    setBusy(true);
    const deleted = new Set<string>();
    const failures: string[] = [];
    for (const file of selectedFiles) {
      try {
        await deleteFile(file);
        deleted.add(file.id);
        onRemove(file.id);
      } catch {
        failures.push(file.originalName);
      }
    }
    if (deleted.size) {
      detachDeletedFiles(deleted);
      if (viewId && deleted.has(viewId)) setViewId(null);
    }
    setBusy(false);
    if (failures.length) ui.toast(`${deleted.size} file(s) deleted. ${failures.length} could not be deleted: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}`, 10000);
    else ui.toast(`${deleted.size} file${deleted.size === 1 ? "" : "s"} permanently deleted`);
  }

  function openCard(file: MediaFile) {
    const kind = fileKind(file);
    if (kind === "image" || kind === "video") { if (urls[file.id]) setViewId(file.id); else void run("", () => openExternally(file)); }
    else if (kind === "text") setEditing(file);
    else void run("Could not open the file.", async () => openExternally(file, await resolveUrl(file)));
  }

  async function createCollection(kind: MediaCollection["kind"]) {
    const name = await ui.prompt({ title: kind === "album" ? "Create album" : "Create playlist", label: "NAME", placeholder: kind === "album" ? "e.g. Childhood photos" : "e.g. Favourite scenes" });
    if (!name) return;
    if (collections.some(c => c.kind === kind && c.name.toLowerCase() === name.toLowerCase())) { ui.toast(`A ${kind} with that name already exists.`); return; }
    const now = new Date().toISOString();
    const item: MediaCollection = { id: makeId(), characterId: character.id, kind, name, mediaIds: [], createdAt: now, updatedAt: now };
    await run(`Could not create ${kind}.`, async () => {
      await ensureMediaCollectionFolder(character, item);
      onCollectionsChange([...collections, item]);
      setActiveCollectionId(item.id);
    });
  }

  async function renameCollection(c: MediaCollection) {
    const name = await ui.prompt({ title: `Rename ${c.kind}`, label: "NAME", initial: c.name });
    if (!name || name === c.name) return;
    if (collections.some(x => x.id !== c.id && x.kind === c.kind && x.name.toLowerCase() === name.toLowerCase())) { ui.toast(`A ${c.kind} with that name already exists.`); return; }
    await run(`Could not rename ${c.kind}.`, async () => {
      const renamed = await renameMediaCollectionFolder(character, c, name);
      if (renamed.oldPrefix && renamed.newPrefix) {
        const oldPrefix = renamed.oldPrefix.replace(/\\/g, "/");
        const newPrefix = renamed.newPrefix.replace(/\\/g, "/");
        for (const file of files) {
          const current = file.relativePath.replace(/\\/g, "/");
          if (current.startsWith(`${oldPrefix}/`)) updateFileLocation(file, `${newPrefix}${current.slice(oldPrefix.length)}`, file.fileSize);
        }
      }
      onCollectionsChange(collections.map(x => x.id === c.id ? { ...x, name, updatedAt: new Date().toISOString() } : x));
    });
  }

  async function deleteCollection(c: MediaCollection) {
    if (!(await ui.confirm(`Delete the ${c.kind} “${c.name}”? Its files will be moved back to the character's ${c.kind === "album" ? "Photos" : "Videos"} folder; the original files will not be deleted.`, { title: `Delete ${c.kind}`, confirmLabel: "Delete", danger: true }))) return;
    setBusy(true);
    await run(`Could not delete ${c.kind}.`, async () => {
      for (const id of c.mediaIds) {
        const file = files.find(f => f.id === id);
        if (!file) continue;
        const result = await moveMediaToLibraryRoot(file, character.name, c.kind);
        updateFileLocation(file, result.relativePath, result.fileSize);
      }
      onCollectionsChange(collections.filter(x => x.id !== c.id).map(x => x.kind === c.kind ? { ...x, mediaIds: x.mediaIds.filter(id => !c.mediaIds.includes(id)), thumbnailMediaId: c.mediaIds.includes(x.thumbnailMediaId ?? "") ? undefined : x.thumbnailMediaId, updatedAt: new Date().toISOString() } : x));
      if (activeCollectionId === c.id) setActiveCollectionId(null);
      ui.toast(`${c.kind === "album" ? "Album" : "Playlist"} deleted; files kept in the library.`);
    });
    setBusy(false);
  }

  function toggleSelected(fileId: string) {
    setSelectedIds(previous => { const next = new Set(previous); if (next.has(fileId)) next.delete(fileId); else next.add(fileId); return next; });
  }

  function toggleAllVisible() {
    setSelectedIds(previous => {
      const visibleIds = shown.map(file => file.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => previous.has(id));
      const next = new Set(previous);
      for (const id of visibleIds) allSelected ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addToCollection(fileId: string, collectionId: string) {
    const file = files.find(f => f.id === fileId);
    const target = collections.find(c => c.id === collectionId && c.kind === collectionKind);
    if (!file || !target || !collectionKind) return;
    void run("Could not move the file to this collection.", async () => {
      const result = await organizeMediaFile(file, character.name, collectionKind, target, "move");
      updateFileLocation(file, result.relativePath, result.fileSize);
      onCollectionsChange(collections.map(c => {
        if (c.kind !== collectionKind) return c;
        const without = c.mediaIds.filter(id => id !== file.id);
        const mediaIds = c.id === target.id ? [...without, file.id] : without;
        return { ...c, mediaIds, thumbnailMediaId: c.id !== target.id && c.thumbnailMediaId === file.id ? undefined : c.thumbnailMediaId, updatedAt: new Date().toISOString() };
      }));
      ui.toast(`Moved to ${target.name}`);
    });
  }

  async function removeFromCollection(fileId: string) {
    if (!activeCollection || !collectionKind) return;
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    await run("Could not remove the file from this collection.", async () => {
      const result = await moveMediaToLibraryRoot(file, character.name, collectionKind);
      updateFileLocation(file, result.relativePath, result.fileSize);
      onCollectionsChange(collections.map(c => c.kind === collectionKind ? { ...c, mediaIds: c.mediaIds.filter(id => id !== fileId), thumbnailMediaId: c.thumbnailMediaId === fileId ? undefined : c.thumbnailMediaId, updatedAt: new Date().toISOString() } : c));
      setSelectedIds(previous => { const next = new Set(previous); next.delete(fileId); return next; });
    });
  }

  async function bulkOrganize(action: "move" | "copy") {
    if (!collectionKind || !bulkTargetId || selectedFiles.length === 0) return;
    const target = collections.find(c => c.id === bulkTargetId && c.kind === collectionKind);
    if (!target) return;
    setBusy(true);
    await run(`Could not ${action} selected files.`, async () => {
      const nextCollections = collections.map(c => ({ ...c, mediaIds: [...c.mediaIds] }));
      const copies: MediaFile[] = [];
      let completed = 0;
      for (const file of selectedFiles) {
        if (action === "move") {
          const result = await organizeMediaFile(file, character.name, collectionKind, target, "move");
          updateFileLocation(file, result.relativePath, result.fileSize);
          for (const c of nextCollections) {
            if (c.kind !== collectionKind) continue;
            c.mediaIds = c.mediaIds.filter(id => id !== file.id);
            if (c.thumbnailMediaId === file.id && c.id !== target.id) c.thumbnailMediaId = undefined;
          }
          const dest = nextCollections.find(c => c.id === target.id);
          if (dest && !dest.mediaIds.includes(file.id)) dest.mediaIds.push(file.id);
        } else {
          const newId = makeId();
          const result = await organizeMediaFile(file, character.name, collectionKind, target, "copy", newId);
          copies.push({ ...file, id: newId, relativePath: result.relativePath, fileSize: result.fileSize, addedAt: new Date().toISOString() });
          const dest = nextCollections.find(c => c.id === target.id);
          if (dest && !dest.mediaIds.includes(newId)) dest.mediaIds.push(newId);
        }
        completed++;
      }
      if (copies.length) onAdd(copies);
      onCollectionsChange(nextCollections.map(c => ({ ...c, updatedAt: new Date().toISOString() })));
      setSelectedIds(new Set());
      ui.toast(`${action === "move" ? "Moved" : "Copied"} ${completed} item${completed === 1 ? "" : "s"} to ${target.name}`);
    });
    setBusy(false);
  }

  async function bulkRemoveFromCollection() {
    if (!activeCollection || !collectionKind || selectedFiles.length === 0) return;
    const ok = await ui.confirm(`Remove ${selectedFiles.length} selected item(s) from “${activeCollection.name}”? The files will be kept and moved back to the character's main ${collectionKind === "album" ? "Photos" : "Videos"} folder.`, { title: "Remove selected items", confirmLabel: "Remove" });
    if (!ok) return;
    setBusy(true);
    await run("Could not remove selected items.", async () => {
      const ids = new Set(selectedFiles.map(f => f.id));
      for (const file of selectedFiles) {
        const result = await moveMediaToLibraryRoot(file, character.name, collectionKind);
        updateFileLocation(file, result.relativePath, result.fileSize);
      }
      onCollectionsChange(collections.map(c => c.kind === collectionKind ? { ...c, mediaIds: c.mediaIds.filter(id => !ids.has(id)), thumbnailMediaId: ids.has(c.thumbnailMediaId ?? "") ? undefined : c.thumbnailMediaId, updatedAt: new Date().toISOString() } : c));
      setSelectedIds(new Set());
      ui.toast(`Removed ${ids.size} item(s); files were not deleted.`);
    });
    setBusy(false);
  }

  function setCollectionThumbnail(collectionId: string, mediaId: string) {
    onCollectionsChange(collections.map(c => c.id === collectionId ? { ...c, thumbnailMediaId: mediaId || undefined, updatedAt: new Date().toISOString() } : c));
  }

  return (
    <section
      className={`media-section ${dragging ? "is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="media-head">
        <div>
          <h2>Files</h2>
          <p className="muted">Images, videos, PDFs, notes and more. Drag files here or use Add files.{busy && " Large videos can take a minute to copy."}</p>
        </div>
        <button className="primary-button" onClick={() => void addFiles()} disabled={busy}><Upload size={16} />{busy ? "Copying files…" : "Add files"}</button>
        <input ref={picker} type="file" multiple hidden onChange={e => { void addFromList(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>

      <div className="media-toolbar">
        <div className="tabs" role="tablist" aria-label="File types">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}<span className="tab-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        {files.length > 4 && (
          <label className="media-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter files…" /></label>
        )}
      </div>

      {collectionKind && (
        <div className="collections-area">
          <div className="collections-heading">
            <div><strong>{collectionKind === "album" ? "Albums" : "Playlists"}</strong><span className="muted small"> · Organize files into real folders on Windows</span></div>
            <div className="collection-heading-actions">
              {activeCollection && <button className="secondary-button compact-button" onClick={() => setActiveCollectionId(null)}>All {collectionKind === "album" ? "images" : "videos"}</button>}
              <button className="secondary-button compact-button" onClick={() => void createCollection(collectionKind)}><Plus size={14} /> New {collectionKind}</button>
            </div>
          </div>
          {visibleCollections.length > 0 && <div className="collection-grid">
            {visibleCollections.map(c => {
              const cover = c.thumbnailMediaId ? files.find(f => f.id === c.thumbnailMediaId) : undefined;
              const coverUrl = cover ? urls[cover.id] : undefined;
              return <article key={c.id} className={`collection-card ${activeCollectionId === c.id ? "active" : ""}`}>
                <button className="collection-cover" onClick={() => setActiveCollectionId(activeCollectionId === c.id ? null : c.id)} title={`Open ${c.name}`}>
                  {coverUrl && cover && fileKind(cover) === "image" ? <img src={coverUrl} alt="" /> : coverUrl && cover && fileKind(cover) === "video" ? <video src={`${coverUrl}#t=0.5`} muted preload="metadata" /> : <div className="collection-placeholder">{collectionKind === "album" ? <Images size={26} /> : <ListVideo size={26} />}</div>}
                  <span className="collection-count">{c.mediaIds.length}</span>
                </button>
                <div className="collection-details"><strong title={c.name}>{c.name}</strong><div className="collection-controls">
                  <select aria-label={`Change ${c.name} thumbnail`} value={c.thumbnailMediaId ?? ""} onChange={e => setCollectionThumbnail(c.id, e.target.value)} title="Change thumbnail">
                    <option value="">Default cover</option>
                    {files.filter(f => fileKind(f) === "image" || (collectionKind === "playlist" && fileKind(f) === "video")).map(f => <option key={f.id} value={f.id}>{f.originalName}</option>)}
                  </select>
                  <button title="Rename" onClick={() => void renameCollection(c)}><Pencil size={13} /></button>
                  <button title="Delete collection" className="danger" onClick={() => void deleteCollection(c)}><Trash2 size={13} /></button>
                </div></div>
              </article>;
            })}
          </div>}
          {activeCollection && <p className="collection-active-note">Viewing {activeCollection.kind}: <strong>{activeCollection.name}</strong>. Select one or more items to remove them or move/copy them to another collection.</p>}
        </div>
      )}

      {shown.length > 0 && <div className="bulk-media-toolbar">
        <button className="secondary-button compact-button" onClick={toggleAllVisible}><CheckSquare size={14} /> {shown.every(f => selectedIds.has(f.id)) ? "Deselect visible" : "Select visible"}</button>
        <span className="bulk-selected-count">{selectedFiles.length} selected</span>
        <span className="muted small marquee-help">Drag across thumbnails to select · Ctrl-drag to add</span>
        {collectionKind && visibleCollections.length > 0 && <>
          <select aria-label={`Target ${collectionKind}`} value={bulkTargetId} onChange={e => setBulkTargetId(e.target.value)}>
            <option value="">Choose {collectionKind === "album" ? "album" : "playlist"}…</option>
            {visibleCollections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="secondary-button compact-button" disabled={busy || !bulkTargetId || !selectedFiles.length} onClick={() => void bulkOrganize("move")}><MoveRight size={14} /> Move</button>
          <button className="secondary-button compact-button" disabled={busy || !bulkTargetId || !selectedFiles.length} onClick={() => void bulkOrganize("copy")}><Copy size={14} /> Copy</button>
        </>}
        {collectionKind && activeCollection && <button className="secondary-button compact-button" disabled={busy || !selectedFiles.length} onClick={() => void bulkRemoveFromCollection()}><X size={14} /> Remove from {collectionKind}</button>}
        <button className="secondary-button compact-button danger-bulk-button" disabled={busy || !selectedFiles.length} onClick={() => void bulkDeleteSelected()}><Trash2 size={14} /> Delete selected</button>
      </div>}

      {shown.length === 0 ? (
        <div className="media-empty">
          <FolderOpen size={26} />
          <strong>{activeCollection ? "This collection is empty" : files.length === 0 ? "No files yet" : "Nothing here"}</strong>
          <span>{activeCollection ? "Import files, then select them and use Move or Copy to organize them in this collection." : files.length === 0 ? "Drop files here or click Add files." : "Try another tab or clear the filter."}</span>
        </div>
      ) : (
        <div
          className={`media-grid ${marquee ? "is-marquee-selecting" : ""}`}
          ref={gridRef}
          onPointerDown={event => {
            if (event.button !== 0 || (event.target as HTMLElement).closest(".media-actions, input, select, audio, video, .media-info")) return;
            const target = event.target as HTMLElement;
            if (target.closest(".media-card") && !target.closest(".media-preview")) return;
            dragSelectRef.current = { startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, started: false, startedOnPreview: Boolean(target.closest(".media-preview")), additive: event.ctrlKey || event.metaKey, baseSelected: new Set(selectedIds) };
          }}
        >
          {shown.map(file => {
            const kind = fileKind(file);
            const url = urls[file.id];
            return (
              <article className={`media-card ${selectedIds.has(file.id) ? "is-selected" : ""}`} key={file.id} data-media-id={file.id}>
                <button className="media-preview" onClick={event => {
                  if (suppressCardClickRef.current) { suppressCardClickRef.current = false; event.preventDefault(); event.stopPropagation(); return; }
                  openCard(file);
                }} title={`Open ${file.originalName}`}>
                  {kind === "image" && url ? <img src={url} alt={file.title} loading="lazy" />
                    : kind === "video" && url ? <VideoTile url={url} />
                    : kind === "audio" && url ? <div className="media-placeholder"><Music2 size={28} /><audio src={url} controls preload="none" onClick={e => e.stopPropagation()} /></div>
                    : <div className="media-placeholder"><KindIcon kind={kind} /><span>{KIND_LABEL[kind]}</span></div>}
                </button>
                <div className="media-info">
                  <label className="media-select"><input type="checkbox" checked={selectedIds.has(file.id)} onChange={() => toggleSelected(file.id)} aria-label={`Select ${file.originalName}`} /><span>Select</span></label>
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <small>{prettyBytes(file.fileSize)} · {new Date(file.addedAt).toLocaleDateString()}</small>
                </div>
                <div className="media-actions">
                  {kind === "image" && <button title="Use as profile picture" onClick={() => void setAsPhoto(file)}><Star size={14} /></button>}
                  {kind === "text" && <button title="Edit" onClick={() => setEditing(file)}><Pencil size={14} /></button>}
                  <button title="Open with default app" onClick={() => void run("Could not open the file.", async () => openExternally(file, await resolveUrl(file)))}><ExternalLink size={14} /></button>
                  {collectionKind && visibleCollections.length > 0 && (activeCollection
                    ? <button title="Remove from this collection" onClick={() => removeFromCollection(file.id)}><X size={14} /></button>
                    : <select className="add-collection-select" title={`Add to ${collectionKind}`} aria-label={`Add ${file.originalName} to ${collectionKind}`} defaultValue="" onChange={e => { addToCollection(file.id, e.target.value); e.currentTarget.value = ""; }}><option value="">+ {collectionKind === "album" ? "Album" : "Playlist"}</option>{visibleCollections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
                  {isDesktop() && !file.relativePath.startsWith("browser:") && <button title="Show in folder" onClick={() => void run("Could not show the file.", () => revealInFolder(file))}><FolderOpen size={14} /></button>}
                  <button title="Permanently delete this file from disk" className="danger" onClick={() => void remove(file)}><Trash2 size={14} /></button>
                </div>
              </article>
            );
          })}
          {marquee && <div className="selection-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} aria-hidden="true" />}
        </div>
      )}

      {dragging && <div className="drop-overlay"><Upload size={30} /><strong>Drop to add to {character.name || "this character"}</strong></div>}

      {viewing && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Media viewer" onClick={() => setViewId(null)}>
          <button className="lightbox-close" aria-label="Close" onClick={() => setViewId(null)}><X size={22} /></button>
          <div className="lightbox-tools" onClick={e => e.stopPropagation()}>
            {fileKind(viewing) === "image" && <>
              <button aria-label="Zoom out" title="Zoom out (−)" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, Number((z - 0.25).toFixed(2))))}><ZoomOut size={18} /></button>
              <span className="zoom-level">{Math.round(zoom * 100)}%</span>
              <button aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, Number((z + 0.25).toFixed(2))))}><ZoomIn size={18} /></button>
              <button aria-label="Reset zoom" title="Reset zoom (0)" disabled={zoom === 1} onClick={() => setZoom(1)}><RotateCcw size={17} /></button>
            </>}
            <button className="lightbox-delete" aria-label="Delete this file" title="Delete this file" onClick={() => void remove(viewing)}><Trash2 size={18} /></button>
          </div>
          {gallery.length > 1 && <button className="lightbox-arrow left" aria-label="Previous" onClick={e => { e.stopPropagation(); step(-1); }}><ChevronLeft size={28} /></button>}
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <LightboxMedia key={viewing.id} file={viewing} url={urls[viewing.id]} zoom={zoom} onZoom={setZoom} onOpenExternal={() => void run("Could not open the file.", () => openExternally(viewing, urls[viewing.id]))} />
            <div className="lightbox-caption"><span title={viewing.originalName}>{viewing.originalName}</span><span>{viewIndex + 1} / {gallery.length}</span></div>
          </div>
          {gallery.length > 1 && <button className="lightbox-arrow right" aria-label="Next" onClick={e => { e.stopPropagation(); step(1); }}><ChevronRight size={28} /></button>}
          <p className="lightbox-hint">← → browse · +/− zoom · 0 reset · Esc close</p>
        </div>
      )}

      {editing && (
        <TextEditor
          file={editing}
          onClose={() => setEditing(null)}
          onSaved={size => { onChange(editing.id, { fileSize: size }); ui.toast("File saved"); }}
          onIndexed={text => onChange(editing.id, { textContent: text.slice(0, 30_000) })}
        />
      )}
    </section>
  );
}

/** Video thumbnail that falls back to a plain tile if the format can't be decoded (the file is still saved). */
function VideoTile({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="media-placeholder"><Film size={28} /><span>Video</span></div>;
  return <><video src={`${url}#t=0.5`} preload="metadata" muted playsInline onError={() => setFailed(true)} /><span className="play-badge"><Film size={18} /></span></>;
}

function LightboxMedia({ file, url, zoom, onZoom, onOpenExternal }: { file: MediaFile; url?: string; zoom: number; onZoom: (zoom: number | ((previous: number) => number)) => void; onOpenExternal: () => void }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  if (fileKind(file) === "video") {
    return failed
      ? <div className="lightbox-fail"><p>This video format can’t be played inside the app.</p><button className="primary-button" onClick={onOpenExternal}><ExternalLink size={15} /> Open with default player</button></div>
      : <video className="lightbox-media" src={url} controls autoPlay playsInline onError={() => setFailed(true)} />;
  }
  return <div className="lightbox-image-viewport" onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); onZoom(z => Math.max(1, Math.min(4, Number((z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))); } }}>
    <img className="lightbox-media lightbox-image" src={url} alt={file.title || file.originalName} style={{ transform: `scale(${zoom})` }} draggable={false} />
  </div>;
}

function TextEditor({ file, onClose, onSaved, onIndexed }: { file: MediaFile; onClose: () => void; onSaved: (size: number) => void; onIndexed: (text: string) => void }) {
  const ui = useUi();
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let off = false;
    readText(file).then(t => { if (!off) { setText(t); setOriginal(t); } }).catch(e => { ui.toast(e instanceof Error ? e.message : "Could not read this file."); onClose(); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const dirty = text !== null && text !== original;

  async function save() {
    if (text === null) return;
    setSaving(true);
    try { const size = await writeText(file, text); setOriginal(text); onSaved(size); onIndexed(text); }
    catch (e) { ui.toast(e instanceof Error ? e.message : "Could not save this file."); }
    finally { setSaving(false); }
  }

  async function close() {
    if (dirty && !(await ui.confirm("You have unsaved changes. Close without saving?", { title: "Unsaved changes", confirmLabel: "Discard", danger: true }))) return;
    onClose();
  }

  return (
    <Modal title={file.originalName} onClose={() => void close()} wide>
      {text === null ? <div className="center-note">Loading…</div> : (
        <textarea
          className="editor-area" value={text} spellCheck={false} autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}
        />
      )}
      <div className="modal-actions">
        <span className="muted small">{dirty ? "Unsaved changes" : "Saved"} · Ctrl+S to save</span>
        <button className="secondary-button" onClick={() => void close()}>Close</button>
        <button className="primary-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
