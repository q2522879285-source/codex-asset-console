# Architecture

The Windows reference has four boundaries:

- **Injected host:** opens the console inside the active Codex task and returns selected absolute paths to the composer.
- **Asset Console:** presents Pending Confirmation, task/project assets, classifications, recovery actions, and lazy image/audio/video previews.
- **Local service:** indexes files, enforces one managed copy, records logical organization changes, and performs explicit recovery operations.
- **Install layer:** validates product-owned roots, creates a local token, backs up replaced runtime files, rolls back failures, and verifies hashes.

The service listens on `127.0.0.1:5177`. API and media access require a per-install random token that is never exposed to iframe JavaScript or included in a bundle. Frame access is scoped by an exact session/frame identity, a per-open nonce, and a generation that is invalidated when the task changes or the console closes.

The bundled adapter targets Windows, Node.js 22+, and a Codex debug port of 9231. Platform changes belong in the adapter; task association, pending confirmation, single-copy storage, logical moves, classification, and recovery remain product behavior.
