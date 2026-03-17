# Enter Bubble Navigation

## Problem

The WYSIWYG editor uses `contenteditable` for rich text editing. Block containers -- blockquotes, admonitions, and code blocks -- can nest arbitrarily. Users need a way to navigate **out** of these containers in both directions (forward from the end, backward from the start) using only the Enter key, and to cancel that behavior with Shift+Enter when they want a plain newline.

Without bubble navigation, the browser's default Enter behavior traps the cursor inside the container, forcing the user to click outside it with the mouse.

## Terminology

- **Container**: a block-level element that wraps other content -- `<blockquote>`, `.admonition`, `<pre>` / `.md-code-block`.
- **Body content**: the editable children of a container, excluding titles (`.admonition-title`) and UI elements (`.md-admonition-settings-btn`).
- **Title**: the non-body header of an admonition (`.admonition-title`) or the language/settings row of an advanced code block.
- **Forward bubble**: exiting a container at its **end** by pressing Enter repeatedly until the cursor escapes onto a new paragraph after the container.
- **Reverse bubble**: exiting a container at its **start** by pressing Enter when the cursor is at position 0 of the first body element, inserting a paragraph before the container.
- **Credit chain**: when exiting one nested container lands the cursor inside a parent container, the parent container's exit counter is pre-loaded ("credited") so only one more Enter is needed to exit the parent.
- **Content guard**: reverse bubble only fires when the container body has meaningful content. If the container is empty, Enter behaves normally (browser default) so the user can start typing.

## Forward Bubble (Exit at End)

Forward bubble is the existing behavior for escaping containers at the end:

| Container | Enter presses to exit | Handler (`dataset` flag) |
| --------- | -------------------- | ------------------------ |
| List (UL/OL) | 2 (empty LI → exit) | `liveWysiwygListEnterExitAttached` (~line 8489) |
| Admonition | 3 (or 1 with credit) | `liveWysiwygAdmonitionEnterExitAttached` (~line 8688) |
| Blockquote | 3 (or 1 with credit) | `liveWysiwygBlockquoteEnterExitAttached` (~line 8915) |
| Code block | 3 (or 1 with credit) | `liveWysiwygCodeBlockEnterExitAttached` (~line 9214) |

### Credit chain

When exiting a nested container, the parent container receives credit so only one more Enter exits the parent. This enables the following flow:

```
admonition > blockquote > list
  Enter 1: new list item
  Enter 2: exit list → lands in blockquote (blockquote gets credit)
  Enter 3: exit blockquote → lands in admonition (admonition gets credit)
  Enter 4: exit admonition → lands in document root
```

Credit is stored on the editable area element:
- `ea.__liveWysiwygBlockquoteEnterCredit = { count: 2, bq: <blockquote> }`
- `ea.__liveWysiwygAdmonitionEnterCredit = { count: 2, ad: <admonition> }`

### Cleanup on exit

When exiting an admonition or blockquote, trailing empty paragraphs are removed from the container. The cleanup loop must:
- Skip non-element nodes (`nodeType !== 1`)
- Skip `.admonition-title` and `.md-admonition-settings-btn` in admonitions
- Only remove empty trailing paragraphs (text content after stripping zero-width characters is empty)

## Reverse Bubble (Exit at Start)

Reverse bubble is the new behavior for escaping containers at their start.

### Handler

Registered as a capture-phase `keydown` listener via IIFE with `dataset` flag `liveWysiwygReverseBubbleAttached` (~line 8241). Registered **before** all forward-bubble handlers so it can `stopImmediatePropagation` when it fires.

### Content guard

Reverse bubble only fires when the container body has meaningful content (at least one element with non-whitespace text, or a structural child like `<img>`, `<pre>`, `.admonition`, `<table>`, `<blockquote>`, `<ul>`, `<ol>`). If the container is empty, Enter is left to the browser so the user can start adding content normally.

### Cases

**Case A -- First body element is a non-empty P or heading, cursor at its start:**
Insert `<p><br>` before the container. Focus cursor on the new paragraph.

**Case B -- First body element is a list (UL/OL), cursor at start of first LI:**
Insert `<p><br>` inside the container before the list. Focus cursor. (Next Enter triggers Case C, moving the paragraph above the container.)

**Case C -- First body element is an empty P (`<br>` or zero-width-space only), AND container has other content after it:**
Remove the empty paragraph from the container, insert it before the container. Focus cursor. This is the escalation mechanism that moves the paragraph up the hierarchy with each Enter.

**Case D -- Code block body, cursor at position 0 of code content (code has content):**
Insert `<p><br>` before the code block / `.md-code-block` wrapper. Focus cursor.

### Hierarchy

Each Enter moves the paragraph one level up the nesting hierarchy:

```
admonition > blockquote > list
  Enter 1 (Case B): insert P inside blockquote, before list
  Enter 2 (Case C): move P from blockquote to before blockquote (in admonition body)
  Enter 3 (Case C): move P from admonition to before admonition (document root)
```

This works because:
1. The handler always targets the **innermost** container (first match walking up from cursor).
2. After Case B/D, the inserted paragraph becomes the first body element (empty P).
3. On the next Enter, Case C detects the empty P and escalates it one level.
4. Escalation repeats until the paragraph reaches the editable area root.

### Detection

1. Bail if selection not collapsed, not WYSIWYG mode, or `e.shiftKey` held.
2. Walk up from cursor node to find the nearest container (BLOCKQUOTE, `.admonition`, PRE). The `!container` guard ensures only the innermost container is selected.
3. Content guard: verify the container body has meaningful content.
4. For code blocks (Case D): compute cursor offset in the code element's text content. If any non-whitespace text precedes the cursor, bail.
5. For blockquote/admonition: find the first body element (skip text nodes, `.admonition-title`, `.md-admonition-settings-btn`).
6. Verify the cursor's direct-child-of-container ancestor equals the first body element.
7. At-start detection via `previousSibling` walk (same pattern as the heading handler).
8. For lists (Case B): verify cursor is in the first `<LI>` at its start.
9. For empty P (Case C): verify there is other content after the empty P.

## Shift Bypass

When the user holds Shift, Enter behaves like a normal Enter (no interception). This applies **only to content bodies**, not titles.

| Handler | Type | shiftKey check |
| ------- | ---- | -------------- |
| Reverse bubble (~8241) | body | checks `e.shiftKey` (bails) |
| List exit (~8489) | body | `e.shiftKey` in early return |
| Admonition exit (~8688) | body (after `inTitle` branch) | `if (e.shiftKey) return;` |
| Blockquote exit (~8915) | body | `e.shiftKey` in early return |
| Code block exit (~9214) | body (after `!pre` check) | `if (e.shiftKey) return;` |
| Heading enter-at-start (~9093) | body | already had `e.shiftKey` |
| Hidden-title admonition (~9145) | body | already had `e.shiftKey` |
| Admonition title enter-at-start | **title** | NO shiftKey check (intentional) |
| Code block title enter | **title** | NO shiftKey check (intentional) |

Title handlers do not check `e.shiftKey` because Shift+Enter in a title area should still trigger the title-specific behavior (e.g., moving focus from title to body).

## Handler Registration Order

All handlers are registered on the editable area element in capture phase (`addEventListener('keydown', fn, true)`). Registration order determines firing order for capture-phase listeners on the same element:

1. **Reverse bubble** (`liveWysiwygReverseBubbleAttached`, ~8241) -- fires first, uses `stopImmediatePropagation`
2. **List exit** (`liveWysiwygListEnterExitAttached`, ~8489)
3. **Admonition exit** (`liveWysiwygAdmonitionEnterExitAttached`, ~8688)
4. **Blockquote exit** (`liveWysiwygBlockquoteEnterExitAttached`, ~8915)
5. **Heading enter-at-start** (`liveWysiwygHeadingEnterAttached`, ~9093)
6. **Hidden-title admonition** (`liveWysiwygHiddenTitleAdmonitionEnterAttached`, ~9145) -- subsumed by reverse bubble for Enter
7. **Code block exit** (`liveWysiwygCodeBlockEnterExitAttached`, ~9214)

The reverse bubble handler must be first because it needs to intercept Enter before any forward-bubble handler processes it. When it fires, `stopImmediatePropagation` prevents all subsequent handlers from running.

## Interaction Rules

1. **Title vs body**: reverse bubble skips title elements entirely (checks if cursor is inside `.admonition-title` or `<summary>` and bails). Forward bubble handlers have their own title/body separation.
2. **Subsumed handlers**: the hidden-title admonition handler's Enter behavior is fully covered by the reverse bubble handler (same logic: at-start of first body element → insert P before admonition). The hidden-title handler still handles Backspace independently.
3. **No double-fire**: `stopImmediatePropagation` ensures at most one Enter handler fires per keystroke.
4. **Content guard prevents interference**: empty containers pass through to browser default or to forward-bubble handlers. The reverse bubble handler only intercepts when there is existing content at the start.

## Integration Points

All changes are in `live-wysiwyg-integration.js`:

1. **Reverse bubble handler** -- new IIFE with `liveWysiwygReverseBubbleAttached` flag, capture-phase keydown listener.
2. **shiftKey additions** -- four forward-bubble handlers gained `e.shiftKey` bypass checks.
3. **No changes to serialization or markdown conversion** -- bubble navigation only manipulates the DOM and cursor position; content serialization is unchanged.
