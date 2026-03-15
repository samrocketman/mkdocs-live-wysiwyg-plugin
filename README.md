# mkdocs-live-wysiwyg-plugin

## Try it out

There's a shell script which makes editing techdocs in this repository really
quick.  Run techdocs-preview.sh.

## Features

A WYSIWYG (What-You-See-Is-What-You-Get) editor for [mkdocs-live-edit-plugin][1], based on [@celsowm/markdown-wysiwyg][2].

See [shortcuts and behaviors document](docs/shortcuts.md) for how to edit documents.

- 🌈✨ Author quality of life features
  - 👁-👁 Focus mode.
  - ✅ Non-destructive WYSIWYG editing is a top priority.  Minimal  `git diff` .
  - ✅ Content refactoring with automated content migration.
  - ✅ Selected text to edit is the fastest flow.
  - ✅ Editing preferences remembered across pages.
  - ✅ A URL pasted onto selected text creates a markdown link.
  - ✅ Automated content migration to mkdocs-nav-weight.
- 💪 Mkdocs/backstage rendering features
  - ✅ Toggle-able checklists (task lists): `- [ ]` and `- [x]` .
  - ✅ YAML frontmatter preserved when editing and switching modes.
  - ✅ MkDocs admonitions (`!!! note`, `!!! warning`, etc.).  A UI button for inserting new admonitions.
  - ✅ Markdown link styles preserved (inline, reference, shortcut)
  - ✅ Code blocks with WYSIWYG editable titles.
- ℹ️ Other noteworthy features
  - ✅ Cursor location memory: when switching between WYSIWYG or Markdown modes the cursor location and scroll area is preserved to reduce editing strain on the author.
  - ✅ Selected text is preserved when the author switches modes (to/from wysiwyg or markdown).
  - ✅ Typing in with backticks inline will automatically convert text to inline code blocks.
  - ✅ No external JavaScript; all assets are bundled locally within the mkdocs plugin.

When you click "Edit" in the live-edit plugin, this plugin replaces the plain textarea with a rich WYSIWYG editor.

<div data-live-wysiwyg-raw-html-block="PGRldGFpbHM+PHN1bW1hcnk+U2NyZWVuc2hvdHM8L3N1bW1hcnk+CgohW2VkaXRvci1saWdodF0oZG9jcy9pbWFnZXMvZWRpdG9yLWxpZ2h0LnBuZykKCiFbZWRpdG9yLWRhcmtdKGRvY3MvaW1hZ2VzL2VkaXRvci1kYXJrLnBuZykKCiFbZm9jdXMtY29udGVudF0oZG9jcy9pbWFnZXMvZm9jdXMtY29udGVudC5wbmcpCgohW2ZvY3VzLWJ1c3ldKGRvY3MvaW1hZ2VzL2ZvY3VzLWJ1c3kucG5nKQoKPC9kZXRhaWxzPg==" data-live-wysiwyg-newlines-after="1"></div>

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

This will install `mkdocs-live-edit-plugin` as a dependency. For development setup, see CONTRIBUTING.md.

## Configuration

Add both plugins to your `mkdocs.yml`. **Important:** `live-edit` must be listed before `live-wysiwyg`:

```yaml
plugins:
  - live-edit
  - live-wysiwyg:
      autoload_wysiwyg: true # optional, if false, start with plain textarea and show "Enable Editor"
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `autoload_wysiwyg` | boolean | `true` | Default behavior when no user preference cookie exists. If `true`, the WYSIWYG editor loads automatically when entering edit mode. If `false`, the plain textarea is shown initially with an "Enable Editor" button. Once the user explicitly enables or disables the editor, their preference is stored in a cookie and takes priority over this setting. |

## Attributions

This plugin incorporates or depends on the following works:

| Component | Author | License | Link |
| --- | --- | --- | --- |
| **@celsowm/markdown-wysiwyg** (WYSIWYG editor) | Celso Fontes | MIT | [GitHub](https://github.com/celsowm/markdown-wysiwyg) · [npm][2] |
| **marked** (Markdown parser) | Christopher Jeffrey, MarkedJS | MIT | [GitHub](https://github.com/markedjs/marked) · [marked.js.org](https://marked.js.org) |
| **mkdocs-live-edit-plugin** (required dependency) | Eddy Luten | MIT | [GitHub][1] |

All listed components are distributed under the MIT License. See each project's repository for full license text.

The WYSIWYG editor and its dependencies (marked, editor.css, editor.js) are bundled locally in `mkdocs_live_wysiwyg_plugin/vendor/`—no external JavaScript or CSS is loaded at runtime.

## MkDocs Theme Support

Only the [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) theme is officially supported. Admonition styling and icons rely on Material theme CSS. Other themes may work but have not been tested.

Contributions to add support for other themes are welcome; see CONTRIBUTING.md. Material theme support is a requirement.

**No breaking changes** to Material theme compatibility are allowed.

## MkDocs Admonitions

The WYSIWYG editor supports MkDocs admonition syntax (`!!! note`, `!!! warning`, etc.) in both modes:

- **Markdown mode**: Type `!!! note` followed by indented content (4 spaces)
- **WYSIWYG mode**: Admonitions render as styled callout boxes; editing preserves the `!!!` syntax when saving

Supported types: `note`, `warning`, `danger`, `tip`, `hint`, `important`, `caution`, `error`, `attention`.

[1]: https://github.com/eddyluten/mkdocs-live-edit-plugin
[2]: https://www.npmjs.com/package/@celsowm/markdown-wysiwyg
