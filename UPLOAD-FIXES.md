# File import notes

- **Electron desktop app:** Add files opens the native picker and copies selected files into the app's local media folder.
- **Browser preview:** Add files uses a browser picker and stores blobs in IndexedDB, with library metadata in localStorage.
- **Profile image:** Choosing a picture imports the source file and stores a small compressed avatar preview in the library.
- **Original files:** Imported source files are copied; they are not edited in place.

Browser storage can be cleared by the browser and is subject to browser quotas. For chosen-folder storage, run the Electron app with `npm run dev`; do not open `index.html` directly.
