# Heading Migration Subsystem — Design Document

## Overview

The Heading Migration subsystem detects when a user renames a heading and automatically stages cross-document anchor link rewrites through the snapshot system. It also enhances the dead link scanner to validate `#fragment` anchors against headings in target documents.

The subsystem operates in both WYSIWYG and Markdown mode.

## Related Documents

- [DESIGN-content-scanning.md](../backend/DESIGN-content-scanning.md) — Dead link scanning, link rewriting infrastructure, exclusion zones
- [DESIGN-table-of-contents.md](DESIGN-table-of-contents.md) — TOC panel, click-to-scroll, heading detection
- [DESIGN-snapshot-nav-architecture.md](DESIGN-snapshot-nav-architecture.md) — Snapshot-driven architecture, `_commitNavSnapshot`, badges
- [DESIGN-focus-nav-menu.md](DESIGN-focus-nav-menu.md) — Nav edit mode, batch queue, save execution
- [DESIGN-declarative-save-planner.md](../backend/DESIGN-declarative-save-planner.md) — Batch executor and disk write pipeline
- [DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md) — Dialog interaction model (for any confirmation UI)

---

## Part 1: Heading Rename Migration

### Concept

When the user edits a heading's text, all other documents that link to that heading via `#anchor-slug` will break after the next MkDocs build. The Heading Migration subsystem detects the rename, immediately rewrites same-page anchor links, and stages a nav snapshot with a batch operation to rewrite cross-document links at save time.

### Trigger

The migration triggers when:

1. **Cursor leaves a heading** — the selection moves from inside an `H1`–`H6` element (WYSIWYG) or a `#`-prefixed heading line (Markdown) to outside that heading, AND the heading text changed since the cursor entered it.
2. **Page navigation** — the user clicks a nav item to load a different document while the cursor was in a heading whose text changed.

The trigger does NOT fire for:

- Heading level changes (e.g., `H2` → `H3`) without text changes — the anchor slug depends only on text.
- New headings that did not exist before the current edit session — no old slug to migrate from.
- Headings whose text changed but whose computed slug is identical (e.g., trailing punctuation changes that the slugify algorithm strips).

### Heading Tracking State

```
_headingTracker = {
  active: false,
  element: null,           // WYSIWYG: the H1–H6 DOM element; Markdown: null
  lineIndex: -1,           // Markdown: index of the heading line; WYSIWYG: -1
  originalText: '',        // plain text when cursor entered the heading
  originalSlug: '',        // slug computed from originalText
  srcPath: ''              // current document's src_path
}
```

The tracker is populated when the selection enters a heading and cleared when the migration fires or the heading text is unchanged on exit.

### Slug Algorithm (`_headingSlugify`)

Replicates the default python-markdown `toc` extension slugify (separator = `-`):

```
function _headingSlugify(text) {
  var value = text.replace(/[^\w\s-]/g, '').trim().toLowerCase();
  return value.replace(/[-\s]+/g, '-');
}
```

This matches the MkDocs default for ASCII headings. Unicode NFKD normalization is omitted because the browser's `contenteditable` and markdown textarea produce pre-normalized text. If the site uses a custom `slugify` (e.g., `slugify_unicode`), the generated slugs may not match — this is an accepted limitation documented as a known constraint.

### Detection Flow — WYSIWYG Mode

1. **`selectionchange` listener** — on each selection change, walk from `range.commonAncestorContainer` up to `editableArea` looking for an `H1`–`H6` ancestor (same walk as `_updateWysiwygToolbarActiveStates`).

2. **Entering a heading** — if the walk finds a heading and `_headingTracker.active` is false (or the element differs from the tracked one):
   - If there is an active tracker with a different element, fire the exit check first.
   - Record `element`, `originalText` (from `element.textContent` with `¶` stripped), `originalSlug`, `srcPath`.
   - Set `active = true`.

3. **Leaving a heading** — if the walk finds no heading (or a different heading) and `_headingTracker.active` is true:
   - Read current text from `_headingTracker.element.textContent` (strip `¶`).
   - Compute `newSlug = _headingSlugify(currentText)`.
   - If `newSlug !== _headingTracker.originalSlug` and `_headingTracker.originalSlug` is non-empty: fire `_stageHeadingMigration(srcPath, originalSlug, newSlug, originalText, currentText)`.
   - Clear tracker.

### Detection Flow — Markdown Mode

1. **`keyup` / `click` listener on `markdownArea`** — determine which line the caret is on. If the line matches `/^#{1,6}\s+(.+)$/`, extract the heading text.

2. **Entering a heading line** — record `lineIndex`, `originalText`, `originalSlug`, `srcPath`. Set `active = true`.

3. **Leaving a heading line** — re-read the line at `_headingTracker.lineIndex` from `markdownArea.value`. If the heading text changed and slug differs, fire `_stageHeadingMigration`. Clear tracker.

### Detection Flow — Navigation

`_navigateToPage` already calls `_doFocusSaveBackground` when the document is dirty. A new hook runs before navigation:

```
function _checkHeadingMigrationBeforeNavigate() {
  if (!_headingTracker.active) return;
  // read current heading text from element (WYSIWYG) or line (Markdown)
  // compare slug, fire _stageHeadingMigration if changed
  // clear tracker
}
```

Called from `_navigateToPage` before `_doNavigate`.

### Same-Page Rewrite

When the heading rename is detected, same-page anchor links (`#old-slug`) in the current document are rewritten immediately to `#new-slug`. This operates on the live content:

- **WYSIWYG mode**: Walk all `<a>` elements in `editableArea` whose `href` starts with `#`. If `href === '#' + oldSlug`, update to `'#' + newSlug`.
- **Markdown mode**: Regex replace `](#old-slug)` → `](#new-slug)` in `markdownArea.value`, respecting exclusion zones.

Same-page links are rewritten in-place without a snapshot because they are part of the same document being edited.

### Cross-Document Staging (`_stageHeadingMigration`)

```
function _stageHeadingMigration(srcPath, oldSlug, newSlug, oldText, newText) {
  _navBatchQueue.push({
    type: 'rewrite-heading-anchor',
    pageSrcPath: srcPath,
    oldSlug: oldSlug,
    newSlug: newSlug
  });

  _addNavBadge({
    className: 'live-wysiwyg-nav-normalize-badge',
    text: 'Migrate all content links for "' + newText + '"'
  });

  _commitNavSnapshot();
  if (!_navEditMode) _enterNavEditMode();
}
```

### Batch Execution — `rewrite-heading-anchor`

At save time, the batch executor processes `rewrite-heading-anchor` ops:

1. For each page `src_path` in `liveWysiwygAllMdSrcPaths` (excluding the renamed heading's own page, which was handled in-place):
   - Read content via `_wsGetContents`.
   - Find all markdown links whose target resolves to `pageSrcPath` and whose fragment is `#oldSlug`.
   - Rewrite the fragment from `#oldSlug` to `#newSlug`, preserving the path part and query string.
   - Respect exclusion zones (fenced code, inline code, HTML comments).
   - Write back via `_wsSetContents` if any changes were made.
2. Skip pages in `_batchDeletedPaths`.
3. Resolve `pageSrcPath` through `_batchRenamedPaths` if the target page was also renamed/moved in the same save.

### Link Format Coverage

MkDocs supports multiple ways to reference a page with a heading anchor. The rewriter must detect and rewrite all of these variants. Given a target page at `docs/guides/setup.md` with heading `## Old Title` (slug: `old-title`), a referencing page at `docs/intro.md` may link to it as:

| Format | Example | Resolution |
|--------|---------|------------|
| Relative `.md` path with fragment | `[link](guides/setup.md#old-title)` | Direct file reference |
| Relative extensionless path with fragment | `[link](guides/setup#old-title)` | MkDocs resolves `setup` → `setup.md` |
| Folder reference with fragment (index) | `[link](guides/#old-title)` | MkDocs resolves `guides/` → `guides/index.md` |
| Folder reference without trailing slash | `[link](guides#old-title)` | MkDocs resolves `guides` → `guides/index.md` |
| Parent traversal with fragment | `[link](../guides/setup.md#old-title)` | Relative `..` resolution |
| Reference-style link definition | `[ref]: guides/setup.md#old-title` | Same path resolution rules |
| Image with fragment (uncommon) | `![img](page.md#anchor)` | Matched by image regex |

**Resolution approach**: For each link in a page, split on `#` to extract `pathPart` and `fragment`. Resolve `pathPart` to an absolute docs-relative path using `_resolvePath(pageDir, pathPart)`. If the path is extensionless, also check `absTarget + '.md'` and `absTarget + '/index.md'` (same fallback logic as `_looksLikePageRef` and `_check_internal`). If the resolved path matches the heading's `pageSrcPath` (or its renamed equivalent via `_batchRenamedPaths`) and the `fragment` equals `oldSlug`, rewrite only the fragment portion to `newSlug` — the path part is left untouched.

### Coalescing Multiple Renames

If the same heading is renamed multiple times before saving (A→B then B→C), the batch queue may contain two ops for the same heading:

```
{ type: 'rewrite-heading-anchor', pageSrcPath: 'page.md', oldSlug: 'a', newSlug: 'b' }
{ type: 'rewrite-heading-anchor', pageSrcPath: 'page.md', oldSlug: 'b', newSlug: 'c' }
```

The batch executor coalesces consecutive anchor rewrite ops for the same `pageSrcPath` into a single pass: for each page, build a map of `oldSlug → newSlug` by chaining through intermediates (A→B + B→C = A→C), then apply all rewrites in one read-write cycle.

If different headings on the same page are renamed, they produce separate map entries and are applied in the same pass.

### Conflict Warning on Navigation

When a heading rename migration is pending (one or more `rewrite-heading-anchor` ops exist in `_navBatchQueue`), navigating to a page that contains links affected by the pending rewrite creates a conflict: the user may edit content with stale `#old-slug` anchors that the pending migration intends to rewrite.

**Detection**: After AJAX navigation completes (in `_doAjaxNavigate`, after content is loaded), check whether the newly loaded page's `srcPath` appears as an affected page for any pending `rewrite-heading-anchor` ops. An affected page is any page other than the heading's own page that contains links resolving to a `pageSrcPath` in the pending ops. The check reads the just-loaded markdown content and tests for links whose resolved target + fragment match a pending `{ pageSrcPath, oldSlug }` pair.

**Warning popup**: If the page is affected, show an informational dialog immediately:

```
Heading Rewrite Pending

This page contains links to a heading that was renamed. The heading
anchor rewrite has not been saved yet.

Editing this page may create conflicts with the pending migration.
Please go back and save the nav menu to complete the heading rewrite
first.

(Go Back)
```

**"Go Back" action**: Navigates the user back to the previous page via `history.back()` (or to the page where the heading was renamed, using the `pageSrcPath` from the pending op).

**Implementation**: `_checkPendingHeadingConflict(srcPath, markdown)` runs inside `_doAjaxNavigate`'s `.then()` callback, after content is loaded but before `_fadeOutOverlay`. It scans the markdown for links matching any pending anchor op's `{ pageSrcPath, oldSlug }`. If matches are found, the warning dialog is shown and the transition overlay remains visible behind it. The dialog uses `_attachDialogKeyboard` with category `'informational'` (ESC dismisses, no form fields).

**Not a hard block**: The dialog is advisory. If the user dismisses it (ESC or clicking outside), they remain on the page. The pending migration will still execute correctly at save time — but the user's edits on this page could introduce new stale anchors or modify content that the migration will also modify, creating merge-like conflicts.

---

## Part 2: Dead Link Anchor Validation

### Concept

The dead link scanner currently validates only that the target page exists. Links with `#fragment` anchors (e.g., `other-page.md#setup-guide`) pass validation even if the heading no longer exists in the target. This enhancement adds server-side heading extraction and slug matching.

### Client Changes

In `_scanDeadLinks`, when building the check payload, preserve the fragment:

**Current behavior** (strips fragment before sending):
```
var pathPart = splitIdx >= 0 ? target.substring(0, splitIdx) : target;
// ... only pathPart is sent ...
allChecks.push({ type: 'internal', from: path, target: pathPart });
```

**New behavior** (sends fragment alongside path):
```
var pathPart = splitIdx >= 0 ? target.substring(0, splitIdx) : target;
var fragment = anchorIdx >= 0 ? target.substring(anchorIdx + 1).split('?')[0] : '';
// ...
allChecks.push({ type: 'internal', from: path, target: pathPart, fragment: fragment || undefined });
```

The `fragment` field is optional. When absent, the server performs path-only validation as before.

### Server Changes — `_check_internal` in `api_server.py`

When `item.get("fragment")` is present and non-empty:

1. Resolve the target path to a `.md` file on disk. The existing path resolution logic already handles `.md`, extensionless (`target.md`), and folder (`target/index.md`) variants. For anchor validation, the resolver must identify the actual `.md` file path (not just confirm existence) so its content can be read:
   - If `resolved` is a `.md` file and exists: use it.
   - If `resolved` has no suffix: try `resolved / "index.md"`, then `resolved.with_suffix(".md")`.
   - If `resolved` is `.md` but doesn't exist, try without suffix (directory case).
2. If the file does not exist, return the existing `"File not found"` error.
3. Read the resolved `.md` file content.
4. Extract headings: match lines against `/^#{1,6}\s+(.+)$/m`.
5. For each heading, compute the slug using the same `slugify` algorithm as python-markdown's `toc` extension.
6. Handle duplicate slugs: if a slug appears more than once, MkDocs appends `_1`, `_2`, etc. Build the full slug inventory with suffixes.
7. If the fragment matches any slug in the inventory, return `{"ok": true}`.
8. Otherwise return `{"ok": false, "error": "Anchor not found: #<fragment>"}`.

**Server-side slugify** — implement as a standalone function in `api_server.py`:

```python
import re
import unicodedata

def _heading_slugify(text: str, separator: str = "-") -> str:
    value = unicodedata.normalize("NFKD", text)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(rf"[{re.escape(separator)}\s]+", separator, value)
```

**Heading extraction** — parse headings from markdown, stripping inline formatting:

```python
def _extract_heading_slugs(content: str) -> set[str]:
    slugs: dict[str, int] = {}
    result: set[str] = set()
    for match in re.finditer(r"^#{1,6}\s+(.+)$", content, re.MULTILINE):
        raw = match.group(1).strip()
        # Strip trailing closing hashes (e.g., "## Heading ##")
        raw = re.sub(r"\s+#+\s*$", "", raw)
        # Strip inline formatting: bold, italic, code, links
        plain = re.sub(r"[*_`~]", "", raw)
        plain = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", plain)
        slug = _heading_slugify(plain)
        if not slug:
            continue
        if slug in slugs:
            slugs[slug] += 1
            suffixed = f"{slug}_{slugs[slug]}"
            result.add(suffixed)
        else:
            slugs[slug] = 0
            result.add(slug)
    return result
```

### Virtual File Layout Mode

When `file_layout` is provided (e.g., during post-delete impact scans), the server cannot read file contents from disk because the virtual layout may not match the filesystem. In this mode, anchor validation is **skipped** — only path existence is checked. The `fragment` field is ignored.

### Dead Link Panel Display

When a dead link has an anchor error, the panel (`_showDeadLinkPanel`) displays it as:

```
[link text] → other-page.md#missing-heading  (Anchor not found)
```

The error string from the server (`"Anchor not found: #<fragment>"`) is used directly. This distinguishes anchor-only failures from file-not-found failures.

### Exclusion: Same-Page Anchors

Links that are same-page anchors (`#heading-only`, no path part) are already excluded from dead link scanning by the existing filter (`pathPart.indexOf('#') === 0` check). This behavior is unchanged — same-page anchors are not validated by the scanner because the heading inventory would need to come from the current editor content, not the on-disk file.

---

## Rules

1. **Trigger only on text change with slug impact.** The migration fires only when `_headingSlugify(newText) !== _headingSlugify(originalText)`. Cosmetic edits (trailing spaces, punctuation that slugify strips) do not trigger.
2. **Same-page rewrites are immediate.** `#old-slug` links within the current document are rewritten in the live editor content, not deferred to save.
3. **Cross-document rewrites use the snapshot system.** A `rewrite-heading-anchor` batch op is queued and a badge is added. The user must click Save to apply.
4. **No migration for new headings.** If the heading did not exist before the current edit session (originalText is empty), no migration is staged.
5. **Coalescing is mandatory.** Multiple renames of the same heading before save are coalesced to a single `oldSlug → finalSlug` rewrite.
6. **Exclusion zones are respected.** Both same-page and cross-document rewrites skip content inside fenced code blocks, inline code, and HTML comments.
7. **All MkDocs link formats are covered.** The rewriter resolves `.md`, extensionless, folder, folder-with-trailing-slash, `../` traversal, and reference-style link definitions. Path resolution uses `_resolvePath` with the same fallback logic as the dead link scanner (`path.md`, `path/index.md`).
8. **Conflict warning on navigation.** When pending `rewrite-heading-anchor` ops exist and the user navigates to an affected page, an informational dialog warns that editing may conflict with the pending migration. The dialog is advisory, not a hard block.
9. **Dead link anchor validation is server-side.** The API server reads the target file and checks headings. The client sends the optional `fragment` field.
10. **Virtual layout mode skips anchors.** When `file_layout` is provided, anchor validation is not performed.
11. **Known limitation: custom slugify.** If the site uses a non-default `toc.slugify` configuration (e.g., `slugify_unicode`), the JS-side `_headingSlugify` may produce different slugs than MkDocs. The server-side slugify for dead link validation uses the default algorithm.

## Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `_headingSlugify(text)` | JS | Compute heading anchor slug from text (MkDocs default algorithm) |
| `_stageHeadingMigration(srcPath, oldSlug, newSlug, oldText, newText)` | JS | Queue batch op, add badge, commit snapshot |
| `_checkHeadingMigrationBeforeNavigate()` | JS | Fire pending heading migration before page navigation |
| `_checkPendingHeadingConflict(srcPath, markdown)` | JS | After AJAX navigation, warn if the page has links affected by pending anchor rewrites |
| `_rewriteHeadingAnchorsInPage(content, pageSrcPath, anchorMap)` | JS | Rewrite `#old` → `#new` fragments in a page's markdown content |
| `_coalesceHeadingAnchorOps(ops)` | JS | Merge chained anchor rewrites into minimal map |
| `_resolveTargetWithFallbacks(pageDir, pathPart)` | JS | Resolve a link target to an absolute docs-relative path, checking `.md` and `/index.md` fallbacks |
| `_heading_slugify(text, separator)` | Python (`api_server.py`) | Server-side slugify matching python-markdown default |
| `_extract_heading_slugs(content)` | Python (`api_server.py`) | Parse headings from markdown, return slug inventory with duplicate suffixes |
