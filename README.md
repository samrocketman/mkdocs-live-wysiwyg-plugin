# mkdocs-live-wysiwyg-plugin

A WYSIWYG (What-You-See-Is-What-You-Get) editor for [mkdocs-live-edit-plugin](https://github.com/eddyluten/mkdocs-live-edit-plugin), based on [@celsowm/markdown-wysiwyg](https://www.npmjs.com/package/@celsowm/markdown-wysiwyg).

When you click "Edit" in the live-edit plugin, this plugin replaces the plain textarea with a rich WYSIWYG editor that supports dual-mode editing (visual and Markdown), toolbar formatting, and smart conversion.

## MkDocs Admonitions

The WYSIWYG editor supports MkDocs admonition syntax (`!!! note`, `!!! warning`, etc.) in both modes:

- **Markdown mode**: Type `!!! note` followed by indented content (4 spaces)
- **WYSIWYG mode**: Admonitions render as styled callout boxes; editing preserves the `!!!` syntax when saving

Supported types: `note`, `warning`, `danger`, `tip`, `hint`, `important`, `caution`, `error`, `attention`.

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
```

### Options

| Option | Type | Default | Description |
|-------|------|---------|-------------|
| `article_selector` | string | `null` | CSS selector for the article element where controls appear. Same behavior as mkdocs-live-edit-plugin. Falls back to `[itemprop="articleBody"]`, `div[role="main"]`, or `article` if not specified. |

## MkDocs Theme Support

Only the [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) theme is officially supported. Admonition styling and icons rely on Material theme CSS. Other themes may work but have not been tested.

Contributions to add support for other themes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Material theme support is a requirement.

**No breaking changes** to Material theme compatibility are allowed.

## Requirements

- Python 3.10 or higher.
- mkdocs-live-edit-plugin (must be installed and configured)
- mkdocs >= 1.5
