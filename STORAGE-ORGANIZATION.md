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
