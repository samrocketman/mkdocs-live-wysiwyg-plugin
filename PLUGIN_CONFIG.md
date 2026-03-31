# Advanced Instructions

If you're not using the `techdocs-preview.sh` script (not advised), then the
following instructions are applicable.

## Requirements

When not using `techdocs-preview.sh` with [uv][1]:

- Python 3.10 or higher
- mkdocs-live-edit-plugin
- mkdocs >= 1.5

## Installation

If not using `techdocs-preview.sh`:

```bash
pip install mkdocs-live-wysiwyg-plugin
```

Or with [uv][1]:

```bash
uv pip install mkdocs-live-wysiwyg-plugin
```

This will install `mkdocs-live-edit-plugin` as a dependency. For development setup, see CONTRIBUTING.md.

## Configuration

Add both plugins to your `mkdocs.yml`. **Important:** `live-edit` must be listed before `live-wysiwyg`:

```yaml
plugins:
  - live-edit
  - live-wysiwyg
```

### Options

| Option             | Type    | Default | Description                |
| ------------------ | ------- | ------- | -------------------------- |
| `autoload_wysiwyg` | boolean | `true`  | Default behavior when no user preference cookie exists. If `true`, the WYSIWYG editor loads automatically when entering edit mode. If `false`, the plain textarea is shown initially with an "Enable Editor" button. Once the user explicitly enables or disables the editor, their preference is stored in a cookie and takes priority over this setting. |
| `user_docs_dir`    | string  | `""`    | Override the docs source directory path. Useful when the monorepo plugin (e.g. techdocs-core) replaces `docs_dir` with a temporary directory. Falls back to the upstream `mkdocs-live-edit-plugin`'s `user_docs_dir`, then to the MkDocs `docs_dir`. |
| `api_port`         | integer | `0`     | Port for the API server (link checking, mermaid sessions, file operations). When `0` (default) the OS picks a free port. Set to a specific port number to enable pre-allocation — used by the VS Code extension to map all three server ports into the embedded preview. |

[1]: https://docs.astral.sh/uv/
