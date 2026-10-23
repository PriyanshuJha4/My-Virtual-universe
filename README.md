# Personal Virtual Universe (PVU)

A local-first Electron + React + TypeScript + Vite desktop app for organizing people and fictional characters, their profiles, groups, and associated files. The app does not require a backend or cloud account.

## Requirements

- Node.js 20 or newer
- npm
- Windows/macOS/Linux desktop environment for running Electron

## Install and run

```bash
npm install
npm run dev
```

## Validate and build

```bash
npm run test:smoke
npm run typecheck
npm run build
```

For a Windows installer:

```bash
npm run dist:win
```

Build artifacts are generated into `dist/`, `dist-electron/`, and `release/`; these generated folders are not source files and are intentionally not included in the source archive.

## Storage

The desktop app starts with a local folder under Electron's `userData` directory. Open **Storage** in the sidebar to see the current path, open it, or choose another folder. Library metadata is stored in `library.json`; character media is copied into `Characters/<sanitized-name>_<id>/` and organized into `Profile/`, `Photos/`, `Videos/`, `Documents/`, and `Other/`.

Imports copy files; they do not edit the original source files. Files are named with generated IDs to reduce collisions. The app creates a `library.backup.json` before the first library write of a run, and writes the main library through a temporary file followed by a rename. If the main library JSON is invalid, startup attempts to recover from the backup and preserves a damaged copy for inspection.

Changing the storage folder copies files without overwriting existing destination files. If a destination contains a same-named file with different content, the move is stopped and the existing storage location remains active. Keep an additional manual copy of the entire storage folder as an independent backup.

## Supported media

- Images: JPG/JPEG, PNG, GIF, WebP, BMP, SVG, AVIF
- Videos: MP4, WebM, MOV, M4V, MKV, AVI, OGV (actual playback depends on the Chromium/Electron codecs available)
- Documents: PDF, Markdown, plain text, CSV, JSON, HTML, RTF, and log files
- Other formats are stored as files and can be opened externally when the operating system has an associated app

Text/Markdown editing is limited to files up to 2 MB. Search indexing is local and uses the text content captured from supported text-like files; it does not perform full-text OCR or extract text from PDFs/Word documents.

## Security model

The renderer runs with context isolation, sandboxing, and Node integration disabled. The preload exposes a narrow `window.universe` API. File paths sent through IPC are resolved under the active storage root for operations on stored media. External links are opened by the operating system rather than loaded into the app window.

## Known limitations

This source project is an in-progress implementation and does **not** yet satisfy every feature in the full PVU specification:

- PDF viewing is delegated to the system's default application rather than an embedded PDF viewer with zoom/navigation.
- There is no complete in-app backup/restore workflow yet; the Storage screen supports opening/changing the folder, and automatic library JSON backup/recovery is limited.
- Storage migration verifies file content and avoids overwriting conflicts, but there is no transactional rollback of already copied destination files if a later copy fails. The source library remains untouched.
- Video thumbnails rely on the browser's metadata/seek support; a guaranteed extracted first-frame thumbnail for every codec is not available.
- The app has no dedicated automated Electron end-to-end suite. Smoke checks are structural only.
- Browser-only mode is a convenience preview using browser storage; the complete chosen-folder workflow requires Electron.

Do not treat the known limitations as completed features. Run the checks above on your machine and test important workflows with a copy of your library before relying on the app for irreplaceable data.

### Character albums and playlists

Each character's **Images** tab supports multiple albums and each **Videos** tab supports multiple playlists. Create, rename, or delete collections; add existing files to them; open a collection to view its contents; and change its cover from the character's existing image (album) or image/video (playlist) files. Collections reference existing media IDs and do not duplicate files. Deleting an album or playlist does not delete its media. The library data schema is normalized to version 4; older v3 libraries remain readable.

### Bulk deletion and image viewer
Select multiple files using the checkboxes on the file cards, then choose **Delete selected**. The app asks for confirmation before permanently deleting files. Files successfully deleted are also removed from album/playlist references; files that fail to delete remain in the library and are reported.

Open an image to use the viewer's **zoom in**, **zoom out**, **reset zoom**, and **delete** controls. Zoom ranges from 100% to 400%; keyboard shortcuts are `+`/`-`/`0`, and Ctrl/Command + mouse wheel also zooms. The viewer's delete button permanently deletes the currently open file after confirmation.
