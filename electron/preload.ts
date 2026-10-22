import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("universe", {
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  chooseStorageFolder: () => ipcRenderer.invoke("storage:choose-folder"),
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
});
