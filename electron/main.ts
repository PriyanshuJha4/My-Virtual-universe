import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const MEDIA_SCHEME = "pvu-media";

// Must be called before the app is ready. Lets the page load stored files (with seeking for video) from a safe custom address.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const TEXT_EXTENSIONS = [".md", ".markdown", ".txt", ".csv", ".json", ".html", ".rtf", ".log"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".avif"];
const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".ogv"];
const DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ...TEXT_EXTENSIONS];

function mimeForExtension(extension: string): string {
  const types: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".webm": "video/webm", ".avi": "video/x-msvideo", ".ogv": "video/ogg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac",
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".rtf": "application/rtf", ".log": "text/plain",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  };
  return types[extension.toLowerCase()] ?? "application/octet-stream";
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0a0b10",
    title: "Personal Virtual Universe",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });

  // Links open in the normal browser; the app window never navigates away (also stops a dropped file from replacing the page).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", event => event.preventDefault());

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

async function start() {
  const dataRoot = path.join(app.getPath("userData"), "universe-data");
  const legacyMediaRoot = path.join(dataRoot, "media");
  const storageSettingsPath = path.join(dataRoot, "storage-settings.json");
  await mkdir(legacyMediaRoot, { recursive: true });

  let activeMediaRoot = legacyMediaRoot;
  try {
    const saved = JSON.parse(await readFile(storageSettingsPath, "utf8")) as { mediaRoot?: string };
    if (typeof saved.mediaRoot === "string" && path.isAbsolute(saved.mediaRoot)) {
      activeMediaRoot = path.resolve(saved.mediaRoot);
      await mkdir(activeMediaRoot, { recursive: true });
    }
  } catch { /* first launch, or the saved folder is unavailable: use the default folder */ }

  /** Registers an IPC handler that always answers with { ok: false, error } instead of throwing. */
  function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args) => {
      try { return await fn(event, ...args); }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    });
  }

  function resolveMediaPath(relativePath: unknown): string {
    if (typeof relativePath !== "string" || !relativePath.trim()) throw new Error("Invalid file path.");
    if (path.isAbsolute(relativePath)) throw new Error("Absolute file paths are not allowed.");
    const fullPath = path.resolve(activeMediaRoot, relativePath);
    if (fullPath !== activeMediaRoot && !fullPath.startsWith(activeMediaRoot + path.sep)) throw new Error("That file is outside the storage folder.");
    return fullPath;
  }

  /* ---------- Serve stored files to the page ---------- */
  protocol.handle(MEDIA_SCHEME, async request => {
    const cors = { "Access-Control-Allow-Origin": "*" };
    try {
      const url = new URL(request.url);
      const full = resolveMediaPath(decodeURIComponent(url.pathname).replace(/^\/+/, ""));
      const { size } = await stat(full);
      const type = mimeForExtension(path.extname(full));
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match) {
          let start: number;
          let end: number;
          if (match[1] === "") { const suffix = parseInt(match[2], 10); start = Math.max(0, size - suffix); end = size - 1; }
          else { start = parseInt(match[1], 10); end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1; }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
            return new Response(null, { status: 416, headers: { ...cors, "Content-Range": `bytes */${size}` } });
          }
          const body = Readable.toWeb(createReadStream(full, { start, end })) as any;
          return new Response(body, { status: 206, headers: { ...cors, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
        }
      }
      const body = Readable.toWeb(createReadStream(full)) as any;
      return new Response(body, { status: 200, headers: { ...cors, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(size) } });
    } catch {
      return new Response("Not found", { status: 404, headers: cors });
    }
  });

  /* ---------- App info & storage folder ---------- */
  let backedUpThisRun = false;

  handle("app:get-info", () => ({ appName: app.getName(), version: app.getVersion(), dataRoot, mediaRoot: activeMediaRoot }));

  handle("storage:open-folder", async () => {
    const error = await shell.openPath(activeMediaRoot);
    return error ? { ok: false, error } : { ok: true };
  });

  async function copyDirectoryWithoutOverwrite(sourceDir: string, targetDir: string): Promise<void> {
    if (path.resolve(sourceDir).toLowerCase() === path.resolve(targetDir).toLowerCase()) return;
    await mkdir(targetDir, { recursive: true });
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await copyDirectoryWithoutOverwrite(source, target);
      } else if (entry.isFile()) {
        let targetExists = false;
        try {
          await stat(target);
          targetExists = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetExists) {
          const [sourceHash, targetHash] = await Promise.all([hashFile(source), hashFile(target)]);
          if (sourceHash !== targetHash) {
            throw new Error(`Storage move stopped: destination already contains a different file named "${entry.name}". Choose an empty folder.`);
          }
        } else {
          await copyFile(source, target);
          const [sourceInfo, targetInfo, sourceHash, targetHash] = await Promise.all([
            stat(source), stat(target), hashFile(source), hashFile(target),
          ]);
          if (sourceInfo.size !== targetInfo.size || sourceHash !== targetHash) {
            throw new Error(`Storage move verification failed for "${entry.name}". The original library has been kept.`);
          }
        }
      }
    }
  }

  handle("storage:choose-folder", async event => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { title: "Choose a folder for your Personal Virtual Universe data", defaultPath: activeMediaRoot, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true, mediaRoot: activeMediaRoot };

    const chosen = path.resolve(result.filePaths[0]);
    const current = path.resolve(activeMediaRoot);
    const isInside = (child: string, parent: string) => child.toLowerCase().startsWith(parent.toLowerCase() + path.sep);
    if (chosen.toLowerCase() !== current.toLowerCase() && (isInside(chosen, current) || isInside(current, chosen))) {
      return { ok: false, error: "Please choose a separate folder, not one inside (or containing) the current storage folder." };
    }
    await mkdir(chosen, { recursive: true });
    if (chosen.toLowerCase() !== current.toLowerCase()) await copyDirectoryWithoutOverwrite(current, chosen);
    activeMediaRoot = chosen;
    backedUpThisRun = false;
    await writeFile(storageSettingsPath, JSON.stringify({ mediaRoot: activeMediaRoot }, null, 2), "utf8");
    return { ok: true, mediaRoot: activeMediaRoot };
  });

  /* ---------- Library (characters, groups, file list) ---------- */
  const libraryFile = () => path.join(activeMediaRoot, "library.json");
  const backupFile = () => path.join(activeMediaRoot, "library.backup.json");
  let saveQueue: Promise<unknown> = Promise.resolve();

  handle("library:load", async () => {
    let text: string;
    try { text = await readFile(libraryFile(), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, data: null };
      throw error;
    }
    try { JSON.parse(text); return { ok: true, data: text }; } catch { /* damaged: try the backup below */ }
    try {
      const backup = await readFile(backupFile(), "utf8");
      JSON.parse(backup);
      await copyFile(libraryFile(), path.join(activeMediaRoot, `library.damaged-${Date.now()}.json`));
      await writeFile(libraryFile(), backup, "utf8");
      return { ok: true, data: backup };
    } catch {
      throw new Error("The library file in your storage folder is damaged and no usable backup was found.");
    }
  });

  handle("library:save", (_event, json: unknown) => {
    if (typeof json !== "string" || json.length > 200_000_000) throw new Error("Invalid library data.");
    const run = async () => {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Library data must be a JSON object.");
      const record = parsed as Record<string, unknown>;
      // The renderer's current schema is v4 (adds collections for albums/playlists).
      // Accept v3 as well so older libraries can still be saved after migration.
      const supportedVersion = record.version === 3 || record.version === 4;
      const validBase = Array.isArray(record.characters) && Array.isArray(record.groups) && Array.isArray(record.media);
      const validCollections = record.version !== 4 || Array.isArray(record.collections);
      if (!supportedVersion || !validBase || !validCollections) {
        throw new Error("Library data does not match the supported schema (version 3 or 4). Nothing was saved.");
      }
      const target = libraryFile();
      if (!backedUpThisRun) {
        try {
          await copyFile(target, backupFile());
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new Error(`Could not create a safety backup, so the library was not changed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        backedUpThisRun = true;
      }
      const temp = `${target}.tmp`;
      await writeFile(temp, json, "utf8");
      await rename(temp, target);
      return { ok: true };
    };
    const next = saveQueue.then(run, run);
    saveQueue = next.catch(() => undefined);
    return next;
  });

  /* ---------- Importing files ---------- */
  async function importSources(characterId: unknown, characterName: unknown, sources: string[]) {
    if (typeof characterId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(characterId)) throw new Error("Invalid character.");
    const safeName = (typeof characterName === "string" ? characterName : "Character").normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70) || "Character";
    const characterDir = path.join(activeMediaRoot, "Characters", `${safeName}_${characterId.slice(0, 8)}`);
    // Keep the documented per-character layout consistent, even before the user imports every type.
    await Promise.all(["Profile", "Photos", "Videos", "Documents", "Other"].map(folder => mkdir(path.join(characterDir, folder), { recursive: true })));
    const imported = [];
    const failures: string[] = [];
    for (const source of sources) {
      if (typeof source !== "string" || !path.isAbsolute(source)) continue;
      let info;
      try { info = await stat(source); } catch { continue; }
      if (!info.isFile()) continue;
      try {
      const id = randomUUID();
      const extension = path.extname(source).toLowerCase();
      const folder = IMAGE_EXTENSIONS.includes(extension) ? "Photos" : VIDEO_EXTENSIONS.includes(extension) ? "Videos" : DOCUMENT_EXTENSIONS.includes(extension) ? "Documents" : "Other";
      const targetDir = path.join(characterDir, folder);
      await mkdir(targetDir, { recursive: true });
      const originalName = path.basename(source);
      const safeFile = originalName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 140) || "file";
      const destination = path.join(targetDir, `${id.slice(0, 8)}-${safeFile}`);
      await copyFile(source, destination);
      const stored = await stat(destination);
      const textContent = TEXT_EXTENSIONS.includes(extension) && stored.size <= 2 * 1024 * 1024 ? (await readFile(destination, "utf8")).slice(0, 30_000) : undefined;
      imported.push({
        id, characterId,
        title: path.basename(source, path.extname(source)),
        originalName,
        relativePath: path.relative(activeMediaRoot, destination),
        mimeType: mimeForExtension(extension),
        fileSize: stored.size,
        addedAt: new Date().toISOString(),
        textContent,
      });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const reason = code === "ENOSPC" ? "not enough disk space" : code === "EBUSY" || code === "EPERM" || code === "EACCES" ? "the file is in use or access was denied" : error instanceof Error ? error.message : String(error);
        failures.push(`${path.basename(source)} (${reason})`);
      }
    }
    if (!imported.length && failures.length) throw new Error(`Could not copy: ${failures.join("; ")}`);
    return imported;
  }

  handle("media:import-character", async (event, characterId: unknown, characterName: unknown, imagesOnly: unknown) => {
    const onlyImages = imagesOnly === true;
    const exts = (list: string[]) => list.map(e => e.slice(1));
    const options = {
      title: onlyImages ? "Choose a picture" : "Add files",
      properties: (onlyImages ? ["openFile"] : ["openFile", "multiSelections"]) as ("openFile" | "multiSelections")[],
      filters: onlyImages
        ? [{ name: "Images", extensions: exts(IMAGE_EXTENSIONS) }]
        : [
            // Put a real, explicit extension list first. Some Windows file dialogs
            // remember the previous Images-only filter, and a wildcard-only filter
            // may not reset it reliably. This first option must include MP4.
            {
              name: "All supported files",
              extensions: exts([
                ...IMAGE_EXTENSIONS,
                ...VIDEO_EXTENSIONS,
                ...DOCUMENT_EXTENSIONS,
                ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
                ".glb", ".gltf",
              ]),
            },
            { name: "All files", extensions: ["*"] },
            { name: "Images", extensions: exts(IMAGE_EXTENSIONS) },
            { name: "Videos", extensions: exts(VIDEO_EXTENSIONS) },
            { name: "Documents", extensions: exts(DOCUMENT_EXTENSIONS) },
          ],
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return { ok: true, files: [] };
    return { ok: true, files: await importSources(characterId, characterName, result.filePaths) };
  });

  handle("media:import-paths", async (_event, characterId: unknown, characterName: unknown, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length > 500) throw new Error("Invalid file list.");
    const files = await importSources(characterId, characterName, paths.filter((p): p is string => typeof p === "string"));
    if (!files.length) throw new Error("Nothing could be imported. Drop files, not folders.");
    return { ok: true, files };
  });

  /* ---------- Physical album / playlist folders ---------- */
  function safeFolderName(value: unknown, fallback: string) {
    const cleaned = (typeof value === "string" ? value : fallback).normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
    return cleaned || fallback;
  }
  function validateCollectionArgs(args: any) {
    if (!args || typeof args !== "object") throw new Error("Invalid collection operation.");
    if (typeof args.characterId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.characterId)) throw new Error("Invalid character.");
    if (args.kind !== "album" && args.kind !== "playlist") throw new Error("Invalid collection type.");
    if (typeof args.collectionId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.collectionId)) throw new Error("Invalid collection ID.");
  }
  async function findOrCreateCharacterDir(characterId: string, characterName: string) {
    const charsRoot = path.join(activeMediaRoot, "Characters");
    await mkdir(charsRoot, { recursive: true });
    const suffix = `_${characterId.slice(0, 8)}`;
    try {
      const entries = await readdir(charsRoot, { withFileTypes: true });
      const found = entries.find(entry => entry.isDirectory() && entry.name.endsWith(suffix));
      if (found) return path.join(charsRoot, found.name);
    } catch { /* create below */ }
    const folder = `${safeFolderName(characterName, "Character")}${suffix}`;
    const result = path.join(charsRoot, folder);
    await mkdir(result, { recursive: true });
    return result;
  }
  function mediaTypeFolder(kind: "album" | "playlist") { return kind === "album" ? "Photos" : "Videos"; }
  function collectionFolderName(name: string, id: string) { return `${safeFolderName(name, "Collection")}_${id.slice(0, 8)}`; }
  async function getCollectionFolder(args: any, create = true) {
    validateCollectionArgs(args);
    const characterDir = await findOrCreateCharacterDir(args.characterId, String(args.characterName || "Character"));
    const typeRoot = path.join(characterDir, mediaTypeFolder(args.kind));
    const subRoot = path.join(typeRoot, args.kind === "album" ? "Albums" : "Playlists");
    const folderName = collectionFolderName(String(args.collectionName || "Collection"), args.collectionId);
    const target = path.join(subRoot, folderName);
    if (create) await mkdir(target, { recursive: true });
    return { characterDir, typeRoot, subRoot, target, folderName };
  }
  async function moveOrCopyMedia(args: any, action: "move" | "copy", toRoot = false) {
    if (!args || typeof args !== "object") throw new Error("Invalid media operation.");
    const source = resolveMediaPath(args.relativePath);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) throw new Error("Only files can be organized.");
    if (typeof args.characterId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.characterId)) throw new Error("Invalid character.");
    const ext = path.extname(source).toLowerCase();
    const actualKind = IMAGE_EXTENSIONS.includes(ext) ? "album" : VIDEO_EXTENSIONS.includes(ext) ? "playlist" : null;
    if (!actualKind || actualKind !== args.kind) throw new Error("This file type does not match the selected collection.");
    const parts = path.relative(activeMediaRoot, source).split(path.sep);
    if (parts[0] !== "Characters" || parts.length < 3 || !parts[1].endsWith(`_${args.characterId.slice(0, 8)}`)) throw new Error("This file does not belong to the selected character.");
    const characterDir = path.join(activeMediaRoot, "Characters", parts[1]);
    const typeRoot = path.join(characterDir, mediaTypeFolder(args.kind));
    let destinationDir = typeRoot;
    let destinationId = action === "copy" ? args.newMediaId : args.mediaId;
    if (action === "copy" && (typeof destinationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(destinationId))) throw new Error("Invalid new media ID for copy.");
    if (!toRoot) {
      const target = await getCollectionFolder(args, true);
      destinationDir = target.target;
    } else {
      await mkdir(destinationDir, { recursive: true });
    }
    const baseName = path.basename(source).replace(/^[a-f0-9-]{8,36}-/i, "");
    const safeName = baseName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 140) || "media";
    const prefix = action === "copy" ? String(destinationId).slice(0, 8) : path.basename(source).split("-")[0];
    const destination = path.join(destinationDir, `${prefix}-${safeName}`);
    if (path.resolve(source) === path.resolve(destination)) return { relativePath: path.relative(activeMediaRoot, source), fileSize: sourceStat.size };
    await mkdir(destinationDir, { recursive: true });
    if (action === "copy") {
      await copyFile(source, destination);
    } else {
      try { await rename(source, destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await copyFile(source, destination);
        await unlink(source);
      }
    }
    const stored = await stat(destination);
    return { relativePath: path.relative(activeMediaRoot, destination), fileSize: stored.size };
  }
  handle("media:ensure-collection-folder", async (_event, args: any) => {
    await getCollectionFolder(args, true);
    return { ok: true };
  });
  handle("media:organize-collection", async (_event, args: any) => {
    if (args?.action !== "move" && args?.action !== "copy") throw new Error("Invalid operation.");
    return { ok: true, ...await moveOrCopyMedia(args, args.action, false) };
  });
  handle("media:move-to-library-root", async (_event, args: any) => ({ ok: true, ...await moveOrCopyMedia({ ...args, mediaId: "root" }, "move", true) }));
  handle("media:rename-collection-folder", async (_event, args: any) => {
    validateCollectionArgs({ ...args, collectionName: args?.oldName });
    const characterDir = await findOrCreateCharacterDir(args.characterId, String(args.characterName || "Character"));
    const typeRoot = path.join(characterDir, mediaTypeFolder(args.kind));
    const subRoot = path.join(typeRoot, args.kind === "album" ? "Albums" : "Playlists");
    const suffix = `_${args.collectionId.slice(0, 8)}`;
    let oldFolder: string | undefined;
    try { oldFolder = (await readdir(subRoot, { withFileTypes: true })).find(e => e.isDirectory() && e.name.endsWith(suffix))?.name; } catch { /* no folder yet */ }
    if (!oldFolder) return { ok: true };
    const nextFolder = collectionFolderName(String(args.newName || "Collection"), args.collectionId);
    const oldPath = path.join(subRoot, oldFolder);
    const newPath = path.join(subRoot, nextFolder);
    if (oldPath !== newPath) {
      try { await rename(oldPath, newPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { ok: true, oldPrefix: path.relative(activeMediaRoot, oldPath), newPrefix: path.relative(activeMediaRoot, newPath) };
  });

  /* ---------- Reading, editing, opening, deleting ---------- */
  handle("media:read-text", async (_event, relativePath: unknown) => {
    const fullPath = resolveMediaPath(relativePath);
    if (!TEXT_EXTENSIONS.includes(path.extname(fullPath).toLowerCase())) throw new Error("Only text and Markdown files can be edited in the app.");
    if ((await stat(fullPath)).size > 2 * 1024 * 1024) throw new Error("The in-app editor supports files up to 2 MB. Use Open to edit larger files.");
    return { ok: true, content: await readFile(fullPath, "utf8") };
  });

  handle("media:write-text", async (_event, relativePath: unknown, content: unknown) => {
    const fullPath = resolveMediaPath(relativePath);
    if (typeof content !== "string" || content.length > 2_000_000) throw new Error("The text is too large for the editor (2 MB limit).");
    if (!TEXT_EXTENSIONS.includes(path.extname(fullPath).toLowerCase())) throw new Error("Only text and Markdown files can be edited in the app.");
    await writeFile(fullPath, content, "utf8");
    return { ok: true };
  });

  handle("media:open", async (_event, relativePath: unknown) => {
    const error = await shell.openPath(resolveMediaPath(relativePath));
    return error ? { ok: false, error } : { ok: true };
  });

  handle("media:reveal", async (_event, relativePath: unknown) => {
    const fullPath = resolveMediaPath(relativePath);
    await stat(fullPath);
    shell.showItemInFolder(fullPath);
    return { ok: true };
  });

  handle("media:delete", async (_event, relativePath: unknown) => {
    try { await unlink(resolveMediaPath(relativePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } // already gone is fine
    return { ok: true };
  });

  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running; two copies writing the same library could lose changes.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox("Personal Virtual Universe could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
