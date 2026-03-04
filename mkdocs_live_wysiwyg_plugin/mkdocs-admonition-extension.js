/**
 * MkDocs admonition extension for marked.js.
 * Renders !!!/???/???+ type syntax as MkDocs-compatible admonition HTML.
 * Supports collapsible (details/summary), inline placement, and empty titles.
 * Must be called after marked loads and before MarkdownWYSIWYG is used.
 */
(function () {
  if (typeof marked === 'undefined') return;

  var ADMONITION_TYPES = [
    'note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution',
    'error', 'attention', 'abstract', 'info', 'success', 'question',
    'failure', 'bug', 'example', 'quote'
  ];
  var ADMONITION_TITLES = {};
  for (var i = 0; i < ADMONITION_TYPES.length; i++) {
    var t = ADMONITION_TYPES[i];
    ADMONITION_TITLES[t] = t.charAt(0).toUpperCase() + t.slice(1);
  }

  var ADMONITION_RE = /^(\?\?\?\+|\?\?\?|!!!)\s+(\w+)(?:\s+(inline(?:\s+end)?))?(?:\s+"([^"]*)")?\s*\n((?:(?:    .*|[ \t]*)(?:\n|$))*)/;

  marked.use({
    extensions: [{
      name: 'mkdocsAdmonition',
      level: 'block',
      start: function (src) {
        var m = src.match(/(?:^|\n)(!!!|\?\?\?\+|\?\?\?)\s/);
        return m ? m.index + (src[m.index] === '\n' ? 1 : 0) : undefined;
      },
      tokenizer: function (src) {
        var match = src.match(ADMONITION_RE);
        if (!match) return;
        var prefix = match[1];
        var type = match[2].toLowerCase();
        var modifiers = match[3] || '';
        var title = match[4];
        var content = (match[5] || '').replace(/^    /gm, '');
        return {
          type: 'mkdocsAdmonition',
          raw: match[0],
          admonitionPrefix: prefix,
          admonitionType: type,
          admonitionModifiers: modifiers.trim(),
          admonitionTitle: title,
          admonitionContent: content,
          tokens: []
        };
      },
      renderer: function (token) {
        var prefix = token.admonitionPrefix;
        var type = token.admonitionType;
        var mods = token.admonitionModifiers;
        var title = token.admonitionTitle;
        var content = token.admonitionContent;
        var isCollapsible = (prefix === '???' || prefix === '???+');
        var isExpanded = (prefix === '???+');
        var hideTitle = (title === '');

        var displayTitle = title !== undefined
          ? (title === '' ? '' : title)
          : (ADMONITION_TITLES[type] || type.charAt(0).toUpperCase() + type.slice(1));

        var contentHtml = '';
        if (content && content.trim()) {
          try {
            contentHtml = marked.parse(content.trim());
          } catch (e) {
            contentHtml = '<p>' + content.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
          }
        }

        var classes = type;
        if (mods) classes += ' ' + mods;

        if (isCollapsible) {
          var attrs = ' class="' + classes + '" open';
          if (!isExpanded) attrs += ' data-default-collapsed="1"';
          var summaryHtml = displayTitle
            ? '<summary>' + displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</summary>'
            : '<summary></summary>';
          return '<details' + attrs + '>\n' + summaryHtml + contentHtml + '\n</details>\n\n';
        }

        var divAttrs = ' class="admonition ' + classes + '"';
        if (hideTitle) divAttrs += ' data-hide-title="1"';
        var titleHtml = '';
        if (displayTitle) {
          titleHtml = '<p class="admonition-title">' + displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
        }
        return '<div' + divAttrs + '>\n' + titleHtml + contentHtml + '\n</div>\n\n';
      }
    }]
  });
})();
