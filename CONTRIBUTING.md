# Contributing

## Development Setup

```bash
cd mkdocs-live-wysiwyg-plugin
uv sync
```

This installs `mkdocs-live-edit-plugin` from PyPI along with the plugin in editable mode.

### Building the site for testing

From the `mkdocs-live-wysiwyg-plugin` directory:

```bash
../techdocs-preview.sh add_plugins --upgrade .
../techdocs-preview.sh build
```

## Releasing

See [RELEASE.md](RELEASE.md) for instructions on publishing to PyPI with uv.
