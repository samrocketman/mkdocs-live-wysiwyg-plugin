---
title: Example WYSIWYG site
---
# Welcome

This is a test page for the mkdocs-live-wysiwyg-plugin.

```yaml title="Preview Example"
build: techdocs-preview.sh build # (1)
preview: techdocs-preview.sh # (2)
```

1. Build the `site`.
2. Launch a server on `http://127.0.0.1:8000/`.

Click **Edit** above to try the WYSIWYG editor.

## Checklist Support

The WYSIWYG editor supports markdown checklists (task lists). In Markdown mode, use:

- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked item

In WYSIWYG mode, click a checkbox to toggle it. Press Enter in a checklist item to create a new empty checklist item (`- [ ]`).

## Admonition Support

The WYSIWYG editor supports MkDocs admonitions. In Markdown mode, use:

!!! note
    This is a note admonition.

Another

!!! warning "Custom Title"
    Admonitions with custom titles work too.

This shows you what it's like to be awesome!

# Test

!!! danger "Danger"
    This is a note common in mkdocs.
