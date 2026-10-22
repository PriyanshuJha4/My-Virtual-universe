# Repair notes

- Removed the unused `@google/model-viewer` dependency and obsolete 3D-model UI/import classification.
- Kept the Electron + React + TypeScript + Vite structure and existing library schema (version 3).
- Made empty groups remain visible when no characters exist.
- Changed character deletion so a file-removal failure is surfaced and the character record is retained instead of silently removing the profile from the library.
- Made storage-folder copying compare existing file content and stop on conflicting destination files rather than switching to a potentially stale destination.
- Ensure a new character folder contains `Profile/`, `Photos/`, `Videos/`, `Documents/`, and `Other/`.
- Removed unused legacy `src/services/local-store.ts` and `src/database/schema.sql`; the active migration path remains in `src/services/library.ts`.
- Removed generated build outputs and TypeScript build-info files from the source archive.
- Added a structural smoke-check script and documented known gaps in `README.md`.

## Verification status

`npm run test:smoke` passes. Full `npm run typecheck`, `npm run build`, and Electron runtime tests could not be completed in this environment because the dependency installation did not finish and the local `node_modules` tree is incomplete. Do not treat the application as fully tested until those commands and the manual acceptance checklist pass on a machine with a complete npm installation.
