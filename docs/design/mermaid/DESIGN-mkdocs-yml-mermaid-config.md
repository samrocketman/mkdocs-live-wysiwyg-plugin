# MkDocs YAML Mermaid Configuration

The MkDocs YAML Mermaid Configuration subsystem detects whether the user's `mkdocs.yml` has the required `pymdownx.superfences` configuration for mermaid diagram rendering and provides an auto-fix mechanism via the Caution subsystem.

**Parent subsystem for:** [Mermaid Mode](DESIGN-mermaid-mode.md) — the caution is triggered when the user exits mermaid mode and mermaid is not configured.

## Overview

MkDocs renders mermaid code blocks via the `pymdownx.superfences` extension with a custom fence definition. If this configuration is missing, mermaid diagrams in markdown will render as plain code blocks instead of diagrams. This subsystem:

1. **Detects** at runtime whether the required configuration exists in the active snapshot's `_virtualMkdocsYml`
2. **Warns** the user via a caution icon on the current page when they exit mermaid mode without it
3. **Auto-fixes** the configuration when the user clicks "Auto-fix mkdocs.yml" in the caution popup

All detection, warning, and fix logic lives in `live-wysiwyg-integration.js`. Detection uses the vendored js-yaml library to structurally parse `_virtualMkdocsYml` from snapshot state (Cardinal Rule B from DESIGN-cautions.md).

---

## Detection Logic (client-side YAML parsing)

### `_isMermaidConfiguredInYml(yml)`

Checks whether the given YAML string contains the required mermaid superfences configuration. Called with `_virtualMkdocsYml` from snapshot state.

| Step | Check |
|------|-------|
| 1 | Pre-process: quote `!!python/name:` tags for safe parsing |
| 2 | Parse YAML with `jsyaml.load()` |
| 3 | Iterate `parsed.markdown_extensions` array |
| 4 | Find dict item with key `pymdownx.superfences` |
| 5 | Check `custom_fences` array for an entry matching all three key-value pairs |

**Required key-value pairs** (all must match in the same entry):

- `name: mermaid`
- `class: mermaid`
- `format: !!python/name:pymdownx.superfences.fence_code_format`

**Result:** `true` if all checks pass; `false` otherwise. Returns `false` on parse errors (with console warning).

Handles both forms of extension entries:
- Dict item: `{ "pymdownx.superfences": { custom_fences: [...] } }` — checks `custom_fences`
- Bare string: `"pymdownx.superfences"` — no config attached, returns false

### `!!python/name:` Tag Handling

Standard YAML parsers (including js-yaml) do not support `!!python/name:` tags. The subsystem uses pre/post processing to work around this:

- **`_preProcessYaml(yml)`**: Quotes `!!python/name:` values so they become plain strings: `format: !!python/name:X` → `format: '!!python/name:X'`
- **`_postProcessYaml(yml)`**: Restores the raw tag after `jsyaml.dump()`: `format: '!!python/name:X'` → `format: !!python/name:X`

Both functions use a shared constant `_PYTHON_NAME_TAG = '!!python/name:'` for consistency.

---

## Caution Integration

### Trigger

When `exitMermaidMode()` fires and `_isMermaidConfiguredInYml(_virtualMkdocsYml)` returns `false`, the function calls `_addCautionPage(pagePath, MERMAID_CONFIG_REASON)` where `pagePath` is the current page's `src_path`. This adds a caution icon to the page in the nav sidebar.

The detection reads from snapshot state (`_virtualMkdocsYml`), satisfying Cardinal Rule B: mkdocs.yml warnings should ALWAYS and ONLY come from active snapshot state.

### Reason String

`MERMAID_CONFIG_REASON = "Mermaid diagrams require pymdownx.superfences configuration"`

This reason is registered in the caution reason string inventory alongside dead links, nav migration, and unreferenced assets.

### Auto-fix in Caution Popup

`_showCautionPopup` renders action buttons for any warning reason registered in `_navCautionActions`. The mermaid config auto-fix is registered as `_navCautionActions[MERMAID_CONFIG_REASON]`. When the user clicks "Auto-fix mkdocs.yml":

1. The popup is dismissed (dismiss-first invocation)
2. The handler calls `_applyMermaidConfigFix()` which mutates `_virtualMkdocsYml` and `_virtualOriginalMkdocsYml` in-memory — no disk I/O
3. Calls `_removeNavWarningReason(navItem, MERMAID_CONFIG_REASON)` to remove only the mermaid reason (respecting caution resolve scoping)
4. Commits a nav snapshot so the icon update is reflected
5. Enters edit mode so Save/Discard buttons become visible — the Declarative Save Planner's `mkdocsYmlOps` diff will detect the virtual change and emit `write-mkdocs-yml` ops when the user clicks Save

### Resolve Scoping

The mermaid config reason follows the caution resolve scoping contract:
- "Resolve" in the popup removes all warnings (including mermaid config) — standard behavior
- "Auto-fix mkdocs.yml" removes only the mermaid config reason, preserving other reasons on the same page
- "Resolve All" clears all cautions across all pages — standard behavior

---

## Auto-fix Transform (JS)

### `_addMermaidSuperfencesConfig(yml)`

YAML-parser-based transform function. Uses js-yaml to structurally parse, modify, and serialize the YAML content with pre/post processing for `!!python/name:` tags.

### Cases Handled

| Case | Condition | Action |
|------|-----------|--------|
| **a** | No `markdown_extensions` key at all | Create `markdown_extensions` with full `pymdownx.superfences` + mermaid config |
| **b** | `markdown_extensions` exists but no `pymdownx.superfences` entry | Add `pymdownx.superfences` entry with `custom_fences` containing mermaid |
| **c** | `pymdownx.superfences` as bare string (no config) | Convert to dict form with `custom_fences` containing mermaid |
| **d** | `pymdownx.superfences` with config but no `custom_fences` | Add `custom_fences` array with mermaid entry |
| **e** | `custom_fences` exists but no mermaid entry | Append mermaid entry to existing list |

**Idempotent:** Returns `yml` unchanged if a mermaid fence with matching `name` and `class` is already present.

**Trade-off:** `jsyaml.dump()` reformats the entire file (comments are lost, indentation is normalized). This is acceptable because `_virtualMkdocsYml` is in-memory snapshot state that will be written by the Declarative Save Planner only when the user explicitly clicks Save.

---

## Virtual Mutation Pattern

### `_applyMermaidConfigFix()`

Applies the mermaid config fix to the virtual mkdocs.yml state in memory. No disk I/O — changes are deferred to the Declarative Save Planner (Cardinal Rule C from DESIGN-cautions.md).

| Step | Action |
|------|--------|
| 1 | Apply `_addMermaidSuperfencesConfig` to `_virtualMkdocsYml` |
| 2 | Apply `_addMermaidSuperfencesConfig` to `_virtualOriginalMkdocsYml` (if not null) |

The save planner's `_computeSavePlan` compares the active snapshot's `mkdocsYml` against the original snapshot's `mkdocsYml`. When they differ, it emits `write-mkdocs-yml` ops for both files. The dual-write to the original mkdocs.yml (techdocs-preview) is handled by the save planner, not by the fix function.

---

## Required Configuration

The auto-fix adds the following configuration when missing:

```yaml
markdown_extensions:
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
```

This enables mermaid code blocks (`` ```mermaid ``) to be rendered as diagrams by MkDocs.

---

## Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `_PYTHON_NAME_TAG` | `live-wysiwyg-integration.js` | Shared constant for `!!python/name:` prefix |
| `_preProcessYaml` | `live-wysiwyg-integration.js` | Quotes `!!python/name:` tags for safe YAML parsing |
| `_postProcessYaml` | `live-wysiwyg-integration.js` | Restores raw `!!python/name:` tags after YAML dump |
| `_isMermaidConfiguredInYml` | `live-wysiwyg-integration.js` | Detects mermaid config in YAML string via js-yaml parsing |
| `MERMAID_CONFIG_REASON` | `live-wysiwyg-integration.js` | Reason string constant for caution entries |
| `_addMermaidSuperfencesConfig` | `live-wysiwyg-integration.js` | YAML-parser-based transform to add mermaid fence config |
| `_applyMermaidConfigFix` | `live-wysiwyg-integration.js` | Applies the transform to virtual mkdocs.yml state (snapshot-only, no disk I/O) |

---

## CLI Startup Integration

`techdocs-preview.sh` also adds mermaid superfences configuration at server startup via `add_superfences_with_mermaid_if_missing`. This is complementary to the client-side auto-fix:

| Layer | Trigger | Scope |
|---|---|---|
| **CLI** (`techdocs-preview.sh`) | Server startup, in `mkdocs_config` | Only adds when `pymdownx.superfences` is entirely absent |
| **Client** (`live-wysiwyg-integration.js`) | User exits mermaid mode | Handles all cases (a–e) via structural YAML parsing |

The CLI integration ensures new projects get mermaid support out of the box. The client-side auto-fix handles existing projects where `pymdownx.superfences` may exist without mermaid configuration.

See [DESIGN-cli-utility.md](../DESIGN-cli-utility.md) — Mermaid Superfences Integration section.

---

## Dead Code

`plugin.py`'s `_is_mermaid_configured` and the `liveWysiwygMermaidConfigured` preamble variable are no longer used for detection. Detection now happens client-side via `_isMermaidConfiguredInYml` reading from snapshot state. The server-side code remains but is dead code pending separate cleanup.

---

## Cross-References

| Document | Relationship |
|----------|--------------|
| [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) | Caution is triggered on exit from mermaid mode |
| [DESIGN-vendor-subsystem.md](DESIGN-vendor-subsystem.md) | js-yaml and mermaid.js are vendored; js-yaml enables YAML parsing for config detection |
| [DESIGN-cautions.md](../backend/DESIGN-cautions.md) | Caution subsystem architecture, Cardinal Rules, and reason string inventory |
| [DESIGN-cli-utility.md](../DESIGN-cli-utility.md) | CLI adds mermaid superfences at server startup |
| `caution-resolve-scoping.mdc` | Cursor rule for scoped caution resolution |
| `dual-mkdocs-yml-write.mdc` | Cursor rule for dual-write contract (used by save planner) |
| `cli-utility.mdc` | Cursor rule for CLI utility subsystem |
| [DESIGN-declarative-save-planner.md](../backend/DESIGN-declarative-save-planner.md) | Save planner detects virtual mkdocs.yml changes and emits `write-mkdocs-yml` ops |
| [DESIGN-architecture-overview.md](../DESIGN-architecture-overview.md) | Architecture context |
