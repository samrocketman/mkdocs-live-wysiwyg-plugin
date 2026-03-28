# mkdocs-live-wysiwyg-plugin

## Try it out

There's a [shell script](techdocs-preview.sh) which makes editing techdocs in this repository really
quick.

Run `./techdocs-preview.sh` from this repository to view the documentation for this repository.

For a general tutorial, you can run

```bash
techdocs-preview.sh init
```

The `init` command will initialize mkdocs documentation for you.  The default docs serve as a tutorial to the WYSIWYG editor but you could also discard the documentation and use it as a starting point for your own project.  `init` is intended to be a quick way to add documentation to a repository that did not previously have TechDocs.

## Features

A WYSIWYG (What-You-See-Is-What-You-Get) editor for exiting `mkdocs` documentation.

See [shortcuts and behaviors document](docs/shortcuts.md) for how to edit documents.

- 🌈✨ Author quality of life features
  - 👁-👁 Focus mode with collapsible nav sidebar, editing tools, and table of contents.
  - ✅ Non-destructive WYSIWYG editing is a top priority.  Minimal  `git diff` .
  - ✅ Content refactoring with automated content migration.
    - Link refactoring when moving around documents.
    - Inner heading link refactoring when renaming headings within documents that are cross-referenced as links.
  - ✅ Editing preferences remembered across pages.
  - ✅ A URL pasted onto selected text creates a markdown link.
  - ✅ Automated content migration to mkdocs-nav-weight.
  - ✅ DAG-based undo/redo with branch picker for non-linear editing history.  Undo works across markdown and WYSIWYG modes.
- 🗂️ Navigation management
  - ✅ Sidebar nav editing: reorder pages and sections with keyboard shortcuts or mouse.
  - ✅ Create, rename, and delete pages and folders from the nav sidebar.
  - ✅ Move pages between folders (indent/outdent).
  - ✅ Group selection with Ctrl/Cmd+Click for batch operations.
  - ✅ Nav-specific undo/redo stack (separate from content undo).
  - ✅ Review Changes popup before saving.
  - ✅ Automated dead link detection and resolution.
  - ✅ mkdocs-nav-weight integration with migration wizard.
- 💪 Mkdocs/backstage rendering features
  - ✅ Toggle-able checklists (task lists): `- [ ]` and `- [x]` .
  - ✅ YAML frontmatter preserved when editing and switching modes.
  - ✅ MkDocs admonitions (`!!! note`, `!!! warning`, etc.) with settings gear for type, collapsible, placement, and more.
  - ✅ Markdown link styles preserved (inline, reference, shortcut).
  - ✅ Code blocks with WYSIWYG editable titles, language selector, and auto-indent settings.
  - ✅ Mermaid diagram editing with an embedded live editor (full-screen overlay).
  - ✅ Tables with contextual toolbar: insert/delete rows and columns, column alignment, and formatting settings.
  - ✅ Image dialog with autocomplete from the docs tree.
  - ✅ Emoji shortcode completion and full emoji picker.
- ℹ️ Other noteworthy features
  - ✅ Cursor location memory: when switching between WYSIWYG or Markdown modes the cursor location and scroll area is preserved to reduce editing strain on the author.
  - ✅ Selected text is preserved when the author switches modes (to/from wysiwyg or markdown).
  - ✅ Auto-conversions: typing markdown syntax (headings, lists, bold, inline code, etc.) in WYSIWYG mode converts live to formatted elements.
  - ✅ Balanced ASCII table formatting with configurable max width and per-table overrides.
  - ✅ Context-sensitive help panel (Ctrl+?).
  - ✅ No external JavaScript; all assets are bundled locally within the mkdocs plugin.

The following is an annotated screenshot after running `techdocs-preview.sh init`.

![focus-busy](docs/images/focus-busy.png)

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
  - live-wysiwyg
```

### Options

| Option             | Type    | Default | Description                |
| ------------------ | ------- | ------- | -------------------------- |
| `autoload_wysiwyg` | boolean | `true`  | Default behavior when no user preference cookie exists. If `true`, the WYSIWYG editor loads automatically when entering edit mode. If `false`, the plain textarea is shown initially with an "Enable Editor" button. Once the user explicitly enables or disables the editor, their preference is stored in a cookie and takes priority over this setting. |
| `user_docs_dir`    | string  | `""`    | Override the docs source directory path. Useful when the monorepo plugin (e.g. techdocs-core) replaces `docs_dir` with a temporary directory. Falls back to the upstream `mkdocs-live-edit-plugin`'s `user_docs_dir`, then to the MkDocs `docs_dir`. |

## Attributions

This plugin incorporates or depends on the following works:

| Component                  | Author                     | License | Link                       |
| -------------------------- | -------------------------- | ------- | -------------------------- |
| **@celsowm/markdown-wysiwyg** (WYSIWYG editor) | Celso Fontes               | MIT     | [GitHub](https://github.com/celsowm/markdown-wysiwyg) · [npm][1] |
| **marked** (Markdown parser) | Christopher Jeffrey, MarkedJS | MIT     | [GitHub](https://github.com/markedjs/marked) · [marked.js.org](https://marked.js.org) |
| **js-yaml** (YAML parser)  | Vitaly Puzrin              | MIT     | [GitHub](https://github.com/nodeca/js-yaml) |
| **mermaid** (Diagram renderer) | Knut Sveidqvist            | MIT     | [GitHub](https://github.com/mermaid-js/mermaid) · [mermaid.js.org](https://mermaid.js.org) |
| **mermaid-live-editor** (Diagram editor) | Knut Sveidqvist            | MIT     | [GitHub](https://github.com/mermaid-js/mermaid-live-editor) |
| **mkdocs-live-edit-plugin** (required dependency) | Eddy Luten                 | MIT     | [GitHub][2]                |

All listed components are distributed under the MIT License. See each project's repository for full license text.

All vendored JavaScript, CSS, and application builds are bundled locally in `mkdocs_live_wysiwyg_plugin/vendor/` — no external JavaScript or CSS is loaded at runtime. See [`vendor/README.md`](mkdocs_live_wysiwyg_plugin/vendor/README.md) for exact versions and license files.

## MkDocs Theme Support

Only the [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) theme is officially supported. Admonition styling and icons rely on Material theme CSS. Other themes may work but have not been tested.

Contributions to add support for other themes are welcome; see CONTRIBUTING.md. Material theme support is a requirement.

**No breaking changes** to Material theme compatibility are allowed.

## MkDocs Admonitions

The WYSIWYG editor supports MkDocs admonition syntax (`!!! note`, `!!! warning`, etc.) in both modes:

- **Markdown mode**: Type `!!! note` followed by indented content (4 spaces)
- **WYSIWYG mode**: Admonitions render as styled callout boxes with a settings gear for type, collapsible toggle, placement, and more. Editing preserves the `!!!` syntax when saving.

Supported types: `note`, `warning`, `danger`, `tip`, `hint`, `important`, `caution`, `error`, `attention`, `abstract`, `info`, `success`, `question`, `failure`, `bug`, `example`, `quote`.

Collapsible admonitions (`??? type`) and HTML details tags (`!!! details`) are also supported.

[1]: https://www.npmjs.com/package/@celsowm/markdown-wysiwyg
[2]: https://github.com/eddyluten/mkdocs-live-edit-plugin
