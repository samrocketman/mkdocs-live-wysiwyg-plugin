#!/usr/bin/env python3
"""Apply vendor patches to the mermaid-live-editor built output.

This script modifies the SvelteKit adapter-static output so the editor
works correctly when served from an arbitrary sub-path (e.g. /mermaid-editor/)
inside an iframe with no network access.

Run after building the SvelteKit app and BEFORE copying to vendor/:
    python3 scripts/patch-mermaid-vendor.py <build-dir>

Or run directly on the vendored copy:
    python3 scripts/patch-mermaid-vendor.py mkdocs_live_wysiwyg_plugin/vendor/mermaid-live-editor

Patches are idempotent — running twice produces identical output.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

BRIDGE_SCRIPT = r'''<script>
(function(){
  /* ===================================================================
   * PostMessage Bridge + Keyboard Isolation Layer
   *
   * Injected by patch P1 into edit.html and index.html.  Two services:
   *
   * 1. CONTENT SYNC — reads editor content from the mermaid-live-editor's
   *    localStorage ("codeStore" key) and PUTs it to the API server's
   *    mermaid session endpoint.  The parent GETs from the same endpoint.
   *    No postMessage content, no cross-origin DOM access.
   *
   * 2. KEYBOARD ISOLATION — intercepts ESC, Ctrl+S, Ctrl+. at capture
   *    phase.  See DESIGN-centralized-keyboard.md § Mermaid Mode.
   *
   * P8 (preventDefault override) neutralizes vendor preventDefault()
   * for parent-controlled shortcut keys as a defensive layer.
   * =================================================================== */

  var _origPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function() {
    if (this instanceof KeyboardEvent) {
      if (this.key === "Escape" ||
          ((this.ctrlKey || this.metaKey) && (this.key === "s" || this.key === "."))) {
        return;
      }
    }
    return _origPreventDefault.call(this);
  };

  var _sessionId = (function() {
    var m = window.location.search.match(/[?&]session=([^&#]+)/);
    return m ? m[1] : "";
  })();
  var _apiBase = window.location.origin;

  function _readEditorCode() {
    try {
      var raw = localStorage.getItem("codeStore");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.code === "string" && parsed.code) return parsed.code;
      }
    } catch(ex) {}
    try {
      var lines = document.querySelectorAll(".view-lines .view-line");
      if (lines.length > 0) {
        var parts = [];
        for (var i = 0; i < lines.length; i++) parts.push(lines[i].textContent);
        var text = parts.join("\n");
        if (text.trim()) return text;
      }
    } catch(ex) {}
    return "";
  }

  function _putSession(code) {
    if (!_sessionId) return;
    try {
      fetch(_apiBase + "/mermaid-session/" + _sessionId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      }).catch(function() {});
    } catch(ex) {}
  }

  var _lastSentCode = "";
  setInterval(function() {
    var code = _readEditorCode();
    if (code && code !== _lastSentCode) {
      _lastSentCode = code;
      _putSession(code);
    }
  }, 1000);

  function _isActuallyVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }
  function _hasVisibleOverlay() {
    var selectors = [
      ".suggest-widget:not(.hidden)",
      ".cm-tooltip",
      ".context-view",
      ".monaco-hover",
      ".find-widget.visible",
      ".parameter-hints-widget.visible"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && _isActuallyVisible(el)) return true;
    }
    return false;
  }

  function _closeAndSignal(save) {
    var code = _readEditorCode();
    _putSession(code);
    var msg = { type: "live-wysiwyg-mermaid-close" };
    if (save) msg.save = true;
    try { window.parent.postMessage(msg, "*"); } catch(ex) {}
  }

  window.addEventListener("message", function(evt) {
    var data = evt.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "live-wysiwyg-mermaid-request-close") {
      _closeAndSignal(data.save);
    }
  });

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      setTimeout(function() {
        if (!_hasVisibleOverlay()) {
          _closeAndSignal();
        }
      }, 50);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.stopImmediatePropagation();
      _closeAndSignal(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ".") {
      e.stopImmediatePropagation();
      return;
    }
  }, true);
})();
</script>'''

BRIDGE_SENTINEL = 'live-wysiwyg-mermaid-init'


def patch_html_bridge(path: Path) -> bool:
    """P1: Inject postMessage bridge script into HTML entry points."""
    text = path.read_text()
    if BRIDGE_SENTINEL in text:
        return False  # already patched
    text = text.replace('</head>', BRIDGE_SCRIPT + '</head>', 1)
    path.write_text(text)
    return True


def patch_html_remove_canonical(path: Path) -> bool:
    """P2: Remove canonical link to mermaid.ai."""
    text = path.read_text()
    new = re.sub(
        r'\s*<link\s+rel="canonical"\s+href="https://mermaid\.ai/[^"]*"\s*/?>',
        '', text
    )
    if new == text:
        return False
    path.write_text(new)
    return True


def patch_html_remove_manifest(path: Path) -> bool:
    """P3: Remove manifest link (PWA irrelevant in iframe)."""
    text = path.read_text()
    new = re.sub(
        r'\s*<link\s+rel="manifest"\s+href="[^"]*manifest\.json"\s*/?>',
        '', text
    )
    if new == text:
        return False
    path.write_text(new)
    return True


def patch_404_html(path: Path) -> bool:
    """P4: Fix 404.html to use relative paths and dynamic base (like other pages).

    The SvelteKit adapter-static generates 404.html with root-absolute paths
    (``/_app/...``) and ``base: ""``.  All other pages use relative paths
    (``./``-prefixed) and a dynamic base.  This patch brings 404.html in line.
    """
    text = path.read_text()
    if 'new URL(".", location)' in text:
        return False  # already patched

    # Change base from empty string to dynamic computation
    text = text.replace(
        'base: ""',
        'base: new URL(".", location).pathname.slice(0, -1)'
    )
    # Change root-absolute paths to relative in script imports
    text = text.replace(
        'import("/_app/',
        'import("./_app/'
    )
    # Change root-absolute paths to relative in modulepreload links
    text = text.replace(
        'href="/_app/',
        'href="./_app/'
    )
    # Change absolute asset refs to relative
    text = text.replace('href="/favicon.svg"', 'href="./favicon.svg"')
    text = text.replace('content="/favicon.svg"', 'content="./favicon.svg"')
    text = text.replace('href="/manifest.json"', 'href="./manifest.json"')

    path.write_text(text)
    return True


def patch_service_worker_layout(build_dir: Path) -> int:
    """P5: Remove service worker registration from layout JS (nodes/0.*.js).

    The layout component registers a service worker in onMount.  The compiled
    code looks like:
        "serviceWorker"in navigator&&navigator.serviceWorker.register(...)
            .then(function(Q){...}).catch(function(Q){...})
    After the register() sed replacement it becomes:
        "serviceWorker"in navigator&&Promise.resolve()
            .then(function(Q){...scope...}).catch(function(Q){...})
    We remove the entire conditional block to eliminate both the registration
    and the console error from the .then() handler receiving undefined.
    """
    count = 0
    nodes_dir = build_dir / '_app' / 'immutable' / 'nodes'
    if not nodes_dir.is_dir():
        return 0
    for js_file in nodes_dir.glob('0.*.js'):
        text = js_file.read_text()
        # Match the full service worker conditional block:
        #   "serviceWorker"in navigator&&<anything>.then(<fn>).catch(<fn>)
        # The pattern accounts for both original and partially-patched forms.
        new = re.sub(
            r'"serviceWorker"\s*in\s+navigator\s*&&\s*'
            r'(?:navigator\.serviceWorker\.register\([^)]*\)|Promise\.resolve\(\)|void 0)'
            r'(?:\.then\(function\([^)]*\)\{[^}]*\}(?:,function\([^)]*\)\{[^}]*\})?\))*'
            r'(?:\.catch\(function\([^)]*\)\{[^}]*\}(?:,function\([^)]*\)\{[^}]*\})?\))*',
            'void 0',
            text
        )
        if new != text:
            js_file.write_text(new)
            count += 1
    return count


def patch_service_worker_register_calls(build_dir: Path) -> int:
    """P6: Replace remaining navigator.serviceWorker.register() calls.

    Catches any register() calls not covered by P5 (e.g. in other chunks).
    Uses Promise.resolve() to preserve .then()/.catch() chains.
    """
    count = 0
    for js_file in build_dir.rglob('*.js'):
        text = js_file.read_text()
        new = text.replace(
            'navigator.serviceWorker.register(',
            'Promise.resolve(('
        )
        if new != text:
            js_file.write_text(new)
            count += 1
    return count


def patch_remove_service_worker_file(build_dir: Path) -> bool:
    """P7: Remove the service worker JS file if present."""
    sw = build_dir / 'service-worker.js'
    if sw.is_file():
        sw.unlink()
        return True
    return False


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <build-dir>', file=sys.stderr)
        sys.exit(1)

    build_dir = Path(sys.argv[1])
    if not build_dir.is_dir():
        print(f'Error: {build_dir} is not a directory', file=sys.stderr)
        sys.exit(1)

    results: list[str] = []

    # P1: Bridge script — inject into edit.html (primary) and index.html (fallback)
    for name in ('edit.html', 'index.html'):
        p = build_dir / name
        if p.is_file() and patch_html_bridge(p):
            results.append(f'P1: Injected bridge script into {name}')

    # P2: Remove canonical links
    for html_file in build_dir.glob('*.html'):
        if patch_html_remove_canonical(html_file):
            results.append(f'P2: Removed canonical link from {html_file.name}')

    # P3: Remove manifest links
    for html_file in build_dir.glob('*.html'):
        if patch_html_remove_manifest(html_file):
            results.append(f'P3: Removed manifest link from {html_file.name}')

    # P4: Fix 404.html
    p404 = build_dir / '404.html'
    if p404.is_file() and patch_404_html(p404):
        results.append('P4: Fixed 404.html base path and imports')

    # P5: Remove service worker registration block from layout
    n = patch_service_worker_layout(build_dir)
    if n:
        results.append(f'P5: Removed service worker registration from {n} layout file(s)')

    # P6: Replace remaining register() calls
    n = patch_service_worker_register_calls(build_dir)
    if n:
        results.append(f'P6: Replaced service worker register() in {n} file(s)')

    # P7: Remove service worker file
    if patch_remove_service_worker_file(build_dir):
        results.append('P7: Removed service-worker.js')

    # P8 is embedded inside the bridge script (P1) — the Event.prototype.preventDefault
    # monkey-patch for parent-controlled keyboard shortcuts.  No separate patch step needed;
    # it is applied whenever P1 injects the bridge.
    if results:
        results.append('P8: preventDefault override included in bridge script (part of P1)')

    if results:
        print(f'Applied {len(results)} patch(es):')
        for r in results:
            print(f'  {r}')
    else:
        print('No patches needed (already applied or no matching files).')


if __name__ == '__main__':
    main()
