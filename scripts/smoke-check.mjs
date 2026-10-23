import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(pkg.name, "personal-virtual-universe");
assert.ok(pkg.scripts.dev, "missing dev script");
assert.ok(pkg.scripts.build, "missing build script");
assert.ok(pkg.scripts.typecheck, "missing typecheck script");
for (const file of [
  "electron/main.ts",
  "electron/preload.ts",
  "src/App.tsx",
  "src/components/CharacterMediaPanel.tsx",
  "src/services/library.ts",
  "src/services/media.ts",
  "src/types/models.ts",
]) await access(resolve(root, file));

const main = await readFile(resolve(root, "electron/main.ts"), "utf8");
const preload = await readFile(resolve(root, "electron/preload.ts"), "utf8");
const app = await readFile(resolve(root, "src/App.tsx"), "utf8");
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /sandbox:\s*true/);
assert.match(preload, /contextBridge\.exposeInMainWorld\("universe"/);
assert.match(app, /Delete group/);
assert.match(app, /Delete character/);
assert.doesNotMatch(main, /MODEL_EXTENSIONS|3D models/);
assert.match(main, /media:organize-collection/);
assert.match(main, /media:move-to-library-root/);
assert.match(main, /media:rename-collection-folder/);
assert.match(main, /record\.version === 3 \|\| record\.version === 4/, "library save handler must accept current v4 schema");
assert.match(main, /validCollections/, "v4 collection schema must be validated");
assert.match(main, /storage:adopt-existing-folder/, "existing vault adoption must be available");
assert.match(main, /storage:sync-folder/, "filesystem reconciliation must be available");
assert.match(main, /unreadable or damaged/, "sync must fail safely on a damaged library");
assert.match(preload, /syncStorageFolder/);
assert.match(app, /Connect existing data folder/);
assert.match(app, /onCollectionsChange/);
const mediaPanel = await readFile(resolve(root, "src/components/CharacterMediaPanel.tsx"), "utf8");
assert.match(mediaPanel, /bulkOrganize\("move"\)/);
assert.match(mediaPanel, /bulkOrganize\("copy"\)/);
assert.match(mediaPanel, /bulkRemoveFromCollection/);
console.log("PVU smoke checks passed. These checks validate project structure and security configuration; they do not replace typecheck, build, or runtime tests.");

assert.match(mediaPanel, /Permanently delete file from disk/);
assert.match(mediaPanel, /deleted from File Explorer too/);
assert.match(mediaPanel, /Remove from this collection/);
assert.match(app, /PERMANENTLY deleted from this computer's disk/);
