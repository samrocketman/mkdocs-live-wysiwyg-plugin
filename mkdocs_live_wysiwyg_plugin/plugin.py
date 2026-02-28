"""mkdocs-live-wysiwyg-plugin

WYSIWYG editor for mkdocs-live-edit-plugin based on @celsowm/markdown-wysiwyg.
"""

from pathlib import Path
from typing import Literal

from mkdocs.config import config_options
from mkdocs.config.defaults import MkDocsConfig
from mkdocs.plugins import BasePlugin

# CDN URLs for @celsowm/markdown-wysiwyg and its dependency (marked.js)
MARKED_JS_URL = "https://cdn.jsdelivr.net/npm/marked/marked.min.js"
EDITOR_CSS_URL = "https://cdn.jsdelivr.net/gh/celsowm/markdown-wysiwyg@latest/dist/editor.css"
EDITOR_JS_URL = "https://cdn.jsdelivr.net/gh/celsowm/markdown-wysiwyg@latest/dist/editor.js"


class LiveWysiwygPlugin(BasePlugin):
    """
    WYSIWYG editor plugin that enhances mkdocs-live-edit-plugin with
    a rich visual editor based on @celsowm/markdown-wysiwyg.
    """

    config_scheme = (
        ("article_selector", config_options.Type(str, default=None)),
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
        integration_js = parent_dir / "live-wysiwyg-integration.js"
        admonition_extension_js = parent_dir / "mkdocs-admonition-extension.js"
        with open(integration_js, "r", encoding="utf-8") as f:
            integration_script = f.read()
        with open(admonition_extension_js, "r", encoding="utf-8") as f:
            admonition_extension_script = f.read()

        article_selector = self.config.get("article_selector")
        if article_selector:
            preamble = f"const liveWysiwygArticleSelector = '{article_selector}';\n"
        else:
            preamble = "const liveWysiwygArticleSelector = null;\n"

        admonition_css = parent_dir / "admonition.css"
        with open(admonition_css, "r", encoding="utf-8") as f:
            admonition_css_content = f.read()

        # Inject: marked.js, MkDocs admonition extension, editor CSS, admonition CSS, editor JS, integration script
        assets = (
            f'<link rel="stylesheet" href="{EDITOR_CSS_URL}">'
            f'<style>{admonition_css_content}</style>'
            f'<script src="{MARKED_JS_URL}"></script>'
            f'<script>{admonition_extension_script}</script>'
            f'<script src="{EDITOR_JS_URL}"></script>'
            f'<script>{preamble}\n{integration_script}</script>'
        )
        return f"{assets}\n{html}"
