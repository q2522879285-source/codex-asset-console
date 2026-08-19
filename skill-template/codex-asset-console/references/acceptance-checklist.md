# Acceptance checklist

## Asset workflow

- The console stays inside the active Codex task; changing tasks invalidates the previous frame context.
- Unresolved generated assets enter Pending Confirmation; ordinary unrelated downloads are untouched.
- Image, audio, and video previews load lazily and stale folder responses cannot replace current content.
- A managed file has one authoritative storage copy; project/folder/category moves do not silently duplicate it.
- Classification, logical move, and recovery results are explicit and traceable.
- Adding paths never submits the composer.

## Installation and release

- Install, state, and service roots match the three documented product-owned directories.
- Failed updates restore prior runtime files and remove only files created by the failed run.
- Existing configuration, ledgers, recovery records, and media remain unchanged.
- `verify.ps1 -BundleOnly` passes against the packaged manifest.
- ZIP hashes match their sidecars.
- The release privacy scan finds no account string, private path, UUID, token, state file, ledger, or user media.
