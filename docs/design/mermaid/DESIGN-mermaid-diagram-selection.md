# Mermaid Diagram Selection Heuristics

When a user clicks on text in the rendered mermaid SVG diagram (inside the mermaid-live-editor iframe), the corresponding text is selected and highlighted in the Monaco code editor and scrolled into view. This subsystem is implemented entirely within the bridge script (vendor patch P1). Context-aware disambiguation ensures that clicking duplicate text (e.g., "Storage" appearing twice) selects the correct occurrence in the source code.

## SVG DOM Structure

The mermaid rendering library produces an SVG inside `div#container`:

```
div#container
  svg#graph-N.flowchart
    g.svg-pan-zoom_viewport [transform: matrix(...)]
      g
        g.root
          g.nodes
            g.node#flowchart-NodeId-N [transform: translate(x, y)]
              rect.basic.label-container
              g.label
                foreignObject
                  div
                    span.nodeLabel
                      p   <-- clickable text: "navData"
          g.edgeLabels
            g.edgeLabel [transform: translate(x, y)]
              g.label
                foreignObject
                  div
                    span.edgeLabel
                      p   <-- clickable text: "commits as"
```

### Key Selectors

There are two categories of clickable text in mermaid SVGs: HTML elements inside `<foreignObject>` (which use `innerHTML` for extraction) and native SVG `<text>`/`<tspan>` elements (which use `textContent`).

#### HTML-in-SVG Selectors (foreignObject `<p>` elements)

| Element | Selector | Diagram Types |
|---|---|---|
| Node labels | `g.node .nodeLabel p` | Flowchart, Block, State, Mindmap, Kanban, Requirement |
| Edge labels | `g.edgeLabel .edgeLabel p` | Flowchart, Block |
| Cluster/subgraph labels | `g.cluster-label .nodeLabel p` | Flowchart (subgraphs), Kanban (columns) |
| Class name labels | `.label-group .nodeLabel p` | Class |
| Class member labels | `.members-group .nodeLabel p` | Class |
| Class method labels | `.methods-group .nodeLabel p` | Class |
| ER entity/attribute labels | `.label.name .nodeLabel p`, `.label.attribute-type .nodeLabel p`, `.label.attribute-name .nodeLabel p` | Entity Relationship |
| Journey section labels | `div.journey-section > div.label` | User Journey |
| Journey task labels | `div.task > div.label` | User Journey |
| ZenUML participant names | `.zenuml label.name` | ZenUML |
| ZenUML conditions | `.zenuml label.condition` | ZenUML |
| ZenUML interface annotations | `.zenuml label.interface` | ZenUML |
| ZenUML diagram title | `.zenuml div.title.text-skin-title` | ZenUML |
| ZenUML lifeline group names | `.zenuml span.text-skin-lifeline-group-name` | ZenUML |
| ZenUML message labels | `.zenuml .message > .name` | ZenUML |
| ZenUML fragment labels | `.zenuml .fragment .header .collapsible-header > label` | ZenUML |

#### Native SVG Text Selectors (`<text>` and `<tspan>` elements)

| Element | Selector | Diagram Types |
|---|---|---|
| Message labels | `text.messageText` | Sequence |
| Actor names | `text.actor tspan` | Sequence |
| Service/group labels | `tspan.text-inner-tspan` | Architecture |
| Packet field labels | `text.packetLabel` | Packet |
| Packet title | `text.packetTitle` | Packet |
| Pie legend | `.legend text` | Pie |
| Pie title | `text.pieTitleText` | Pie |
| Quadrant labels | `.quadrant text` | Quadrant |
| Data point labels | `.data-point text` | Quadrant |
| Axis labels | `.labels .label text` | Quadrant |
| Chart title | `.title text` | Quadrant |
| Radar axis labels | `text.radarAxisLabel` | Radar |
| Radar title | `text.radarTitle` | Radar |
| Radar legend | `text.radarLegendText` | Radar |
| Branch labels | `.branchLabel text tspan` | Git |
| Commit labels | `text.commit-label` | Git |
| Task text | `text.taskText` | Gantt |
| Section titles | `text.sectionTitle tspan` | Gantt |
| Chart title | `text.titleText` | Gantt |
| C4 person/system labels | `g.person-man text tspan` | C4 |
| C4 relation/boundary labels | `tspan[alignment-baseline='mathematical']` | C4 |
| Sankey node labels | `g.node-labels text` | Sankey |
| Timeline node labels | `g.timeline-node tspan` | Timeline |
| Treemap section labels | `text.treemapSectionLabel` | Treemap |
| Treemap item labels | `text.treemapLabel` | Treemap |
| Journey actor legend | `text.legend tspan` | User Journey |
| XY/chart title | `g.chart-title text` | XY |

## Pan/Zoom Tracking

The SVG uses the `svg-pan-zoom` library which applies a CSS `transform: matrix(...)` on `g.svg-pan-zoom_viewport`. Since the text elements are **children** of this viewport group, they naturally follow the pan/zoom transform. No separate overlay repositioning is needed. Click events on the `<foreignObject>` / `<p>` elements inside the SVG fire correctly regardless of the current zoom/pan state because they are part of the SVG DOM tree.

No external overlay divs are created. Click handlers are attached directly to the SVG text elements.

## Initial SVG Load Monitor

The mermaid-live-editor iframe does not always reliably render the diagram on first load. The bridge includes a session-establishment monitor that verifies the diagram loads successfully.

### Monitor Algorithm

1. `_monitorSvgLoad()` starts on bridge initialization
2. Polls every 500ms for `document.querySelector("#container svg")`
3. The SVG is considered "loaded" when the `<svg>` exists and contains at least one `<g class="node">`, `<text>`, `<g class="root">`, or `<foreignObject>` element (confirming the diagram rendered, not just an empty SVG shell). The broader check covers diagram types without `g.node` (Sequence, Packet, Pie, Quadrant, Radar) and `foreignObject` covers ZenUML which renders HTML inside the SVG.
4. **Success**: Stop polling, call `_onSvgLoaded()` to attach click handlers. Reset the reload counter in `sessionStorage`.
5. **Timeout**: Call `window.location.reload()` to refresh the iframe. The bridge re-initializes on reload and retries with a progressively longer timeout.
6. The monitor runs once per session — after initial confirmation, no further SVG monitoring occurs

### Tiered Reload Strategy

The reload timeout uses a tiered backoff tracked via `sessionStorage` (`live-wysiwyg-reload-count`):

| Attempt | Timeout | Polls |
|---|---|---|
| 1–3 | 1.5s | 3 |
| 4 | 2.0s | 4 |
| 5 | 2.5s | 5 |
| 6 | 3.0s | 6 |
| N (N > 3) | 0.5 × (N + 1) s | N + 1 |

On successful load, the counter resets to zero. This keeps initial loads snappy (1.5s) while giving complex diagrams that fail the first few attempts progressively more time to render.

### Sequence

```
Bridge init
  |
  v
_monitorSvgLoad() reads reload count from sessionStorage, computes maxPolls
  |
  polls every 500ms
  |
  +-- SVG with g.node/text/root/foreignObject found? --> clear sessionStorage --> _onSvgLoaded() --> done
  |
  +-- maxPolls elapsed? --> increment sessionStorage counter --> location.reload() --> retry with longer timeout
```

## Text Search Heuristics

When the user clicks a text element in the SVG, `_findTextInCode(code, searchText, contextHint)` locates the corresponding text in the mermaid source code. The `contextHint` is the nearest ancestor `<g>` element's `id`, extracted by `_getContextHint(el)`.

### Step 1: Normalize Clicked Text

1. Replace `<br>` / `<br/>` / `<br />` with spaces
2. Strip remaining HTML tags
3. Decode HTML entities (`&lt;` → `<`, `&gt;` → `>`, `&amp;` → `&`, etc.) using a `<textarea>` element
4. Normalize Unicode guillemets: `«` (`\u00AB`) → `<<`, `»` (`\u00BB`) → `>>`
5. Collapse all whitespace to single spaces
6. Trim leading/trailing whitespace

Entity decoding (step 3) is essential because `innerHTML` returns entity-encoded text. For example, Requirement diagrams render `<<Requirement>>` which `innerHTML` gives as `&lt;&lt;Requirement&gt;&gt;`. Without decoding, this would never match the source keyword `requirement`.

Guillemet normalization (step 4) handles ZenUML, which renders `<<interface>>` annotations using Unicode guillemet characters (`«interface»`) rather than ASCII `<<`/`>>`. Normalizing to ASCII ensures consistent matching against source text.

Example: `"Nav Snapshots.<br>Saving snapshot differences"` → `"Nav Snapshots. Saving snapshot differences"`
Example: `"&lt;&lt;Requirement&gt;&gt;"` → `"<<Requirement>>"`
Example: `"«BFF»"` → `"<<BFF>>"`

### Step 2: Search Mermaid Code

Mermaid diagram code uses specific syntax patterns for labeling nodes and edges:

| Pattern | Example | Label Extracted |
|---|---|---|
| Node with brackets | `NavSnaps["Nav Snapshots.<br>Saving snapshot differences"]` | `Nav Snapshots. Saving snapshot differences` |
| Node with parens | `A(Round node)` | `Round node` |
| Node with braces | `B{Diamond}` | `Diamond` |
| Node bare ID | `navData` | `navData` |
| Edge label with pipes | `-->\|"commits as"\|` | `commits as` |
| Edge label with pipes (unquoted) | `-->\|commits as\|` | `commits as` |
| Standalone quoted string | `state "Press<br>BACKSPACE" as Moving` | `Press BACKSPACE` |

The search scans each line of the code using a four-tier strategy. All tiers collect **all** matches and apply context-aware disambiguation when multiple matches exist (see § Context-Aware Disambiguation below).

#### Tier 1: Bracket/Delimiter Extraction

1. Extract text content from within `["..."]`, `("...")`, `{"..."}`, `|"..."|` / `|...|`, and standalone `"..."` delimiters
2. Strip `<br>` / `<br/>` tags from the extracted content and normalize whitespace
3. Compare the normalized extracted text against the normalized clicked text
4. On match, return `{ lineNumber, startColumn, endColumn }` pointing to the full delimiter expression (1-based, for Monaco)

This tier handles Flowchart, Block, and other bracket-based diagram syntaxes, as well as State diagram `state "Label" as Alias` declarations where the label is in standalone double quotes.

#### Tier 2: Whole-Line Match

If no bracket pattern matches, compare the full trimmed line against the normalized clicked text. Collects **all** matching lines. This handles Mindmap nodes where each label is on its own indented line, and ER attribute lines like `float price` that appear identically in multiple entity blocks.

#### Tier 3: Substring Match (Case-Sensitive)

If tiers 1 and 2 fail, search for the normalized text as a case-sensitive substring within each line. Collects **all** matching lines (not just the first). This tier handles:

- **Class diagrams**: `Animal`, `+int age`, `+isMammal()` in lines like `Animal : +int age` or `class Duck{`
- **ER diagrams**: `CUSTOMER`, `string`, `id`, `places` in lines like `CUSTOMER ||--o{ ORDER : places`
- **State diagrams**: `Still`, `Moving` in lines like `[*] --> Still`
- **Sequence diagrams**: actor names and message text
- **Kanban**: column names, item text, assigned values
- **Requirement diagrams**: `test_req`, `test_entity`, `<<satisfies>>` labels

#### Tier 4: Substring Match (Case-Insensitive)

If tier 3 finds no matches, retry with case-insensitive comparison (`toLowerCase()` on both sides). This handles diagram types where the rendered text uses different casing than the source — e.g., Requirement diagrams render `Risk: High` and `Verification: Test` but the source uses `risk: high` and `verifymethod: test`.

### Context-Aware Disambiguation

When multiple lines match the same text (any tier), a **context hint** is used to select the best match. The context hint is the `id` attribute of the nearest ancestor `<g>` element in the SVG DOM tree. For example:

| Diagram Type | SVG Node ID Example | Extracted Tokens |
|---|---|---|
| Flowchart | `flowchart-ContentMod-0` | `ContentMod` |
| Class | `classId-Duck-5` | `Duck` |
| ER | `entity-CUSTOMER-0`, `entity-ORDER_ITEM-2` | `CUSTOMER`, `ORDER_ITEM` |
| State | `state-Still-3` | `Still` |
| Architecture | `server`, `disk1` | `server`, `disk1` |
| Requirement | `test_entity`, `test_req` | `test`, `entity` / `test`, `req` |
| Kanban | `id8` | *(numeric — no useful tokens)* |

#### Token Extraction

The context hint ID is split by `-` separators only (underscores are preserved to keep compound names like `ORDER_ITEM` intact). Purely numeric segments and common prefixes (`classId`, `entity`, `state`, `flowchart`) are filtered out. The full original ID is also kept as a token.

#### Proximity Scoring

For each candidate match, the algorithm searches within a ±10-line window for any line containing a hint token. The match with the smallest distance to a context token wins. When two matches have equal distance, the **"after context" tiebreaker** applies: the match that appears AFTER (below) the context token line is preferred over one that appears before it. This ensures matches inside a block (e.g., `float price` after `ORDER_ITEM {`) are preferred over matches that merely happen to be near a mention of the token. If no token appears within the window, the first match is returned as fallback.

This solves several previously-broken cases:
- **Sample 4 (ER)**: Clicking `string` under `CUSTOMER` selects the `string` in `CUSTOMER`'s attribute block, not `ORDER`'s
- **Sample 7 (Architecture)**: Clicking `Storage` on `disk1` selects `disk1(disk)[Storage]`, not `disk2(disk)[Storage]`
- **Sample 12 (Kanban)**: Clicking `knsv` under a specific task prefers the match nearest that task's section
- **Sample 17 (Requirement)**: Clicking `Type: simulation` under `test_entity` selects the line within the `element test_entity {}` block

## ER Attribute Pair Handler

Entity Relationship diagrams render each attribute as a pair of sibling `<g>` elements: `g.label.attribute-type` (e.g., `string`) and `g.label.attribute-name` (e.g., `name`). Clicking either element in isolation would search for just `"string"` or `"name"`, which produces ambiguous matches across multiple entities.

The bridge includes a dedicated ER handler that runs **before** the general click handler. It:

1. Queries all `g.label.attribute-type` groups in the SVG
2. For each, finds the next sibling `g.label.attribute-name`
3. Combines both texts: `"string" + " " + "name"` → `"string name"`
4. Binds a click handler to both `<p>` elements that searches for the combined text
5. Marks both elements as `data-live-wysiwyg-click-bound` so the general handler skips them

This ensures the search text `"string name"` uniquely matches the correct source line within the correct entity block. Combined with context-aware disambiguation (using the parent entity's `g[id]`), even identical attribute pairs across entities (e.g., `float price` in both PRODUCT and ORDER_ITEM) are correctly resolved.

## Monaco Integration

The selection is applied via the Monaco editor API. See [DESIGN-monaco-subsystem.md](DESIGN-monaco-subsystem.md) for the full API reference.

### Editor Discovery

`_getMonacoEditor()` discovers the editor instance via `window.monaco.editor.getEditors()`. The `window.monaco` global is made available by an AMD shim that the bridge defines before Monaco loads — see [DESIGN-monaco-subsystem.md](DESIGN-monaco-subsystem.md) § AMD Global Shim for the full mechanism and upgrade archaeology procedure.

The result is cached in `_cachedEditor` for subsequent clicks. The cache is invalidated if `getModel()` throws or returns falsy.

### Selection Application

```javascript
var sel = { startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col + len };
editor.setSelection(sel);
editor.revealRangeInCenter(sel);
editor.focus();
```

- `setSelection` highlights the matched text in the editor
- `revealRangeInCenter` scrolls the editor so the selection appears at approximately 50% vertical
- `focus` ensures the editor receives keyboard input after the click

## ZenUML Dedicated Binding

ZenUML diagrams render HTML inside `<foreignObject>` within the SVG, rather than using standard mermaid `g.node` structures. This requires a dedicated binding path separate from both the general HTML-in-SVG and native SVG text handlers.

### Why a Separate Path

ZenUML elements live inside a `.zenuml` container within the `<foreignObject>`. While the general HTML-in-SVG handler queries inside `#container svg`, ZenUML elements are accessible via `document.querySelectorAll` but may not be reachable through the SVG container query due to `foreignObject` DOM boundary behavior. The dedicated path queries ZenUML elements directly from `document`.

### Selectors

The ZenUML binding queries a combined selector:

```
.zenuml label.name
.zenuml label.condition
.zenuml label.interface
.zenuml div.title.text-skin-title
.zenuml span.text-skin-lifeline-group-name
.zenuml .message > .name
.zenuml .fragment .header .collapsible-header > label
```

These cover participant names, interface annotations (e.g., `<<BFF>>`), message labels, lifeline group names, conditions, and fragment labels (Alt, Par).

### pointer-events

ZenUML's CSS sets `pointer-events: none` on several parent containers (`.life-line-layer`, `.message-container`), which blocks click events from reaching child elements. The bridge injects CSS rules with `!important` to override this:

```css
.zenuml .life-line-layer .participant { pointer-events: auto !important; }
.zenuml .life-line-layer .lifeline-group-container > div:first-child { pointer-events: auto !important; }
.zenuml .message-container .message { pointer-events: auto !important; }
```

Additionally, each bound ZenUML element has `style.pointerEvents = "auto"` set directly.

### Known Limitations

Some ZenUML elements (participant names like `Client`, `OrderController`, service names) may remain non-clickable depending on the ZenUML version's CSS layering. The current implementation covers message labels, fragment labels, conditions, and interface annotations reliably.

## SVG Link Interception (Kanban Ticket Links)

Some diagram types (notably Kanban) render `<a>` elements with `xlink:href` inside the SVG (e.g., ticket links to GitHub). Since the iframe sandbox prevents `target="_blank"`, these links are intercepted by the same generic link intercept handler (Service 5) that handles menu links.

For SVG `<a>` elements, `link.href` returns an `SVGAnimatedString` object rather than a plain string. The bridge resolves URLs via `_resolveHref()` which checks `link.href.baseVal`, `getAttribute("href")`, and `getAttributeNS("http://www.w3.org/1999/xlink", "href")` as fallbacks.

Resolved URLs are validated against the domain allow-list and forwarded to the parent via `postMessage` for opening in a new tab.

## Lifecycle

1. **Bridge init**: `_monitorSvgLoad()` begins polling
2. **SVG confirmed**: `_onSvgLoaded()` calls `_attachClickHandlers()` which binds handlers in order: (a) ER attribute pair handler, (b) general HTML-in-SVG `<p>` elements, (c) native SVG `<text>`/`<tspan>` elements, (d) ZenUML-specific elements via `document.querySelectorAll`. Each phase marks bound elements to prevent double-binding.
3. **User clicks SVG text**: Handler extracts text (via `innerHTML` for HTML elements, `textContent` for SVG/ZenUML elements) and a context hint (nearest ancestor `g[id]`), searches code with disambiguation, discovers Monaco editor, applies selection
4. **Session ends**: Bridge is torn down with the iframe on mermaid mode exit. No cleanup needed — the iframe is removed from the DOM entirely.

Click handlers are attached once after the initial SVG load. They persist for the duration of the mermaid editing session. If the diagram re-renders (e.g., user edits the code), the SVG DOM is replaced and the click handlers are lost. The bridge observes `#container` for child mutations and re-attaches handlers when the SVG is replaced.

## Browser Compatibility

The bridge script targets **Blink** (Chrome/Edge), **Gecko** (Firefox), and **WebKit** (Safari). See [DESIGN-browser-compatibility.md](../ui/DESIGN-browser-compatibility.md) for the full compatibility framework.

### Language Level

The entire bridge script is written in **ES5** syntax — `var` declarations, `function` expressions, no arrow functions, no template literals, no destructuring. This avoids any transpilation concerns and ensures compatibility with all three engines.

### API Surface Audit

| API | Blink | Gecko | WebKit | Notes |
|---|---|---|---|---|
| `Object.getOwnPropertyNames` | 5+ | 4+ | 5+ | Core to editor discovery |
| `Object.getOwnPropertySymbols` | 38+ | 36+ | 9+ | Wrapped in try/catch; graceful no-op if unavailable |
| `MutationObserver` | 26+ | 14+ | 7+ | SVG re-render detection |
| `fetch` | 42+ | 39+ | 10.1+ | Session PUT (mermaid-live-editor itself requires this) |
| `localStorage` | 4+ | 3.5+ | 4+ | `getItem` wrapped in try/catch per compat doc |
| `el.innerHTML` on `<p>` in foreignObject | Yes | Yes | Yes | HTML element inside SVG; standard HTML API applies |
| `el.dataset` on `<p>` in foreignObject | Yes | Yes | Yes | HTML element inside SVG |
| `el.style.cursor` on `<p>` in foreignObject | Yes | Yes | Yes | HTML element inside SVG |
| `querySelectorAll` with compound selectors | Yes | Yes | Yes | `g.node .nodeLabel p` etc. |
| `String()` on `Symbol` values | 38+ | 36+ | 9+ | Used in debug logging only |

### Considerations

- **No `Array.from`**: The bridge uses `for` loops to iterate NodeLists and arguments, avoiding Gecko/WebKit `Array.from` inconsistencies on non-iterable objects.
- **No `for...of`**: Avoids requiring Symbol.iterator support on older engines.
- **No `let`/`const`**: `var` hoisting is consistent across all engines; avoids temporal dead zone edge cases.
- **`Object.getOwnPropertySymbols` fallback**: If unavailable (extremely old engine), the try/catch ensures `_probeElement` still functions using `getOwnPropertyNames` alone.
- **SVG foreignObject event propagation**: Click events on `<p>` elements inside `<foreignObject>` propagate correctly through the SVG DOM in all three engines. `stopPropagation()` prevents the click from bubbling to the SVG pan/zoom handler.
- **Monaco widget storage**: The minified Monaco bundle stores its editor reference identically across browsers (same JS bundle). The property name is determined by the minifier, not the browser engine.

## Cross-References

- **Monaco Subsystem**: [DESIGN-monaco-subsystem.md](DESIGN-monaco-subsystem.md) — editor API, runtime discovery, content access paths
- **Vendor Subsystem**: [DESIGN-vendor-subsystem.md](DESIGN-vendor-subsystem.md) — bridge script (P1), upgrade verification for SVG selectors
- **Mermaid Mode**: [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) — Layer 3 UI mode, iframe lifecycle, overlay DOM
- **Keyboard Isolation**: [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode — bridge keyboard interception
- **Readonly Selection Heuristics**: [DESIGN-readonly-selection-heuristics.md](../ui/DESIGN-readonly-selection-heuristics.md) — analogous text selection heuristics for the WYSIWYG editor (different subsystem, similar pattern)
- **Browser Compatibility**: [DESIGN-browser-compatibility.md](../ui/DESIGN-browser-compatibility.md) — engine detection, API audit framework, workaround catalog
