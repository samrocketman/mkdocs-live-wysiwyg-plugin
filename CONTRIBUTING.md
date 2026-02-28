# Contributing

## Development Setup

### Local development with sibling mkdocs-live-edit-plugin

When developing with a local clone of `mkdocs-live-edit-plugin` in a sibling directory:

```bash
cd mkdocs-live-wysiwyg-plugin
uv sync
```

The `pyproject.toml` includes a `[tool.uv.sources]` override to use the local `../mkdocs-live-edit-plugin` when present.

### Standalone development (without local mkdocs-live-edit-plugin)

```bash
uv pip install mkdocs-live-edit-plugin
uv pip install -e .
```

### Building the site for testing

From the `mkdocs-live-wysiwyg-plugin` directory:

```bash
../techdocs-preview.sh add_plugins --upgrade .
../techdocs-preview.sh build
```

## Releasing

See [RELEASE.md](RELEASE.md) for instructions on publishing to PyPI with uv.
