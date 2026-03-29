# Monaco Subsystem

Monaco is the code editor embedded within the vendored mermaid-live-editor SvelteKit app. It provides the text editing surface where users write mermaid diagram code. This document captures the runtime API surface, content access paths, and discovery mechanism used by the bridge script.

## Bundle Location

Monaco is bundled (not loaded from CDN) inside the SvelteKit build output. The main chunk filename changes on every build (content-hashed). As of the current vendored build the chunk is:

```
vendor/mermaid-live-editor/_app/immutable/chunks/Dvs79aKq.js
```

By default there is **no** `window.monaco` global. Monaco is loaded as ES modules within the SvelteKit Vite bundle. However, the bundle contains a conditional that exposes the global when AMD is detected (see "AMD Global Shim" below). Public API method names (`setSelection`, `getModel`, `revealRangeInCenter`, `focus`, `getEditors`, etc.) are preserved in the minified bundle because they are part of Monaco's public interface.

## Editor Container DOM

```
div#editor [data-keybinding-context="1"][data-mode-id="mermaid"]
  div.monaco-editor[role="code"][data-uri="internal://mermaid.mmd"]
    div.overflow-guard [data-mprt="3"]
    div.overflowingContentWidgets [data-mprt="2"]
    div.overflowingOverlayWidgets [data-mprt="5"]
```

**Important**: `div#editor` (with `data-mode-id="mermaid"`) is the **outer wrapper**. The `div.monaco-editor` is a **child** of `div#editor`, not a parent. Earlier versions of this document incorrectly described the relationship.

## Runtime Discovery — AMD Global Shim

Monaco's bundled code contains a conditional that exposes the full API to `globalThis.monaco`:

```javascript
// Minified pattern (variable names change per build):
(typeof define === "function" && define.amd) && (globalThis.monaco = Yo);
```

Where `Yo` (or equivalent in a future build) is the Monaco namespace with `Yo.editor`, `Yo.languages`, etc.

The bridge script runs in `<head>` before any ES modules load. It defines a minimal AMD shim:

```javascript
if (typeof window.define !== "function") {
  window.define = function() {};
  window.define.amd = true;
}
```

This causes Monaco's conditional to evaluate to `true`, resulting in `globalThis.monaco` being populated with the full public API. The `getEditors()` method on `monaco.editor` returns all `IStandaloneCodeEditor` instances.

### Discovery Algorithm

```javascript
function _getMonacoEditor() {
  if (_cachedEditor) {
    try { if (_cachedEditor.getModel()) return _cachedEditor; }
    catch(ex) {}
    _cachedEditor = null;
  }
  if (window.monaco && window.monaco.editor &&
      typeof window.monaco.editor.getEditors === "function") {
    var editors = window.monaco.editor.getEditors();
    for (var i = 0; i < editors.length; i++) {
      if (editors[i] && typeof editors[i].getModel === "function") {
        _cachedEditor = editors[i];
        return _cachedEditor;
      }
    }
  }
  return null;
}
```

### Why the AMD Shim Is Safe

- The `define.amd` conditional in Monaco **only** gates the `globalThis.monaco` assignment. All other Monaco functionality (editor creation, language services, workers) operates through ES module imports unaffected by this flag.
- A separate conditional checks `typeof globalThis.require.config === "function"` to configure AMD paths. Since we do **not** define `require.config`, this path is not taken.
- SvelteKit/Vite apps do not use AMD loaders. No other code in the mermaid-live-editor checks for `define.amd`.

## Minified Symbol Archaeology (Upgrade Guide)

After a vendor upgrade, **all minified variable names change**. The following procedure locates the key internal symbols in the new Monaco chunk. This is only needed if the AMD shim approach stops working in a future Monaco version.

### Step 1 — Identify the Monaco Chunk

```bash
# The Monaco chunk is the only one containing setSelection, revealRangeInCenter, AND getModel
rg 'setSelection|revealRangeInCenter|getModel\(\)' \
  vendor/mermaid-live-editor/_app/immutable/chunks/ \
  --files-with-matches
```

Expect one file (e.g. `Dvs79aKq.js`). This is the main Monaco + app chunk.

### Step 2 — Find `listCodeEditors` (Internal Editor Service Method)

```bash
rg -o '.{0,80}listCodeEditors.{0,80}' <monaco-chunk>
```

In the current build this yields:

```
delete this._codeEditors[e.getId()]&&this._onCodeEditorRemove.fire(e)}
  listCodeEditors(){return Object.keys(this._codeEditors).map(e=>this._codeEditors[e])}
```

This is the `ICodeEditorService.listCodeEditors()` implementation.

### Step 3 — Find the Public API Wrapper

```bash
rg -o '.{0,30}listCodeEditors.{0,30}' <monaco-chunk> | grep 'function'
```

Look for a standalone function wrapping the service call:

```
function _Ve(){return it.get(Yt).listCodeEditors()}
```

Here `_Ve` is the minified name for the public `getEditors()` function. `it` is the DI service locator; `Yt` is the `ICodeEditorService` token.

### Step 4 — Find the Public API Object

```bash
rg -o '.{0,100}create:.*getEditors:.{0,200}' <monaco-chunk>
```

This reveals the factory function:

```
function jVe(){return{create:gVe,getEditors:_Ve,getDiffEditors:bVe,onDidCreateEditor:pVe,...}}
```

| Minified | Public API | Purpose |
|---|---|---|
| `gVe` | `monaco.editor.create()` | Create a standalone editor |
| `_Ve` | `monaco.editor.getEditors()` | List all editor instances |
| `bVe` | `monaco.editor.getDiffEditors()` | List all diff editor instances |

### Step 5 — Find the Namespace Assignment

```bash
rg -o '.{0,20}globalThis\.monaco.{0,100}' <monaco-chunk>
```

Reveals the conditional global:

```
(typeof define==="function"&&define.amd)&&(globalThis.monaco=Yo);
```

Where `Yo` is the Monaco namespace variable. Confirm it has the editor API:

```bash
rg -o '.{0,30}Yo\.editor.{0,50}' <monaco-chunk>
# Expected: Yo.editor=jVe()
```

### Step 6 — Verify the AMD Shim Still Works

After upgrading, test that defining `window.define` with `define.amd = true` before Monaco loads results in `window.monaco` being populated. If Monaco removes the AMD conditional in a future version, an alternative approach is needed (see "Fallback: Vendor Chunk Patch" below).

### Fallback: Vendor Chunk Patch

If the AMD shim stops working (e.g., Monaco removes the `define.amd` check), add a new patch to `patch-mermaid-vendor.py` that modifies the Monaco chunk directly:

1. Find the conditional: `(typeof define==="function"&&define.amd)&&(globalThis.monaco=<VAR>)`
2. Replace the condition with `true`: `(true)&&(globalThis.monaco=<VAR>)`

This is fragile across builds but is captured in the upgrade verification checklist. The namespace variable name must be updated in the patch after each build.

## Key API Methods

All methods below are available on the editor instance returned by `_getMonacoEditor()`. Line and column numbers are **1-based**.

### Editor Instance Methods

| Method | Signature | Purpose |
|---|---|---|
| `setSelection` | `(selection: ISelection) => void` | Set the text selection in the editor |
| `getSelection` | `() => ISelection` | Get the current text selection |
| `setPosition` | `(position: IPosition) => void` | Set the cursor position |
| `getPosition` | `() => IPosition` | Get the current cursor position |
| `revealRangeInCenter` | `(range: IRange) => void` | Scroll the editor so the range appears at ~50% vertical |
| `revealLineInCenter` | `(lineNumber: number) => void` | Scroll the editor so the line appears at ~50% vertical |
| `focus` | `() => void` | Focus the editor, making it receive keyboard input |
| `getModel` | `() => ITextModel` | Get the text model backing the editor |
| `getValue` | `(eol?: number, preserveBOM?: boolean) => string` | Get full editor text (delegates to model) |
| `setValue` | `(value: string) => void` | Replace all editor text |
| `hasTextFocus` | `() => boolean` | Whether the editor's textarea has focus |

### Text Model Methods

Available on the object returned by `editor.getModel()`:

| Method | Signature | Purpose |
|---|---|---|
| `getValue` | `(eol?, preserveBOM?) => string` | Get the full text content |
| `getLineContent` | `(lineNumber: number) => string` | Get text of a specific line |
| `getLineCount` | `() => number` | Total number of lines |
| `findMatches` | `(searchString, searchScope, isRegex, matchCase, wordSeparators, captureMatches) => FindMatch[]` | Find all matches of a pattern |

### Interfaces

**ISelection / IRange** (all fields 1-based):

```
{ startLineNumber, startColumn, endLineNumber, endColumn }
```

**IPosition**:

```
{ lineNumber, column }
```

**FindMatch**:

```
{ range: IRange, matches: string[] }
```

## Content Access Paths

The bridge reads mermaid diagram code through three paths, in order of preference:

| Path | Mechanism | Reliability |
|---|---|---|
| **Primary** | `localStorage.getItem("codeStore")` → `JSON.parse(raw).code` | Always has complete content. The mermaid-live-editor persists its Svelte store under the `codeStore` key. |
| **Alternative** | `editor.getModel().getValue()` | Requires editor instance discovery. Returns complete content. |
| **Fallback** | DOM `.view-lines .view-line` text extraction | Subject to Monaco's viewport virtualization — lines outside the visible viewport may not be in the DOM. Unreliable for full content. |

The bridge's periodic sync (1s) uses the primary path. The SVG text click handler uses the primary path for code search and the alternative path as a backup.

## Limitations

- **Viewport virtualization**: Monaco only renders lines that are currently visible in the scroll viewport. DOM-based text extraction (`.view-line` elements) will miss lines outside the viewport. Always prefer `localStorage` or `getModel().getValue()` for full content access.
- **AMD shim dependency**: The global `window.monaco` is only available because the bridge defines `window.define.amd = true` before Monaco loads. If a future Monaco build removes the AMD conditional, the "Fallback: Vendor Chunk Patch" approach must be used instead.
- **Minified symbol names change per build**: Every content-hashed rebuild produces different variable names (`_Ve`, `gVe`, `Yo`, etc.). Only the public API method names (`setSelection`, `getModel`, `getEditors`, `create`, etc.) are stable. The "Minified Symbol Archaeology" procedure must be re-run after each vendor upgrade to verify the AMD shim still works.
- **Single editor assumption**: `getEditors()[0]` assumes only one `IStandaloneCodeEditor` exists in the mermaid-live-editor. If the app ever creates multiple editors, the discovery must be updated to select the correct one (e.g., by matching the model URI `internal://mermaid.mmd`).

## Cross-References

- **Vendor Subsystem**: [DESIGN-vendor-subsystem.md](DESIGN-vendor-subsystem.md) — bridge script patches, upgrade procedures, offline audit
- **Mermaid Mode**: [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) — Layer 3 UI mode lifecycle, iframe embedding
- **Keyboard Isolation**: [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode — bridge capture-phase keyboard interception
- **Mermaid Diagram Selection**: [DESIGN-mermaid-diagram-selection.md](DESIGN-mermaid-diagram-selection.md) — SVG click-to-select using Monaco API
- **Mermaid Session Server**: [DESIGN-mermaid-session-server.md](../backend/DESIGN-mermaid-session-server.md) — session-based content brokering
