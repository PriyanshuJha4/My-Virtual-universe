export type CharacterKind = "real" | "fictional" | "ai_character" | "self";

export const KIND_LABELS: Record<CharacterKind, string> = {
  real: "Real person",
  fictional: "Fictional character",
  ai_character: "AI character",
  self: "My virtual self",
};

export interface Character {
  id: string;
  kind: CharacterKind;
  name: string;
  aliases: string[];
  description: string;
  biography: string;
  /** Small profile picture stored as a data URL. */
  avatarUrl?: string;
  /** User-defined group name. Empty / missing means "Ungrouped". */
  groupName?: string;
  /** Legacy flag from older versions. Archived characters stay hidden but are never deleted. */
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  characterId: string;
  title: string;
  originalName: string;
  /** Desktop: path relative to the storage folder. Browser: "browser:<id>". */
  relativePath: string;
  mimeType: string;
  fileSize: number;
  addedAt: string;
  /** First part of text files, used only for search. */
  textContent?: string;
}

export interface MediaCollection {
  id: string;
  characterId: string;
  kind: "album" | "playlist";
  name: string;
  /** IDs of existing media files; collections never duplicate the original media. */
  mediaIds: string[];
  /** Optional cover chosen from existing media. */
  thumbnailMediaId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Library {
  version: 4;
  characters: Character[];
  groups: string[];
  media: MediaFile[];
  collections: MediaCollection[];
}

export const UNGROUPED = "Ungrouped";
