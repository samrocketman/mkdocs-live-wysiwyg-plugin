"""mkdocs-live-wysiwyg-plugin

WYSIWYG editor for mkdocs-live-edit-plugin based on @celsowm/markdown-wysiwyg.
"""

import base64
import json
from pathlib import Path
from typing import Literal

from mkdocs.config import config_options
from mkdocs.config.defaults import MkDocsConfig
from mkdocs.plugins import BasePlugin

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
    )

    is_serving: bool = False

    def on_startup(
        self, *, command: Literal["build", "gh-deploy", "serve"], dirty: bool
    ) -> None:
        self.is_serving = command == "serve"

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

        # Inject: theme overrides (first, before upstream CSS can paint),
        # marked.js, MkDocs admonition extension, editor CSS, admonition CSS,
        # editor JS, integration script (all local)
        assets = (
            f'<style id="live-wysiwyg-theme-overrides">{live_edit_theme_css}</style>'
            f'<style>{editor_css_content}</style>'
            f'<style>{admonition_css_content}</style>'
            f'<script>{marked_js_content}</script>'
            f'<script>{admonition_extension_script}</script>'
            f'<script>{editor_js_content}</script>'
            f'<script>{preamble}\n{integration_script}</script>'
        )
        return f"{assets}\n{html}"
