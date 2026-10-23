import type { MediaFile } from "./models";

export {};

type Ok = { ok: true };
type Fail = { ok: false; error: string };
type Result<T = object> = (Ok & T) | Fail;

declare global {
  interface Window {
    /** Present only when running inside the Electron desktop app. */
    universe?: {
      getInfo: () => Promise<{ appName: string; version: string; dataRoot: string; mediaRoot: string }>;
      chooseStorageFolder: () => Promise<{ ok: boolean; canceled?: boolean; mediaRoot?: string; error?: string }>;
      adoptExistingStorageFolder: () => Promise<{ ok: boolean; canceled?: boolean; mediaRoot?: string; error?: string }>;
      syncStorageFolder: () => Promise<Result<{ data: string }>>;
      openStorageFolder: () => Promise<Result>;
      loadLibrary: () => Promise<Result<{ data: string | null }>>;
      saveLibrary: (json: string) => Promise<Result>;
      importCharacterMedia: (characterId: string, characterName: string, imagesOnly?: boolean) => Promise<Result<{ files: MediaFile[] }>>;
      importPaths: (characterId: string, characterName: string, paths: string[]) => Promise<Result<{ files: MediaFile[] }>>;
      getPathForFile: (file: File) => string;
      readTextMedia: (relativePath: string) => Promise<Result<{ content: string }>>;
      writeTextMedia: (relativePath: string, content: string) => Promise<Result>;
      openMedia: (relativePath: string) => Promise<Result>;
      revealMedia: (relativePath: string) => Promise<Result>;
      deleteMediaFile: (relativePath: string) => Promise<Result>;
      organizeMediaFile: (args: { relativePath: string; characterId: string; characterName: string; kind: "album" | "playlist"; collectionId?: string; collectionName?: string; action: "move" | "copy"; newMediaId?: string }) => Promise<Result<{ relativePath: string; fileSize: number }>>;
      moveMediaToLibraryRoot: (args: { relativePath: string; characterId: string; characterName: string; kind: "album" | "playlist" }) => Promise<Result<{ relativePath: string; fileSize: number }>>;
      renameMediaCollectionFolder: (args: { characterId: string; characterName: string; kind: "album" | "playlist"; collectionId: string; oldName: string; newName: string }) => Promise<Result<{ oldPrefix?: string; newPrefix?: string }>>;
      ensureMediaCollectionFolder: (args: { characterId: string; characterName: string; kind: "album" | "playlist"; collectionId: string; collectionName: string }) => Promise<Result>;
    };
  }
}
