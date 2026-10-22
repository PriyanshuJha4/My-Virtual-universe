# Acceptance checklist

Run `npm run test:smoke`, `npm run typecheck`, and `npm run build`. The smoke test only validates basic project structure and selected security settings.

Manual desktop verification still required:
- [ ] Add, edit, and delete characters; verify the delete confirmation and media cleanup behavior.
- [ ] Add, rename, delete groups; verify empty groups remain visible and characters are moved to Ungrouped.
- [ ] Drag characters between groups.
- [ ] Import files and confirm originals are unchanged.
- [ ] Test image/video viewer navigation, Escape, seeking, and external-player fallback.
- [ ] Edit Markdown/text and save with Ctrl+S.
- [ ] Test PDF opening in the external application.
- [ ] Test Ctrl+K search and text indexing.
- [ ] Restart and verify library persistence.
- [ ] Test storage-folder changes with an empty destination and with conflicting files.
- [ ] Test corrupted `library.json`, backup recovery, disk-full and permission errors.
- [ ] Confirm all destructive actions use in-app confirmation.

Known gaps are documented in `README.md`; unchecked items must not be reported as passed.
