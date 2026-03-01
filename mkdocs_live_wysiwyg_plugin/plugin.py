"""mkdocs-live-wysiwyg-plugin

WYSIWYG editor for mkdocs-live-edit-plugin based on @celsowm/markdown-wysiwyg.
"""

import base64
from pathlib import Path
from typing import Literal

from mkdocs.config import config_options
from mkdocs.config.defaults import MkDocsConfig
from mkdocs.plugins import BasePlugin

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

        # Inject: marked.js, MkDocs admonition extension, editor CSS, admonition CSS, editor JS, integration script (all local)
        assets = (
            f'<style>{editor_css_content}</style>'
            f'<style>{admonition_css_content}</style>'
            f'<script>{marked_js_content}</script>'
            f'<script>{admonition_extension_script}</script>'
            f'<script>{editor_js_content}</script>'
            f'<script>{preamble}\n{integration_script}</script>'
        )
        return f"{assets}\n{html}"
