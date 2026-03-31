# VS Code Extension Subsystem — Design Document

## Overview

The VS Code extension is a cross-platform (Windows, Mac, Linux) TypeScript implementation that provides the same server lifecycle and configuration features as the CLI subsystem ([DESIGN-cli-utility.md](DESIGN-cli-utility.md)). It surfaces these features through the VS Code UI: command palette, context menus, status bar, and sidebar panel.

All extension source lives in `vsx-src/`. The extension namespace is `mkdocs-wysiwyg`.

## Relationship to CLI Subsystem

The extension and CLI share:

- **`~/.techdocs/` virtual environment** — both use the same Python venv, uv binary, and installed packages.
- **`.github/download-utilities.yml`** — single source of truth for binary dependency versions, checksums, OS/arch mappings, and download URLs. The CLI embeds this YAML into `techdocs-preview.sh`; the extension bundles it and reads it at runtime.
- **Dual `mkdocs.yml` mechanism** — the generated config and original preservation contract described in [DESIGN-cli-utility.md](DESIGN-cli-utility.md) is implemented identically.
- **Plugin ordering** — `techdocs-core` before `live-edit` before `live-wysiwyg`.
- **Version pins** — `WYSIWYG_VERSION` and all Python package pins must match between the CLI's script header and the extension's `constants.ts`.

The extension does **not** call `techdocs-preview.sh`. It reimplements the same logic in TypeScript for cross-platform portability.

## Feature Parity Table

Any change to a feature relevant to both subsystems must be updated in both. This table is the verification checklist.

| Feature | CLI (`techdocs-preview.sh`) | Extension (`vsx-src/`) | Shared Contract |
|---|---|---|---|
| **Environment bootstrap** | `uv()` / `yq()` functions, embedded download YAML | `platform.ts` (TS port of yml-install-files), reads bundled `download-utilities.yml` | `~/.techdocs/` path, binary versions from `.github/download-utilities.yml` |
| **Venv creation** | `uv venv --python 3.13 ~/.techdocs/python3` | `environment.ts` calls `uv venv` via `child_process` | `~/.techdocs/python3` path |
| **Package installation** | `pip()` wrapper → `uv pip install` | `environment.ts` calls `uv pip install` | Identical package list and version pins |
| **Config generation** | `mkdocs_config` function (yq-based) | `config-generator.ts` (js-yaml-based) | Same output: plugin chain, theme, extensions, mermaid superfences |
| **Theme handling** | `--theme` flag, Material defaults, `restore_theme.py` hook | `--theme` setting, same defaults, same hook generation | Material default palette, techdocs-core interaction |
| **Mermaid superfences** | `add_superfences_with_mermaid_if_missing` (yq + snippet file) | `config-generator.ts` additive-only logic (js-yaml) | Additive-only rule (cardinal rule 7 analogy) |
| **Dual mkdocs.yml** | `$TMPDIR/original-mkdocs.yml` preserved/restored | `server-manager.ts` same temp path contract | `liveWysiwygOriginalMkdocsYml` detection in plugin.py |
| **Port resolution** | `available_port` via `nc -z`, retry up to 100 | `port-manager.ts` via Node `net` module, same retry | Default ports 8000/8484, same fallback logic |
| **Server launch** | `mkdocs serve -f mkdocs.yml -a HOST:PORT --livereload --open` | `server-manager.ts` spawns identical command | Same args, same `TMPDIR` env var |
| **Build** | `mkdocs build` with piped config | `build-manager.ts` spawns `mkdocs build` | Same config generation |
| **Auto-generated docs** | Temp `docs/` from `*.md`, `full_path` frontmatter, asset tar-copy, restore on exit | `auto-docs.ts` same logic, `fs.cpSync` for assets | Frontmatter format, restore behavior |
| **Init** | Embedded example-docs tarball | `init-manager.ts` equivalent template | Same output structure |
| **Add plugins** | `pip install` pass-through | `environment.ts` `uv pip install` pass-through | Same venv target |
| **Upgrade** | `FORCE_UPDATE=1 install_techdocs` | `environment.ts` reinstall with force | Same venv, same packages |
| **Uninstall** | `rm -rf ~/.techdocs` | `environment.ts` removes `~/.techdocs` | Same path |

## Modules

### `platform.ts` — Binary Download Engine

TypeScript reimplementation of [samrocketman/yml-install-files](https://github.com/samrocketman/yml-install-files). Reads `.github/download-utilities.yml` (bundled in the VSIX) at runtime.

Responsibilities:
- Parse YAML with `js-yaml` (anchors/aliases resolved at parse time)
- Map Node.js `os.platform()` / `os.arch()` to YAML OS/arch values
- Apply per-utility OS and arch overrides
- Interpolate `${version}`, `${os}`, `${arch}`, `${extension}` in download URL templates
- Download via Node.js `https`, verify SHA-256 checksums, extract (tar.gz, zip, or bare binary)
- Path helpers: home dir, venv bin path (`bin/` vs `Scripts/`), executable suffix (`.exe` on Windows)

### `environment.ts` — Environment Manager

Uses `platform.ts` for binary downloads. Manages the shared `~/.techdocs/` environment.

### `config-generator.ts` — Configuration Generator

Reimplements `mkdocs_config` using `js-yaml`. The `!!python/name:` YAML tags for superfences require custom schema handling.

### `port-manager.ts` — Port Manager

Cross-platform port availability via Node.js `net` module. Same defaults and retry logic as CLI.

### `server-manager.ts` — Server Manager

Spawns `mkdocs serve`, streams output, handles cleanup. Sets `TMPDIR` for dual-write contract.

### `auto-docs.ts` — Auto-Docs Manager

Temp docs generation from `*.md` files with frontmatter injection, smart asset detection from markdown content, and restore on exit.

### `build-manager.ts` / `init-manager.ts`

Build and init command wrappers.

### `constants.ts` — Python Package Pins

Holds `WYSIWYG_VERSION` and the pip package list. Binary versions come from `download-utilities.yml`, not from this file.

## VS Code UI

- **Command palette**: `mkdocs-wysiwyg.serve`, `.stop`, `.build`, `.init`, `.addPlugins`, `.upgrade`, `.uninstall`
- **Context menus**: Right-click `mkdocs.yml` to start server; right-click `.md` to preview with auto-detected assets
- **Status bar**: Server state, port, click actions
- **Sidebar panel**: TreeView with server status, logs, config, quick actions

## Build and Publishing

- **VSIX built in Docker** via `vsx-src/Makefile` (`make build`). Only `make` and `docker` required on the host.
- **Version parity**: VSIX version read from `pyproject.toml` at build time. No separate version maintained.
- **Icon**: SVG source in `resources/icon.svg`, converted to 128x128 PNG via `make icon` (rsvg-convert in Docker).
- **Triple publish**: GitHub Releases + VS Code Marketplace + Open VSX. All publishing via Docker-isolated make targets.
- **CI**: Extends existing `release.yml` with `vsix-build` and `vsix-publish` jobs after `pypi-publish`.

## Rules

1. **Feature parity is mandatory.** Any change to a shared feature (config generation, package list, port logic, auto-docs behavior) must be updated in both the CLI and extension. Use the feature parity table above as the verification checklist.

2. **`.github/download-utilities.yml` is the single source of truth for binaries.** No binary version, checksum, or download URL may be hardcoded in TypeScript. All values come from the YAML at runtime.

3. **The extension must not call `techdocs-preview.sh`.** It reimplements the same behavior in TypeScript for cross-platform support.

4. **The shared venv path `~/.techdocs/` must not change.** Both CLI and extension depend on this location. On Windows this resolves to `%USERPROFILE%\.techdocs\`.

5. **Plugin ordering must match the CLI.** `techdocs-core` before `live-edit` before `live-wysiwyg`. This is required for correct theme configuration and plugin dependencies.

6. **The dual `mkdocs.yml` contract must be preserved.** The `$TMPDIR/original-mkdocs.yml` path is how `plugin.py` detects dual-write mode. The extension must set `TMPDIR` identically to the CLI.

7. **All Node.js dependencies must resolve from public registries.** `package.json`, `package-lock.json`, and any other dependency manifest must reference only publicly accessible registries (e.g. `https://registry.npmjs.org/`). No private or corporate registry URLs may appear in committed files. This ensures CI, Docker builds, and external contributors can resolve dependencies without special network access.

## Server Readiness Checks

Before opening the Simple Browser preview, the extension verifies all three companion servers are responding at the application protocol level:

- **MkDocs HTTP** — `HEAD /` (any non-5xx confirms ready)
- **API server** — `GET /build-epoch` (exists in all released versions)
- **WebSocket server** — full WebSocket connection mirroring a real client: upgrade handshake, receive the `{"action":"connected"}` greeting message, then send a proper close frame (opcode `0x8`, status `1000`). This ensures the live-edit plugin logs `disconnected with status OK` rather than `disconnected due to an error`.

These three checks run in parallel every 500ms with a 30-second timeout (`preview-panel.ts`).

### Future: unified `/health` endpoint

The API server now exposes `GET /health` which performs these same checks server-side (HTTP HEAD for MkDocs, WebSocket upgrade for the WebSocket server) and returns a single JSON response with per-service status and an aggregate `ready` boolean (`200` when ready, `503` otherwise). Once a plugin release containing the `/health` endpoint is generally available, the extension should switch to polling `GET /health` on the API port as the sole readiness check, replacing the three individual probes. This simplifies the extension and centralizes the readiness logic in the Python plugin.
