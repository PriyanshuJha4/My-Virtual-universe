import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, File as FileIcon, FileText, Film, FolderOpen, Image as ImageIcon, Music2, Pencil, Search, Star, Trash2, Upload, X } from "lucide-react";
import type { Character, MediaFile } from "../types/models";
import { deleteFile, fileKind, importFiles, isDesktop, makeAvatar, openExternally, pickAndImportDesktop, prettyBytes, readText, resolveUrl, revealInFolder, sectionOf, writeText } from "../services/media";
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
  onAdd: (files: MediaFile[]) => void;
  onChange: (id: string, patch: Partial<MediaFile>) => void;
  onRemove: (id: string) => void;
  onAvatar: (dataUrl: string) => void;
}

export default function CharacterMediaPanel({ character, files, onAdd, onChange, onRemove, onAvatar }: Props) {
  const ui = useUi();
  const [tab, setTab] = useState<"all" | Section>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const [viewId, setViewId] = useState<string | null>(null);
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...files]
      .filter(f => tab === "all" || sectionOf(fileKind(f)) === tab)
      .filter(f => !q || `${f.title} ${f.originalName}`.toLowerCase().includes(q))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [files, tab, query]);

  const gallery = useMemo(() => shown.filter(f => { const k = fileKind(f); return (k === "image" || k === "video") && urls[f.id]; }), [shown, urls]);
  const viewIndex = viewId ? gallery.findIndex(f => f.id === viewId) : -1;
  const viewing = viewIndex >= 0 ? gallery[viewIndex] : null;

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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, step]);

  async function run(label: string, task: () => Promise<void>) {
    try { await task(); } catch (e) { ui.toast(e instanceof Error && e.message ? e.message : label, 9000); }
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

  async function remove(file: MediaFile) {
    const ok = await ui.confirm(`Delete “${file.originalName}”? The file will be removed from this computer. This can't be undone.`, { title: "Delete file", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await run("Could not delete the file.", async () => { await deleteFile(file); onRemove(file.id); ui.toast("File deleted"); });
  }

  function openCard(file: MediaFile) {
    const kind = fileKind(file);
    if (kind === "image" || kind === "video") { if (urls[file.id]) setViewId(file.id); else void run("", () => openExternally(file)); }
    else if (kind === "text") setEditing(file);
    else void run("Could not open the file.", async () => openExternally(file, await resolveUrl(file)));
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

      {shown.length === 0 ? (
        <div className="media-empty">
          <FolderOpen size={26} />
          <strong>{files.length === 0 ? "No files yet" : "Nothing here"}</strong>
          <span>{files.length === 0 ? "Drop files here or click Add files." : "Try another tab or clear the filter."}</span>
        </div>
      ) : (
        <div className="media-grid">
          {shown.map(file => {
            const kind = fileKind(file);
            const url = urls[file.id];
            return (
              <article className="media-card" key={file.id}>
                <button className="media-preview" onClick={() => openCard(file)} title={`Open ${file.originalName}`}>
                  {kind === "image" && url ? <img src={url} alt={file.title} loading="lazy" />
                    : kind === "video" && url ? <VideoTile url={url} />
                    : kind === "audio" && url ? <div className="media-placeholder"><Music2 size={28} /><audio src={url} controls preload="none" onClick={e => e.stopPropagation()} /></div>
                    : <div className="media-placeholder"><KindIcon kind={kind} /><span>{KIND_LABEL[kind]}</span></div>}
                </button>
                <div className="media-info">
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <small>{prettyBytes(file.fileSize)} · {new Date(file.addedAt).toLocaleDateString()}</small>
                </div>
                <div className="media-actions">
                  {kind === "image" && <button title="Use as profile picture" onClick={() => void setAsPhoto(file)}><Star size={14} /></button>}
                  {kind === "text" && <button title="Edit" onClick={() => setEditing(file)}><Pencil size={14} /></button>}
                  <button title="Open with default app" onClick={() => void run("Could not open the file.", async () => openExternally(file, await resolveUrl(file)))}><ExternalLink size={14} /></button>
                  {isDesktop() && !file.relativePath.startsWith("browser:") && <button title="Show in folder" onClick={() => void run("Could not show the file.", () => revealInFolder(file))}><FolderOpen size={14} /></button>}
                  <button title="Delete file" className="danger" onClick={() => void remove(file)}><Trash2 size={14} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dragging && <div className="drop-overlay"><Upload size={30} /><strong>Drop to add to {character.name || "this character"}</strong></div>}

      {viewing && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Media viewer" onClick={() => setViewId(null)}>
          <button className="lightbox-close" aria-label="Close" onClick={() => setViewId(null)}><X size={22} /></button>
          {gallery.length > 1 && <button className="lightbox-arrow left" aria-label="Previous" onClick={e => { e.stopPropagation(); step(-1); }}><ChevronLeft size={28} /></button>}
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <LightboxMedia key={viewing.id} file={viewing} url={urls[viewing.id]} onOpenExternal={() => void run("Could not open the file.", () => openExternally(viewing, urls[viewing.id]))} />
            <div className="lightbox-caption"><span title={viewing.originalName}>{viewing.originalName}</span><span>{viewIndex + 1} / {gallery.length}</span></div>
          </div>
          {gallery.length > 1 && <button className="lightbox-arrow right" aria-label="Next" onClick={e => { e.stopPropagation(); step(1); }}><ChevronRight size={28} /></button>}
          <p className="lightbox-hint">← → to browse · Esc to close</p>
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

function LightboxMedia({ file, url, onOpenExternal }: { file: MediaFile; url?: string; onOpenExternal: () => void }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  if (fileKind(file) === "video") {
    return failed
      ? <div className="lightbox-fail"><p>This video format can’t be played inside the app.</p><button className="primary-button" onClick={onOpenExternal}><ExternalLink size={15} /> Open with default player</button></div>
      : <video className="lightbox-media" src={url} controls autoPlay playsInline onError={() => setFailed(true)} />;
  }
  return <img className="lightbox-media" src={url} alt={file.title || file.originalName} />;
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
