# Mermaid Mode

Mermaid Mode is a Layer 3 UI mode that provides a full-screen diagram editor for mermaid code blocks. It embeds the vendored mermaid-live-editor in an iframe and communicates via `postMessage`.

## Mode Hierarchy Position

| Layer | Mode | Z-Index |
|-------|------|---------|
| 0 | Readonly | — |
| 1 | Unfocused | — |
| 2 | Focus | 99990 |
| **3** | **Mermaid** | **99995** |

Mermaid Mode can only be entered from Focus Mode. It visually overlays the focus mode UI with its own fixed-position overlay.

## Entry and Exit

### Entry

- **Trigger**: Click the expand button (`&#x26F6;`) on a `.md-mermaid-block` wrapper.
- **Preconditions**: `isFocusModeActive === true`, `wysiwygEditor` exists, the block contains a `<pre data-lang="mermaid">`.
- **Function**: `enterMermaidMode(mermaidBlock)`
- **Steps**:
  1. Extract mermaid code from the hidden `<pre>` element.
  2. Set `_mermaidModeActive = true`, store source block reference and original code (`_mermaidOriginalCode = mermaidCode`).
  3. Inject mermaid mode CSS (`_getMermaidModeCSS()`).
  4. Save and disable body/documentElement overflow (scroll suppression).
  5. Create overlay DOM: header (title + close button) and body (iframe).
  6. Apply theme colors to overlay.
  7. Register `message` event listener for close signals from iframe.
  8. POST initial code to `POST /mermaid-session` to create a session. Receive `sessionId`, store in `_mermaidSessionId`.
  9. Build iframe URL: `http://{hostname}:{port}/mermaid-editor/edit?session={sessionId}#{base64-encoded-state}`. The SvelteKit app reads the hash natively. The bridge reads the session ID from the `?session=` query param.

### Exit

- **Triggers**: Close button click, ESC key (from parent or iframe bridge), Ctrl+S (from parent or iframe bridge), `exitFocusMode()` (auto-exits mermaid first).
- **Functions**: `_requestMermaidClose(save)` → `_exitMermaidModeAsync(callback)`
- **Close flow**: User-initiated close triggers (X button, ESC, Ctrl+S) call `_requestMermaidClose(save)` which sends `live-wysiwyg-mermaid-request-close` to the iframe. The bridge PUTs final code to the API server session endpoint, then responds with a lightweight `live-wysiwyg-mermaid-close` signal (no content). A 500ms timeout ensures the editor closes even if the iframe is unresponsive. `exitFocusMode()` calls `exitMermaidMode()` directly (synchronous teardown requirement).
- **Steps** (in `_exitMermaidModeAsync`):
  1. Set `_mermaidModeActive = false`.
  2. GET the final code from the API server: `GET /mermaid-session/{id}`. The server returns `{ code }` — the authoritative diagram content, written there by the bridge's periodic sync and close handlers.
  3. Apply the mermaid edit at the markdown level and create a direct DAG node for undo/redo. This replaces the mermaid fenced code block in the markdown, re-renders the editor (including SVG preview via `enhanceMermaidBlocks`), and updates the save/discard button state. See [Undo-Redo DAG Integration](#undo-redo-dag-integration) below.
  4. Remove message listener, remove overlay from DOM.
  5. Restore body/documentElement overflow.
  6. Remove mermaid mode CSS.
  7. DELETE the session: `DELETE /mermaid-session/{id}`.
  8. If `liveWysiwygMermaidConfigured === false`, add caution to the current page via `_addCautionPage(pagePath, MERMAID_CONFIG_REASON)`.

## postMessage Protocol

All messages use `window.postMessage` with `'*'` origin. The iframe is **cross-origin** (parent page at MkDocs port 8000, iframe at API server port), so `contentDocument` access is blocked by the browser's same-origin policy. postMessage carries **signals only** (close, request-close). All diagram content flows through the API server's mermaid session endpoints. See [DESIGN-mermaid-session-server.md](../backend/DESIGN-mermaid-session-server.md) for the full session API.

### Initial State

On entry, the parent POSTs the initial code to `POST /mermaid-session` and receives a `sessionId`. The iframe URL includes both the session ID (query param `?session={id}`) and the `base64:` state (URL hash). The SvelteKit app reads the hash natively via `loadStateFromURL()`.

### Content Sync via Session API

The bridge reads editor content from `localStorage` (the mermaid-live-editor persists its Svelte store under the `codeStore` key, same-origin with the iframe). Every 1 second, if the code changed, the bridge PUTs it to `PUT /mermaid-session/{id}`. On close, the parent GETs the final code from `GET /mermaid-session/{id}`.

### Parent → Iframe

| Message Type | Payload | When |
|---|---|---|
| `live-wysiwyg-mermaid-request-close` | `{ type, save?: boolean }` | X button click, ESC from parent document, Ctrl+S from parent document. |

### Iframe → Parent

Messages are **signals only** — no content payload. Content is always read from the session API.

| Message Type | Payload | When |
|---|---|---|
| `live-wysiwyg-mermaid-close` | `{ type, save?: boolean }` | Response to `request-close`, ESC key, Ctrl+S |

### Exit Synchronization

`_requestMermaidClose(save)` is the standard close entry point. It posts `live-wysiwyg-mermaid-request-close` to the iframe. The bridge PUTs the final code to the session, then responds with `live-wysiwyg-mermaid-close` (signal only). A 500ms timeout ensures the editor closes even if the iframe is unresponsive.

On exit, `_exitMermaidModeAsync` GETs the code from `GET /mermaid-session/{id}`, applies the edit at the markdown level (creating a DAG node for undo), and DELETEs the session. The user can immediately Save from focus mode.

When `save: true` is set on the close message (Ctrl+S), the parent clicks `.live-edit-save-button` after exiting mermaid mode, triggering an immediate save.

## Overlay DOM Structure

```
div.live-wysiwyg-mermaid-overlay          (position:fixed; inset:0; z-index:99995)
  div.live-wysiwyg-mermaid-header         (flex row, themed header bar)
    span.live-wysiwyg-mermaid-header-title  "Mermaid Diagram Editor"
    button.live-wysiwyg-mermaid-close-btn   X close button
  div.live-wysiwyg-mermaid-body           (flex:1, contains iframe)
    iframe                                 (sandbox: allow-scripts allow-same-origin)
```

## Mermaid Block DOM Structure

```
div.md-mermaid-block                      (contenteditable=false wrapper)
  div.md-mermaid-preview                  (rendered SVG preview)
  button.md-mermaid-expand-btn            (opens mermaid mode, contenteditable=false)
  pre[data-lang="mermaid"]                (hidden, contains source code)
    code                                  (text content is the mermaid diagram)
```

## State Variables

| Variable | Type | Purpose |
|---|---|---|
| `_mermaidModeActive` | boolean | Mode active guard |
| `_mermaidOverlay` | Element | Overlay DOM reference |
| `_mermaidSourceBlock` | Element | The `.md-mermaid-block` being edited |
| `_mermaidIframe` | Element | Iframe reference for postMessage signals |
| `_mermaidSessionId` | string | Active session ID for API server communication. Set on enter (POST response), cleared on exit (after DELETE). |
| `_mermaidOriginalCode` | string | Mermaid code at entry time, used to locate the correct fenced code block in the markdown for replacement on exit |
| `_mermaidSavedBodyOverflow` | string | Saved body overflow for restore |
| `_mermaidSavedDocElOverflow` | string | Saved documentElement overflow for restore |

## Keyboard Isolation

Keyboard handling in Mermaid Mode operates across two documents (parent and iframe) connected by postMessage. See [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode Keyboard Isolation for the full architecture.

### Parent Document (Tier 2 Global Router)

When `_mermaidModeActive` is true, the parent's `_globalKeydownRouter` intercepts events that fire in the **parent document** (e.g., user clicks the overlay header then types):

- **ESC**: Calls `_requestMermaidClose()` — sends `request-close` to the iframe and waits for the bridge to respond with the authoritative state before exiting.
- **Ctrl+S**: Calls `_requestMermaidClose(true)` — same round-trip, then triggers save after exit.
- **Ctrl+.**: Suppressed (no mode toggle in mermaid mode).
- **Undo/redo**: Suppressed.

### Parent Document (Tier 3 Editor/Markdown Routers)

All editor and markdown keyboard handlers return early when `_mermaidModeActive` is true.

### Iframe Document (Bridge Keyboard Isolation Layer)

When the user is focused inside the mermaid editor iframe, keydown events fire in the **iframe's document** — they do not bubble to the parent. The bridge script (patch P1/P8) intercepts parent-controlled shortcuts at capture phase:

| Key | Bridge Behavior | Parent Receives |
|-----|----------------|----------------|
| ESC | Deferred overlay check (50ms). If no overlay visible, PUTs final code to session, sends close signal. If overlay visible, lets vendor close it (Dialog UX escalation). | `live-wysiwyg-mermaid-close` (signal only) |
| Ctrl+S | `stopImmediatePropagation` + PUTs final code to session, sends close signal with `save: true`. | `live-wysiwyg-mermaid-close` with `save` (signal only) |
| Ctrl+. | `stopImmediatePropagation`. Suppressed entirely. | Nothing |
| All other keys | Pass through to vendor editor normally. | Nothing (regular editing) |

### P8: preventDefault Override

The bridge monkey-patches `Event.prototype.preventDefault` to no-op for parent-controlled shortcut keys (ESC, Ctrl+S, Ctrl+.). This prevents the vendor editor from suppressing browser defaults for these keys, ensuring the bridge's capture-phase handler has full control. Regular editing keys are unaffected.

## Scroll Suppression

`document.body` and `document.documentElement` have `overflow: hidden` while mermaid mode is active. Values are saved before entry and restored on exit. This follows the same pattern as Focus Mode (Layer 2).

## In-Memory Editing Contract

All changes in Mermaid Mode are **in-memory only**:

1. The iframe sends `live-wysiwyg-mermaid-update` messages carrying the raw base64 state token as the user edits (1s periodic timer).
2. The parent decodes the token via `_decodeMermaidState()` and writes the decoded code to the hidden `<pre>` element's `textContent`.
3. On exit, the edit is applied at the markdown level: `_replaceMermaidCodeBlock` locates the original fenced code block and replaces its content with the new code. `_historyApplyContent` re-renders the entire editor from the new markdown (including `enhanceMermaidBlocks` for the SVG preview).
4. `_historyApplyContent()` updates `textarea.value` and the save/discard button state.
5. The standard content save pipeline (Ctrl+S → Save button) handles persistence.

No direct disk writes occur during mermaid mode.

## Undo-Redo DAG Integration

Mermaid edits are applied at the **markdown level** with a **direct DAG node creation**, bypassing the standard `_doubleRenderCheck` corruption guard. This is necessary because `_doubleRenderCheck` can fail on pages where the markdown-to-HTML round-trip is lossy, which would prevent any history node from being created. The mermaid edit is a known-good markdown change (replacing text inside a fenced code block), so the corruption guard is unnecessary.

**Entry** (`enterMermaidMode`): The original mermaid code is stored in `_mermaidOriginalCode` for later use as a search key to locate the correct fenced code block in the markdown.

**Exit** (`_applyCodeAndTeardown` inside `_exitMermaidModeAsync`):

1. `_flushHistoryCapture()` — captures any pending debounced typing as a separate DAG node before the mermaid edit.
2. `_replaceMermaidCodeBlock(_historyLastMd, _mermaidOriginalCode, finalCode)` — finds the `` ```mermaid `` fenced code block in the markdown whose trimmed content matches the original code, and replaces it with `finalCode`. Produces `newMd`.
3. Compute `_computeLineDiff` between `_historyLastMd` and `newMd`, group with `_groupMarkdownConstructs`, generate summary.
4. Create the DAG node directly: same structure as `_createHistoryNode` (node object, link to parent, update `_historyCurrentId` and `_historyLastMd`), but without calling `_doubleRenderCheck`.
5. `_historySetContent(newMd)` — applies the new markdown via `_historyApplyContent`, which does the full content-loading contract (preprocess stores, md→html, DOM enhancers including `enhanceMermaidBlocks` for the SVG preview, save/discard button state).

**Undo**: `_contentUndo` calls `_reconstructContentAtNode(parentId)` which walks diffs from root to reconstruct the parent markdown (with the old mermaid code). `_historyApplyContent` re-renders the editor, and `enhanceMermaidBlocks` restores the old SVG preview.

**Redo**: `_contentRedo` reconstructs the child markdown (with the new mermaid code) and applies it. The updated SVG preview reappears.

**No-change edits**: If `finalCode === _mermaidOriginalCode`, the code block replacement is skipped and no DAG node is created.

**Error path**: If `_applyCodeAndTeardown('')` is called on fetch failure, `finalCode` is falsy so the entire history/content block is skipped. The editor content remains unchanged.

**Multiple mermaid blocks**: `_replaceMermaidCodeBlock` matches on trimmed content, so only the block being edited is updated even when a page has multiple mermaid diagrams.

**Helper function**: `_replaceMermaidCodeBlock(markdown, originalCode, newCode)` uses a regex (`` /^```mermaid\s*\n([\s\S]*?)^```\s*$/gm ``) to find all mermaid fenced code blocks. It matches the one whose trimmed content equals `originalCode.trim()` and replaces the content portion with `newCode`.

## Content Editing Subsystem Integration

Mermaid blocks receive dedicated treatment throughout the content editing subsystem:

| Function | Behavior |
|---|---|
| `classifyBlock` | Returns `'mermaidblock'` for `.md-mermaid-block` |
| `findSelectedBlock` | Walks up to `.md-mermaid-block` wrapper from inner `<pre>` |
| `_isSelectableTarget` | Recognizes `.md-mermaid-block` |
| `isEmptyContainer` | Excludes containers with `.md-mermaid-block` children |
| `isEmptyParagraph` | Excludes paragraphs with `.md-mermaid-block` children |
| `isEmptyListItem` | Excludes list items with `.md-mermaid-block` children |
| `hasContentBeyond` | Recognizes `.md-mermaid-block` as meaningful content |
| `containerHasContent` | Recognizes `.md-mermaid-block` as meaningful content |
| `_nodeToMarkdownRecursive` | Extracts code from hidden `<pre>` inside `.md-mermaid-block` |
| Paste handler | `'mermaidblock'` case extracts `<pre>` and delegates to `pasteCodeblock` |

## Enhancement Pipeline

`enhanceMermaidBlocks(editableArea)` runs alongside other DOM enhancers at every content-loading path:

1. Finds `<pre data-lang="mermaid">` elements not yet wrapped in `.md-mermaid-block`.
2. Skips elements already inside `.md-mermaid-block` or `.md-code-block`.
3. Creates wrapper div, SVG preview container, expand button, and hides the `<pre>`.
4. Renders initial SVG preview via `_renderMermaidPreview()`.
5. Wires expand button to `enterMermaidMode(wrapper)`.

`enhanceCodeBlocks` is modified to skip `pre[data-lang="mermaid"]` elements.

## Mermaid.js Loading

`_loadMermaidJs()` provides mermaid.js for inline SVG preview rendering. It uses a two-tier strategy:

1. **Reuse Material's mermaid.js** — If `window.mermaid` already exists with a `render` method (loaded by MkDocs Material when `pymdownx.superfences` has mermaid custom fences configured), skip loading and use the existing instance. This avoids double-loading and global namespace conflicts.
2. **Fall back to vendored copy** — If `window.mermaid` is not available (user hasn't configured mermaid in `mkdocs.yml`), dynamically load `mermaid.min.js` from the API server (`/mermaid-editor/mermaid.min.js`) and call `mermaid.initialize({ startOnLoad: false })`.

The function is idempotent — subsequent calls return immediately once mermaid is available.

### Material Theme Compatibility

When MkDocs Material has mermaid configured, its JS initializes mermaid.js with `startOnLoad: true` and renders `<pre class="mermaid">` elements on the read-only page. The WYSIWYG editor avoids conflicts by:

- Using `data-lang="mermaid"` (not `class="mermaid"`) on `<pre>` elements, so Material's observer does not auto-render them.
- Using `md-mermaid-preview` as the preview container class, not `mermaid`.
- Reusing the existing `window.mermaid` instance rather than loading a second copy and re-initializing.
- Not calling `mermaid.initialize()` when reusing Material's instance — the existing configuration is preserved.

### SVG Theme Integration

Material for MkDocs renders mermaid diagrams inside a closed shadow DOM and injects extensive CSS that overrides mermaid's default theme colors with `--md-mermaid-*` CSS variables. The raw SVG from `mermaid.render()` only contains mermaid's default theme (hardcoded colors like `#ECECFF`, `#9370DB`), so without intervention, WYSIWYG previews look visually inferior to the read-only rendering.

`_buildMaterialMermaidCSS(svgId)` solves this by generating the same CSS overrides that Material injects into its shadow DOM, scoped to the rendered SVG's ID. The function:

1. Checks if `--md-mermaid-node-bg-color` is defined on `document.body` (Material defines mermaid variables on `[data-md-color-scheme]` which matches `<body>`, not `:root`).
2. If defined, returns a CSS string that maps mermaid's default selectors to Material's CSS variables. The overrides cover flowchart, class diagram, state diagram, ER diagram, and sequence diagram elements.
3. If not defined (non-Material theme or mermaid not configured), returns an empty string — the SVG renders with mermaid's default theme colors.

`_renderMermaidPreview` injects this CSS into the SVG's `<style>` block (before `</style>`) after `mermaid.render()` returns. Since the SVG is inline in the document (not shadow DOM), the `var(--md-mermaid-*)` references resolve from `:root` CSS variables defined by Material's theme CSS.

#### Intentional `var()` fallback omission

The `var()` references inside `_buildMaterialMermaidCSS` do not include fallback values (e.g., `var(--md-mermaid-node-bg-color)` instead of `var(--md-mermaid-node-bg-color, #ECECFF)`). This is a deliberate exception to Theme Rule 3 ("every `var()` must include a fallback"). The guard check at the top of the function — `if (!bodyStyle.getPropertyValue('--md-mermaid-node-bg-color').trim()) return '';` — ensures the CSS is never injected unless Material's mermaid variables are confirmed present. When the variables are absent, the function returns an empty string and the SVG renders with mermaid's built-in default theme, which serves as the effective fallback. Adding individual fallbacks to 50+ `var()` references would double the CSS string size with no practical benefit. See `docs/design/ui/DESIGN-theme-detection.md` for the full variable inventory.

## API Server Integration

The API server (`api_server.py`) serves the vendored mermaid-live-editor static files under `GET /mermaid-editor/*`. Special handling serves `mermaid.min.js` from the parent `vendor/` directory when requested as `/mermaid-editor/mermaid.min.js`.

## Cross-References

- **Unified Content Undo**: [DESIGN-unified-content-undo.md](../ui/DESIGN-unified-content-undo.md) — content undo DAG integration; mermaid edits are captured as DAG nodes so Cmd+Z can undo diagram changes
- **Mermaid Session Server**: [DESIGN-mermaid-session-server.md](../backend/DESIGN-mermaid-session-server.md) — session-based content brokering between parent and iframe via the API server (POST/GET/PUT/DELETE lifecycle, server-mediated content exchange)
- **Keyboard Isolation**: [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode Keyboard Isolation — two-document keyboard architecture (parent Tier 2 guards + iframe bridge capture-phase interception)
- **Vendor Subsystem**: [DESIGN-vendor-subsystem.md](DESIGN-vendor-subsystem.md) — bridge script (P1), preventDefault override (P8), upgrade procedures, patch inventory
- **Dialog UX**: [DESIGN-popup-dialog-ux.md](../ui/DESIGN-popup-dialog-ux.md) — ESC overlay-escalation pattern reused by the bridge's ESC handler
- **Modes of Operation**: `docs/design/ui/DESIGN-modes-of-operation.md` — Layer 3 in the mode hierarchy
- **MkDocs YAML Config**: [DESIGN-mkdocs-yml-mermaid-config.md](DESIGN-mkdocs-yml-mermaid-config.md) — superfences detection and auto-fix
- **Cautions**: [DESIGN-cautions.md](../backend/DESIGN-cautions.md) — page-level caution added on exit when mermaid is not configured; auto-fix registered in `_navCautionActions`
- **Layout**: `docs/design/ui/DESIGN-layout.md` — z-index registry (99995 for mermaid overlay)
- **Architecture Overview**: `docs/design/DESIGN-architecture-overview.md` — subsystem hierarchy
- **Markdown Awareness**: `docs/design/ui/DESIGN-markdown-awareness.md` — `enhanceMermaidBlocks` in the enhancement pipeline
- **Browser Compatibility**: `docs/design/ui/DESIGN-browser-compatibility.md` — iframe sandbox constraints
