# CLI Utility — Design Document

## Overview

`techdocs-preview.sh` is the CLI entry point for the WYSIWYG editor development environment. It bootstraps a self-contained Python virtual environment, installs all MkDocs dependencies, generates the runtime `mkdocs.yml` configuration, and manages the server lifecycle. It is the outermost layer of the system — everything else (the WYSIWYG plugin, live-edit plugin, MkDocs, Material theme) runs inside the environment it creates.

All code lives in `techdocs-preview.sh`.

## Responsibilities

### Environment Bootstrap

- **Python virtual environment**: Creates `~/.techdocs/python3` via `uv venv --python 3.13`. Uses `uv` as the package manager (with automatic download via `yml-install-files` if not available).
- **Dependency installation**: Installs `mkdocs-techdocs-core`, `mkdocs-same-dir`, `mkdocs-gen-files`, `mkdocstrings`, `mkdocs-nav-weight`, `mkdocs-live-edit-plugin`, and `mkdocs-live-wysiwyg-plugin` at pinned versions.
- **Upgrade path**: `techdocs-preview.sh upgrade` re-runs installation with `FORCE_UPDATE=1`.
- **Uninstall**: `techdocs-preview.sh uninstall` removes `~/.techdocs` entirely.

### Configuration Generation (`mkdocs_config`)

1. Copies user's `mkdocs.yml` to `$TMPDIR/original-mkdocs.yml` (the dual-write target)
2. Extracts user plugins (excluding `search`, `techdocs-core`, `live-edit`, `live-wysiwyg`)
3. Generates a rendered `mkdocs.yml` with techdocs-core plugin chain
4. Resolves theme: forces Material by default; `--theme` flag preserves user's theme
5. Injects required markdown extensions (`admonition`, `pymdownx.details`)
6. Injects `pymdownx.superfences` with mermaid `custom_fences` if not already present (see [Mermaid Superfences Integration](#mermaid-superfences-integration))
7. Merges user plugins back into the generated config
8. Writes a restore hook (`restore_theme.py`) to counteract techdocs-core's `on_config` theme override

### Dual mkdocs.yml Mechanism

The generated `mkdocs.yml` includes techdocs-core plugins and the live-edit/live-wysiwyg plugin chain. The original is preserved at `$TMPDIR/original-mkdocs.yml` and restored on shutdown. The WYSIWYG plugin detects this via `liveWysiwygOriginalMkdocsYml` and applies edits to both files. See `dual-mkdocs-yml-write.mdc`.

### Auto-Generated Docs Directory

When no `docs/` directory exists (or `--current-dir` is used), the script auto-generates a temporary `docs/` from top-level `*.md` files:

1. Each file gets `full_path` frontmatter pointing to the original location
2. Asset paths (`-a`) are tar-copied into the temporary docs
3. On exit, edited files are restored to their original locations with frontmatter stripped
4. `--readonly` skips the restore step

### Server Lifecycle

- **`serve`** (default): Generates config, launches `mkdocs serve` with `--livereload --open`
- **`build`**: Generates config, runs `mkdocs build`
- **`add_plugins`**: Installs additional PyPI packages into the virtual environment
- **Cleanup**: `trap 'cleanup_on $?' EXIT` restores `mkdocs.yml` and removes `$TMPDIR`

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TECHDOCS_HOST` | `127.0.0.1` | MkDocs server bind address |
| `TECHDOCS_PORT` | `8000` | MkDocs server port |
| `TECHDOCS_WEBSOCKET_PORT` | `8484` | Live-edit WebSocket port |
| `USE_USER_THEME` | (unset) | Set by `--theme` flag; preserves user theme |
| `SKIP_NEXUS` | (unset) | Disables Nexus mirror for pip |
| `GITHUB_DOWNLOAD_MIRROR` | `https://github.com` | Mirror for uv/yq downloads |
| `TMPDIR` | (system default) | Overridden to script's temp dir for MkDocs |

## CLI Flags

| Flag | Purpose |
|------|---------|
| `--theme` | Use user's mkdocs.yml theme instead of forcing Material |
| `-c`, `--current-dir` | Auto-generate docs/ from current directory *.md files |
| `-r`, `--readonly` | With `-c`, discard edits on exit |
| `-a`, `--assets` | Copy additional files into auto-generated docs/ |

## Subcommands

| Command | Purpose |
|---------|---------|
| `serve` | Start MkDocs dev server (default) |
| `build` | Build static site |
| `add_plugins` | Install additional MkDocs plugins |
| `upgrade` | Re-install all dependencies |
| `uninstall` | Remove `~/.techdocs` environment |

## Mermaid Superfences Integration

`add_superfences_with_mermaid_if_missing` ensures MkDocs can render mermaid diagrams out of the box when the user hasn't already configured `pymdownx.superfences`.

### Behavior

| User's `mkdocs.yml` | Script action |
|---|---|
| No `pymdownx.superfences` at all | Add it as a map with `custom_fences` containing the mermaid entry |
| `pymdownx.superfences` as bare string | Leave untouched — user may intend to add their own config later |
| `pymdownx.superfences` with map config | Leave untouched — user has their own `custom_fences` setup |

The function never modifies an existing `pymdownx.superfences` entry. If the user has a more advanced configuration (e.g., multiple custom fences, custom formatters), it is preserved as-is.

### Mechanism

The `!!python/name:pymdownx.superfences.fence_code_format` YAML tag cannot be constructed inline in `yq` expressions. The function writes a YAML snippet file (`$TMPDIR/superfences-mermaid.yml`) containing the tag, then uses `yq load()` to merge it into the config. This preserves the Python-specific YAML tag through the round-trip.

### Relationship to Client-Side Auto-fix

This CLI-side integration is complementary to the client-side auto-fix in [DESIGN-mkdocs-yml-mermaid-config.md](mermaid/DESIGN-mkdocs-yml-mermaid-config.md). The CLI adds the config at server startup for new projects; the client-side auto-fix handles the case where a user opens a mermaid diagram in an existing project that lacks the config.

## Rules

1. **The original `mkdocs.yml` must always be restored on exit.** The `cleanup_on` trap handles this. Any new exit path must ensure the trap fires.

2. **Plugin ordering matters.** The generated config places `techdocs-core` before `live-edit` before `live-wysiwyg`. This order is required because `live-wysiwyg` depends on `live-edit`, and `techdocs-core` configures the theme.

3. **The `$TMPDIR/original-mkdocs.yml` path is the dual-write contract.** The WYSIWYG plugin's `plugin.py` detects this file in `on_startup` and injects `liveWysiwygOriginalMkdocsYml` into the JS preamble. Changing the temp file location breaks dual-write.

4. **Pinned versions are intentional.** The `WYSIWYG_VERSION` and dependency versions at the top of the script are the tested combination. Changing one version may require testing all others.

5. **`uv` is preferred over `pip`.** The `pip()` function delegates to `uv pip` by default. `FORCE_PIP=1` falls back to system pip. All dependency management should go through this wrapper.

6. **Theme restoration hook is Material-only.** The `restore_theme.py` hook is only generated when `user_theme_name = material`. Non-Material themes skip the hook since `techdocs-core` is not included.

7. **Auto-generated docs use frontmatter for tracking.** The `full_path` frontmatter line maps each temporary doc back to its original source. The cleanup step uses this to restore edited content. Do not strip this frontmatter during the server session.

8. **Superfences with mermaid is additive-only.** `add_superfences_with_mermaid_if_missing` only adds `pymdownx.superfences` when it is entirely absent from `markdown_extensions`. It never modifies an existing superfences entry, regardless of whether it contains mermaid config or not. Users with their own superfences configuration are responsible for adding mermaid support if desired.
