# mkdocs-live-wysiwyg-plugin

A WYSIWYG (What-You-See-Is-What-You-Get) editor for [mkdocs-live-edit-plugin](https://github.com/eddyluten/mkdocs-live-edit-plugin), based on [@celsowm/markdown-wysiwyg](https://www.npmjs.com/package/@celsowm/markdown-wysiwyg).

- :rainbow::sparkles: Author quality of life features
  - :white_check_mark: Non-destructive WYSIWYG editing is a top priority.  `git diff` will show changes the author intended.  No extra mess typically associated with WYSIWYG editors.
  - :white_check_mark: Cursor location memory: when switching between WYSIWYG or Markdown modes the cursor location and scroll area is preserved to reduce editing strain on the author.
  - :white_check_mark: Selected text is preserved when the author switches modes (to/from wysiwyg or markdown).
  - :white_check_mark: Editor preferences remembered across pages.  If the editor is disabled, then it will still be disabled when editing another document.  WYGSIWYG or Markdown mode is also remembered when the Editor is enabled.
- :muscle: Mkdocs rendering features
  - :white_check_mark: Dual-mode editing (WYSIWYG and Markdown) with toolbar formatting.  The editor can also be disabled.
  - :white_check_mark: YAML frontmatter preserved when editing and switching modes.
  - :white_check_mark: MkDocs admonitions (`!!! note`, `!!! warning`, etc.)
  - :white_check_mark: Markdown link styles preserved (inline, reference, shortcut)
- :white_check_mark: No external JavaScript; all assets are bundled locally within the mkdocs plugin.

When you click "Edit" in the live-edit plugin, this plugin replaces the plain textarea with a rich WYSIWYG editor.

<img width="1538" height="1392" alt="image" src="https://github.com/user-attachments/assets/e53618b1-f465-4551-8e6f-f50c1ee1fd6f" />

## Requirements

- Python 3.10 or higher.
- mkdocs-live-edit-plugin (must be installed and configured)
- mkdocs >= 1.5

## Installation

```bash
pip install mkdocs-live-wysiwyg-plugin
```

Or with [uv](https://docs.astral.sh/uv/):

```bash
uv pip install mkdocs-live-wysiwyg-plugin
```

This will install `mkdocs-live-edit-plugin` as a dependency. For development setup, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration

Add both plugins to your `mkdocs.yml`. **Important:** `live-edit` must be listed before `live-wysiwyg`:

```yaml
plugins:
  - live-edit
  - live-wysiwyg:
      article_selector: ".md-content"  # optional, same as mkdocs-live-edit-plugin
      menu_selector: ".md-content"     # optional, area to add the Enable/Disable Editor button
      autoload_wysiwyg: true          # optional, if false, start with plain textarea and show "Enable Editor"
```

### Options

| Option | Type | Default | Description |
|-------|------|---------|-------------|
| `article_selector` | string | `null` | CSS selector for the article element where controls appear. Same behavior as mkdocs-live-edit-plugin. Falls back to `[itemprop="articleBody"]`, `div[role="main"]`, or `article` if not specified. |
| `menu_selector` | string | `null` | CSS selector for the area where the "Enable Editor" / "Disable Editor" button is added. Defaults to `.live-edit-controls` (the live-edit plugin's control bar). The button uses class `live-edit-button` and appears alongside Rename, Delete, New when in edit mode. |
| `autoload_wysiwyg` | boolean | `true` | If `true`, the WYSIWYG editor loads automatically when entering edit mode. If `false`, the plain textarea is shown initially and the "Enable Editor" button allows switching to WYSIWYG. |

## Attributions

This plugin incorporates or depends on the following works:

| Component | Author | License | Link |
|-----------|--------|---------|------|
| **@celsowm/markdown-wysiwyg** (WYSIWYG editor) | Celso Fontes | MIT | [GitHub](https://github.com/celsowm/markdown-wysiwyg) · [npm](https://www.npmjs.com/package/@celsowm/markdown-wysiwyg) |
| **marked** (Markdown parser) | Christopher Jeffrey, MarkedJS | MIT | [GitHub](https://github.com/markedjs/marked) · [marked.js.org](https://marked.js.org) |
| **mkdocs-live-edit-plugin** (required dependency) | Eddy Luten | MIT | [GitHub](https://github.com/eddyluten/mkdocs-live-edit-plugin) |

All listed components are distributed under the MIT License. See each project's repository for full license text.

The WYSIWYG editor and its dependencies (marked, editor.css, editor.js) are bundled locally in `mkdocs_live_wysiwyg_plugin/vendor/`—no external JavaScript or CSS is loaded at runtime.

## MkDocs Theme Support

Only the [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) theme is officially supported. Admonition styling and icons rely on Material theme CSS. Other themes may work but have not been tested.

Contributions to add support for other themes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Material theme support is a requirement.

**No breaking changes** to Material theme compatibility are allowed.

## MkDocs Admonitions

The WYSIWYG editor supports MkDocs admonition syntax (`!!! note`, `!!! warning`, etc.) in both modes:

- **Markdown mode**: Type `!!! note` followed by indented content (4 spaces)
- **WYSIWYG mode**: Admonitions render as styled callout boxes; editing preserves the `!!!` syntax when saving

Supported types: `note`, `warning`, `danger`, `tip`, `hint`, `important`, `caution`, `error`, `attention`.

