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
