# Application Storage — Design Document

## Overview

The WYSIWYG plugin uses `localStorage` for two categories of persistent state: **user preferences** (editor settings that survive page reloads) and **nav-operational data** (warnings, execution pipelines, and notifications generated during editing sessions). All storage keys live in the browser's `localStorage` under well-known string keys. The plugin never uses `sessionStorage` or IndexedDB.

All code lives in `live-wysiwyg-integration.js`.

## Storage Categories

### User Preferences

User preferences are stored in a single JSON object under `liveWysiwygSettings`. These are never cleared by schema validation — they represent the user's chosen configuration and must survive across plugin updates.

### Nav-Operational Data

Nav-operational data is generated during editing sessions and may become incompatible when the plugin's data structures change (e.g., new item types in navData, pipeline operation format changes). This data is expendable — it can always be reconstructed through rescanning or re-editing. It is subject to schema version validation and automatic clearing.

## Storage Keys

| Key | Category | Format | Purpose |
|-----|----------|--------|---------|
| `liveWysiwygSettings` | Preferences | JSON object | All user preferences as key-value pairs |
| `live_wysiwyg_nav_schema` | Schema | Integer string | Nav storage schema version stamp |
| `live_wysiwyg_caution_pages` | Nav-operational | JSON array | Per-page warning reasons (link integrity, batch failures) |
| `live_wysiwyg_dead_links` | Nav-operational | JSON array | Per-page dead link details (internal + external) |
| `live_wysiwyg_changes_pipeline` | Nav-operational | JSON array | Multi-stage execution plans that survive page reloads |
| `live_wysiwyg_post_save_messages` | Nav-operational | JSON array | Notification queue displayed after page reload |

## User Preferences (`liveWysiwygSettings`)

### Structure

```
{
  "_migrated": true,
  "liveWysiwygEditorEnabled": { "enabled": true, "mode": "wysiwyg" },
  "liveWysiwygIndent": { "size": 4, "type": "spaces" },
  "live_wysiwyg_autofocus": "1",
  "live_wysiwyg_autolaunch": "1",
  "live_wysiwyg_focus_remain": "1",
  "live_wysiwyg_focus_toolbar": "1",
  "live_wysiwyg_focus_nav": "1",
  "live_wysiwyg_show_hidden": "1",
  "live_wysiwyg_image_attr_syntax": "1",
  "live_wysiwyg_nav_edit_cursor": "{...}",
  "live_wysiwyg_focus_nav_retry": "2",
  "live_wysiwyg_focus_nav_target": "Page Title",
  "live_wysiwyg_migration_result": "success",
  "live_wysiwyg_migration_normalize": "1",
  "live_wysiwyg_migration_adjust_weight": "1"
}
```

Most values are `"0"` / `"1"` strings (legacy from cookie migration). `liveWysiwygEditorEnabled` and `liveWysiwygIndent` are structured objects. `live_wysiwyg_nav_edit_cursor` stores a JSON-stringified cursor descriptor.

### API

| Function | Purpose |
|----------|---------|
| `_getSettings()` | Returns the full settings object. Cached in `_settingsCache` after first read. |
| `_getSetting(key)` | Returns a single setting value. |
| `_setSetting(key, value)` | Writes a single key. Invalidates cache. |
| `_deleteSetting(key)` | Removes a key. Invalidates cache. |

### Cookie Migration

`_migrateFromCookies()` runs once (IIFE, synchronous). It reads settings from `document.cookie`, copies them into the `liveWysiwygSettings` localStorage object, sets `_migrated: true`, and deletes the original cookies. This is a one-time migration from the cookie-based storage used in earlier versions. The `_migrated` flag prevents re-running.

### Transient Settings

Some keys are written before a page reload and consumed immediately after:

- `live_wysiwyg_nav_edit_cursor` — cursor state captured before nav-edit save/discard, restored after reload, then deleted.
- `live_wysiwyg_migration_result` — migration outcome (`"success"` or `"warnings"`), displayed as notification after reload, then deleted.
- `live_wysiwyg_migration_normalize` / `live_wysiwyg_migration_adjust_weight` — migration chain state, consumed and deleted as each phase completes.
- `live_wysiwyg_focus_nav_retry` — retry counter for focus mode initialization failures, deleted on success.
- `live_wysiwyg_focus_nav_target` — page title to scroll to after focus mode opens, consumed then deleted.

These keys self-clean after consumption. Stale values (from a crash mid-chain) are harmless — the migration chain simply starts from the detected state on next load.

## Nav-Operational Data

### Caution Pages (`live_wysiwyg_caution_pages`)

```
[
  { "path": "docs/page.md", "reasons": ["Link integrity may need attention"], "renames": 2 },
  ...
]
```

Written by `_setCautionPages()` during `_persistWarningsFromSnapshot()` on save. Read by `_getCautionPages()` during `_applyStoredWarningsToNavData()` on focus mode entry. Each entry is matched to a navData item by `src_path`; unmatched entries are silently skipped.

### Dead Links (`live_wysiwyg_dead_links`)

```
[
  {
    "path": "docs/page.md",
    "internal": [{ "text": "Link text", "target": "relative/path.md" }],
    "external": [{ "text": "Link text", "target": "https://...", "status": 404, "error": "" }]
  },
  ...
]
```

Written by `_setDeadLinkPages()` during `_persistWarningsFromSnapshot()`. Read by `_getDeadLinkPages()` during `_applyStoredWarningsToNavData()`. Same match-by-path pattern as caution pages.

### Changes Pipeline (`live_wysiwyg_changes_pipeline`)

```
[
  {
    "title": "Restructuring folders and files",
    "completed": false,
    "batches": [
      {
        "title": "Renaming folders",
        "ops": [{ "type": "rename-folder", "oldFolder": "...", "newFolder": "..." }, ...],
        "type": "api",
        "completed": false
      },
      ...
    ]
  },
  ...
]
```

The pipeline is a multi-stage execution plan that survives page reloads. Written by `_savePipeline()` during batch execution. Read by `_loadPipeline()` during `_resumePipeline()`, which is called 500ms after focus mode entry. Each stage contains batches of operations. The pipeline advances by marking batches and stages as `completed: true`. Once all stages complete, the pipeline is cleared.

### Post-Save Messages (`live_wysiwyg_post_save_messages`)

```
[
  { "type": "success", "text": "All changes saved." },
  { "type": "error", "text": "Failed to move file: ..." },
  ...
]
```

A notification queue. Messages are appended by `_queuePostSaveMessage()` during batch save finalization (before page reload). Consumed and cleared by `_showPostSaveMessages()` after focus mode initializes. Message types: `success`, `warning`, `info`, `error`. Error messages persist until manual dismiss; others auto-dismiss after 5 seconds.

## Schema Versioning

### Purpose

When the plugin's data structures change (e.g., new item types added to navData, pipeline operation format changes, caution/dead-link format changes), stale nav-operational data in localStorage can corrupt the application state. The schema version system detects format mismatches and clears stale data before it can be loaded.

### Mechanism

`_NAV_STORAGE_SCHEMA` is an integer constant in the JS. `_validateNavStorageSchema()` runs at the start of `enterFocusMode`, before any nav-operational localStorage is read:

1. Read `live_wysiwyg_nav_schema` from localStorage
2. Parse as integer; treat parse failure as `NaN`
3. If stored value equals `_NAV_STORAGE_SCHEMA`, return (data is compatible)
4. Otherwise, remove all nav-operational keys: `live_wysiwyg_caution_pages`, `live_wysiwyg_dead_links`, `live_wysiwyg_changes_pipeline`, `live_wysiwyg_post_save_messages`
5. Write the new schema version to `live_wysiwyg_nav_schema`

User preferences (`liveWysiwygSettings`) are never cleared.

### When to Bump

Increment `_NAV_STORAGE_SCHEMA` when any of the following change:

- NavData item types (e.g., adding `type: 'asset'`)
- Pipeline operation structure (new op types, changed op fields)
- Caution/dead-link storage format
- Any change that makes previously-stored data incompatible with current loading code

Schema bumps are safe: the cleared data is all reconstructable through rescanning (dead links), re-editing (cautions), or re-saving (pipeline). No user work is lost.

### Schema History

| Version | Change |
|---------|--------|
| 1 | (implicit) Original format — pages only, no assets |
| 2 | Binary file management — asset items added to navData, synthetic sections, hidden section detection |

## Corruption Protection

### Layer 1: Schema Versioning

Prevents stale nav-operational data from being loaded after format changes. Runs once on focus mode entry, before any other localStorage read.

### Layer 2: JSON Parse Protection

Every `localStorage.getItem` + `JSON.parse` pair is wrapped in try/catch. Invalid JSON (manual corruption, browser storage issues, truncated writes) degrades gracefully:

| Key | Invalid JSON Behavior |
|-----|-----------------------|
| `liveWysiwygSettings` | Returns `{}`. Next `_setSetting` overwrites corrupt data. Self-healing. |
| `live_wysiwyg_nav_schema` | `parseInt` returns `NaN` → schema mismatch → clears all nav keys. Self-healing. |
| `live_wysiwyg_changes_pipeline` | Clears pipeline, returns `[]`. |
| `live_wysiwyg_post_save_messages` | Read: returns early, no notification displayed. Write: starts fresh `[]`. |
| `live_wysiwyg_caution_pages` | Returns `[]`. No warnings applied. |
| `live_wysiwyg_dead_links` | Returns `[]`. No dead links applied. |

### Layer 3: Structural Validation

Valid JSON with wrong structure (e.g., array where object expected, missing fields) is handled by downstream consumers:

- **Pipeline**: `_loadPipeline()` validates that parsed data is an array of stages, each with a `title` string and `batches` array, each batch with an `ops` array. Invalid structure clears the pipeline.
- **Caution pages**: `_getCautionPages()` normalizes entries via `.map()`, defaulting missing `.path` to `''`. `_applyStoredWarningsToNavData()` calls `_findNavItemByPath(cp.path)` which returns `null` for empty/unknown paths — the entry is silently skipped.
- **Dead links**: Same pattern — `_findNavItemByPath(dp.path)` returns `null` for entries with missing or unrecognized paths.
- **Settings**: Type-tolerant. `_getSetting` returns `undefined` for missing keys. All callers check for specific values (e.g., `=== '1'`, `=== '0'`) and treat unexpected values as the default.
- **Post-save messages**: `_queuePostSaveMessage` validates the parsed array with `Array.isArray`, falling back to `[]`. `_showPostSaveMessages` exits early on parse failure.

### Layer 4: Write Protection

Every `localStorage.setItem` call is wrapped in try/catch. Storage-full (quota exceeded) or unavailable (private browsing) conditions are silently absorbed. No write failure can propagate into application logic or interrupt operations like batch save.

### Layer 5: Pipeline Resume Safety

`_resumePipeline()` is wrapped in a top-level try/catch. If any error occurs during pipeline loading or stage execution setup, the pipeline is cleared and the progress bar is hidden. This prevents a corrupt pipeline from permanently blocking editor initialization.

## Lifecycle

### On Page Load (Synchronous)

1. `_migrateFromCookies()` — one-time cookie-to-localStorage migration (IIFE)
2. Settings cache initialized on first `_getSetting` call

### On Focus Mode Entry

1. `_validateNavStorageSchema()` — schema version check, clears stale nav-operational data
2. `_applyStoredWarningsToNavData()` — reads caution pages and dead links, applies to navData items
3. Initial snapshot taken (includes applied warnings)
4. `setTimeout(_resumePipeline, 500)` — resumes incomplete pipeline stages
5. `_showPostSaveMessages()` — displays and clears queued notifications

### During Editing

- Caution pages and dead links are modified in-memory on navData items only. No localStorage writes.
- Dead link scans commit results as a single snapshot.
- Pipeline is saved to localStorage on each batch/stage completion during batch save.
- Post-save messages are queued to localStorage before page reload.

### On Save

1. `_persistWarningsFromSnapshot()` — writes cautions and dead links from current navData to localStorage
2. Batch save may write pipeline state across multiple page reloads
3. Post-save messages queued for display after reload

### On Discard

Snapshot 0 (original state, which includes warnings from load) is restored. No localStorage mutation needed — the original warnings are already persisted.

## Rules

1. **Never clear `liveWysiwygSettings`.** User preferences must survive schema version bumps, plugin updates, and nav data clears.

2. **Bump `_NAV_STORAGE_SCHEMA` on format changes.** Any change to navData item types, pipeline op structure, or warning/dead-link format requires a schema bump. Without it, stale data may corrupt the editor.

3. **Every `JSON.parse` must be in try/catch.** No localStorage read path may allow a `SyntaxError` to propagate. The catch block must provide a safe default (empty object, empty array, or `NaN`).

4. **Every `localStorage.setItem` must be in try/catch.** Storage quota exhaustion and private browsing restrictions must never interrupt application logic.

5. **Structural validation before pipeline execution.** `_loadPipeline` must validate stage/batch/ops structure before returning data. Invalid structure clears the pipeline entirely.

6. **Match-by-path is the tolerance mechanism.** Caution and dead-link entries reference pages by `src_path`. If a path no longer exists in navData, the entry is skipped. This naturally handles renamed/deleted pages without requiring explicit cleanup.

7. **Transient settings must self-clean.** Keys like `live_wysiwyg_nav_edit_cursor` and `live_wysiwyg_migration_normalize` must be deleted after consumption. Stale transient keys should be harmless — callers must tolerate their presence and either re-consume or ignore them.

8. **Pipeline resume must not crash.** The top-level try/catch in `_resumePipeline` ensures that a corrupt or incompatible pipeline never prevents focus mode from initializing. The pipeline is cleared on any error.
