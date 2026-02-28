/**
 * Integration script: replaces the live-edit textarea with MarkdownWYSIWYG editor.
 * Runs after mkdocs-live-edit-plugin. Uses MutationObserver to detect when
 * the .live-edit-source textarea appears, then replaces it with the WYSIWYG editor.
 * Patches the editor to support MkDocs admonitions (!!! note) in HTML mode.
 */
(function () {
  if (typeof MarkdownWYSIWYG === 'undefined') {
    console.warn('live-wysiwyg: MarkdownWYSIWYG not loaded, falling back to plain textarea');
    return;
  }

  (function patchAdmonitionHtmlToMarkdown() {
    var proto = MarkdownWYSIWYG.prototype;
    var orig = proto._nodeToMarkdownRecursive;
    if (!orig) return;
    proto._nodeToMarkdownRecursive = function (node, options) {
      if (node.nodeName === 'DIV' && node.classList && node.classList.contains('admonition')) {
        var type = null;
        var types = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention'];
        for (var i = 0; i < types.length; i++) {
          if (node.classList.contains(types[i])) {
            type = types[i];
            break;
          }
        }
        if (type) {
          var titleEl = node.querySelector('.admonition-title');
          var title = titleEl ? titleEl.textContent.trim() : '';
          var contentParts = [];
          for (var j = 0; j < node.childNodes.length; j++) {
            var c = node.childNodes[j];
            if (c.nodeType !== 1 || c === titleEl) continue;
            contentParts.push(orig.call(this, c, options || {}));
          }
          var body = contentParts.join('').trim();
          var bodyIndented = body ? body.split('\n').map(function (l) { return '    ' + l; }).join('\n') : '';
          var out = '!!! ' + type;
          if (title) out += ' "' + title.replace(/"/g, '\\"') + '"';
          out += '\n' + (bodyIndented ? bodyIndented + '\n' : '');
          return out + '\n';
        }
      }
      return orig.apply(this, arguments);
    };
  })();

  let wysiwygEditor = null;
  let wysiwygContainer = null;
  let cancelObserver = null;

  function destroyWysiwyg(textarea) {
    if (cancelObserver) {
      cancelObserver.disconnect();
      cancelObserver = null;
    }
    if (wysiwygEditor) {
      try {
        wysiwygEditor.destroy();
      } catch (e) {
        console.warn('live-wysiwyg: error destroying editor', e);
      }
      wysiwygEditor = null;
    }
    if (wysiwygContainer && wysiwygContainer.parentNode) {
      wysiwygContainer.parentNode.removeChild(wysiwygContainer);
      wysiwygContainer = null;
    }
    if (textarea) {
      textarea.style.display = '';
      textarea.removeAttribute('data-live-wysiwyg-replaced');
      setupReplacementObserver(textarea);
    }
  }

  function setupReplacementObserver(textarea) {
    if (!textarea || !textarea.parentNode) return;
    if (cancelObserver) cancelObserver.disconnect();
    cancelObserver = new MutationObserver(function () {
      if (!textarea.parentNode) return;
      if (!textarea.classList.contains('live-edit-hidden') && !textarea.dataset.liveWysiwygReplaced) {
        cancelObserver.disconnect();
        cancelObserver = null;
        replaceTextareaWithWysiwyg(textarea);
      }
    });
    cancelObserver.observe(textarea, { attributes: true, attributeFilter: ['class'] });
  }

  function replaceTextareaWithWysiwyg(textarea) {
    if (textarea.dataset.liveWysiwygReplaced) return;
    textarea.dataset.liveWysiwygReplaced = 'true';

    if (cancelObserver) {
      cancelObserver.disconnect();
      cancelObserver = null;
    }

    const initialValue = textarea.value || '';

    wysiwygContainer = document.createElement('div');
    wysiwygContainer.id = 'live-edit-wysiwyg-container';
    wysiwygContainer.className = 'live-edit-wysiwyg-wrapper';
    wysiwygContainer.style.cssText = 'width: 100%; min-height: 50vh; margin: 5px;';

    textarea.parentNode.insertBefore(wysiwygContainer, textarea);
    textarea.style.display = 'none';

    try {
      wysiwygEditor = new MarkdownWYSIWYG('live-edit-wysiwyg-container', {
        initialValue: initialValue,
        initialMode: 'wysiwyg',
        showToolbar: true,
        onUpdate: function (markdownContent) {
          textarea.value = markdownContent;
        },
      });
    } catch (e) {
      console.error('live-wysiwyg: failed to init editor', e);
      textarea.style.display = '';
      if (wysiwygContainer && wysiwygContainer.parentNode) {
        wysiwygContainer.parentNode.removeChild(wysiwygContainer);
      }
      wysiwygEditor = null;
      wysiwygContainer = null;
      textarea.removeAttribute('data-live-wysiwyg-replaced');
      return;
    }

    const observer = new MutationObserver(function () {
      if (!textarea.parentNode) return;
      if (textarea.classList.contains('live-edit-hidden')) {
        observer.disconnect();
        destroyWysiwyg(textarea);
      }
    });
    observer.observe(textarea, { attributes: true, attributeFilter: ['class'] });
  }

  function observeForTextarea() {
    const textarea = document.querySelector('.live-edit-source');
    if (textarea) {
      replaceTextareaWithWysiwyg(textarea);
      return true;
    }
    return false;
  }

  const observer = new MutationObserver(function () {
    if (observeForTextarea()) {
      observer.disconnect();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!observeForTextarea()) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  } else {
    if (!observeForTextarea()) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
})();
