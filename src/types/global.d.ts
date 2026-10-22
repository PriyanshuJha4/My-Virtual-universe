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
    };
  }
}
