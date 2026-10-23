import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("universe", {
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  chooseStorageFolder: () => ipcRenderer.invoke("storage:choose-folder"),
  adoptExistingStorageFolder: () => ipcRenderer.invoke("storage:adopt-existing-folder"),
  syncStorageFolder: () => ipcRenderer.invoke("storage:sync-folder"),
  openStorageFolder: () => ipcRenderer.invoke("storage:open-folder"),
  loadLibrary: () => ipcRenderer.invoke("library:load"),
  saveLibrary: (json: string) => ipcRenderer.invoke("library:save", json),
  importCharacterMedia: (characterId: string, characterName: string, imagesOnly = false) => ipcRenderer.invoke("media:import-character", characterId, characterName, imagesOnly),
  importPaths: (characterId: string, characterName: string, paths: string[]) => ipcRenderer.invoke("media:import-paths", characterId, characterName, paths),
  // Dropped File objects don't expose their path directly in modern Electron; this resolves it.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readTextMedia: (relativePath: string) => ipcRenderer.invoke("media:read-text", relativePath),
  writeTextMedia: (relativePath: string, content: string) => ipcRenderer.invoke("media:write-text", relativePath, content),
  openMedia: (relativePath: string) => ipcRenderer.invoke("media:open", relativePath),
  revealMedia: (relativePath: string) => ipcRenderer.invoke("media:reveal", relativePath),
  deleteMediaFile: (relativePath: string) => ipcRenderer.invoke("media:delete", relativePath),
  organizeMediaFile: (args: { relativePath: string; characterId: string; characterName: string; kind: "album" | "playlist"; collectionId?: string; collectionName?: string; action: "move" | "copy"; newMediaId?: string }) => ipcRenderer.invoke("media:organize-collection", args),
  moveMediaToLibraryRoot: (args: { relativePath: string; characterId: string; characterName: string; kind: "album" | "playlist" }) => ipcRenderer.invoke("media:move-to-library-root", args),
  renameMediaCollectionFolder: (args: { characterId: string; characterName: string; kind: "album" | "playlist"; collectionId: string; oldName: string; newName: string }) => ipcRenderer.invoke("media:rename-collection-folder", args),
  ensureMediaCollectionFolder: (args: { characterId: string; characterName: string; kind: "album" | "playlist"; collectionId: string; collectionName: string }) => ipcRenderer.invoke("media:ensure-collection-folder", args),
});
