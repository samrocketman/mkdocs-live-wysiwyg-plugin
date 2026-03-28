# Changing mkdocs.yml — Design Document

## Overview

All programmatic modifications to `mkdocs.yml` in the WYSIWYG editor. Covers detection, transformation, dual-write, and the source-of-truth architecture.

All code lives in `live-wysiwyg-integration.js`.

## Cardinal Rules

**Rule 1 (In-Place Extension Replacement).** When upgrading a `markdown_extensions` list item from bare string to dict form (e.g., `pymdownx.superfences` → `pymdownx.superfences: {custom_fences: [...]}`), the transform must replace the item in-place at its current array index. Never add a new entry alongside the existing one. This prevents duplicate entries that cause MkDocs configuration errors. Already implemented correctly in `_addMermaidSuperfencesConfig`.

**Rule 2 (In-Place Plugin Replacement).** When upgrading a `plugins` list item from bare string to dict form (e.g., `mkdocs-nav-weight` → `mkdocs-nav-weight: {default_page_weight: 1000}`), the transform must replace the item in-place at its current array index. Never add a new entry alongside the existing one. **Known gap:** `_insertNavWeightEntry` currently uses regex-based string insertion without checking for an existing bare string entry. Future refactoring should move this transform to js-yaml round-trip with in-place replacement.

**Rule 3 (Transforms Are Idempotent).** Every transform must check whether the desired configuration already exists before modifying. Return the unchanged string if no modification is needed.

**Rule 4 (Snapshot-Only Mutations — from Cautions Rule C).** All mkdocs.yml changes only affect in-memory snapshot state (`_virtualMkdocsYml`). No disk I/O occurs until the user clicks Save, at which point the Declarative Save Planner emits ops. See `DESIGN-cautions.md` Rule C.

**Rule 5 (Snapshot State for Detection — from Cautions Rule B).** All config detection reads from `_virtualMkdocsYml` in the active snapshot, never from server-side flags or disk. See `DESIGN-cautions.md` Rule B.

**Rule 6 (Transforms Must Handle Missing Sections).** If a required top-level key (e.g., `markdown_extensions:`, `plugins:`) does not exist, create it. If an entry exists but lacks sub-keys, add them.

## Transform Inventory

| Transform | Function | Method | Trigger |
|---|---|---|---|
| Remove `nav:` key | `_removeNavKeyFromYaml` | String (line-based) | Nav-key migration |
| Insert `mkdocs-nav-weight` plugin | `_insertNavWeightEntry` | String (regex) | Nav-weight staging |
| Replace `default_page_weight` | `_replaceDefaultPageWeight` | String (regex) | Settings gear, auto-adjust |
| Replace `site_name` | `_replaceSiteName` | String (regex) | Site settings gear |
| Add mermaid superfences | `_addMermaidSuperfencesConfig` | js-yaml round-trip | Caution auto-fix |

## Virtual Mutation Pattern

Transforms are applied to both `_virtualMkdocsYml` (the user's original config) and `_virtualGeneratedMkdocsYml` (the techdocs-generated config) via `_applyYmlTransform(fn)`. After applying a transform, the caller commits a nav snapshot via `_commitNavSnapshot()`. The snapshot captures both virtual copies, making the change part of the undo/redo history.

```
Action handler
  → _applyYmlTransform(transformFn)  // applies to both virtual copies
  → _commitNavSnapshot()
  → snapshot captures mkdocsYml + generatedMkdocsYml
  → on Save: _computeSavePlan detects diff → emits write-mkdocs-yml ops for each changed file
```

## Source of Truth Architecture

Two virtual copies are maintained when `original-mkdocs.yml` exists:

- `_virtualMkdocsYml` — the user's original config (`original-mkdocs.yml`)
- `_virtualGeneratedMkdocsYml` — the techdocs-generated config (`../mkdocs.yml`)

When `original-mkdocs.yml` does not exist, only `_virtualMkdocsYml` is used (loaded from `../mkdocs.yml`), and `_virtualGeneratedMkdocsYml` remains `null`.

### Prefetch

`_prefetchMkdocsYml()` loads:
1. `_virtualMkdocsYml` from `liveWysiwygOriginalMkdocsYml` (if available) or `../mkdocs.yml` (fallback)
2. `_virtualGeneratedMkdocsYml` from `../mkdocs.yml` (only when `liveWysiwygOriginalMkdocsYml` exists)

### Save: Direct Writes via Save Planner

When `_computeSavePlan` detects that either virtual copy changed between the disk snapshot and the active snapshot:

- **With `original-mkdocs.yml`**: Emits `write-mkdocs-yml` (overwrite) for `original-mkdocs.yml` with `currentSnap.mkdocsYml`, and `write-mkdocs-yml` (overwrite) for `../mkdocs.yml` with `currentSnap.generatedMkdocsYml`.
- **Without `original-mkdocs.yml`**: Emits `write-mkdocs-yml` (overwrite) for `../mkdocs.yml` with `currentSnap.mkdocsYml` directly.

No `merge-mkdocs-yml` ops are emitted. Both files receive their complete content directly.

### `!!python/name:` Tag Handling

`_preProcessYaml` / `_postProcessYaml` wrap all js-yaml parse/dump cycles to handle `!!python/name:` tags safely. The pre-processor quotes them as strings; the post-processor restores the original syntax.

## Cross-References

| Document | Relationship |
|---|---|
| [DESIGN-cautions.md](DESIGN-cautions.md) | Cardinal Rules B and C; mermaid auto-fix action handler |
| [DESIGN-declarative-save-planner.md](DESIGN-declarative-save-planner.md) | Batch pipeline `write-mkdocs-yml` and `merge-mkdocs-yml` ops |
| [DESIGN-mkdocs-yml-mermaid-config.md](../mermaid/DESIGN-mkdocs-yml-mermaid-config.md) | Mermaid-specific config detection and auto-fix |
| [DESIGN-cli-utility.md](../DESIGN-cli-utility.md) | CLI manages `original-mkdocs.yml` lifecycle |
| `mkdocs-yml.mdc` | Cursor rule for mkdocs.yml modifications |
| `dual-mkdocs-yml-write.mdc` | Cursor rule for dual-write contract |
