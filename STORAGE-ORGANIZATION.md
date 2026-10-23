# Storage organization

The Electron app stores the library in the selected local storage folder. The root contains `library.json`, `library.backup.json` (when a prior library has been backed up), and character directories.

```text
<chosen folder>/
  library.json
  library.backup.json
  Characters/
    <SanitizedCharacterName>_<ID-prefix>/
      Profile/
      Photos/
      Videos/
      Documents/
      Other/
```

The current app copies imported source files into this folder; it does not modify the originals. The storage settings remember the selected directory. Changing the folder copies data and leaves the source folder in place. Existing destination files are never overwritten; differing same-name files cause the operation to stop with an error.

This is a copy-based migration, not a fully transactional move. If a copy fails partway through, some files may already have been copied into the destination, but the source remains untouched and active. Keep a separate backup of the full folder before moving important data.


## Physical album and playlist folders

On Windows, media stays inside each character's folder. Images moved into an album are physically stored under `Photos/Albums/<AlbumName>_<id>/`; videos moved into a playlist are stored under `Videos/Playlists/<PlaylistName>_<id>/`. Unassigned or removed items are kept in the character's main `Photos/` or `Videos/` folder. **Move** relocates the existing file; **Copy** creates a separate media file and library entry in the target collection. Removing an item from a collection does not delete the file. Renaming a collection renames its folder and updates saved relative paths.

The PWA/browser version cannot create folders in the user's ordinary phone file manager; it uses browser-managed IndexedDB storage. Physical folder organization is a Windows desktop feature.
