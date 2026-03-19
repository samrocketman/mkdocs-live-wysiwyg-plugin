# Cautions — Design Document

## Overview

Per-page warning system with scoped reason ownership. Each feature owns its reason strings. Resolution must only remove the caller's own reasons.

## Cardinal Rules

**Rule A.** Cautions get resolved (applying changes to disk) through the snapshot system only, via the Declarative Save Planner. No caution action handler may perform disk I/O directly.

**Rule B.** `mkdocs.yml` warnings should ALWAYS and ONLY come from active snapshot state — because the active snapshot contains `mkdocs.yml` contents or desired contents if the user clicks Save.

**Rule C.** "Applying" `mkdocs.yml` changes ONLY affects snapshot state — deferred to the Declarative Save Planner on Save. Action handlers mutate `_virtualMkdocsYml` / `_virtualOriginalMkdocsYml` and call `_commitNavSnapshot()`. The save planner's `mkdocsYmlOps` diff detects the change and emits `write-mkdocs-yml` ops.

## Warning Surface Taxonomy

The Caution subsystem surfaces warnings in the nav menu through the Nav Renderer in 4 configurations — 2 top-level and 2 page-level. All rendering flows through `_buildNavMenu` → `_buildNavItems` per the Nav Rendering Authority (`nav-rendering-authority.mdc`). All action handlers are synchronous snapshot mutations — no async operations, no disk I/O.

### Top-level warnings (`_navTopWarnings`, rendered next to nav title)

| # | Type | Registry | Example |
|---|------|----------|---------|
| 1 | Message only, no action | No `actionId` | Future informational notices |
| 2 | Message + action (snapshot mutation) | `_navTopWarningActions[actionId]` | `start-migration`, `apply-default-weight` |

Top-level warnings use dismiss-first invocation (`_showNavPopup` removes the popup before calling `btn.action()`).

### Page-level warnings (`item._warnings`, rendered as caution icons on nav items)

| # | Type | Registry | Example |
|---|------|----------|---------|
| 3 | Message only, no action | No `_navCautionActions` entry | Dead links, unreferenced assets |
| 4 | Message + action (snapshot mutation) | `_navCautionActions[reason]` | Mermaid auto-fix (`MERMAID_CONFIG_REASON`) |

Page-level action buttons use dismiss-first invocation (popup is removed before the handler runs).

## Data Model

**Per-item on navData:**
```
item._warnings = [
  { reason: 'Internal dead links found', renames: 0 },
  { reason: 'Batch operation failed: ...', renames: 0 },
  { reason: 'Some actionable reason', renames: 0, _actionData: { key: 'value' } }
]

item._deadLinks = {
  internal: [{ text: 'Link text', target: 'relative/path.md' }],
  external: [{ text: 'Link text', target: 'https://...', status: 404, error: '' }]
}
```

The optional `_actionData` property carries per-instance context for actionable cautions. It is deep-cloned in snapshots via `JSON.parse(JSON.stringify())` and round-tripped through localStorage as an `actionData` map keyed by reason string.

**Top-level on snapshot:**
```
topWarnings: ['warning message', ...]
```

## Warning Flow

```
                    ┌─────────────────────────────────┐
                    │         localStorage             │
                    │  live_wysiwyg_caution_pages      │
                    │  live_wysiwyg_dead_links         │
                    └──────┬──────────────▲────────────┘
                           │              │
              on load      │              │  on save
      _applyStoredWarnings │              │  _persistWarningsFromSnapshot
              ToNavData()  │              │
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │     navData items                 │
                    │  item._warnings = [...]           │
                    │  item._deadLinks = {...}          │
                    │  item._fm = {...}                 │
                    │  item._indexContent = '...'       │
                    └──────┬──────────────▲────────────┘
                           │              │
           _takeNavSnapshot│              │ _applySnapshotToGlobals
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │     _navSnapshots[]               │
                    │     (deep-cloned navData)         │
                    └──────┬──────────────▲────────────┘
                           │              │
          _renderNavFrom   │              │  undo / redo
          Snapshot()       │              │  index ± 1
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │         DOM                       │
                    │  caution icons from _warnings     │
                    │  dead link panel from _deadLinks  │
                    └─────────────────────────────────────┘
```

## Persistence Lifecycle

1. **Load**: `_applyStoredWarningsToNavData()` reads `_getCautionPages()` and `_getDeadLinkPages()` from localStorage, finds matching navData items by `src_path`, and sets `_warnings` / `_deadLinks` on them. When `actionData` is present in the persisted entry, it is attached as `_actionData` on the corresponding warning entries. This happens before the initial snapshot is taken, so snapshot 0 includes persisted warnings.

2. **Editing**: All warning operations (`_addCautionPage`, `_addDeadLinksForPage`, dead link scan, dismiss/resolve) modify navData items only. No localStorage writes.

3. **Save**: `_persistWarningsFromSnapshot()` calls `_collectNavWarnings()` and `_collectNavDeadLinks()` to walk the navData tree, extract warnings into the localStorage format, and write via `_setCautionPages` / `_setDeadLinkPages`. `_collectNavWarnings` includes an `actionData` map on entries where any warning has `_actionData`.

4. **Batch save errors**: `_warningDirectMode = true`. `_addCautionPage` writes directly to localStorage so errors survive the page reload that follows batch save.

5. **Discard**: Restores snapshot 0 (which contains original warnings from load). No localStorage mutation needed.

**localStorage format:**
```
{ path: 'guide/index.md', reasons: ['reason1', 'reason2'], renames: 0, actionData: { 'reason1': { ... } } }
```

The `actionData` map is optional and backward-compatible — entries without it work exactly as before.

## Batch Suppression

`_suppressWarningSnapshot` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` modify navData without calling `_commitNavSnapshot()`. The caller sets this flag, performs all warning operations, unsets it, then calls `_commitNavSnapshot()` once.

Used by `_commitDeadLinkResults` to add dead links for many pages as a single snapshot.

## Direct Mode

`_warningDirectMode` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` bypass navData entirely and write directly to localStorage. Used during batch save execution, when the snapshot system has been finalized and errors need to persist across page reloads.

Set to `true` in `_executeNavBatchSave` before `_runBatchOps`. Reset to `false` in `_finishBatchSave`.

## Rendering

`_buildNavItems` is the **sole authority** for caution icon DOM in the nav sidebar, per the Nav Rendering Authority (`nav-rendering-authority.mdc`). No caution-related code may directly add, remove, or modify DOM elements in the nav sidebar — all visual updates flow through `navData mutation → _commitNavSnapshot() → _renderNavFromSnapshot() → _buildNavMenu() → _buildNavItems()`.

Caution icons are rendered inline during `_buildNavItems`, not via a separate pass:

**Page items:** If `item._warnings` has entries, a warning span (`.live-wysiwyg-nav-caution`) is appended to the page link. The `<li>` gets class `live-wysiwyg-nav-caution-item`. Clicking the icon calls `_showCautionPopup(icon, navItem)`.

**Section items:** If the section's own `_warnings` or its index child's `_warnings` has entries, a caution icon is appended to the section label.

**Weight-exceeds warnings:** Rendered as direct DOM elements (not stored in `_warnings`). A warning icon with `data-weight-caution="1"` appears inline when `item.weight > defaultPageWeight` and `item.isIndex` is false (section indexes are excluded from this warning). This is computed state, not user-generated — it appears/disappears based on current data without snapshot tracking.

## Caution Popup

`_showCautionPopup(anchorEl, navItem)` reads from `navItem._warnings`:

- **Resolve**: Deletes `navItem._warnings` and `navItem._deadLinks`, hides dead link panel, calls `_commitNavSnapshot()`.
- **Resolve All**: Calls `_clearAllNavWarnings()` (recursive tree walk deleting `_warnings` and `_deadLinks` from all items), hides dead link panel, calls `_commitNavSnapshot()`.

Both actions create a snapshot, so they can be undone.

## Actionable Cautions

### Page-level action registry (`_navCautionActions`)

`_navCautionActions` is a registry mapping **reason string** to an action descriptor. When `_showCautionPopup` renders, it checks each warning reason against the registry. For each match, an action button is rendered in the popup.

```
_navCautionActions[reason] = {
  text: string,         // button label
  style?: string,       // optional cssText for the button
  handler: function(navItem, warningEntry) -> void
}
```

All handlers are synchronous. The popup is dismissed before the handler runs (dismiss-first invocation, matching top-level warnings).

### Registering a page-level action

```
// 1. Register the action (once, at init time)
_navCautionActions['My feature needs attention'] = {
  text: 'Fix it',
  style: 'background:#5cb85c;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:.75rem;',
  handler: function (navItem, warningEntry) {
    // Mutate snapshot state only — no disk I/O
    _removeNavWarningReason(navItem, 'My feature needs attention');
    _commitNavSnapshot();
    if (!_navEditMode) _enterNavEditMode();
  }
};

// 2. Add the warning when the condition arises
_addCautionPage(pagePath, 'My feature needs attention', { extra: 'context' });
```

### Handler contract

Action handlers registered in `_navCautionActions` MUST:

1. Be synchronous — no Promises, no async disk I/O (Cardinal Rule A)
2. Only mutate snapshot state: navData (via `_removeNavWarningReason` or direct property changes), `_virtualMkdocsYml`, `_virtualOriginalMkdocsYml`
3. Call `_commitNavSnapshot()` after mutations to trigger a nav DOM rebuild
4. Call `_enterNavEditMode()` if the mutation creates saveable changes, so Save/Discard buttons become visible
5. Never use `classList`, `setAttribute`, `removeChild`, or any DOM API on nav sidebar elements

### Mermaid Config Auto-fix

The Mermaid auto-fix is registered in `_navCautionActions[MERMAID_CONFIG_REASON]`:

1. Calls `_applyMermaidConfigFix()` which applies `_addMermaidSuperfencesConfig` to `_virtualMkdocsYml` and `_virtualOriginalMkdocsYml` in-memory — no disk I/O (Cardinal Rule C)
2. Removes only the mermaid config reason via `_removeNavWarningReason(navItem, MERMAID_CONFIG_REASON)` — respecting scoped resolution
3. Commits a nav snapshot so the caution icon update is reflected
4. Enters edit mode so the user can Save the mkdocs.yml change (the Declarative Save Planner's `mkdocsYmlOps` diff detects the virtual change and emits `write-mkdocs-yml` ops)

See `docs/design/mermaid/DESIGN-mkdocs-yml-mermaid-config.md` for the full auto-fix architecture.

## Dead Link Panel

`_showDeadLinkPanel(tocEl, navItem)` reads from `navItem._deadLinks`:

- **Resolve single link**: `_resolveOneDeadLink(pagePath, kind, target)` — finds item by path, removes the link from `_deadLinks.internal` or `_deadLinks.external`, removes corresponding warning reason if that category is now empty, calls `_commitNavSnapshot()`.
- **Resolve Page**: Deletes `_deadLinks` and dead-link warning reasons from the item, calls `_commitNavSnapshot()`.
- **Resolve All**: `_clearAllNavDeadLinks()` recursively removes `_deadLinks` and dead-link warning reasons from all items, calls `_commitNavSnapshot()`.

## Reason String Ownership

| Subsystem | Reason Strings | Registered Action |
|-----------|----------------|-------------------|
| Content Scanning (Dead Link Finder) | `"Internal dead links found"`, `"External dead links found"` | — |
| Nav Migration | `"Link integrity may need attention"` | — |
| Unreferenced Asset Finder | `"Unreferenced asset"` | — |
| Mermaid Mode | `"Mermaid diagrams require pymdownx.superfences configuration"` | `_navCautionActions[MERMAID_CONFIG_REASON]` (virtual mkdocs.yml mutation) |

## Helper Functions

| Function | Purpose |
|----------|---------|
| `_addCautionPage(srcPath, reason, actionData?)` | Add page-level caution; optional `actionData` is stored as `_actionData` on the warning entry |
| `_removeNavWarningReason(item, reason)` | Remove a specific reason from `item._warnings`; delete array if empty |
| `_clearAllNavWarnings(items)` | Recursively delete `_warnings` and `_deadLinks` from all items |
| `_clearAllNavDeadLinks(items)` | Recursively delete `_deadLinks` and dead-link warning reasons |
| `_collectNavWarnings(items)` | Walk tree, return `[{path, reasons, renames, actionData?}]` for localStorage format |
| `_collectNavDeadLinks(items)` | Walk tree, return `[{path, internal, external}]` for localStorage format |
| `_applyStoredWarningsToNavData()` | Read localStorage, apply to navData items (on load); restores `_actionData` from persisted `actionData` map |
| `_persistWarningsFromSnapshot()` | Write navData warnings to localStorage (on save) |

## Rules

1. **Scoped resolution.** When resolving cautions, only remove reason strings owned by the calling feature. Never clear the entire caution entry or wipe all cautions indiscriminately.

2. **Preserve the entry if other reasons remain.** After removing your reasons, check if `reasons.length` is still > 0. Only delete the caution entry when the array is empty.

3. **Never call `_setCautionPages([])` from feature-specific resolve.** Clearing all cautions is only acceptable for an explicit "Resolve All Cautions" action in the caution popup itself.

4. **Caution icon lifecycle is renderer-driven.** The caution icon (`.live-wysiwyg-nav-caution`) and item class (`.live-wysiwyg-nav-caution-item`) are created by `_buildNavItems` when `item._warnings` has entries, and omitted when it does not. Icon removal is an emergent effect of deleting `item._warnings` and committing a snapshot — the renderer omits the icon because there are no warnings. No code directly adds or removes these CSS classes on nav DOM.

5. **Each feature owns its reason strings.** Document which reason strings a feature uses so other features do not accidentally match them.

6. **Batch suppression.** During batch operations that add many warnings, set `_suppressWarningSnapshot = true` before the loop, then call `_commitNavSnapshot()` once after all additions.

7. **Direct mode for batch save errors.** When `_warningDirectMode` is true, write directly to localStorage so errors survive the page reload that follows batch save.

8. **Action handlers are synchronous snapshot mutations.** Handlers registered in `_navCautionActions` must be synchronous, must only mutate snapshot state (navData, virtual mkdocs.yml), and must call `_commitNavSnapshot()`. They must never perform disk I/O or manipulate nav sidebar DOM. See the handler contract and Cardinal Rules above.

## Cross-References

| Document | Relationship |
|----------|--------------|
| `nav-rendering-authority.mdc` | DOM authority rule governing caution icon rendering |
| [DESIGN-snapshot-nav-architecture.md](../ui/DESIGN-snapshot-nav-architecture.md) | Snapshot system, deep cloning of `_warnings` (with `_actionData`), warning flow |
| [DESIGN-mkdocs-yml-mermaid-config.md](../mermaid/DESIGN-mkdocs-yml-mermaid-config.md) | Mermaid auto-fix architecture (actionable caution consumer) |
| [DESIGN-mermaid-mode.md](../mermaid/DESIGN-mermaid-mode.md) | Triggers caution on exit when mermaid is not configured |
