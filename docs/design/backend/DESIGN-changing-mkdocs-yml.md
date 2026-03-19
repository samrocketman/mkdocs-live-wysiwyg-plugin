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
| Add mermaid superfences | `_addMermaidSuperfencesConfig` | js-yaml round-trip | Caution auto-fix |

## Virtual Mutation Pattern

Transforms are applied to `_virtualMkdocsYml` (the single in-memory copy of the user's mkdocs.yml content). After applying a transform, the caller commits a nav snapshot via `_commitNavSnapshot()`. The snapshot captures the current `_virtualMkdocsYml` value, making the change part of the undo/redo history.

```
Action handler
  → apply transform to _virtualMkdocsYml
  → _commitNavSnapshot()
  → snapshot captures _virtualMkdocsYml
  → on Save: _computeSavePlan detects diff → emits mkdocsYmlOps
```

## Source of Truth Architecture

`original-mkdocs.yml` is the primary source of truth for `_virtualMkdocsYml`. The generated `../mkdocs.yml` (which includes techdocs-core plugins, hooks, theme overrides) is only used as a fallback when `original-mkdocs.yml` is not available.

### Prefetch

`_prefetchMkdocsYml()` loads `_virtualMkdocsYml` from:
1. `liveWysiwygOriginalMkdocsYml` (if available — the user's original config)
2. `../mkdocs.yml` (fallback — the generated config)

Only one virtual copy is maintained. All transforms are applied to `_virtualMkdocsYml` only.

### Save: Dual-Write via Save Planner

When `_computeSavePlan` detects that `_virtualMkdocsYml` changed between snapshot 0 and the active snapshot:

- **With `original-mkdocs.yml`**: Emits `write-mkdocs-yml` (overwrite) for `original-mkdocs.yml`, then `merge-mkdocs-yml` (3-way YAML deep merge) for `../mkdocs.yml`.
- **Without `original-mkdocs.yml`**: Emits `write-mkdocs-yml` (overwrite) for `../mkdocs.yml` directly.

### 3-Way YAML Deep Merge (`_yamlDeepMerge`)

The `merge-mkdocs-yml` op handler reads `../mkdocs.yml` from disk and performs a 3-way merge:

- **base**: snapshot 0's mkdocs.yml (before user changes)
- **source**: active snapshot's mkdocs.yml (after user changes)
- **target**: the generated `../mkdocs.yml` currently on disk

The merge computes the delta (base → source) and applies only those changes to target:

- Key unchanged between base and source → target untouched
- Key changed between base and source → target updated with source's value
- Key in base but not source → deleted from target
- Key in source but not base → added to target
- Key in target but not in base or source → preserved (e.g., techdocs-core plugins, hooks)

For `plugins` and `markdown_extensions` lists, set-union merge is used instead of atomic overwrite: items added in source are added to target, items removed from source are removed from target, items only in target are preserved.

If the merged content is identical to the disk content, the write is skipped entirely.

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
