# Releasing to PyPI

This document describes how to publish `mkdocs-live-wysiwyg-plugin` to [PyPI](https://pypi.org/) using [uv](https://docs.astral.sh/uv/).

## Prerequisites

- [uv](https://docs.astral.sh/uv/installation/) installed
- PyPI account with API token ([create one](https://pypi.org/manage/account/token/))
- Maintainer access to the project on PyPI (for first release, [register the project](https://pypi.org/account/register/))

## Release Steps

### 1. Update the version

Bump the version in `pyproject.toml`:

```bash
# Bump patch (0.1.0 → 0.1.1)
uv version --bump patch

# Bump minor (0.1.0 → 0.2.0)
uv version --bump minor

# Set exact version
uv version 1.0.0

# Preview without changing (dry run)
uv version 1.0.0 --dry-run
```

### 2. Build the package

Build source and wheel distributions. Use `--no-sources` to ensure the build works without local path overrides (e.g. `tool.uv.sources`), which matches how users will install from PyPI:

```bash
uv build --no-sources
```

Artifacts are written to `dist/`:
- `mkdocs_live_wysiwyg_plugin-<version>.tar.gz` (source distribution)
- `mkdocs_live_wysiwyg_plugin-<version>-py3-none-any.whl` (wheel)

### 3. Test the build (optional)

Verify the package installs and the plugin loads:

```bash
uv run --with ./dist/mkdocs_live_wysiwyg_plugin-*.whl --no-project -- python -c "import mkdocs_live_wysiwyg_plugin; print('OK')"
```

### 4. Publish to PyPI

Publish using your PyPI API token:

```bash
# Using environment variable (recommended)
export UV_PUBLISH_TOKEN=pypi-xxxxxxxxxxxx
uv publish

# Or pass token directly
uv publish --token pypi-xxxxxxxxxxxx
```

For [TestPyPI](https://test.pypi.org/) first:

```bash
uv publish --index testpypi --token pypi-xxxxxxxxxxxx
```

Add a TestPyPI index in `pyproject.toml` if needed:

```toml
[[tool.uv.index]]
name = "testpypi"
url = "https://test.pypi.org/simple/"
publish-url = "https://test.pypi.org/legacy/"
explicit = true
```

### 5. Tag the release (optional)

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

## Trusted Publishing (GitHub Actions)

The `.github/workflows/publish.yml` workflow publishes to PyPI on tag push (e.g. `v0.1.0`) using [PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/) (OIDC). No API token is stored in GitHub.

**Setup:**

1. In PyPI project settings, add a trusted publisher: [https://pypi.org/manage/project/mkdocs-live-wysiwyg-plugin/settings/publishing/](https://pypi.org/manage/project/mkdocs-live-wysiwyg-plugin/settings/publishing/)
2. Publisher type: GitHub
3. Owner, repository, and workflow name: `publish.yml`
4. Create a GitHub environment named `pypi` (optional, for deployment protection)

## Troubleshooting

- **Build fails with path dependency**: Ensure `uv build --no-sources` is used so `mkdocs-live-edit-plugin` is resolved from PyPI, not a local path.
- **Version already exists**: PyPI rejects re-uploads. Bump the version and rebuild.
- **Missing files in package**: Check `[tool.hatch.build.targets.wheel.force-include]` in `pyproject.toml` includes all required assets (JS, CSS).
