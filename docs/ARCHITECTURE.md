# Architecture

- `electron/main.ts`: Electron lifecycle, secure BrowserWindow configuration, local storage, IPC handlers, media protocol, imports and file operations.
- `electron/preload.ts`: minimal bridge from renderer to IPC.
- `src/App.tsx`: character/group dashboard, profile editing, search, persistence scheduling, and storage dialog.
- `src/components/CharacterMediaPanel.tsx`: file organization, image/video lightbox, and text editor.
- `src/components/Ui.tsx`: accessible in-app confirmation/prompt dialogs and toast notifications.
- `src/services/library.ts`: library normalization, browser legacy migration, and persistence interface.
- `src/services/media.ts`: file classification, browser IndexedDB fallback, media URLs, and media operations.
- `src/types/models.ts`: stable character/media identifiers and library data model.

The desktop data format is `library.json` (schema version 3). Character and media IDs are preserved by normalizing existing data rather than regenerating IDs. Groups are currently represented as names, not separate stable group IDs.

## Albums and playlists (library schema v4)

- `MediaCollection` records live in `library.json` under `collections` and are scoped to a character.
- Image collections use `kind: "album"`; video collections use `kind: "playlist"`.
- Collections store media IDs, not copies of files. A media item can belong to multiple collections.
- `thumbnailMediaId` points to an existing media record so the user can change the cover without duplicating image/video data.
- `normalizeLibrary` migrates v3 data in memory to v4 while preserving character and media IDs. Existing libraries gain an empty collections list.
