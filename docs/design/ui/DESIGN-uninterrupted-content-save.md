# Uninterrupted Content Save — Design Document

## Overview

The focus mode content save is non-blocking. When the user clicks Save (or presses Ctrl+S / Cmd+S), the editor writes the current document to disk via WebSocket and immediately updates the dirty-state baseline. The user continues typing without interruption — no read-only lock, no overlay, no content replacement. The MkDocs rebuild triggered by the file write is absorbed silently by the existing focus mode build-epoch poller.

This subsystem is part of **Content Editing** (focus mode document save path). It replaces the previous blocking save flow that routed through `_runBatchOps`.

All code lives in `live-wysiwyg-integration.js`.

## Problem

The previous focus mode content save had three sources of interruption:

1. **Editor lockout.** `_runBatchOps` set `contentEditable = 'false'` and `readOnly = true` on the editing surfaces for the duration of the save.
2. **Rebuild wait.** After writing the file, the save pipeline closed the bulk WebSocket, polled the livereload endpoint until MkDocs finished rebuilding, then reconnected the WebSocket — blocking the entire time.
3. **Content replacement.** When "Remain in Focus Mode on Save" was enabled, the save pipeline fetched the rebuilt markdown from the server via `_wsGetContents`, called `_loadContent` to replace the editor content, and showed a "Reloading..." fullscreen overlay.

The combined effect: several seconds of frozen UI per save, during which any typing was lost.

## Architecture

### Save Flow

```
_doFocusModeSave()
  └─ _doFocusSaveBackground()
       ├─ Capture content (same as _doFocusSave)
       │   ├─ _finalizeUpdate(innerHTML or markdownArea.value)
       │   └─ Read hidden textarea (.live-edit-source)
       ├─ _getOrCreateBulkWs()
       ├─ _wsSetContents(path, content)
       ├─ On success:
       │   ├─ _resetPristineContent(content)   ← dirty baseline updated
       │   ├─ _bgSavePendingRebuild = true     ← suppress rebuild dialog
       │   └─ _focusOverlay._updateSaveDiscard()
       └─ On failure:
           └─ Show error toast (auto-dismiss after 5s)
```

The entire flow is asynchronous. The user's editing surface is never locked.

### Rebuild Absorption

Writing a file triggers a MkDocs rebuild, which changes the build epoch. Without suppression, the focus mode rebuild poller would detect the epoch change and show an "external rebuild" dialog. The `_bgSavePendingRebuild` flag prevents this.

Three code paths can detect a rebuild and call `_onExternalRebuild()`:

| Path | Location | Suppression |
|---|---|---|
| **Build-epoch poller** | `_startFocusModeRebuildPoller` inner `poll()` | Checks `_bgSavePendingRebuild` before `_userActionInProgress`. If true, clears the flag and absorbs the epoch change. |
| **WS redirect handler** | `WebSocket.prototype.onmessage` wrapper | Adds `!_bgSavePendingRebuild` to the condition guarding `_onExternalRebuild()`. Does **not** clear the flag (poller handles that). |
| **Location guard** | `_compat.installLocationGuard` `onIntercept` | Adds `!_bgSavePendingRebuild` to the condition guarding `_onExternalRebuild()`. Does **not** clear the flag. |

The poller is the canonical absorber — it updates `_focusModeBuildEpoch` and clears the flag atomically. The other two paths only suppress the dialog; the poller eventually syncs the epoch.

### Dirty State

Dirty tracking uses the existing `_pristineContent` / `_isDocDirty()` mechanism:

```
_pristineContent ← set to saved content when _wsSetContents succeeds
_isDocDirty()    ← returns (textarea.value !== _pristineContent)
```

If the user typed additional characters during the async save, `_isDocDirty()` returns `true` and the Save/Discard buttons remain visible. If the user made no further changes, the buttons hide.

The Discard flow is unchanged: it fetches the current file from the server via `_wsGetContents` and calls `_loadContent` to replace the editor content.

## Global State

| Variable | Type | Purpose |
|---|---|---|
| `_bgSavePendingRebuild` | `boolean` | `true` from the moment a background save's `_wsSetContents` succeeds until the build-epoch poller absorbs the resulting epoch change. Suppresses `_onExternalRebuild()` across all three detection paths. |

## Functions

### `_doFocusSaveBackground()`

Non-blocking content save. Captures editor content, writes to disk, updates dirty baseline. Does not call `_runBatchOps`, does not lock the editor, does not wait for rebuild, does not replace editor content.

**Called by:** `_doFocusModeSave()` (Save button click, Ctrl+S in focus mode).

**Not used by:** `_onExternalRebuild()` "Save changes and Refresh" path, which deliberately replaces content and continues to use the blocking `_doFocusSave()`.

### `_doFocusModeSave()`

Entry point for focus mode Save button and Ctrl+S. Routes to `_confirmNavSave()` when in nav edit mode, otherwise calls `_doFocusSaveBackground()`.

## Concurrent Saves

If the user saves multiple times before the first rebuild is detected:

- Each `_wsSetContents` call is independent. The last write wins on disk.
- `_pristineContent` is updated to each save's content, so dirty state always reflects the delta against the most recent save.
- `_bgSavePendingRebuild` stays `true` until the first epoch change, which covers all pending saves — MkDocs batches file-change rebuilds.

## Error Handling

If `_wsSetContents` fails (WebSocket disconnected, server error):

- `_pristineContent` is **not** updated (the save did not reach disk).
- `_bgSavePendingRebuild` is **not** set (no rebuild to absorb).
- A fixed-position error toast appears at the top of the viewport for 5 seconds, then auto-removes.
- The Save/Discard buttons remain in their current state (the document is still dirty).

## Auto-Save on Navigate

When the user clicks a nav item to navigate to a different page, the editor auto-saves dirty content without prompting. `_navigateToPage` checks `_isDocDirty()` and calls `_doFocusSaveBackground()` (fire-and-forget), then immediately proceeds with `_doNavigate`. No dialog, no waiting — navigation is instant and content is preserved in the background.

## Content Preservation Across Nav-Save Reload

Nav menu saves trigger a page reload (needed to rebuild the snapshot history from fresh server data). User content is preserved through two layers:

1. **Batch `save-content` op**: `_executeNavBatchSave` prepends a `save-content` operation if the document is dirty. This writes to disk before any rename/move ops, and renames carry the content to the new location.

2. **sessionStorage safety net**: Before the reload, `_navigateAfterBatchComplete` stashes `{ srcPath: reloadPath, content: editorContent }` in `sessionStorage` under `live_wysiwyg_content_backup`. After reload, `enterFocusMode` checks this key. If the stashed `srcPath` matches the current page and the content differs from what the server provided, the stashed version is loaded (user content takes priority). `_pristineContent` is set to the server content so any delta shows as dirty. The sessionStorage entry is consumed (deleted) after restoration.

The `reloadPath` is computed from `desiredState.items` in `_executeNavBatchSave` — the desired post-move path of the currently-edited page — ensuring the reload navigates to the correct URL after file moves/renames.

## Relationship to Other Subsystems

| Subsystem | Interaction |
|---|---|
| **Blocking content save** (`_doFocusSave`) | Retained for the "Save changes and Refresh" path in `_onExternalRebuild()`. The two save functions share the same content-capture logic but differ in execution strategy. |
| **Nav batch save** (`_runBatchOps`) | Not used by the background content save. Nav saves continue to use the full batch pipeline with read-only lock, progress UI, rebuild wait, and WebSocket reconnect. |
| **Focus mode rebuild poller** | The poller's `poll()` function gained a `_bgSavePendingRebuild` check that takes priority over `_userActionInProgress`. |
| **Dirty tracking** (`_pristineContent`, `_isDocDirty`) | The background save updates `_pristineContent` on success, same as the blocking save. No changes to the dirty-tracking mechanism itself. |
| **Cursor preservation** | Not affected. The background save does not reparent, recreate, or refocus any DOM elements. The user's cursor and selection are untouched. |
| **Nav page navigation** (`_navigateToPage`) | Auto-saves dirty content via `_doFocusSaveBackground()` before AJAX navigation. No save/discard prompt. |
| **Nav save reload** (`_navigateAfterBatchComplete`) | Stashes content to sessionStorage before reload. `enterFocusMode` restores it post-reload if the server content differs. |
