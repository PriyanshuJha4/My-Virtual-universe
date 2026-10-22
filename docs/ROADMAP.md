# Remaining work against the full PVU specification

The current implementation covers the character/group board, profile editing, local library persistence, imports, image/video lightbox, text editing, and basic local search.

Not yet complete:
- In-app PDF viewing with zoom/navigation.
- Complete backup export and restore UI.
- Full legacy migration verification and recovery UX.
- Guaranteed first-frame video thumbnail extraction across codecs.
- Rich text/document indexing beyond the text content captured during import.
- Automated Electron end-to-end tests.
- Dedicated group IDs (groups are currently stored as names).

See `README.md` for current limitations and `docs/ACCEPTANCE-CHECKLIST.md` for manual verification.
