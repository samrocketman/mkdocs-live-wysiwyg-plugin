# Vendor Subsystem

The WYSIWYG plugin vendors all third-party JavaScript and CSS dependencies locally. No external CDN calls are made at runtime. The editor must function identically with no network access.

**Parent subsystem for:** [Mermaid Mode](DESIGN-mermaid-mode.md) — defines how the vendored mermaid assets are consumed (inline SVG preview via mermaid.js, Layer 3 iframe via mermaid-live-editor).

## Vendoring Philosophy

- **All deps local, no CDN, fully offline-capable.** Every JavaScript library, CSS file, and font used by the editor is shipped inside the Python package.
- **License chain documentation.** Every vendored dependency includes: (a) the project's own LICENSE file, (b) a NOTICES file listing significant transitive dependencies and their licenses when the vendor has a build step that bundles transitive deps.
- **Upgrade procedures are documented and scripted.** Each vendored component has a documented upgrade procedure and, where applicable, an automated script.

## Inventory

| Component | File(s) | Version | License | Upgrade Procedure |
|---|---|---|---|---|
| marked.js | `vendor/marked.min.js` | v14.1.4 | MIT — `LICENSE.marked` | Manual download from npm |
| js-yaml | `vendor/js-yaml.min.js` | v4.1.1 | MIT — `LICENSE.js-yaml` | See [Upgrade js-yaml](#upgrade-js-yaml) |
| editor.js/css | `vendor/editor.js`, `vendor/editor.css` | latest | MIT — `LICENSE.editor` | Manual copy from upstream |
| mermaid.js | `vendor/mermaid.min.js` | v11.4.1 | MIT — `LICENSE.mermaid` | See [Upgrade Mermaid JS](#upgrade-mermaid-js-subsystem) |
| mermaid-live-editor | `vendor/mermaid-live-editor/` | develop (SvelteKit build) | MIT — `LICENSE.mermaid-live-editor` | See [Upgrade Mermaid JS Live Editor](#upgrade-mermaid-js-live-editor-subsystem) |

## Upgrade js-yaml

js-yaml is a YAML 1.2 parser and serializer used by the mermaid config detection and auto-fix subsystem (`_isMermaidConfiguredInYml`, `_addMermaidSuperfencesConfig`) to structurally parse and modify `mkdocs.yml` in memory. The browser bundle (`dist/js-yaml.min.js`) is self-contained with zero runtime dependencies. It exposes `jsyaml` as a global when loaded via a `<script>` tag.

**Cross-reference:** See [DESIGN-mkdocs-yml-mermaid-config.md](DESIGN-mkdocs-yml-mermaid-config.md) for the pre/post processing pattern that handles `!!python/name:` YAML tags.

### Upgrade Procedure

1. Identify the target version from [js-yaml releases](https://github.com/nodeca/js-yaml/releases) or [npm](https://www.npmjs.com/package/js-yaml)
2. Download the tarball: `curl -sL "https://registry.npmjs.org/js-yaml/-/js-yaml-{version}.tgz" -o /tmp/js-yaml.tgz`
3. Extract: `tar -xzf /tmp/js-yaml.tgz -C /tmp`
4. Replace `vendor/js-yaml.min.js` with `/tmp/package/dist/js-yaml.min.js`
5. Update `vendor/LICENSE.js-yaml` if the copyright year range has changed (`/tmp/package/LICENSE`)
6. Update the version in `vendor/README.md` and the inventory table above
7. Verify: trigger the mermaid auto-fix on a page, confirm the `_virtualMkdocsYml` update produces valid YAML with the mermaid config

## Upgrade Mermaid JS Subsystem

mermaid.js is a pure client-side rendering library with **zero runtime network dependencies**. It renders SVG diagrams entirely in the browser. No offline modifications are required after upgrade.

**Material theme compatibility:** When the user has `pymdownx.superfences` configured with mermaid custom fences, MkDocs Material loads its own copy of mermaid.js on the page. `_loadMermaidJs()` detects this by checking for `window.mermaid` with a `render` method and reuses the existing instance instead of loading the vendored copy. This avoids double-loading and global namespace conflicts. See [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) "Mermaid.js Loading" for the two-tier loading strategy.

**Cross-reference:** See [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) for how mermaid.js is loaded and used to render inline SVG previews in `.md-mermaid-block` elements.

### Upgrade Procedure

1. Identify the target version from [mermaid releases](https://github.com/mermaid-js/mermaid/releases)
2. Download the ESM bundle (`mermaid.min.js`) from npm or the release assets
3. Replace `vendor/mermaid.min.js` with the new file
4. Update `vendor/LICENSE.mermaid` if the copyright year range has changed
5. Update the version in `vendor/README.md` and the inventory table above
6. Verify: load a page with a mermaid code block, confirm the inline SVG preview renders correctly

Alternatively, run `scripts/vendor-mermaid.sh` with updated version pins.

## Upgrade Mermaid JS Live Editor Subsystem

The Mermaid Live Editor is a SvelteKit application that provides a split-pane diagram editor with live preview. It **has external network dependencies** that must be disabled or removed after every upgrade to guarantee offline operability.

**Cross-reference:** See [DESIGN-mermaid-mode.md](DESIGN-mermaid-mode.md) for how the live editor is embedded via iframe, the session API protocol, and the Layer 3 overlay lifecycle. See [DESIGN-mermaid-session-server.md](../backend/DESIGN-mermaid-session-server.md) for the API server session endpoints that broker content between parent and iframe.

### Upgrade Procedure

1. Update the version pin in `scripts/vendor-mermaid.sh` (`LIVE_EDITOR_BRANCH`)
2. Run `scripts/vendor-mermaid.sh` — this clones, builds, patches, and copies in one step
3. Verify the patch script output — all 7 patches (P1–P7) should report as applied
4. Run the offline audit (see below)
5. Update `vendor/README.md` and the inventory table above with the new version

#### Manual Upgrade (if the automated script fails)

1. Clone the repo at the target branch/tag
2. `pnpm install && pnpm build` with **all external service env vars empty**:
   - `MERMAID_ANALYTICS_URL=''` — disables Plausible analytics
   - `MERMAID_RENDERER_URL=''` — disables mermaid.ink SVG export
   - `MERMAID_KROKI_RENDERER_URL=''` — disables Kroki renderer
   - `MERMAID_IS_ENABLED_MERMAID_CHART_LINKS=false` — disables mermaid.ai links
   - `MERMAID_DOMAIN=''` — disables analytics domain
3. Run `python3 scripts/patch-mermaid-vendor.py <build-output-dir>` to apply all patches
4. Copy the patched build output to `vendor/mermaid-live-editor/`
5. Update `vendor/LICENSE.mermaid-live-editor` if the copyright year range has changed
6. Regenerate `vendor/NOTICES.mermaid-live-editor` from `node_modules/*/LICENSE`
7. Run the offline audit to verify no external URLs remain

### Vendor Patches (`scripts/patch-mermaid-vendor.py`)

All post-build modifications are applied by `scripts/patch-mermaid-vendor.py`. The script is idempotent and can be re-run safely. It is called automatically by `vendor-mermaid.sh` after the SvelteKit build completes.

The patches address two categories of issues:
1. **Offline operability** — Remove service workers and network-dependent features
2. **Sub-path deployment** — The upstream app assumes deployment at `/`; our API server serves it at `/mermaid-editor/`

#### Patch Inventory

| ID | Patch | What it fixes | Files affected |
|---|---|---|---|
| **P1** | Bridge script injection | Injects the postMessage bridge into `edit.html` (primary) and `index.html` (fallback) so the iframe can communicate with the parent WYSIWYG editor | `edit.html`, `index.html` |
| **P2** | Canonical link removal | Removes `<link rel="canonical" href="https://mermaid.ai/live" />` — external reference irrelevant in an iframe | All `.html` files |
| **P3** | Manifest link removal | Removes `<link rel="manifest">` — PWA features are irrelevant in an iframe, and `manifest.json` contains root-absolute paths (`/favicon.png`, `/edit`) that break under a sub-path | All `.html` files |
| **P4** | 404.html base path fix | Changes `base: ""` to dynamic `new URL(".", location)` computation and converts all root-absolute paths (`/_app/...`) to relative (`./`) — the upstream adapter-static generates 404.html differently from other pages | `404.html` |
| **P5** | Service worker removal (layout) | Removes the entire `"serviceWorker" in navigator && navigator.serviceWorker.register(...)` block from the root layout JS — the SW intercepts fetches and makes network requests when the cache expires | `_app/immutable/nodes/0.*.js` |
| **P6** | Service worker register() fallback | Replaces any remaining `navigator.serviceWorker.register()` calls with `Promise.resolve()` to preserve `.then()`/`.catch()` chains without making network requests | Any `.js` files with register() |
| **P7** | Service worker file removal | Deletes `service-worker.js` from the build output | `service-worker.js` |
| **P8** | preventDefault override | Monkey-patches `Event.prototype.preventDefault` to no-op for parent-controlled keyboard shortcuts (ESC, Ctrl+S, Ctrl+.). Embedded inside the bridge script (P1). Prevents vendor handlers from suppressing browser defaults for keys controlled by the parent application. See [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode Keyboard Isolation. | `edit.html`, `index.html` (via P1) |

#### When Upgrading: Verify Each Patch Still Applies

The upstream codebase may change between versions. After building a new version, run the patch script and verify:

1. **P1**: The built `edit.html` and `index.html` must have a `</head>` tag for injection
2. **P2**: Check if canonical links are still present (may have been removed upstream)
3. **P3**: Check if manifest is still linked (may have been changed upstream)
4. **P4**: Check if `404.html` still uses root-absolute paths and `base: ""`
5. **P5**: Check if `+layout.svelte` still registers a service worker — search for `serviceWorker` in the built `nodes/0.*.js`
6. **P6**: Search all JS files for `navigator.serviceWorker.register(`
7. **P7**: Check if `service-worker.js` exists in the build output

8. **P8**: Embedded inside P1 (bridge script). Verify the vendor's keyboard handling hasn't changed in ways that would require adjusting the `_hasVisibleOverlay()` selectors or the `preventDefault` override. Test ESC, Ctrl+S, and Ctrl+. from inside the editor.

The patch script reports which patches were applied; if a patch reports "no matching files," the upstream may have changed and the patch should be re-examined.

#### Additional Upstream Issues (Mitigated but Not Patched)

These issues exist in the built output but are mitigated by how we embed the editor:

| Issue | Impact | Mitigation |
|---|---|---|
| `manifest.json` has root-absolute paths (`/favicon.png`, `start_url: "/edit"`) | PWA features broken under sub-path | P3 removes the `<link rel="manifest">` so the manifest is never loaded |
| 404 error page has hardcoded `href="/"` and `goto("/")` | 404 links navigate to wrong page | Unlikely to trigger — our API server has `.html` fallback so SvelteKit routes resolve; P4 fixes the base/imports if 404 does render |
| Root redirect (`nodes/2.*.js`) uses `goto("/${path}")` | Could navigate wrong if base not set | SvelteKit's `goto()` prepends base automatically; the iframe loads `/edit` directly, bypassing the root redirect entirely |
| `getRegistration(base||"/")` in SvelteKit router (`BmybysiL.js`) | Queries service worker registry | Harmless — no SW was registered (P5/P7) so `getRegistration` returns `undefined` |
| Gist loader (`loadGistData`) fetches from `api.github.com` | Network call on `?gist=` URL param | Our iframe URL never includes `?gist=`; the env var `MERMAID_RENDERER_URL=''` disables related features at build time |
| External URLs in JS (GitHub issue links, license comments, docs references) | Non-functional links | Informational only — no runtime network requests |

### Offline Audit Verification (Mandatory After Every Upgrade)

```bash
# Grep built JS/HTML for external URLs. Filter acceptable entries.
grep -rn 'https://' vendor/mermaid-live-editor/ --include='*.js' --include='*.html' | \
  grep -v '//# sourceMappingURL' | \
  grep -v 'mermaid.js.org'       # docs links acceptable (non-functional hyperlinks)
# Remaining matches must be examined and addressed.
```

### Fonts — Verified Self-Contained

`@fontsource-variable/recursive` bundles `.woff2` font files locally via npm. No Google Fonts CDN calls. On upgrade, verify the font package is still `@fontsource-variable/*` (local) and has not been replaced with a CDN import.

### PostMessage Bridge + Keyboard Isolation Layer

The bridge script is injected into `edit.html` (primary entry point) and `index.html` (fallback) by patch P1. It provides two services:

**1. Content Sync via Session API** — reads the diagram code from `localStorage` (where the mermaid-live-editor persists its Svelte store under the `codeStore` key, same-origin with the iframe) and PUTs it to the API server's mermaid session endpoint (`PUT /mermaid-session/{id}`). The parent GETs the code from the same endpoint on exit. See [DESIGN-mermaid-session-server.md](../backend/DESIGN-mermaid-session-server.md) for the full session lifecycle.

- **Session ID**: Parsed from the iframe URL query param `?session={id}`. The parent creates the session via `POST /mermaid-session` before loading the iframe.
- **Content source**: `_readEditorCode()` reads `JSON.parse(localStorage.getItem("codeStore")).code`. DOM `.view-line` elements serve as a fallback but are subject to Monaco's viewport virtualization.
- **Why localStorage for reading**: The URL hash is only reliable for initial state delivery — the SvelteKit app re-serializes with `pako` compression immediately after loading. Monaco editor is loaded as an ES module with no global `monaco` object. `localStorage` is same-origin and always has the complete content.
- **Initial state**: The parent encodes diagram state via `_encodeMermaidState(code)` and places it in the iframe URL hash. The SvelteKit app reads this hash on its own initialization via `initHandler()` → `loadStateFromURL()`, avoiding race conditions.
- **Periodic sync (1s)**: If code changed, PUTs raw code to `PUT /mermaid-session/{id}`. No postMessage, no base64 encoding.
- **Close**: ESC, Ctrl+S, and request-close all PUT final code to the session, then send a lightweight `live-wysiwyg-mermaid-close` signal (no content) to the parent via postMessage.
- **Request-close handler**: The bridge listens for `live-wysiwyg-mermaid-request-close` from the parent. On receipt, PUTs final code and responds with `live-wysiwyg-mermaid-close` signal. The parent's `save` flag is echoed back.

**2. Keyboard Isolation** — intercepts parent-controlled shortcuts at capture phase. See [DESIGN-centralized-keyboard.md](../ui/DESIGN-centralized-keyboard.md) § Mermaid Mode Keyboard Isolation for the full architecture.

- **ESC → Parent (Dialog UX pattern)**: Defers via `setTimeout(50ms)` then checks `_hasVisibleOverlay()` for open menus/tooltips/autocomplete widgets. Only sends close if nothing is visible. This matches the WYSIWYG editor's ESC escalation pattern.
- **Ctrl+S → Parent**: `stopImmediatePropagation` prevents vendor handling. PUTs final code, sends `live-wysiwyg-mermaid-close` signal with `save: true` — parent exits mermaid mode and triggers document save.
- **Ctrl+. → Suppressed**: `stopImmediatePropagation` prevents vendor handling. Mode toggle is not valid in mermaid mode.
- **P8 (preventDefault override)**: Monkey-patches `Event.prototype.preventDefault` to no-op for parent-controlled shortcut keys. Defensive layer ensuring no vendor handler can suppress ESC, Ctrl+S, or Ctrl+.
- **Regular editing keys**: Pass through to the vendor editor normally.

### API Server: Sub-Path Routing Support

The API server (`api_server.py`) includes two features that support the SvelteKit app under `/mermaid-editor/`:

1. **`.html` extension fallback**: When a requested file is not found, the server tries appending `.html` before returning 404. This handles SvelteKit's clean URL routing (e.g., `/mermaid-editor/edit` → `edit.html`).
2. **MIME type coverage**: All file types produced by the SvelteKit build are covered (`.html`, `.js`, `.css`, `.woff2`, `.ttf`, `.svg`, `.json`, `.ico`, `.xml`, `.txt`).

### Iframe Entry Point

The iframe loads `/mermaid-editor/edit?session={id}#{base64-state}` (served as `edit.html` via the `.html` fallback). This directly renders the edit route, bypassing the root redirect in `index.html`. The bridge script in `edit.html` (P1) reads the session ID from the URL query param and establishes the session API connection immediately.

### Transitive Dependency Licenses

Documented in `vendor/NOTICES.mermaid-live-editor`:

| Dependency | License |
|---|---|
| CodeMirror (`@codemirror/*`) | MIT |
| Monaco Editor | MIT |
| Svelte | MIT |
| lodash-es | MIT |
| pako | MIT/Zlib |
| svg-pan-zoom | BSD-2-Clause |
| Tailwind CSS | MIT |
| Fontsource Recursive | OFL-1.1 (font), MIT (package) |
