# Focus Mode Navigation Menu — Design Document

## Overview

The WYSIWYG editor's focus mode includes an emulated navigation sidebar that provides seamless AJAX page navigation (no page reloads), mkdocs-nav-weight integration with 4-direction arrow controls, settings gears for page and folder metadata, a batch nav menu editing system with undo/redo, a page management submenu, and a nav-to-weight migration flow.

## Architecture

### Server Side (`plugin.py`)

- **`on_nav` hook**: Stores a reference to the `nav` object (`_nav_ref`) and collects the full navigation tree via `_collect_nav_tree`. Stores `_nav_data` for immediate use, but it is re-collected in `on_page_content` to ensure page titles (resolved from markdown content or frontmatter) are accurate.
- **`on_page_markdown` hook**: Builds site-wide link index (`_link_index`) by parsing markdown links (with `(?<!!)` negative lookbehind), images, HTML `<img>` tags, and reference definitions. Stores type, target (stripped of anchors/queries), and character offset.
- **`on_page_content` hook**: Re-collects the nav tree from `_nav_ref` so that titles resolved during rendering are included. Injects 6 JS constants into the preamble: `liveWysiwygPageSrcPath`, `liveWysiwygNavData`, `liveWysiwygNavWeightConfig`, `liveWysiwygHasNavKey`, `liveWysiwygAllMdSrcPaths`, `liveWysiwygLinkIndex`. Also injects the early-inject overlay script (dark transparent, `rgba(0,0,0,.18)`) for cookie-based focus mode re-entry on full page loads.

### Client Side (`live-wysiwyg-integration.js`)

Core systems:

1. **YAML Frontmatter Parser** (`_parseFrontmatter`, `_buildFrontmatterString`, `_updateFrontmatter`): Parses frontmatter between `---` delimiters. Handles multiline values, YAML comments, and unrecognized keys. Enforces ordering: `title` first, `weight` last, everything else in between. Default-removal strips fields matching their effective default (with exception for `empty` on `retitled` index.md).

2. **Dedicated WebSocket** (`_getOrCreateBulkWs`, `_wsSend`, `_wsNewFile`, etc.): Lazily created connection to the live-edit server for reading/writing arbitrary files. Used for AJAX navigation content loading, bulk operations, frontmatter updates on other pages, and mkdocs.yml editing. `_wsSend` handles `get_contents`, `set_contents`, and `delete_file` (generic `{action, path, contents}` format). `_wsNewFile` is separate because the upstream server expects `{action: 'new_file', path, title}` — **not** `contents`. Both `_wsSend` and `_wsNewFile` register `close` and `error` event handlers alongside the `message` handler: if the server crashes (e.g., `FileNotFoundError` on `get_contents` for a missing file), the promise rejects immediately instead of waiting for the 15-second timeout. On close/error, `_bulkWs` is set to `null` so the next operation creates a fresh connection.

3. **Livereload Guard & Rebuild Polling** (`_installReloadGuard`, `_removeReloadGuard`, `_waitForRebuild`, `_waitForRebuildAndReconnect`): Suppresses page reloads during batch processing via two layers: (a) a permanent XHR tracking hook (`_trackedLivereloadXHRs`) installed at script load time that records every XHR opened to `/livereload/` — when `_installReloadGuard` activates, all tracked XHRs are aborted, killing in-flight livereload long-polls before they can respond and trigger `location.reload()`, (b) patching `XMLHttpRequest.prototype.open/send` to block new livereload XHRs opened during the guard period. `Location.prototype.reload` is NOT patched (it is non-writable/non-configurable in Chrome). Our own rebuild detection uses `fetch()` — completely independent of XHR — to poll `/livereload/` and detect when MkDocs finishes rebuilding after a write. See [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) for Chrome Location object restrictions. The guard is idempotent and fully reversible (`_removeReloadGuard` restores to the tracking hook). `_waitForRebuildAndReconnect` chains: close bulk WebSocket → poll for rebuild → reconnect WebSocket.

4. **Link Rewriting** (`_rewriteLinksInContent`, `_rewriteInboundLinks`): Rewrites relative paths in moved documents (outbound) and across all referencing documents (inbound). Respects exclusion zones (code blocks, inline code, HTML comments). Preserves anchors and query strings. Case-sensitive matching.

5. **Nav Menu Builder** (`_buildNavMenu`, `_buildNavItems`): Populates the left sidebar (~253px wide) with a hierarchical nav tree using Material for MkDocs CSS classes and variables. Arrow controls and settings gear are grouped inside a flex wrapper (`.live-wysiwyg-nav-controls-wrapper`) positioned to the left of each item. Section expand/collapse uses CSS grid animation (`grid-template-rows: 0fr/1fr`). Every `<li>` gets a `data-nav-uid` attribute matching its navData item's `_uid` — this is the primary DOM lookup key for post-operation visual focus. Page `<li>` elements also get `data-nav-src-path` for event-to-data bridging (mapping clicks back to navData items). Section `<li>` elements get `data-nav-index-path` set to their index child's `src_path` (used by the caution icon renderer to place warnings for hidden index.md files on the folder title). None of these DOM attributes are used for nav item positioning, movement, or sibling lookup — those operations use the navData tree exclusively.

6. **Nav Edit Mode** (`_enterNavEditMode`, `_exitNavEditMode`): Manages the editing state: read-only overlay, keyboard overrides (Cmd+S → save, ESC → discard, Cmd+Z/Y → nav undo/redo), Save/Discard/Undo/Redo buttons.

7. **Batch Operation Queue** (`_navBatchQueue`, `_pushNavOperation`): Records all user actions as ordered operations in memory. At save time, normalization ops (if pending) are dispatched first, followed by user ops phase-sorted, all with a single rebuild wait at the end. During execution, `_batchDeletedPaths` and `_batchRenamedPaths` track filesystem changes so subsequent ops resolve files at their current locations and skip deleted files. See "Batch Nav Menu Editing" below.

8. **AJAX Navigation System** (`_doAjaxNavigate`, `_getCurrentSrcPath`, `_doFocusSave`): Enables seamless page-to-page navigation within focus mode without full page reloads. See "Navigation Flow" below.

9. **Content Dirty Tracking** (`_pristineContent`, `_resetPristineContent`, `_loadContent`): Tracks whether the user has made edits by comparing current content against the baseline. The upstream save/cancel buttons are only shown when actual changes exist, preventing false "unsaved changes" warnings caused by WYSIWYG/markdown rendering differences.

10. **Focused Item Interaction** (`_setNavItemFocused`, `_clearNavItemFocused`, `item._focused`): Focus is a property on navData items (`item._focused = true`), not a separate DOM reference. After a move operation, `_setNavItemFocused(item)` marks the moved item in navData, then `_commitNavSnapshot()` triggers `_renderNavFromSnapshot()`. The renderer (`_buildNavItems`) reads `item._focused` and applies `.live-wysiwyg-nav-item--focused` (visible outline, persistent controls). `_renderNavFromSnapshot` scrolls the focused `<li>` to center in a `requestAnimationFrame`. Hovering a different item temporarily shows that item's controls (suppressing the focused item's). Moving the mouse off the nav menu restores the focused item's controls. This allows rapid repeated arrow clicks for positioning.

## Navigation Flow

### AJAX Navigation (Primary — Focus Mode)

When the user clicks a nav link while in focus mode, the editor uses AJAX to swap page content without a page reload. The focus mode overlay stays in place throughout:

1. User clicks a nav link in the focus mode sidebar
2. If unsaved changes exist, show "Save and leave" / "Discard and leave" / "Cancel" dialog
3. `_doAjaxNavigate(url, title, srcPath)` is called
4. A dark transparent transition overlay (`rgba(0,0,0,.12)`) fades in on top of focus mode with a spinner and status text
5. New page markdown is fetched via WebSocket: `_wsGetContents(srcPath)`
6. `wysiwygEditor._loadContent(markdown)` replaces the editor content:
   - Updates the hidden textarea value
   - Converts markdown to HTML and sets `editableArea.innerHTML` (WYSIWYG mode) or updates `markdownArea.value` (markdown mode)
   - Resets `_pristineContent` baseline and hides save/cancel buttons
7. `_ajaxCurrentSrcPath` is set to track the new page's file path
8. `history.pushState()` updates the browser URL (no page reload)
9. `document.title`, nav sidebar active state, TOC, and focus header are refreshed
10. Transition overlay fades out

**Fallback**: If the WebSocket fetch fails, navigation falls back to a full page reload with the cookie-based early overlay.

**Browser back/forward**: A `popstate` event listener detects history navigation and performs AJAX navigation when the state contains `srcPath`.

### Cookie-Based Navigation (Fallback — Full Reload)

Used for batch save navigation, migration flow, and any case where AJAX is not possible:

1. Set `live_wysiwyg_focus_nav=1` cookie (60s TTL)
2. Navigate via `window.location.href = url` (full page reload)
3. Early-inject script on the new page detects cookie, creates dark transparent overlay (`rgba(0,0,0,.18)`)
4. `_autoClickEditButton()` polls for and clicks the live-edit "Edit" button to establish the WebSocket connection
5. Once the `.live-edit-source` textarea appears, the WYSIWYG editor initializes
6. `enterFocusMode()` is called, which removes the early overlay with a fade-out transition

### Page Source Path Tracking

After AJAX navigation, `liveWysiwygPageSrcPath` (a `const` from the server-rendered page) becomes stale. All code accesses the current page's source path through `_getCurrentSrcPath()`, which returns `_ajaxCurrentSrcPath` if set, falling back to `liveWysiwygPageSrcPath`.

### Source Path to URL Conversion

`_srcPathToUrl(srcPath)` converts a docs-relative source path to a MkDocs URL (assuming `use_directory_urls: true`, which is the default):

- `index.md` → `/`
- `folder/index.md` → `/folder/`
- `page.md` → `/page/`
- `folder/page.md` → `/folder/page/`

Used by `_navigateAfterBatchComplete` and `_navigateAfterSave` to navigate to the correct URL after batch operations that may have moved/renamed the current page.

### Save Flow After AJAX Navigation

When saving content for an AJAX-loaded page, the upstream live-edit save button cannot be used (it would save to the originally-loaded page's `page_path`, which is trapped in the live-edit IIFE closure). Instead:

1. `_doFocusSave()` is called by the focus mode save button
2. `wysiwygEditor._finalizeUpdate()` syncs current content to the hidden textarea
3. If `_ajaxCurrentSrcPath` is set: `_wsSetContents(_ajaxCurrentSrcPath, content)` writes directly via the dedicated WebSocket
4. `_resetPristineContent(content)` updates the dirty tracking baseline
5. If `_ajaxCurrentSrcPath` is not set (original page): clicks the upstream save button as before

## "Remain in Focus Mode on Save"

Cookie: `live_wysiwyg_focus_remain`. When enabled, Save triggers:

**After AJAX navigation** (no page reload needed):
1. `_doFocusSave()` saves via WebSocket
2. Re-fetch content: `_wsGetContents(currentSrcPath)`
3. `_loadContent()` refreshes the editor with server-side content
4. TOC is rebuilt
5. Transition overlay fades out

**Original page** (full reload path):
1. Capture cursor to `live_wysiwyg_nav_edit_cursor` cookie
2. Trigger upstream save
3. Set `live_wysiwyg_focus_nav` cookie
4. Navigate to current page (controlled reload)
5. Restore cursor from cookie after reconnection

## Overlay System

All overlays use dark semi-transparent backgrounds to avoid white flashing in both light and dark themes:

| Overlay | Background | Purpose |
|---------|-----------|---------|
| **Transition overlay** (`.live-wysiwyg-nav-transition-overlay`) | `rgba(0,0,0,.12)` | Shown on top of focus mode before AJAX navigation or full page reload. Spinner + status text in white with text-shadow. |
| **Early overlay** (`.live-wysiwyg-early-overlay`) | `rgba(0,0,0,.18)` | Injected by `plugin.py` on the new page during full page reloads. Hides the readonly page while the editor initializes. Faded out once focus mode is ready. |
| **Status overlay** (`.live-wysiwyg-nav-status`) | `rgba(0,0,0,.12)` | Positioned absolute within the content area during batch save operations. Shows progress bar and detail text. |

All use white-colored text/spinners with `text-shadow` for visibility against the dark background.

## Batch Nav Menu Editing

Entry points: first arrow click, WYSIWYG menu actions (Rename, New, Delete, Normalize).

### Phase Ordering

Operations are assembled in two groups and executed in this order:

**Group A — Normalization (runs first, if `_navNormalizeAllPending`):**

All normalization ops from `_collectNormalizeOps` are kept in their generated **bottom-up, level-grouped** order. `_collectNormalizeOps` recurses into children **before** processing the current level, so the deepest folders are fully normalized (rename + create + weights) before their parent folders are touched. This prevents corruption where a parent's index.md rename reads stale child state.

Within each level, ops are emitted in this order:
1. **Rename** (`rename-page`) — rename content-bearing `index.md` to a regular page file
2. **Create** (`create-page`) — generate a new placeholder `index.md` with `retitled: true` and `empty: true`
3. **Weights** (`set-weight`) — assign evenly distributed weights to all pages at this level (including the just-renamed file)

The renamed file is included in the weight calculation for its level, ensuring it gets a proper normalized weight. Normalization renames set `skipDoubleRenderCheck: true` because the content is only having links rewritten (string manipulation), not passing through WYSIWYG — the double render check is irrelevant and would block necessary renames.

When a create-page op creates a file at a path that was previously deleted (e.g., `folder/index.md` deleted by rename then recreated as placeholder), `_batchDeletedPaths[path]` is cleared so subsequent ops can correctly reference the file.

Normalization runs first so that weights are in place and index files exist before the user's manual reorganization operations execute.

**Group B — User operations (from `_navBatchQueue`, phase-sorted):**

3. **index.md regeneration** (`regenerate-index`) — rename-and-regenerate for folders needing placeholders
4. **Create** (`create-folder`, `create-page`, `convert-folder-to-page`) — new files
5. **Move/Rename** (`rename-page`, `move-left`, `move-right`, `move-into-section`, `set-headless`) — structural changes with outbound/inbound link rewriting
6. **Reorder** (`move-up`, `move-down`, `set-weight`) — weight updates
7. **Delete/Config** (`delete-page`, `update-mkdocs-yml`) — destructive operations last

### Fast Write with Reload Guard

The reload guard (`_installReloadGuard`) fully prevents page reloads during batch processing via two mechanisms: (1) aborting all tracked in-flight livereload XHRs (killing MkDocs' livereload long-poll before it can respond and trigger `location.reload()`), and (2) patching `XMLHttpRequest.prototype.open/send` to suppress new livereload XHRs. A permanent tracking hook installed at script load time records every XHR opened to `/livereload/` so the guard can abort them. `Location.prototype.reload` is NOT patched because it is non-writable/non-configurable in Chrome. This allows all WebSocket writes to be dispatched as fast as possible without needing to wait for intermediate MkDocs rebuilds.

1. **Install reload guard**: `_installReloadGuard()` aborts tracked livereload XHRs and patches `XMLHttpRequest.prototype.open/send` before any writes begin.
2. **Init batch path tracking**: `_batchDeletedPaths = {}; _batchRenamedPaths = {}` — cleared at the start of every batch and again in `_finishBatchSave`.
3. **Open WebSocket**: `_getOrCreateBulkWs()` establishes the dedicated bulk WebSocket connection.
4. **Dispatch all ops**: All phase-ordered operations (normalization first, then user ops) are dispatched sequentially via a chained Promise loop — each op completes its WebSocket I/O (reads, deletes, creates, writes) before the next begins, ensuring file consistency. Progress updates show each step. No rebuild wait or WebSocket reconnection between operations. Each op that deletes a file records it in `_batchDeletedPaths`; each rename/move records the old→new mapping in `_batchRenamedPaths`. Before any `_wsGetContents` call, ops resolve paths through `_batchRenamedPaths` and skip files in `_batchDeletedPaths` — this prevents sending `get_contents` for files that no longer exist on disk, which would crash the server's WebSocket handler with an unhandled `FileNotFoundError`.
5. **Wait for final rebuild**: After all ops complete, `_closeBulkWs()` closes the connection and `_waitForRebuild()` polls `/livereload/` via `fetch()` (independent of the XHR patch) every 1.5s up to 60 attempts (90s window) to detect when MkDocs finishes rebuilding.
6. **Finish**: Remove reload guard, clear batch tracking maps, show completion status, and navigate to the focus target page via `_srcPathToUrl(focusTarget)` (converts the src_path to the correct MkDocs URL). The `live_wysiwyg_focus_nav` cookie is set for the early overlay on the destination page.

All batch state (operations, focus target, failures, path tracking) is held **in memory only** — no cookies or `localStorage` are used for batch persistence. If the page somehow reloads mid-batch, the batch is abandoned.

**Error handling**: If an individual op fails, it is logged, the affected page gets a caution icon, and the batch continues with the next op. If the WebSocket connection dies (e.g., server crash from a `FileNotFoundError` on a missing file), `_wsSend`/`_wsNewFile` reject immediately via their `close`/`error` handlers and `_bulkWs` is nulled — the next op's `_getOrCreateBulkWs()` creates a fresh connection. Failures are accumulated and shown in the completion status.

### Undo/Redo

Every operation pushes to undo stack, clears redo stack. Undo pops and computes inverse operation. Redo re-applies. New action after undo clears redo (forks history).

### Content Submenu

The Content button in the focus mode toolbar opens a submenu (`_createPageSubmenu`) with Rename Page, New Page, Delete Page, Find dead links, and a new "Migrate to mkdocs-nav-weight" item. The migrate item calls `_startMigrationFlow()`, which has a Phase 0 hard prerequisite: it checks `cfg.installed` and aborts with an install prompt if mkdocs-nav-weight is not installed.

## mkdocs-nav-weight Integration

### Nav Controls Always Rendered

Nav controls (arrows and gear) are always rendered for every nav item regardless of `nwConfig.enabled` or `_ymlHasNavKey`. The old gates `(_navEditMode || isHiddenSection || nwConfig.enabled) && !_ymlHasNavKey(...)` have been replaced with unconditional rendering. Arrow movements are a no-op when `_ymlHasNavKey` is true (with a deferred warning), but all other operations (gear, rename, delete, create) work regardless of nav key or nav-weight status.

### Arrow Navigation

All arrow moves operate exclusively on the navData tree. Move functions accept only the navData `item` object — no DOM elements. `_findNavItemInTree(item._uid)` locates the item's position (parent array + index) for splice operations. After the navData mutation, `_setNavItemFocused(item)` marks the moved item in navData, then `_commitNavSnapshot()` triggers `_renderNavFromSnapshot()` which rebuilds the DOM with the `--focused` class applied by `_buildNavItems` and scrolls the focused item to center.

**Nav-key guard**: When `_ymlHasNavKey(_virtualMkdocsYml)` is true (mkdocs.yml has a hand-written `nav:` key), arrow movement is blocked at the top of `_handleArrowClick`. The move is a no-op; no movement function is called. A deferred warning is seeded lazily (see "Deferred Nav-Key Migration Warning" under Content Integrity).

- **Up/Down**: Reorder within folder. Sections (folders) are treated as same-level peers — a page moves one position at a time past sections, not over them. The moved page gets a midpoint weight between its new adjacent siblings (which may be section index.md weights via `_getItemWeight`).
- **Left**: Move to parent folder (no-op and hidden at root)
- **Right**: Move into adjacent folder below (or above if none below). No folders → new folder prompt
- **Shift+Up**: Move into deepest child of section above
- **Shift+Down**: Move into first level of section below
- **Shift+Right**: Always prompt for new/choose folder

**Auto-normalization**: If any sibling at the destination level lacks a weight, `_autoNormalizeSiblingWeights` assigns sequential weights to all siblings before the snapshot is committed. This eliminates the need for a blocking normalization prerequisite dialog — items of all types (pages, sections, assets, hidden content) can be moved freely.

### Root Index (`index.md`)

The root-level `index.md` (src_path `'index.md'`) receives special treatment:

- **Never assigned a weight**: Normalization strips any existing weight (`weight: null` op) and skips it in the weight distribution. `_isRootIndex(item)` helper identifies it.
- **Always stays first**: `_moveNavItemUp` blocks any item from moving above root index at the top level.
- **No arrows**: `_createNavWeightControls` hides all arrow buttons (`display:none`) for root index.
- **Gear with disabled weight**: Settings gear is available (skips `_checkNormalizationPrerequisite`) but the weight input is disabled. Other fields (title, headless, retitled, empty) remain editable. `_applySettingsGearChanges` skips disabled inputs.
- **No warning/question icons**: Weight-exceeds and unweighted caution icons are suppressed.

### Nav Item Controls Layout

Each nav item `<li>` has `padding-left:56px; margin-left:-56px` to extend the hover-interactive area leftward. The controls wrapper (`.live-wysiwyg-nav-controls-wrapper`) is a direct child of the `<li>`, positioned `absolute; left:2px`, containing both arrow grid and settings gear in a flex row (`display:flex; gap:3px`):

- **Arrow grid** (`.live-wysiwyg-nav-weight-controls`): 3×3 CSS grid of 12px buttons forming a plus/cross symbol. Up (row 1, col 2), Left (row 2, col 1), Right (row 2, col 3), Down (row 3, col 2).
- **Settings gear** (`.live-wysiwyg-nav-settings-gear`): 0.7rem font-size gear icon, flex-aligned next to the arrow grid.

**Page items**: Controls wrapper uses `top:50%; transform:translateY(-50%)` to vertically center with the link text. Shown on `<li>` `:hover` via direct-child selector.

**Section (folder) items**: Controls wrapper gets additional class `live-wysiwyg-nav-controls-section` with `top:.625em; transform:translateY(calc(.7em - 50%))` to vertically center with the folder title text. Shown only when hovering the folder title label, via a JS-toggled `live-wysiwyg-nav-title-hover` class on the `<li>` — using the direct-child selector (`>`) to prevent showing controls for nested children.

**Focused item** (`.live-wysiwyg-nav-item--focused`): After clicking an arrow, the item gets a 2px accent-color outline and its controls are force-shown via `display:flex!important`. Focus persists until the user interacts with a different item or exits nav edit mode.

### Settings Gears

Two gears: page (current page frontmatter) and folder (parent folder index.md). Fields: title, weight, headless, retitled (index.md only), empty (index.md only), plus Normalize button.

### Normalization on Move

Arrow moves no longer require a normalization prerequisite. Instead, `_handleArrowClick` auto-normalizes after the move: if any non-deleted, non-headless sibling at the destination level lacks a weight, `_autoNormalizeSiblingWeights(siblings)` assigns sequential weights (100, 200, 300...) to all siblings in the parent array before committing the snapshot. `_findNavSiblings` walks the navData tree to find the item and its siblings. `_getItemWeight` reads `weight` directly from pages and `index_meta.weight` from sections. All sibling and position lookups use the navData tree — the DOM is not consulted.

### Weight Adjustment

The effective default weight is `default_page_weight` from the nav-weight config if it is a positive number, otherwise `1000`. This avoids a JavaScript falsy trap where a configured value of `0` would be treated as unset.

**Normalization increment**: `Math.floor(defaultWeight / Math.max(10, count + 1))`. With ≤9 items, the divisor is 10, giving increments of `defaultWeight/10` (e.g., 100 for default 1000). With >9 items the divisor scales to `count+1`. All weights are evenly distributed as `weight_i = increment * (i + 1)`, always strictly between `0` and `default_page_weight`.

**Move increment**: Same formula `Math.max(1, Math.round(defWeight / Math.max(10, count + 1)))`. Moving between neighbors computes the midpoint: `round((prevPrevWeight + prevWeight) / 2)`. Moving to bottom: last weight + increment.

**Folder index.md as peers**: Folder `index.md` pages with `retitled: true` and `empty: true` participate in the same-level weight distribution alongside regular pages. Their effective default for UI warnings is `default_page_weight` (not `index_weight`). The `_executeMoveWeightOp` function uses `_getItemWeight()` (which reads `index_meta.weight` for sections) to correctly include section weights in midpoint calculations. Root index.md is filtered out of the siblings list.

### Migration Flow

`_startMigrationFlow` is a unified pipeline handling both nav-key migration (existing 7-phase flow) and alphabetical-ordering migration (simpler path for users without a nav key). Phase 0 checks `cfg.installed` and aborts with an install prompt if mkdocs-nav-weight is not installed. Phase 0b checks if nav weights are already active (`cfg.enabled && !hasNavKey`) and aborts with "No migration needed." When a nav key exists, `_startMigrationFlowNavKey` runs the full 7-phase nav-to-weight migration. When no nav key exists, `_startMigrationFlowAlphabetical` runs the simpler alphabetical-ordering path. See [DESIGN-nav-migration.md](DESIGN-nav-migration.md) for the nav-key migration phases.

## Content Integrity

- **Top warnings on page load**: `_seedNavTopWarnings()` no longer adds proactive warnings. The top warning area starts empty.

- **Deferred nav-key migration warning**: When the user first attempts an arrow move while `_ymlHasNavKey` is true, `_seedNavKeyMigrationWarning()` is called lazily (idempotent). It adds a top-level warning with `actionId: 'start-migration'` and `actionText: 'Migrate to mkdocs-nav-weight'`. `_pushNavKeyItemWarning(item)` shows a transient tooltip ("Reordering blocked — see warning above") on the clicked item.

- **Exclusion zones**: Code blocks, inline code, HTML comments are never modified
- **Anchor preservation**: `#section` and `?query` split off, path rewritten, reassembled
- **Heading-only links**: `#anchor` always skipped (same-page reference)
- **Filename conflicts**: Case-insensitive check + incrementor. Batch queue tracks claimed paths
- **Double rendering check**: In-memory WYSIWYG↔Markdown round-trip. Failure → original content preserved, caution icon added
- **Caution icon system**: Cookie `live_wysiwyg_caution_pages`, yellow triangle, popup with Resolve/Resolve All. Caution icons are rendered inline during `_buildNavItems` from `item._warnings` on navData items — the DOM is a rendering target only. The legacy `_applyCautionIcons` path (which queries `[data-nav-src-path]` and `[data-nav-index-path]` on `<li>` elements) is used only for post-save localStorage-driven icon placement on the already-rendered DOM; it does not influence data operations or item positioning
- **Pristine content tracking**: Editor content is compared against `_pristineContent` (set when content is loaded) to accurately detect user-initiated changes vs. rendering differences

## File Naming Convention

Generated from title: keep `a-zA-Z-`, lowercase, spaces→dashes, append `.md`. Conflict: append incrementor starting at 2. Folder names: `a-z0-9-` only.

## Case Sensitivity

- Filesystem operations: delete-then-create for case-insensitive safety
- Content and links: always case-sensitive (for Linux deployment)
- Link matching: exact case-sensitive comparison
- Filename generation: always lowercase

## Theme Dependency

The focus mode nav menu requires Material for MkDocs. It uses Material CSS variables (`--md-default-bg-color`, `--md-accent-fg-color`, `--md-nav-icon--next`, etc.) with hardcoded fallbacks. If a non-Material theme is detected, the left nav sidebar is disabled. Other themes may still be used for the editor itself, but nav menu features are unsupported.

## Upstream WebSocket Limitations

The upstream `mkdocs-live-edit-plugin` WebSocket supports `get_contents`, `set_contents`, `new_file`, `delete_file`, and `rename_file` for individual files. It does **not** support:

- Renaming or deleting folders
- Batch/transactional operations

Each `set_contents` / `new_file` / `delete_file` triggers a MkDocs rebuild. The WebSocket connection itself (running on a separate port/thread) is **not** invalidated by rebuilds, so multiple writes can be dispatched rapidly. The livereload-triggered page reload is suppressed by the reload guard (`_installReloadGuard`), which aborts all tracked in-flight livereload XHRs and patches `XMLHttpRequest.prototype.open/send` to block new ones. `Location.prototype.reload` is NOT patched (non-writable/non-configurable in Chrome). After all writes complete, a single `_waitForRebuild()` poll detects when MkDocs finishes the final rebuild. Note: the upstream server's `get_contents` handler does not gracefully handle missing files — a `FileNotFoundError` crashes the WebSocket connection handler. The batch path tracking system (`_batchDeletedPaths` / `_batchRenamedPaths`) prevents this by resolving paths to their current locations before any read.

**Workarounds**:
- **Folder deletion**: Recursively delete all `*.md` files; rely on Git not tracking empty folders.
- **Convert folder to page**: Move `folder/index.md` to `folder.md`, delete child `.md` files; empty folder remains on disk until next Git commit.
- **AJAX save routing**: The `page_path` variable in the live-edit IIFE is not accessible from outside. After AJAX navigation, saves are routed through the WYSIWYG plugin's dedicated WebSocket (`_wsSetContents`) instead.

See `.cursor/rules/focus-nav-menu.mdc` for detailed constraints and future expansion notes.

## Layout Subsystem

Nav sidebar width (`15.8rem` + `--_nav-extend`), controls positioning, section expand/collapse animation, scroll-to-focused, and the `< 76.25em` responsive breakpoint are governed by the Layout subsystem. See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative contracts.
