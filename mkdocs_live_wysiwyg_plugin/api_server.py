"""Batch link-check HTTP server for the WYSIWYG dead-link finder.

Runs in a daemon thread alongside the MkDocs dev server.  Exposes
``POST /check-links``, ``POST /file-exists``, ``POST /list-items``,
``POST /rename-folder``, ``POST /delete-folder``, ``POST /move-file``,
``POST /delete-file``, ``POST /unreferenced-files``,
``GET /link-index``, ``GET /build-epoch``,
``GET /mermaid-editor/*``, and
``POST|GET|PUT|DELETE /mermaid-session`` endpoints.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from pathlib import Path

import yaml

_RE_MD_LINK = re.compile(r'(?<!!)\[([^\]]*)\]\(([^)]+)\)')
_RE_MD_IMAGE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
_RE_IMG_TAG = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']')
_RE_REF_DEF = re.compile(r'^\[([^\]]+)\]:\s+(\S+)', re.MULTILINE)

_RE_HEADING = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)
_RE_INLINE_MARKUP = re.compile(r'[*_`~\[\]!]')


def _heading_slugify(text: str, separator: str = "-") -> str:
    """Slugify heading text matching Python-Markdown's default toc algorithm."""
    import unicodedata
    value = unicodedata.normalize("NFKD", text)
    value = _RE_INLINE_MARKUP.sub("", value)
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", separator, value)


def _extract_heading_slugs(content: str) -> set[str]:
    """Extract all heading slugs from markdown, handling duplicates."""
    slugs: set[str] = set()
    counts: dict[str, int] = {}
    for m in _RE_HEADING.finditer(content):
        raw = m.group(2).rstrip().rstrip("#").rstrip()
        slug = _heading_slugify(raw)
        if not slug:
            continue
        if slug in slugs:
            count = counts.get(slug, 0) + 1
            counts[slug] = count
            slugs.add(f"{slug}_{count}")
        else:
            slugs.add(slug)
    return slugs


_MERMAID_EDITOR_DIR = Path(__file__).parent / "vendor" / "mermaid-live-editor"
_MERMAID_MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".map": "application/json",
    ".ico": "image/x-icon",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".webmanifest": "application/manifest+json",
}

_mermaid_sessions: dict[str, str] = {}
_mermaid_sessions_lock = threading.Lock()


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
    _rename_state: dict[tuple[str, str], str] = {}
    _rename_lock: threading.Lock = threading.Lock()

    def log_message(self, format, *args):  # noqa: A002
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    # ------------------------------------------------------------------
    # GET /link-index
    # ------------------------------------------------------------------

    def do_GET(self):
        if self.path == "/link-index":
            payload = json.dumps(self.link_index).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/build-epoch":
            payload = json.dumps({"epoch": self.build_epoch[0]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path.startswith("/mermaid-editor/"):
            return self._serve_mermaid_editor()
        if self.path.startswith("/mermaid-session/"):
            return self._handle_mermaid_session_get()
        self.send_error(404)

    # ------------------------------------------------------------------
    # GET /mermaid-editor/*  — serve vendored Mermaid Live Editor assets
    # ------------------------------------------------------------------

    def _serve_mermaid_editor(self):
        rel = self.path[len("/mermaid-editor/"):]
        if not rel:
            rel = "index.html"
        rel = rel.split("?")[0].split("#")[0]
        if rel == "mermaid.min.js":
            requested = _MERMAID_EDITOR_DIR.parent / "mermaid.min.js"
        else:
            requested = (_MERMAID_EDITOR_DIR / rel).resolve()
            if not self._is_within_docs(
                requested, _MERMAID_EDITOR_DIR.resolve()
            ):
                self.send_error(403, "Path escapes mermaid-editor directory")
                return
        if not requested.is_file():
            # SvelteKit adapter-static: extensionless routes map to .html files
            html_fallback = requested.parent / (requested.name + ".html")
            if html_fallback.is_file() and self._is_within_docs(
                html_fallback.resolve(), _MERMAID_EDITOR_DIR.resolve()
            ):
                requested = html_fallback
            else:
                self.send_error(404)
                return
        suffix = requested.suffix.lower()
        content_type = _MERMAID_MIME_TYPES.get(suffix, "application/octet-stream")
        try:
            data = requested.read_bytes()
        except OSError:
            self.send_error(500, "Failed to read file")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

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
        if self.path == "/move-file":
            return self._handle_move_file()
        if self.path == "/delete-file":
            return self._handle_delete_file()
        if self.path == "/unreferenced-files":
            return self._handle_unreferenced_files()
        if self.path == "/mermaid-session":
            return self._handle_mermaid_session_create()
        self.send_error(404)

    def _read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return None

    def _send_json(self, obj: object, code: int = 200) -> None:
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
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
        raw_layout = body.get("file_layout")
        file_layout_set: set[str] | None = None
        if isinstance(raw_layout, list):
            file_layout_set = set(raw_layout)

        results: list[dict] = []
        for item in checks:
            try:
                self.wfile.flush()
            except (BrokenPipeError, ConnectionError, OSError):
                return
            if item.get("type") == "internal":
                results.append(self._check_internal(item, file_layout_set))
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
                    "meta": dict(meta) if meta else {},
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

        rename_key = (old_path, new_path)

        with self._rename_lock:
            state = self._rename_state.get(rename_key)
            if state == "in_progress":
                self._send_json(
                    {"ok": True, "status": "in_progress"}, code=202,
                )
                return
            if state == "done":
                del self._rename_state[rename_key]
                self._send_json({"ok": True}, code=201)
                return
            self._rename_state[rename_key] = "in_progress"

        if not old_abs.is_dir():
            with self._rename_lock:
                if self._rename_state.get(rename_key) == "in_progress":
                    del self._rename_state[rename_key]
            self.send_error(404, "Source directory not found")
            return

        try:
            new_abs.parent.mkdir(parents=True, exist_ok=True)
            if new_abs.is_dir():
                for child in list(old_abs.iterdir()):
                    dest = new_abs / child.name
                    if dest.exists():
                        if child.is_dir() and dest.is_dir():
                            shutil.copytree(child, dest,
                                            dirs_exist_ok=True)
                            shutil.rmtree(child)
                        else:
                            child.replace(dest)
                    else:
                        child.rename(dest)
                if not any(old_abs.iterdir()):
                    old_abs.rmdir()
            else:
                old_abs.rename(new_abs)
        except OSError as e:
            with self._rename_lock:
                if rename_key in self._rename_state:
                    del self._rename_state[rename_key]
            self.send_error(500, f"Rename failed: {e}")
            return

        with self._rename_lock:
            self._rename_state[rename_key] = "done"

        self._send_json({"ok": True}, code=201)

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
    # POST /move-file  — move or rename a single non-markdown (binary) file
    # ------------------------------------------------------------------

    def _handle_move_file(self):
        body = self._read_json_body()
        if body is None:
            return

        old_path = body.get("old_path", "")
        new_path = body.get("new_path", "")
        if not old_path or not new_path:
            self.send_error(400, "old_path and new_path are required")
            return

        if old_path.endswith(".md"):
            self.send_error(
                400, "Markdown files must be moved via the WebSocket API"
            )
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

        if not old_abs.is_file():
            self.send_error(404, "Source file not found")
            return

        try:
            new_abs.parent.mkdir(parents=True, exist_ok=True)
            old_abs.rename(new_abs)
        except OSError as e:
            self.send_error(500, f"Move failed: {e}")
            return

        self._send_json({"ok": True})

    # ------------------------------------------------------------------
    # POST /delete-file  — delete a single non-markdown (binary) file
    # ------------------------------------------------------------------

    def _handle_delete_file(self):
        body = self._read_json_body()
        if body is None:
            return

        file_path = body.get("path", "")
        if not file_path:
            self.send_error(400, "path is required")
            return

        if file_path.endswith(".md"):
            self.send_error(
                400, "Markdown files must be deleted via the WebSocket API"
            )
            return

        docs = Path(self.walk_dir or self.docs_dir).resolve()
        abs_path = (docs / file_path).resolve()

        if not self._is_within_docs(abs_path, docs):
            self.send_error(403, "path escapes docs_dir")
            return

        if not abs_path.is_file():
            self.send_error(404, "File not found")
            return

        try:
            abs_path.unlink()
        except OSError as e:
            self.send_error(500, f"Delete failed: {e}")
            return

        self._send_json({"ok": True})

    # ------------------------------------------------------------------
    # POST /unreferenced-files  — non-md files not referenced by any md
    # ------------------------------------------------------------------

    def _handle_unreferenced_files(self):
        docs = Path(self.walk_dir or self.docs_dir).resolve()

        all_files: set[str] = set()
        for root, dirs, files in os.walk(docs):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            root_path = Path(root)
            for f in files:
                if f.startswith(".") or f.endswith(".md"):
                    continue
                rel = str(root_path.joinpath(f).relative_to(docs)).replace(
                    "\\", "/"
                )
                all_files.add(rel)

        referenced: set[str] = set()
        for src_path, refs in self.link_index.items():
            src_dir = (docs / src_path).parent
            for ref in refs:
                target = ref.get("target", "")
                if not target:
                    continue
                if target.startswith("/"):
                    resolved = (docs / target.lstrip("/")).resolve()
                else:
                    resolved = (src_dir / target).resolve()
                try:
                    rel = str(resolved.relative_to(docs)).replace("\\", "/")
                    referenced.add(rel)
                except ValueError:
                    pass

        unreferenced = sorted(all_files - referenced)
        self._send_json({"files": unreferenced})

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

    # ------------------------------------------------------------------
    # PUT /mermaid-session/{id}
    # ------------------------------------------------------------------

    def do_PUT(self):
        if self.path.startswith("/mermaid-session/"):
            return self._handle_mermaid_session_update()
        self.send_error(404)

    # ------------------------------------------------------------------
    # DELETE /mermaid-session/{id}
    # ------------------------------------------------------------------

    def do_DELETE(self):
        if self.path.startswith("/mermaid-session/"):
            return self._handle_mermaid_session_delete()
        self.send_error(404)

    # ------------------------------------------------------------------
    # Mermaid Session CRUD
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_session_id(path: str) -> str:
        return path[len("/mermaid-session/"):].split("?")[0].split("#")[0]

    def _handle_mermaid_session_create(self):
        body = self._read_json_body()
        if body is None:
            return
        code = body.get("code", "")
        session_id = uuid.uuid4().hex[:16]
        with _mermaid_sessions_lock:
            _mermaid_sessions[session_id] = code
        self._send_json({"sessionId": session_id}, code=201)

    def _handle_mermaid_session_get(self):
        sid = self._extract_session_id(self.path)
        with _mermaid_sessions_lock:
            code = _mermaid_sessions.get(sid)
        if code is None:
            self.send_error(404, "Session not found")
            return
        self._send_json({"code": code})

    def _handle_mermaid_session_update(self):
        sid = self._extract_session_id(self.path)
        body = self._read_json_body()
        if body is None:
            return
        with _mermaid_sessions_lock:
            if sid not in _mermaid_sessions:
                self.send_error(404, "Session not found")
                return
            _mermaid_sessions[sid] = body.get("code", "")
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _handle_mermaid_session_delete(self):
        sid = self._extract_session_id(self.path)
        with _mermaid_sessions_lock:
            removed = _mermaid_sessions.pop(sid, None)
        if removed is None:
            self.send_error(404, "Session not found")
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS",
        )
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ------------------------------------------------------------------
    # Check helpers
    # ------------------------------------------------------------------

    def _check_internal(
        self, item: dict, file_layout_set: set[str] | None = None
    ) -> dict:
        from_path = item.get("from", "")
        target = item.get("target", "")
        fragment = item.get("fragment", "")
        if not target:
            return {"ok": False, "error": "Empty target"}
        docs = Path(self.docs_dir)
        docs_resolved = docs.resolve()
        from_dir = (docs / from_path).parent
        resolved = (from_dir / target).resolve()
        try:
            resolved.relative_to(docs_resolved)
        except ValueError:
            return {"ok": False, "error": "Path escapes docs_dir"}

        actual_md_path: Path | None = None

        if file_layout_set is not None:
            rel = str(resolved.relative_to(docs_resolved)).replace("\\", "/")
            found = False
            if rel in file_layout_set:
                found = True
            elif not resolved.suffix:
                if (rel + "/index.md") in file_layout_set:
                    found = True
                    rel = rel + "/index.md"
                elif (rel + ".md") in file_layout_set:
                    found = True
                    rel = rel + ".md"
            elif resolved.suffix == ".md" and rel.removesuffix(".md") in file_layout_set:
                found = True
            if not found:
                return {"ok": False, "error": "File not found"}
            if fragment and file_layout_set is None:
                actual_md_path = docs / rel
        else:
            found = False
            if resolved.exists():
                found = True
                actual_md_path = resolved
            elif not resolved.suffix:
                if (resolved / "index.md").exists():
                    found = True
                    actual_md_path = resolved / "index.md"
                elif resolved.with_suffix(".md").exists():
                    found = True
                    actual_md_path = resolved.with_suffix(".md")
            elif resolved.suffix == ".md" and resolved.with_suffix("").exists():
                found = True
                actual_md_path = resolved
            if not found:
                return {"ok": False, "error": "File not found"}

        if fragment and file_layout_set is None:
            if actual_md_path is None:
                actual_md_path = resolved
            md_file = actual_md_path
            if not md_file.suffix:
                if (md_file / "index.md").exists():
                    md_file = md_file / "index.md"
                elif md_file.with_suffix(".md").exists():
                    md_file = md_file.with_suffix(".md")
            if md_file.exists() and md_file.suffix == ".md":
                try:
                    content = md_file.read_text(encoding="utf-8")
                    slugs = _extract_heading_slugs(content)
                    if fragment not in slugs:
                        return {
                            "ok": False,
                            "error": f"Anchor not found: #{fragment}",
                        }
                except Exception:
                    pass
        return {"ok": True}

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
# Threaded HTTP server (allows 202 polling during in-flight renames)
# ------------------------------------------------------------------

class _ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


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
    server = _ThreadedHTTPServer((host, 0), handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port
