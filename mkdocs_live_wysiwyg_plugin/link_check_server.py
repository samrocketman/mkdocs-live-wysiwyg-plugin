"""Batch link-check HTTP server for the WYSIWYG dead-link finder.

Runs in a daemon thread alongside the MkDocs dev server.  Exposes
``POST /check-links`` and ``GET /link-index`` endpoints.
"""

from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

_RE_MD_LINK = re.compile(r'(?<!!)\[([^\]]*)\]\(([^)]+)\)')
_RE_MD_IMAGE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
_RE_IMG_TAG = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']')
_RE_REF_DEF = re.compile(r'^\[([^\]]+)\]:\s+(\S+)', re.MULTILINE)


class _LinkCheckHandler(BaseHTTPRequestHandler):
    """Handles POST /check-links and GET /link-index requests."""

    docs_dir: str = ""
    link_index: dict = {}

    def log_message(self, format, *args):  # noqa: A002
        pass

    # ------------------------------------------------------------------
    # GET /link-index
    # ------------------------------------------------------------------

    def do_GET(self):
        if self.path != "/link-index":
            self.send_error(404)
            return
        payload = json.dumps(self.link_index).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    # ------------------------------------------------------------------
    # POST /check-links
    # ------------------------------------------------------------------

    def do_POST(self):
        if self.path != "/check-links":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return

        checks = body.get("checks", [])
        results: list[dict] = []
        for item in checks:
            # Abort early when the client has disconnected.
            try:
                self.wfile.flush()
            except (BrokenPipeError, ConnectionError, OSError):
                return
            if item.get("type") == "internal":
                results.append(self._check_internal(item))
            elif item.get("type") == "external":
                results.append(self._check_external(item))
            else:
                results.append({"ok": False, "error": "Unknown check type"})

        payload = json.dumps({"results": results}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ------------------------------------------------------------------
    # Check helpers
    # ------------------------------------------------------------------

    def _check_internal(self, item: dict) -> dict:
        from_path = item.get("from", "")
        target = item.get("target", "")
        if not target:
            return {"ok": False, "error": "Empty target"}
        docs = Path(self.docs_dir)
        from_dir = (docs / from_path).parent
        resolved = (from_dir / target).resolve()
        try:
            resolved.relative_to(docs.resolve())
        except ValueError:
            return {"ok": False, "error": "Path escapes docs_dir"}
        if resolved.exists():
            return {"ok": True}
        if not resolved.suffix:
            if (resolved / "index.md").exists():
                return {"ok": True}
            if resolved.with_suffix(".md").exists():
                return {"ok": True}
        if resolved.suffix == ".md" and resolved.with_suffix("").exists():
            return {"ok": True}
        return {"ok": False, "error": "File not found"}

    def _check_external(self, item: dict) -> dict:
        url = item.get("url", "")
        if not url:
            return {"ok": False, "error": "Empty URL"}
        try:
            req = urllib.request.Request(url, method="HEAD")
            req.add_header("User-Agent", "MkDocs-WYSIWYG-LinkChecker/1.0")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.getcode()
                return {"ok": 200 <= status < 400, "status": status}
        except urllib.error.HTTPError as e:
            return {"ok": False, "status": e.code}
        except Exception as e:
            return {"ok": False, "error": str(e)}


# ------------------------------------------------------------------
# Link-index builder
# ------------------------------------------------------------------

def _extract_refs(markdown: str) -> list[dict]:
    """Extract local file references from markdown content."""
    refs: list[dict] = []

    for m in _RE_MD_LINK.finditer(markdown):
        target = m.group(2).split("#")[0].split("?")[0]
        if target and not target.startswith(
            ("http://", "https://", "#", "mailto:")
        ):
            refs.append({"type": "link", "target": target, "offset": m.start()})

    for m in _RE_MD_IMAGE.finditer(markdown):
        target = m.group(2).split("#")[0].split("?")[0]
        if target and not target.startswith(("http://", "https://")):
            refs.append({"type": "image", "target": target, "offset": m.start()})

    for m in _RE_IMG_TAG.finditer(markdown):
        target = m.group(1)
        if target and not target.startswith(("http://", "https://", "data:")):
            refs.append({"type": "img_tag", "target": target, "offset": m.start()})

    for m in _RE_REF_DEF.finditer(markdown):
        target = m.group(2).split("#")[0].split("?")[0]
        if target and not target.startswith(
            ("http://", "https://", "#", "mailto:")
        ):
            refs.append({
                "type": "ref_def",
                "ref_id": m.group(1),
                "target": target,
                "offset": m.start(),
            })

    return refs


def build_link_index(docs_dir: str) -> dict[str, list[dict]]:
    """Walk *docs_dir* and build a ``{src_path: [ref, …]}`` link index.

    Uses the same regex patterns as the MkDocs ``on_page_markdown`` hook
    so the index is identical regardless of source.  Called once at server
    startup so the index is available before the first build completes.
    """
    index: dict[str, list[dict]] = {}
    docs = Path(docs_dir)
    for md_file in docs.rglob("*.md"):
        src_path = str(md_file.relative_to(docs)).replace("\\", "/")
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        refs = _extract_refs(content)
        if refs:
            index[src_path] = refs
    return index


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def start_link_check_server(
    host: str,
    docs_dir: str,
    link_index: dict | None = None,
    *,
    walk_dir: str | None = None,
) -> tuple[HTTPServer, int]:
    """Start the link-check HTTP server on *host* (port chosen by the OS).

    Returns ``(server, port)``.  The server runs in a daemon thread and
    will be torn down automatically when the main process exits.

    If *link_index* is provided the server shares it with the caller
    (mutations are visible to both sides).  Otherwise, a fresh index is
    built by walking *walk_dir* (defaults to *docs_dir*).
    """
    scan_dir = walk_dir or docs_dir
    if link_index is None:
        link_index = build_link_index(scan_dir)
    elif not link_index:
        link_index.update(build_link_index(scan_dir))
    handler = type(
        "_BoundLinkCheckHandler",
        (_LinkCheckHandler,),
        {"docs_dir": docs_dir, "link_index": link_index},
    )
    server = HTTPServer((host, 0), handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port
