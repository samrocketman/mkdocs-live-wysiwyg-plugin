"""Batch link-check HTTP server for the WYSIWYG dead-link finder.

Runs in a daemon thread alongside the MkDocs dev server.  Exposes
``POST /check-links``, ``POST /file-exists``, ``POST /list-items``,
``POST /rename-folder``, ``POST /delete-folder``,
and ``GET /link-index``, ``GET /build-epoch`` endpoints.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import yaml

_RE_MD_LINK = re.compile(r'(?<!!)\[([^\]]*)\]\(([^)]+)\)')
_RE_MD_IMAGE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
_RE_IMG_TAG = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']')
_RE_REF_DEF = re.compile(r'^\[([^\]]+)\]:\s+(\S+)', re.MULTILINE)


def _parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter from markdown *text*.

    Returns the parsed dict (or ``{}`` if absent / invalid).
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    try:
        return yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        return {}


class _LinkCheckHandler(BaseHTTPRequestHandler):
    """Handles POST /check-links, POST /file-exists, POST /list-items,
    POST /rename-folder, POST /delete-folder, GET /link-index,
    and GET /build-epoch."""

    docs_dir: str = ""
    walk_dir: str = ""
    link_index: dict = {}
    build_epoch: list[int] = [1]

    def log_message(self, format, *args):  # noqa: A002
        pass

    # ------------------------------------------------------------------
    # GET /link-index
    # ------------------------------------------------------------------

    def do_GET(self):
        if self.path == "/link-index":
            payload = json.dumps(self.link_index).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/build-epoch":
            payload = json.dumps({"epoch": self.build_epoch[0]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_error(404)

    # ------------------------------------------------------------------
    # POST /check-links
    # ------------------------------------------------------------------

    def do_POST(self):
        if self.path == "/check-links":
            return self._handle_check_links()
        if self.path == "/file-exists":
            return self._handle_file_exists()
        if self.path == "/list-items":
            return self._handle_list_items()
        if self.path == "/rename-folder":
            return self._handle_rename_folder()
        if self.path == "/delete-folder":
            return self._handle_delete_folder()
        self.send_error(404)

    def _read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return None

    def _send_json(self, obj: object) -> None:
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    # ------------------------------------------------------------------
    # POST /check-links
    # ------------------------------------------------------------------

    def _handle_check_links(self):
        body = self._read_json_body()
        if body is None:
            return

        checks = body.get("checks", [])
        results: list[dict] = []
        for item in checks:
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

        self._send_json({"results": results})

    # ------------------------------------------------------------------
    # POST /file-exists  — batch file-existence check (docs-scoped)
    # ------------------------------------------------------------------

    def _handle_file_exists(self):
        body = self._read_json_body()
        if body is None:
            return

        paths = body.get("paths", [])
        docs = Path(self.walk_dir or self.docs_dir)
        results: dict[str, dict] = {}
        for rel in paths:
            if not isinstance(rel, str) or not rel:
                continue
            resolved = (docs / rel).resolve()
            try:
                resolved.relative_to(docs.resolve())
            except ValueError:
                results[rel] = {"exists": False}
                continue
            if resolved.is_file():
                try:
                    text = resolved.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    results[rel] = {"exists": True, "meta": {}}
                    continue
                meta = _parse_frontmatter(text)
                results[rel] = {
                    "exists": True,
                    "meta": {
                        "title": meta.get("title"),
                        "weight": meta.get("weight"),
                        "headless": meta.get("headless"),
                        "retitled": meta.get("retitled"),
                        "empty": meta.get("empty"),
                    },
                }
            else:
                results[rel] = {"exists": False}

        self._send_json({"results": results})

    # ------------------------------------------------------------------
    # POST /list-items  — recursive directory listing (docs-scoped)
    # ------------------------------------------------------------------

    def _handle_list_items(self):
        body = self._read_json_body()
        if body is None:
            return

        folder = body.get("folder", "")
        include_all = body.get("all", False)
        docs = Path(self.walk_dir or self.docs_dir).resolve()

        target = (docs / folder).resolve() if folder else docs
        if not self._is_within_docs(target, docs):
            self.send_error(403, "Path escapes docs_dir")
            return
        if not target.is_dir():
            self._send_json({"items": []})
            return

        items: list[dict] = []
        for root, dirs, files in os.walk(target):
            root_path = Path(root)
            rel_root = str(root_path.relative_to(docs)).replace("\\", "/")
            if rel_root == ".":
                rel_root = ""
            for d in sorted(dirs):
                items.append({
                    "path": (rel_root + "/" + d if rel_root else d),
                    "type": "directory",
                })
            for f in sorted(files):
                if not include_all and not f.endswith(".md"):
                    continue
                items.append({
                    "path": (rel_root + "/" + f if rel_root else f),
                    "type": "file",
                })
        self._send_json({"items": items})

    # ------------------------------------------------------------------
    # POST /rename-folder  — rename a directory within docs
    # ------------------------------------------------------------------

    def _handle_rename_folder(self):
        body = self._read_json_body()
        if body is None:
            return

        old_path = body.get("old_path", "")
        new_path = body.get("new_path", "")
        if not old_path or not new_path:
            self.send_error(400, "old_path and new_path are required")
            return

        docs = Path(self.walk_dir or self.docs_dir).resolve()
        old_abs = (docs / old_path).resolve()
        new_abs = (docs / new_path).resolve()

        if not self._is_within_docs(old_abs, docs):
            self.send_error(403, "old_path escapes docs_dir")
            return
        if not self._is_within_docs(new_abs, docs):
            self.send_error(403, "new_path escapes docs_dir")
            return
        if not old_abs.is_dir():
            self.send_error(404, "Source directory not found")
            return
        if new_abs.exists():
            self.send_error(409, "Destination already exists")
            return

        try:
            new_abs.parent.mkdir(parents=True, exist_ok=True)
            old_abs.rename(new_abs)
        except OSError as e:
            self.send_error(500, f"Rename failed: {e}")
            return
        self._send_json({"ok": True})

    # ------------------------------------------------------------------
    # POST /delete-folder  — delete a directory (with optional exclusions)
    # ------------------------------------------------------------------

    def _handle_delete_folder(self):
        body = self._read_json_body()
        if body is None:
            return

        folder = body.get("folder", "")
        exclusions = set(body.get("exclusions", []))
        if not folder:
            self.send_error(400, "folder is required")
            return

        docs = Path(self.walk_dir or self.docs_dir).resolve()
        target = (docs / folder).resolve()

        if not self._is_within_docs(target, docs):
            self.send_error(403, "Path escapes docs_dir")
            return
        if not target.is_dir():
            self.send_error(404, "Directory not found")
            return

        if not exclusions:
            try:
                shutil.rmtree(target)
            except OSError as e:
                self.send_error(500, f"Delete failed: {e}")
                return
            self._send_json({"ok": True, "deleted": True, "partial": False})
            return

        deleted_files: list[str] = []
        skipped_files: list[str] = []
        self._delete_tree_with_exclusions(
            target, docs, exclusions, deleted_files, skipped_files,
        )
        self._send_json({
            "ok": True,
            "deleted": not target.exists(),
            "partial": bool(skipped_files),
            "deleted_files": deleted_files,
            "skipped_files": skipped_files,
        })

    def _delete_tree_with_exclusions(
        self,
        directory: Path,
        docs: Path,
        exclusions: set[str],
        deleted_files: list[str],
        skipped_files: list[str],
    ) -> bool:
        """Recursively delete *directory* contents, skipping exclusions.

        Returns True if the directory itself was fully deleted (empty after
        processing).  Files/folders whose relative path (from docs root)
        appears in *exclusions* are preserved.
        """
        all_removed = True
        for child in sorted(directory.iterdir()):
            rel = str(child.relative_to(docs)).replace("\\", "/")
            if rel in exclusions:
                skipped_files.append(rel)
                all_removed = False
                continue
            if child.is_dir():
                has_excluded_child = any(
                    ex.startswith(rel + "/") for ex in exclusions
                )
                if has_excluded_child:
                    sub_clear = self._delete_tree_with_exclusions(
                        child, docs, exclusions, deleted_files, skipped_files,
                    )
                    if not sub_clear:
                        all_removed = False
                else:
                    try:
                        shutil.rmtree(child)
                        deleted_files.append(rel + "/")
                    except OSError:
                        all_removed = False
            else:
                try:
                    child.unlink()
                    deleted_files.append(rel)
                except OSError:
                    all_removed = False

        if all_removed:
            try:
                directory.rmdir()
            except OSError:
                all_removed = False
        return all_removed

    # ------------------------------------------------------------------
    # Path sandboxing helper
    # ------------------------------------------------------------------

    @staticmethod
    def _is_within_docs(resolved: Path, docs_resolved: Path) -> bool:
        """Return True if *resolved* is within or equal to *docs_resolved*."""
        try:
            resolved.relative_to(docs_resolved)
            return True
        except ValueError:
            return False

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
    build_epoch: list[int] | None = None,
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
    if build_epoch is None:
        build_epoch = [1]
    handler = type(
        "_BoundLinkCheckHandler",
        (_LinkCheckHandler,),
        {
            "docs_dir": docs_dir,
            "walk_dir": scan_dir,
            "link_index": link_index,
            "build_epoch": build_epoch,
        },
    )
    server = HTTPServer((host, 0), handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port
