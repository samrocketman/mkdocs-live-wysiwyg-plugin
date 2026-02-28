/**
 * MkDocs admonition extension for marked.js.
 * Renders !!! type "title" syntax as MkDocs-compatible admonition HTML.
 * Must be called after marked loads and before MarkdownWYSIWYG is used.
 */
(function () {
  if (typeof marked === 'undefined') return;

  var ADMONITION_TYPES = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention'];
  var ADMONITION_TITLES = {
    note: 'Note',
    warning: 'Warning',
    danger: 'Danger',
    tip: 'Tip',
    hint: 'Hint',
    important: 'Important',
    caution: 'Caution',
    error: 'Error',
    attention: 'Attention'
  };

  marked.use({
    extensions: [{
      name: 'mkdocsAdmonition',
      level: 'block',
      start: function (src) {
        var idx = src.indexOf('!!!');
        return idx >= 0 ? idx : undefined;
      },
      tokenizer: function (src) {
        var match = src.match(/^!!!\s+(\w+)(?:\s+"([^"]*)")?\s*\n((?:    .*\n?)*)/);
        if (!match) return;
        var type = match[1].toLowerCase();
        var title = match[2];
        var content = (match[3] || '').replace(/^    /gm, '');
        return {
          type: 'mkdocsAdmonition',
          raw: match[0],
          admonitionType: type,
          admonitionTitle: title,
          admonitionContent: content,
          tokens: []
        };
      },
      renderer: function (token) {
        var type = token.admonitionType;
        var title = token.admonitionTitle;
        var content = token.admonitionContent;
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
        var titleHtml = '';
        if (displayTitle) {
          titleHtml = '<p class="admonition-title">' + displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
        }
        return '<div class="admonition ' + type + '">\n' + titleHtml + contentHtml + '\n</div>\n\n';
      }
    }]
  });
})();
