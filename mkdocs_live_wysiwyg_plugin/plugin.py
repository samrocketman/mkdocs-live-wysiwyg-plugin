"""mkdocs-live-wysiwyg-plugin

WYSIWYG editor for mkdocs-live-edit-plugin based on @celsowm/markdown-wysiwyg.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Literal

from mkdocs.config import config_options
from mkdocs.config.defaults import MkDocsConfig
from mkdocs.plugins import BasePlugin
from mkdocs.structure.nav import Navigation, Section

# Fallback emoji map when pymdownx.gemoji_db is not available (~50 common emoji)
FALLBACK_EMOJI_MAP = {
    "white_check_mark": "\u2705",
    "check_mark": "\u2714",
    "heavy_check_mark": "\u2714",
    "x": "\u274c",
    "smile": "\U0001f604",
    "heart": "\u2764",
    "thumbsup": "\U0001f44d",
    "thumbsdown": "\U0001f44e",
    "star": "\u2b50",
    "warning": "\u26a0",
    "info": "\u2139",
    "information_source": "\u2139",
    "+1": "\U0001f44d",
    "-1": "\U0001f44e",
    "fire": "\U0001f525",
    "ok": "\U0001f197",
    "bulb": "\U0001f4a1",
    "rocket": "\U0001f680",
    "tada": "\U0001f389",
    "see_no_evil": "\U0001f648",
    "hear_no_evil": "\U0001f649",
    "speak_no_evil": "\U0001f64a",
    "eyes": "\U0001f440",
    "zzz": "\U0001f4a4",
    "100": "\U0001f4af",
    "1234": "\U0001f522",
    "grin": "\U0001f601",
    "joy": "\U0001f602",
    "smiley": "\U0001f603",
    "heart_eyes": "\U0001f60d",
    "kissing_heart": "\U0001f618",
    "sweat_smile": "\U0001f605",
    "laughing": "\U0001f606",
    "wink": "\U0001f609",
    "blush": "\U0001f60a",
    "yum": "\U0001f60b",
    "thinking": "\U0001f914",
    "neutral_face": "\U0001f610",
    "expressionless": "\U0001f611",
    "no_mouth": "\U0001f636",
    "smirk": "\U0001f60f",
    "rolling_eyes": "\U0001f644",
    "relieved": "\U0001f60c",
    "heartbeat": "\U0001f493",
    "broken_heart": "\U0001f494",
    "two_hearts": "\U0001f495",
    "sparkles": "\u2728",
    "dizzy": "\U0001f4ab",
    "boom": "\U0001f4a5",
    "anger": "\U0001f4a2",
    "question": "\u2753",
    "grey_exclamation": "\u2755",
    "exclamation": "\u2757",
    "heavy_plus_sign": "\u2795",
    "heavy_minus_sign": "\u2796",
    "heavy_division_sign": "\u2797",
}


def _hex_to_unicode(hex_str: str) -> str:
    """Convert hex like '1f44d' or '1f1e6-1f1eb' to Unicode character(s)."""
    parts = hex_str.split("-")
    return "".join(chr(int(p, 16)) for p in parts)


def _build_emoji_map() -> dict[str, str]:
    """Build shortcode (no colons) -> unicode character mapping.
    Uses pymdownx.gemoji_db if available, otherwise FALLBACK_EMOJI_MAP.
    """
    try:
        import pymdownx.gemoji_db as gemoji_db
    except ImportError:
        return FALLBACK_EMOJI_MAP.copy()

    emoji_map = {}

    # Canonical emoji from gemoji_db.emoji
    for shortcode_with_colons, data in gemoji_db.emoji.items():
        shortcode = shortcode_with_colons.strip(":")
        hex_unicode = data.get("unicode", "")
        if hex_unicode:
            emoji_map[shortcode] = _hex_to_unicode(hex_unicode)

    # Aliases: map alias shortcode to same unicode as canonical
    for alias_with_colons, canonical_with_colons in gemoji_db.aliases.items():
        alias = alias_with_colons.strip(":")
        canonical = canonical_with_colons.strip(":")
        if canonical in emoji_map:
            emoji_map[alias] = emoji_map[canonical]

    return emoji_map


class LiveWysiwygPlugin(BasePlugin):
    """
    WYSIWYG editor plugin that enhances mkdocs-live-edit-plugin with
    a rich visual editor based on @celsowm/markdown-wysiwyg.
    """

    config_scheme = (
        ("autoload_wysiwyg", config_options.Type(bool, default=True)),
        ("user_docs_dir", config_options.Type(str, default="")),
    )

    is_serving: bool = False

    def on_startup(
        self, *, command: Literal["build", "gh-deploy", "serve"], dirty: bool
    ) -> None:
        self.is_serving = command == "serve"
        self._link_check_port = None
        self._link_check_server = None
        self._link_index: dict = {}
        self._build_epoch: list[int] = [1]
        tmpdir = os.environ.get("TMPDIR", "")
        original = Path(tmpdir) / "original-mkdocs.yml" if tmpdir else None
        self._original_mkdocs_yml = (
            str(original) if original and original.is_file() else None
        )

    def on_config(self, config: MkDocsConfig, **_) -> MkDocsConfig | None:
        if not self.is_serving:
            return config
        if self._link_check_server is not None:
            return config

        from .link_check_server import start_link_check_server

        dev_addr = config.get("dev_addr")
        host = dev_addr.host if dev_addr else "127.0.0.1"
        docs_dir = str(config["docs_dir"])
        walk_dir = self._resolve_docs_dir(config, docs_dir)
        server, port = start_link_check_server(
            host, docs_dir, self._link_index, walk_dir=walk_dir,
            build_epoch=self._build_epoch,
        )
        self._link_check_server = server
        self._link_check_port = port
        return config

    def _resolve_docs_dir(self, config: MkDocsConfig, default: str) -> str:
        """Return the real docs directory for filesystem walks.

        Resolution order:
        1. This plugin's ``user_docs_dir`` option.
        2. The upstream ``mkdocs-live-edit-plugin``'s ``user_docs_dir``.
        3. The MkDocs ``docs_dir`` config (*default*).

        The monorepo plugin (used by techdocs-core) replaces ``docs_dir``
        with a temporary directory, so the MkDocs value cannot be relied on.
        ``user_docs_dir`` points to the real source tree where the
        WebSocket server reads and writes files.
        """
        own = self.config.get("user_docs_dir", "")
        if own:
            return str(Path(own).resolve())
        plugins = config.get("plugins", {})
        live_edit = plugins.get("live-edit") if plugins else None
        if live_edit is not None:
            upstream = getattr(live_edit, "config", {}).get("user_docs_dir")
            if upstream:
                return str(Path(upstream).resolve())
        return default

    @staticmethod
    def _title_from_src_path(src_path: str) -> str:
        """Derive a human-readable title from a source file path."""
        p = Path(src_path)
        name = p.stem
        if name == "index":
            name = p.parent.name or "Home"
        return name.replace("-", " ").replace("_", " ").title()

    def _collect_nav_tree(self, items, *, title_cache=None) -> list:
        """Walk nav items recursively, producing a JSON-serializable tree.

        *title_cache* (dict mapping src_path → title) is used to fill in
        titles that MkDocs hasn't resolved yet (pages processed after the
        current one during a sequential build).
        """
        if title_cache is None:
            title_cache = {}
        result = []
        for item in items:
            if isinstance(item, Section):
                index_page = None
                for child in item.children:
                    if (
                        hasattr(child, "file")
                        and child.file.src_path.endswith("index.md")
                    ):
                        index_page = child
                        break
                node = {
                    "type": "section",
                    "title": item.title or "",
                    "children": self._collect_nav_tree(
                        item.children, title_cache=title_cache
                    ),
                    "src_path": (
                        index_page.file.src_path if index_page else None
                    ),
                    "index_meta": (
                        {
                            "weight": index_page.meta.get("weight"),
                            "headless": index_page.meta.get("headless"),
                            "retitled": index_page.meta.get("retitled"),
                            "empty": index_page.meta.get("empty"),
                        }
                        if index_page
                        else None
                    ),
                }
                result.append(node)
            elif hasattr(item, "file"):
                src = item.file.src_path
                title = (
                    item.title
                    or title_cache.get(src)
                    or self._title_from_src_path(src)
                )
                node = {
                    "type": "page",
                    "title": title,
                    "url": item.url,
                    "src_path": src,
                    "isIndex": src.endswith("index.md"),
                    "weight": item.meta.get("weight"),
                    "headless": item.meta.get("headless"),
                    "retitled": item.meta.get("retitled"),
                    "empty": item.meta.get("empty"),
                }
                result.append(node)
        return result

    def on_nav(
        self, nav: Navigation, /, *, config: MkDocsConfig, files, **_
    ) -> Navigation | None:
        if not self.is_serving:
            return nav

        self._build_epoch[0] += 1
        self._nav_title_cache = getattr(self, "_nav_title_cache", {})

        self._nav_ref = nav
        self._nav_data = self._collect_nav_tree(nav.items)
        self._nav_pages_flat = [
            {
                "url": p.url,
                "title": p.title or "",
                "src_path": p.file.src_path,
                "isIndex": p.file.src_path.endswith("index.md"),
                "weight": p.meta.get("weight"),
                "headless": p.meta.get("headless"),
                "retitled": p.meta.get("retitled"),
                "empty": p.meta.get("empty"),
            }
            for p in nav.pages
        ]

        self._all_md_src_paths = [
            f.src_path for f in files if f.src_path.endswith(".md")
        ]

        try:
            from importlib.metadata import distribution

            distribution("mkdocs-nav-weight")
            _nw_installed = True
        except Exception:
            _nw_installed = False

        nav_weight_plugin = config["plugins"].get("mkdocs-nav-weight")
        if nav_weight_plugin:
            nw_cfg = nav_weight_plugin.config
            self._nw_config = {
                "enabled": True,
                "installed": True,
                "section_renamed": nw_cfg.get("section_renamed", False),
                "index_weight": nw_cfg.get("index_weight", -10),
                "warning": nw_cfg.get("warning", True),
                "reverse": nw_cfg.get("reverse", False),
                "headless_included": nw_cfg.get(
                    "headless_included", False
                ),
                "default_page_weight": nw_cfg.get(
                    "default_page_weight", 0
                ),
                "frontmatter_defaults": {
                    "weight": nw_cfg.get("default_page_weight", 0),
                    "index_weight": nw_cfg.get("index_weight", -10),
                    "headless": False,
                    "retitled": False,
                    "empty": False,
                },
            }
        else:
            self._nw_config = {
                "enabled": False,
                "installed": _nw_installed,
            }

        return nav

    def on_page_markdown(
        self, markdown: str, /, *, page, config, files, **_
    ) -> str | None:
        if not self.is_serving:
            return markdown

        src = page.file.src_path

        if page.title:
            if not hasattr(self, "_nav_title_cache"):
                self._nav_title_cache = {}
            self._nav_title_cache[src] = page.title

        from .link_check_server import _extract_refs

        self._link_index[src] = _extract_refs(markdown)
        return markdown

    def on_page_content(
        self,
        html: str,
        /,
        *,
        page,
        config: MkDocsConfig,
        files,
        **_
    ) -> str | None:
        """Injects the WYSIWYG editor assets and integration script into the page."""
        if not self.is_serving:
            return html

        parent_dir = Path(__file__).parent
        vendor_dir = parent_dir / "vendor"
        integration_js = parent_dir / "live-wysiwyg-integration.js"
        admonition_extension_js = parent_dir / "mkdocs-admonition-extension.js"
        with open(integration_js, "r", encoding="utf-8") as f:
            integration_script = f.read()
        with open(admonition_extension_js, "r", encoding="utf-8") as f:
            admonition_extension_script = f.read()

        autoload_wysiwyg = self.config.get("autoload_wysiwyg")
        preamble_parts = []
        preamble_parts.append(
            f"const liveWysiwygAutoload = {str(autoload_wysiwyg).lower()};\n"
        )
        wysiwyg_svg_path = parent_dir / "wysiwyg.svg"
        if wysiwyg_svg_path.exists():
            with open(wysiwyg_svg_path, "rb") as f:
                wysiwyg_svg_b64 = base64.b64encode(f.read()).decode("ascii")
            preamble_parts.append(
                f"const liveWysiwygIconDataUrl = 'data:image/svg+xml;base64,{wysiwyg_svg_b64}';\n"
            )
        else:
            preamble_parts.append("const liveWysiwygIconDataUrl = null;\n")

        # Build and inject emoji map (cached on plugin instance)
        if not hasattr(self, "_emoji_map_cache"):
            self._emoji_map_cache = _build_emoji_map()
        emoji_map = self._emoji_map_cache
        preamble_parts.append(
            f"const liveWysiwygEmojiMap = {json.dumps(emoji_map, ensure_ascii=True)};\n"
        )

        # Build and inject image list for autocomplete (cached on plugin instance)
        if not hasattr(self, "_image_list_cache"):
            image_exts = {
                ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
                ".ico", ".bmp", ".tiff", ".tif", ".avif", ".apng",
                ".jfif", ".pjpeg", ".pjp", ".cur",
            }
            self._image_list_cache = sorted(
                f.src_path
                for f in files
                if Path(f.src_path).suffix.lower() in image_exts
            )
        preamble_parts.append(
            f"const liveWysiwygImageList = {json.dumps(self._image_list_cache)};\n"
        )
        preamble_parts.append(
            f"const liveWysiwygPageSrcPath = {json.dumps(page.file.src_path)};\n"
        )

        nav_ref = getattr(self, "_nav_ref", None)
        title_cache = getattr(self, "_nav_title_cache", {})
        nav_data = (
            self._collect_nav_tree(nav_ref.items, title_cache=title_cache)
            if nav_ref
            else []
        )
        nw_config = getattr(self, "_nw_config", {"enabled": False})
        all_md_src_paths = getattr(self, "_all_md_src_paths", [])
        link_index = getattr(self, "_link_index", {})
        preamble_parts.append(
            f"const liveWysiwygNavData = {json.dumps(nav_data)};\n"
        )
        preamble_parts.append(
            f"const liveWysiwygNavWeightConfig = {json.dumps(nw_config)};\n"
        )
        preamble_parts.append(
            f"const liveWysiwygAllMdSrcPaths = {json.dumps(all_md_src_paths)};\n"
        )
        preamble_parts.append(
            f"const liveWysiwygLinkIndex = {json.dumps(link_index)};\n"
        )
        fm_map = {}
        if nav_ref:
            for p in nav_ref.pages:
                fm_map[p.file.src_path] = dict(p.meta) if p.meta else {}
        preamble_parts.append(
            f"const liveWysiwygFrontmatterMap = {json.dumps(fm_map)};\n"
        )
        preamble_parts.append(
            f"const liveWysiwygOriginalMkdocsYml = {json.dumps(self._original_mkdocs_yml)};\n"
        )
        link_check_port = getattr(self, "_link_check_port", None)
        preamble_parts.append(
            f"const liveWysiwygLinkCheckPort = {json.dumps(link_check_port)};\n"
        )

        preamble = "".join(preamble_parts)

        admonition_css = parent_dir / "admonition.css"
        with open(admonition_css, "r", encoding="utf-8") as f:
            admonition_css_content = f.read()

        with open(vendor_dir / "editor.css", "r", encoding="utf-8") as f:
            editor_css_content = f.read()
        with open(vendor_dir / "marked.min.js", "r", encoding="utf-8") as f:
            marked_js_content = f.read()
        with open(vendor_dir / "editor.js", "r", encoding="utf-8") as f:
            editor_js_content = f.read()

        live_edit_theme_css = (
            '.live-edit-source{'
              'font-family:var(--md-code-font-family,monospace)!important;'
              'color:var(--md-default-fg-color,#333)!important;'
              'background:var(--md-default-bg-color,#fff)!important;'
              'border-color:var(--md-default-fg-color--lightest,#ccc)!important;'
            '}'
            'button.live-edit-button{'
              'background:rgba(255,255,255,0.12)!important;'
              'border:1px solid rgba(255,255,255,0.2)!important;'
              'color:var(--md-primary-bg-color,#fff)!important;'
              'transition:background .2s;'
            '}'
            'button.live-edit-button:hover{'
              'background:rgba(255,255,255,0.25)!important;'
            '}'
            'button.live-edit-save-button{'
              'background:#5cb85c!important;border-color:#4cae4c!important;color:#fff!important;'
            '}'
            'button.live-edit-save-button:hover{'
              'background:#4cae4c!important;'
            '}'
            'button.live-edit-cancel-button{'
              'background:#d9534f!important;border-color:#d43f3a!important;color:#fff!important;'
            '}'
            'button.live-edit-cancel-button:hover{'
              'background:#d43f3a!important;'
            '}'
            'div.live-edit-controls{'
              'background:linear-gradient(to bottom,var(--md-primary-fg-color,#fff2dc),var(--md-footer-bg-color,#f0c36d))!important;'
              'border-color:var(--md-primary-fg-color--dark,#f0c36d)!important;'
              'color:var(--md-primary-bg-color,inherit)!important;'
            '}'
            '.live-edit-label{'
              'color:var(--md-primary-bg-color,inherit)!important;'
            '}'
            '.live-edit-info-modal{'
              'background-color:var(--md-default-bg-color--light,#fff2dc)!important;'
              'border-color:var(--md-default-fg-color--lightest,#f0c36d)!important;'
            '}'
        )

        early_inject_script = (
            '(function(){'
            'try{var st=JSON.parse(localStorage.getItem("liveWysiwygSettings")||"{}");'
            'if(st.live_wysiwyg_focus_nav!=="1")return;}catch(e){return;}'
            'var o=document.createElement("div");'
            'o.className="live-wysiwyg-early-overlay";'
            'o.style.cssText="position:fixed;inset:0;z-index:99989;'
            'background:rgba(0,0,0,1);'
            'display:flex;align-items:center;justify-content:center;'
            'flex-direction:column;gap:12px;transition:opacity .6s ease-out;";'
            'var s=document.createElement("div");'
            's.style.cssText="width:24px;height:24px;border:3px solid rgba(255,255,255,.25);'
            'border-top-color:rgba(255,255,255,.75);border-radius:50%;'
            'animation:live-wysiwyg-spin 1s linear infinite;";'
            'var t=document.createElement("div");'
            't.style.cssText="font-size:.85rem;color:rgba(255,255,255,.8);'
            'text-shadow:0 1px 3px rgba(0,0,0,.5);";'
            't.textContent="Establishing connection...";'
            'o.appendChild(s);o.appendChild(t);'
            'document.documentElement.appendChild(o);'
            'window.__liveWysiwygEarlyOverlay=o;'
            '})();'
        )

        # Inject: early overlay (before anything else), theme overrides,
        # marked.js, MkDocs admonition extension, editor CSS, admonition CSS,
        # editor JS, integration script (all local)
        assets = (
            f'<script>{early_inject_script}</script>'
            f'<style id="live-wysiwyg-theme-overrides">{live_edit_theme_css}</style>'
            f'<style>{editor_css_content}</style>'
            f'<style>{admonition_css_content}</style>'
            f'<script>{marked_js_content}</script>'
            f'<script>{admonition_extension_script}</script>'
            f'<script>{editor_js_content}</script>'
            f'<script>{preamble}\n{integration_script}</script>'
        )
        return f"{assets}\n{html}"

    def on_post_build(self, *, config, **_) -> None:
        """Snapshot all resolved page titles after the full build.

        ``_nav_title_cache`` maps ``src_path`` → title and persists across
        rebuilds.  On the *next* rebuild, ``_collect_nav_tree`` uses the
        cache to fill in titles for pages that haven't been processed yet
        (MkDocs processes pages sequentially, so unprocessed pages have
        empty titles at the time ``on_page_content`` runs for earlier pages).
        """
        if not self.is_serving:
            return
        nav_ref = getattr(self, "_nav_ref", None)
        if not nav_ref:
            return
        cache = getattr(self, "_nav_title_cache", {})
        for page in nav_ref.pages:
            if page.title:
                cache[page.file.src_path] = page.title
        self._nav_title_cache = cache
