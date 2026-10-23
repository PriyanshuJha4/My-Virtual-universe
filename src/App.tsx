import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ArrowLeft, Camera, FolderCog, FolderOpen, Menu, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import type { Character, CharacterKind, Library, MediaFile } from "./types/models";
import { KIND_LABELS, UNGROUPED } from "./types/models";
import { emptyLibrary, loadLibrary, saveLibrary } from "./services/library";
import { isDesktop, makeAvatar, pickAndImportDesktop, importFiles, resolveUrl, deleteFile } from "./services/media";
import CharacterMediaPanel from "./components/CharacterMediaPanel";
import { Avatar, Modal, UiProvider, useUi } from "./components/Ui";

type View = "home" | "character";
type LoadState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const byName = (a: Character, b: Character) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const groupOf = (c: Character) => c.groupName?.trim() || UNGROUPED;

export default function App() {
  return <UiProvider><Universe /></UiProvider>;
}

function Universe() {
  const ui = useUi();
  const [lib, setLib] = useState<Library>(emptyLibrary);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 860);
  const [showAdd, setShowAdd] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);

  /* ---------- Loading & saving ---------- */
  const libRef = useRef(lib);
  libRef.current = lib;
  const dirty = useRef(false);
  const saveFailed = useRef(false);
  const canSave = useRef(false);

  const applyLoaded = useCallback((result: Awaited<ReturnType<typeof loadLibrary>>) => {
    if (!result.ok) {
      canSave.current = false;
      setLoad({ status: "error", message: result.error });
      return;
    }
    canSave.current = true;
    dirty.current = result.needsSave;
    setLib(result.library);
    setLoad({ status: "ready" });
  }, []);

  useEffect(() => { void loadLibrary().then(applyLoaded); }, [applyLoaded]);

  // Periodically reconcile the selected vault with Windows File Explorer. Changes made
  // inside PVU are saved first; external file additions, renames and deletions then appear here.
  useEffect(() => {
    if (!isDesktop() || load.status !== "ready" || !window.universe?.syncStorageFolder) return;
    let running = false;
    const sync = async () => {
      if (running || dirty.current || !canSave.current) return;
      running = true;
      try {
        const result = await window.universe?.syncStorageFolder();
        if (!result?.ok || !result.data || dirty.current) return;
        const loaded = await loadLibrary();
        if (loaded.ok && JSON.stringify(loaded.library) !== JSON.stringify(libRef.current) && !dirty.current) applyLoaded(loaded);
      } catch { /* Keep the current UI available; the next sync will retry. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void sync(), 4000);
    return () => window.clearInterval(timer);
  }, [load.status, applyLoaded]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (!canSave.current) return false;
    if (!dirty.current) return true;
    dirty.current = false;
    const result = await saveLibrary(libRef.current);
    if (!result.ok) {
      dirty.current = true;
      if (!saveFailed.current) ui.toast(result.error || "Could not save your changes.");
      saveFailed.current = true;
      return false;
    }
    saveFailed.current = false;
    return true;
  }, [ui]);

  /** Every change to the library goes through here so it is saved automatically. */
  const edit = useCallback((fn: (l: Library) => Library) => {
    dirty.current = true;
    setLib(prev => fn(prev));
  }, []);

  useEffect(() => {
    if (load.status !== "ready") return;
    const t = window.setTimeout(() => void flush(), 400);
    return () => window.clearTimeout(t);
  }, [lib, load.status, flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    const onUnload = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("beforeunload", onUnload); };
  }, [flush]);

  // Dropping a file anywhere else must not make the window navigate to it.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- Derived data ---------- */
  const visible = useMemo(() => lib.characters.filter(c => !c.isArchived).sort(byName), [lib.characters]);
  const selected = useMemo(() => visible.find(c => c.id === selectedId) ?? null, [visible, selectedId]);
  const selectedFiles = useMemo(() => lib.media.filter(m => m.characterId === selectedId), [lib.media, selectedId]);

  /** For each matching character, a short note on where the search term was found. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out = new Map<string, string>();
    const filesByChar = new Map<string, MediaFile[]>();
    for (const m of lib.media) filesByChar.set(m.characterId, [...(filesByChar.get(m.characterId) ?? []), m]);
    for (const c of visible) {
      let hint: string | null = null;
      if (c.name.toLowerCase().includes(q) || c.aliases.some(a => a.toLowerCase().includes(q))) hint = "";
      else if (c.description.toLowerCase().includes(q)) hint = "Found in description";
      else if (c.biography.toLowerCase().includes(q)) hint = "Found in notes";
      else if (groupOf(c).toLowerCase().includes(q)) hint = `In group ${groupOf(c)}`;
      else {
        for (const f of filesByChar.get(c.id) ?? []) {
          if (`${f.title} ${f.originalName}`.toLowerCase().includes(q)) { hint = `File: ${f.originalName}`; break; }
          if (f.textContent?.toLowerCase().includes(q)) { hint = `Inside file: ${f.originalName}`; break; }
        }
      }
      if (hint !== null) out.set(c.id, hint);
    }
    return out;
  }, [query, visible, lib.media]);

  const shownCharacters = useMemo(() => (matches ? visible.filter(c => matches.has(c.id)) : visible), [matches, visible]);

  const sections = useMemo(() => {
    const list: { name: string; items: Character[]; removable: boolean }[] = lib.groups.map(g => ({ name: g, items: shownCharacters.filter(c => groupOf(c) === g), removable: true }));
    const ungrouped = shownCharacters.filter(c => groupOf(c) === UNGROUPED);
    if (ungrouped.length || lib.groups.length === 0) list.push({ name: UNGROUPED, items: ungrouped, removable: false });
    return matches ? list.filter(s => s.items.length) : list;
  }, [lib.groups, shownCharacters, matches]);

  /* ---------- Actions ---------- */
  const update = useCallback((id: string, patch: Partial<Character>) => {
    edit(l => ({ ...l, characters: l.characters.map(c => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)) }));
  }, [edit]);

  const addMedia = useCallback((files: MediaFile[]) => edit(l => ({ ...l, media: [...files, ...l.media] })), [edit]);

  function openCharacter(id: string) {
    setSelectedId(id); setView("character");
    if (window.innerWidth <= 860) setSidebarOpen(false);
    window.scrollTo?.(0, 0);
  }
  function goHome() { setView("home"); if (window.innerWidth <= 860) setSidebarOpen(false); }

  function createCharacter(name: string, kind: CharacterKind, group: string) {
    const now = new Date().toISOString();
    const c: Character = { id: uid(), kind, name, aliases: [], description: "", biography: "", groupName: group, createdAt: now, updatedAt: now };
    edit(l => ({ ...l, characters: [...l.characters, c] }));
    setShowAdd(false); setQuery("");
    openCharacter(c.id);
    ui.toast("Character created. Add a photo and some notes.");
  }

  async function addGroup() {
    const name = await ui.prompt({ title: "New group", label: "GROUP NAME", placeholder: "e.g. Family, Story cast, Friends", confirmLabel: "Create group" });
    if (!name) return;
    if (name.toLowerCase() === UNGROUPED.toLowerCase() || lib.groups.some(g => g.toLowerCase() === name.toLowerCase())) { ui.toast("That group already exists."); return; }
    edit(l => ({ ...l, groups: [...l.groups, name] }));
    ui.toast(`Group “${name}” created`);
  }

  async function renameGroup(old: string) {
    const name = await ui.prompt({ title: "Rename group", label: "GROUP NAME", initial: old, confirmLabel: "Rename" });
    if (!name || name === old) return;
    if (name.toLowerCase() === UNGROUPED.toLowerCase() || lib.groups.some(g => g !== old && g.toLowerCase() === name.toLowerCase())) { ui.toast("That group name is already used."); return; }
    edit(l => ({ ...l, groups: l.groups.map(g => (g === old ? name : g)), characters: l.characters.map(c => (c.groupName === old ? { ...c, groupName: name } : c)) }));
  }

  async function deleteGroup(name: string) {
    const ok = await ui.confirm(`Delete the group “${name}”? Its characters are kept and moved to Ungrouped.`, { title: "Delete group", confirmLabel: "Delete group", danger: true });
    if (!ok) return;
    edit(l => ({ ...l, groups: l.groups.filter(g => g !== name), characters: l.characters.map(c => (c.groupName === name ? { ...c, groupName: "" } : c)) }));
    ui.toast("Group deleted. Characters were kept.");
  }

  async function deleteCharacter(c: Character) {
    const files = lib.media.filter(m => m.characterId === c.id);
    const extra = files.length
      ? `

${files.length} associated file${files.length === 1 ? "" : "s"} will be PERMANENTLY deleted from this computer's disk, not just removed from PVU.`
      : "";
    const ok = await ui.confirm(`Delete character “${c.name}”?${extra}

This action cannot be undone. If you only want to keep the files, cancel and back them up first.`, { title: "Delete character and its files", confirmLabel: "Delete permanently", danger: true });
    if (!ok) return;
    // Do not remove the character from the index if a stored file could not be deleted.
    // This prevents a failed disk operation from becoming a silent data-loss event.
    try {
      for (const f of files) await deleteFile(f);
    } catch (error) {
      ui.toast(error instanceof Error ? `Character was not deleted: ${error.message}` : "Character was not deleted because one or more files could not be removed.");
      return;
    }
    edit(l => ({ ...l, characters: l.characters.filter(x => x.id !== c.id), media: l.media.filter(m => m.characterId !== c.id) }));
    setView("home"); setSelectedId(null);
    ui.toast(`“${c.name}” deleted`);
  }

  async function changePhoto(character: Character, picked?: File) {
    try {
      let added: MediaFile[];
      if (isDesktop()) added = await pickAndImportDesktop(character.id, character.name, true);
      else if (picked) {
        if (!picked.type.startsWith("image/")) { ui.toast("Please choose an image file."); return; }
        added = await importFiles(character.id, character.name, [picked]);
      } else { photoPicker.current?.click(); return; }
      const first = added[0];
      if (!first) return;
      const url = await resolveUrl(first);
      if (!url) throw new Error("The image could not be loaded.");
      const avatar = await makeAvatar(url);
      addMedia(added);
      update(character.id, { avatarUrl: avatar });
      ui.toast("Profile picture updated");
    } catch (e) { ui.toast(e instanceof Error ? e.message : "Could not change the picture."); }
  }

  function moveToGroup(id: string, group: string) {
    const target = group === UNGROUPED ? "" : group;
    const c = lib.characters.find(x => x.id === id);
    if (!c || (c.groupName || "") === target) return;
    update(id, { groupName: target });
    ui.toast(`Moved ${c.name} to ${group}`);
  }

  const dragProps = (group: string) => ({
    onDragOver: (e: DragEvent) => { if (dragId) { e.preventDefault(); setDropGroup(group); } },
    onDragLeave: (e: DragEvent) => { if (e.currentTarget === e.target) setDropGroup(null); },
    onDrop: (e: DragEvent) => { if (dragId) { e.preventDefault(); moveToGroup(dragId, group); } setDragId(null); setDropGroup(null); },
  });

  /* ---------- Screens ---------- */
  if (load.status === "loading") return <div className="center-screen"><div className="spinner" /><p>Opening your universe…</p></div>;
  if (load.status === "error") {
    return (
      <div className="center-screen">
        <h1>Couldn’t open your library</h1>
        <p className="muted">{load.message}</p>
        <p className="muted small">Nothing has been changed or deleted. Your files are still in your storage folder. Try again, or choose another folder.</p>
        <div className="row-gap">
          <button className="primary-button" onClick={() => { setLoad({ status: "loading" }); void loadLibrary().then(applyLoaded); }}>Try again</button>
          {isDesktop() && <button className="secondary-button" onClick={() => void window.universe?.openStorageFolder()}><FolderOpen size={15} /> Open storage folder</button>}
        </div>
      </div>
    );
  }

  const photoOf = (c: Character) => c.avatarUrl;

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}

      <aside className="sidebar" aria-label="Characters">
        <div className="sidebar-top">
          <div className="brand"><div className="brand-mark"><Users size={17} /></div><div><strong>PERSONAL</strong><span>VIRTUAL UNIVERSE</span></div></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><Menu size={19} /></button>
        </div>

        <button className={`nav-item ${view === "home" ? "active" : ""}`} onClick={goHome}><Users size={16} /><span>All characters</span><small>{visible.length}</small></button>
        <button className="primary-button wide" onClick={() => setShowAdd(true)}><Plus size={16} /> Add character</button>

        <div className="sidebar-list">
          {visible.length === 0 && <p className="sidebar-empty">No characters yet.</p>}
          {[...lib.groups, UNGROUPED].map(group => {
            const items = visible.filter(c => groupOf(c) === group);
            if (group === UNGROUPED && items.length === 0) return null;
            return (
              <div className="sidebar-group" key={group}>
                <div className="sidebar-group-title"><span>{group}</span><small>{items.length}</small></div>
                {items.map(c => (
                  <button key={c.id} className={`sidebar-character ${view === "character" && selectedId === c.id ? "active" : ""}`} onClick={() => openCharacter(c.id)} title={c.name}>
                    <Avatar name={c.name} size="sm" imageUrl={photoOf(c)} /><span>{c.name}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <button className="ghost-button" onClick={() => void addGroup()}><Plus size={15} /> Add group</button>
          <button className="ghost-button" onClick={() => setShowStorage(true)}><FolderCog size={15} /> Storage</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-expanded={sidebarOpen} title={sidebarOpen ? "Hide menu" : "Show menu"}><Menu size={20} /></button>
          <div className="breadcrumbs">
            <button className="crumb-link" onClick={goHome}>Home</button>
            {view === "character" && selected && <><span className="crumb-sep">/</span><strong>{selected.name || "Untitled"}</strong></>}
          </div>
          <label className="global-search">
            <Search size={16} />
            <input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); if (view !== "home") setView("home"); }}
              onKeyDown={e => { if (e.key === "Escape") { setQuery(""); searchRef.current?.blur(); } }}
              placeholder="Search names, notes and file contents…" aria-label="Search" />
            {query ? <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button> : <kbd>Ctrl K</kbd>}
          </label>
        </header>

        <div className="page-content">
          {view === "home" && (
            <section className="home">
              <div className="page-head">
                <div>
                  <div className="eyebrow">YOUR PERSONAL UNIVERSE</div>
                  <h1>{matches ? `Results for “${query.trim()}”` : "Your characters"}</h1>
                  <p className="muted">{matches ? `${shownCharacters.length} match${shownCharacters.length === 1 ? "" : "es"}` : "Drag a character onto a group to move it."}</p>
                </div>
                {!matches && <div className="row-gap"><button className="secondary-button" onClick={() => void addGroup()}><Plus size={15} /> Add group</button><button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={16} /> Add character</button></div>}
              </div>

              {visible.length === 0 && lib.groups.length === 0 ? (
                <div className="empty-state">
                  <Users size={32} />
                  <h3>Your universe starts here</h3>
                  <p>Add a character, give it a photo, then collect its images, videos, documents and notes in one place.</p>
                  <button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={16} /> Add your first character</button>
                </div>
              ) : matches && shownCharacters.length === 0 ? (
                <div className="empty-state"><Search size={30} /><h3>No matches</h3><p>Try a different word. Search covers names, notes, group names, file names and the text inside text files.</p></div>
              ) : (
                sections.map(section => (
                  <section key={section.name} className={`home-group ${dropGroup === section.name ? "drop-target" : ""}`} {...dragProps(section.name)}>
                    <div className="group-head">
                      <h2>{section.name}<span>{section.items.length}</span></h2>
                      {section.removable && !matches && (
                        <div className="group-tools">
                          <button className="icon-button small" onClick={() => void renameGroup(section.name)} aria-label={`Rename ${section.name}`} title="Rename group"><Pencil size={14} /></button>
                          <button className="icon-button small" onClick={() => void deleteGroup(section.name)} aria-label={`Delete ${section.name}`} title="Delete group"><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>
                    {section.items.length === 0 ? <div className="group-empty">Empty group. Drag characters here, or pick this group in a profile.</div> : (
                      <div className="node-grid">
                        {section.items.map(c => (
                          <button key={c.id} className={`node ${dragId === c.id ? "dragging" : ""}`} draggable onClick={() => openCharacter(c.id)}
                            onDragStart={e => { setDragId(c.id); e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
                            onDragEnd={() => { setDragId(null); setDropGroup(null); }}>
                            <Avatar name={c.name} size="lg" imageUrl={photoOf(c)} />
                            <strong>{c.name}</strong>
                            <small>{matches?.get(c.id) || c.description || KIND_LABELS[c.kind]}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                ))
              )}
            </section>
          )}

          {view === "character" && (selected ? (
            <section className="profile">
              <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> All characters</button>
              <div className="profile-head">
                <button className="avatar-button" onClick={() => void changePhoto(selected)} title="Change profile picture" aria-label="Change profile picture">
                  <Avatar name={selected.name} size="xl" imageUrl={photoOf(selected)} />
                  <span className="avatar-edit"><Camera size={15} /></span>
                </button>
                <input ref={photoPicker} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void changePhoto(selected, f); }} />
                <div className="profile-title">
                  <div className="eyebrow">CHARACTER PROFILE</div>
                  <input className="name-input" value={selected.name} aria-label="Name" placeholder="Name"
                    onChange={e => update(selected.id, { name: e.target.value })}
                    onBlur={() => { if (!selected.name.trim()) update(selected.id, { name: "Untitled" }); }} />
                </div>
                <button className="danger-outline" onClick={() => void deleteCharacter(selected)}><Trash2 size={15} /> Delete</button>
              </div>

              <div className="fields">
                <label className="field-label">GROUP
                  <select value={selected.groupName || ""} onChange={e => update(selected.id, { groupName: e.target.value })}>
                    <option value="">{UNGROUPED}</option>
                    {lib.groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="field-label">CATEGORY
                  <select value={selected.kind} onChange={e => update(selected.id, { kind: e.target.value as CharacterKind })}>
                    {(Object.keys(KIND_LABELS) as CharacterKind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                  </select>
                </label>
                <AliasesField key={selected.id} aliases={selected.aliases} onCommit={aliases => update(selected.id, { aliases })} />
                <label className="field-label full">SHORT DESCRIPTION
                  <input value={selected.description} onChange={e => update(selected.id, { description: e.target.value })} placeholder="One line shown on the home board" maxLength={140} />
                </label>
                <label className="field-label full">NOTES
                  <textarea rows={6} value={selected.biography} onChange={e => update(selected.id, { biography: e.target.value })} placeholder="Background, traits, story, anything you want to remember. Everything here is searchable." />
                </label>
              </div>

              <CharacterMediaPanel
                key={selected.id}
                character={selected}
                files={selectedFiles}
                collections={lib.collections.filter(c => c.characterId === selected.id)}
                onCollectionsChange={collections => edit(l => ({ ...l, collections: [...l.collections.filter(c => c.characterId !== selected.id), ...collections] }))}
                onAdd={addMedia}
                onChange={(id, patch) => edit(l => ({ ...l, media: l.media.map(m => (m.id === id ? { ...m, ...patch } : m)) }))}
                onRemove={id => edit(l => ({ ...l, media: l.media.filter(m => m.id !== id) }))}
                onAvatar={avatarUrl => update(selected.id, { avatarUrl })}
              />
            </section>
          ) : (
            <div className="empty-state"><h3>Character not found</h3><button className="secondary-button" onClick={goHome}>Back to all characters</button></div>
          ))}
        </div>
      </main>

      {showAdd && <AddCharacterModal groups={lib.groups} onClose={() => setShowAdd(false)} onCreate={createCharacter} />}
      {showStorage && <StorageModal onClose={() => setShowStorage(false)} flush={flush} reload={() => loadLibrary().then(applyLoaded)} />}
    </div>
  );
}

function AliasesField({ aliases, onCommit }: { aliases: string[]; onCommit: (a: string[]) => void }) {
  const [text, setText] = useState(aliases.join(", "));
  return (
    <label className="field-label">ALSO KNOWN AS
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Nicknames, separated by commas"
        onBlur={() => onCommit(text.split(",").map(s => s.trim()).filter(Boolean))} />
    </label>
  );
}

function AddCharacterModal({ groups, onClose, onCreate }: { groups: string[]; onClose: () => void; onCreate: (name: string, kind: CharacterKind, group: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CharacterKind>("fictional");
  const [group, setGroup] = useState("");
  return (
    <Modal title="Add a character" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), kind, group); }}>
        <label className="field-label">NAME<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Character name" maxLength={80} /></label>
        <label className="field-label">CATEGORY
          <select value={kind} onChange={e => setKind(e.target.value as CharacterKind)}>
            {(Object.keys(KIND_LABELS) as CharacterKind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="field-label">GROUP
          <select value={group} onChange={e => setGroup(e.target.value)}>
            <option value="">{UNGROUPED}</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!name.trim()}><Plus size={16} /> Create</button>
        </div>
      </form>
    </Modal>
  );
}

function StorageModal({ onClose, flush, reload }: { onClose: () => void; flush: () => Promise<boolean>; reload: () => Promise<void> }) {
  const ui = useUi();
  const [root, setRoot] = useState<string | null>(null);
  const desktop = isDesktop();

  useEffect(() => { void window.universe?.getInfo().then(i => setRoot(i.mediaRoot)).catch(() => undefined); }, []);

  async function change() {
    if (!(await flush())) {
      ui.toast("Your latest changes could not be saved. Storage was not changed.");
      return;
    }
    const r = await window.universe?.chooseStorageFolder();
    if (!r) return;
    if (r.ok && r.mediaRoot) { setRoot(r.mediaRoot); await reload(); ui.toast("Storage folder changed"); onClose(); }
    else if (r.error) ui.toast(r.error);
  }

  async function useExisting() {
    if (!(await flush())) { ui.toast("Your latest changes could not be saved. Storage was not changed."); return; }
    const r = await window.universe?.adoptExistingStorageFolder();
    if (!r) return;
    if (r.ok && r.mediaRoot) { setRoot(r.mediaRoot); await reload(); ui.toast("Existing data folder connected. PVU will sync file changes automatically."); onClose(); }
    else if (r.error) ui.toast(r.error);
  }

  return (
    <Modal title="Where your data is stored" onClose={onClose}>
      {desktop ? (
        <>
          <p className="modal-text">This is your PVU vault: characters, notes and media live together in one normal Windows folder. Back it up by copying the whole folder.</p>
          <div className="path-box" title={root ?? ""}>{root ?? "…"}</div>
          <p className="muted small">Use “Connect existing data folder” to recover a PVU folder from an old laptop without copying or moving the source. PVU checks the folder periodically for file additions, renames and deletions; changes made in PVU are saved to this same folder.</p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => void window.universe?.openStorageFolder()}><FolderOpen size={15} /> Open folder</button>
            <button className="secondary-button" onClick={() => void useExisting()}><FolderOpen size={15} /> Connect existing data folder</button>
            <button className="primary-button" onClick={() => void change()}><FolderCog size={15} /> Copy to another folder</button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-text">You’re using the browser version, so everything is saved inside this browser only. Clearing site data would remove it.</p>
          <p className="muted small">For permanent storage in a folder you choose, use the desktop app (npm run dev, or the installed Windows app).</p>
          <div className="modal-actions"><button className="primary-button" onClick={onClose}>OK</button></div>
        </>
      )}
    </Modal>
  );
}
