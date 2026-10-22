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
      if (record.version !== 3 || !Array.isArray(record.characters) || !Array.isArray(record.groups) || !Array.isArray(record.media)) {
        throw new Error("Library data does not match the supported schema (version 3). Nothing was saved.");
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
