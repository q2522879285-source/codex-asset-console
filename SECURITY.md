# Security

Security fixes are applied to the latest release.

- The local service binds to `127.0.0.1` only.
- API and media requests require a locally generated token.
- Tokens, project configuration, ledgers, state files, task history, and private media are never release inputs.
- The embedded frame bridge uses a per-open nonce and a dedicated synthetic origin.
- Install and uninstall operations are restricted to product-owned directories with ownership markers.

Report vulnerabilities through the repository's private security advisory flow.
