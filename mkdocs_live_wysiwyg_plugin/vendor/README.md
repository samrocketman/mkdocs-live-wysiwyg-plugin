# Vendor dependencies

Third-party JavaScript and CSS bundled locally so the WYSIWYG editor does not rely on external CDNs.

| File | Source | Version | License |
|------|--------|---------|---------|
| `marked.min.js` | [marked](https://github.com/markedjs/marked) (Christopher Jeffrey, MarkedJS) | v14.1.4 | MIT — see [LICENSE.marked](LICENSE.marked) |
| `editor.css` | [@celsowm/markdown-wysiwyg](https://github.com/celsowm/markdown-wysiwyg) (Celso Fontes) | latest | MIT — see [LICENSE.editor](LICENSE.editor) |
| `editor.js` | [@celsowm/markdown-wysiwyg](https://github.com/celsowm/markdown-wysiwyg) (Celso Fontes) | latest | MIT — see [LICENSE.editor](LICENSE.editor) |
| `js-yaml.min.js` | [js-yaml](https://github.com/nodeca/js-yaml) (Vitaly Puzrin) | v4.1.1 | MIT — see [LICENSE.js-yaml](LICENSE.js-yaml) |
| `mermaid.min.js` | [mermaid](https://github.com/mermaid-js/mermaid) (Knut Sveidqvist) | v11.4.1 | MIT — see [LICENSE.mermaid](LICENSE.mermaid) |
| `mermaid-live-editor/` | [mermaid-live-editor](https://github.com/mermaid-js/mermaid-live-editor) (Knut Sveidqvist) | develop (SvelteKit build) | MIT — see [LICENSE.mermaid-live-editor](LICENSE.mermaid-live-editor) |

All dependencies are MIT licensed. Full license text is included in this directory. Transitive dependency licenses for the mermaid-live-editor build are listed in [NOTICES.mermaid-live-editor](NOTICES.mermaid-live-editor). See the main [README](../README.md) for full attributions.

For upgrade procedures, see [DESIGN-vendor-subsystem.md](../../docs/design/mermaid/DESIGN-vendor-subsystem.md) or run `scripts/vendor-mermaid.sh`.
