/**
 * Integration script: replaces the live-edit textarea with MarkdownWYSIWYG editor.
 * Runs after mkdocs-live-edit-plugin. Uses MutationObserver to detect when
 * the .live-edit-source textarea appears, then replaces it with the WYSIWYG editor.
 * Patches the editor to support MkDocs admonitions (!!! note) in HTML mode.
 * Patches PRE/code block handling to prevent text loss when contenteditable
 * splits blocks (e.g. DIV children) during editing before switching to markdown mode.
 * Patches _htmlToMarkdown to preserve extra newlines inside code blocks when collapsing
 * multiple blank lines in the final output.
 * Patches text node handling to preserve multiple spaces (e.g. "Foo.  Bar", leading spaces).
 * Uses a preprocessor/postprocessor to preserve all markdown link styles (inline, reference,
 * shortcut) exactly as the original author intended when loading, saving, and switching modes.
 * Preserves unordered list markers (*, -, +) when content is unchanged; new/modified lists use '-'.
 */
(function () {
  if (typeof MarkdownWYSIWYG === 'undefined') {
    console.warn('live-wysiwyg: MarkdownWYSIWYG not loaded, falling back to plain textarea');
    return;
  }

  (function registerCodeBlockRenderer() {
    if (typeof marked === 'undefined') return;
    function parseInfoString(info) {
      var result = { lang: '', attrs: {} };
      if (!info) return result;
      info = info.trim();
      var langMatch = info.match(/^(\S+)/);
      if (langMatch) result.lang = langMatch[1];
      var attrRe = /(\w+)="([^"]*)"/g;
      var m;
      while ((m = attrRe.exec(info)) !== null) {
        result.attrs[m[1]] = m[2];
      }
      if (result.lang && result.lang.indexOf('=') !== -1) result.lang = '';
      return result;
    }
    marked.use({
      renderer: {
        code: function (token) {
          var info = parseInfoString(token.lang);
          var lang = info.lang;
          var escaped = (token.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          var attrs = '';
          if (lang) attrs += ' data-lang="' + lang + '"';
          if (info.attrs.title) attrs += ' data-title="' + info.attrs.title.replace(/"/g, '&quot;') + '"';
          if (info.attrs.linenums) attrs += ' data-linenums="' + info.attrs.linenums + '"';
          if (info.attrs.hl_lines) attrs += ' data-hl-lines="' + info.attrs.hl_lines + '"';
          var codeClass = lang ? ' class="language-' + lang + '"' : '';
          return '<pre' + attrs + '><code' + codeClass + '>' + escaped + '</code></pre>\n';
        }
      }
    });
  })();

  function enhanceCodeBlocks(editableArea) {
    if (!editableArea) return;
    var pres = editableArea.querySelectorAll('pre[data-title], pre[data-linenums], pre[data-lang]');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('md-code-block')) continue;
      var wrapper = document.createElement('div');
      wrapper.className = 'md-code-block';
      var title = pre.getAttribute('data-title');
      var lang = pre.getAttribute('data-lang') || '';
      var headerBar = document.createElement('div');
      wrapper.appendChild(headerBar);
      (function (bar, preEl, langName) {
        function setupAsTitle(text) {
          bar.className = 'md-code-title';
          bar.setAttribute('contenteditable', 'true');
          bar.removeAttribute('data-placeholder');
          bar.textContent = text;
          preEl.setAttribute('data-title', text);
        }
        function setupAsLang() {
          bar.className = 'md-code-lang';
          bar.setAttribute('contenteditable', 'false');
          bar.removeAttribute('data-placeholder');
          bar.textContent = langName;
          preEl.removeAttribute('data-title');
        }
        var outsideClickHandler = null;
        function revertIfEmpty() {
          if (bar.classList.contains('md-code-title') && !bar.textContent.trim()) {
            if (langName) {
              setupAsLang();
            } else {
              bar.setAttribute('data-placeholder', 'Enter title...');
              preEl.removeAttribute('data-title');
            }
          }
          removeOutsideClickHandler();
        }
        function removeOutsideClickHandler() {
          if (outsideClickHandler) {
            document.removeEventListener('mousedown', outsideClickHandler, true);
            outsideClickHandler = null;
          }
        }
        function installOutsideClickHandler() {
          removeOutsideClickHandler();
          outsideClickHandler = function (e) {
            if (!bar.contains(e.target)) {
              revertIfEmpty();
            }
          };
          document.addEventListener('mousedown', outsideClickHandler, true);
        }
        function setupAsTitleEditing() {
          bar.className = 'md-code-title';
          bar.setAttribute('contenteditable', 'true');
          bar.setAttribute('data-placeholder', 'Enter title...');
          bar.textContent = '';
          preEl.removeAttribute('data-title');
          installOutsideClickHandler();
          requestAnimationFrame(function () {
            bar.focus();
            var sel = window.getSelection();
            if (sel) {
              var range = document.createRange();
              range.selectNodeContents(bar);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          });
        }
        function onInput() {
          preEl.setAttribute('data-title', bar.textContent.trim());
        }
        function onKeydown(e) {
          if (e.key === 'Enter') e.preventDefault();
        }
        function onClick() {
          if (bar.classList.contains('md-code-lang')) {
            setupAsTitleEditing();
          }
        }
        function onBlur() {
          revertIfEmpty();
        }
        bar.addEventListener('input', onInput);
        bar.addEventListener('keydown', onKeydown);
        bar.addEventListener('click', onClick);
        bar.addEventListener('blur', onBlur);
        if (title) {
          setupAsTitle(title);
        } else if (langName) {
          setupAsLang();
        }
      })(headerBar, pre, lang);
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      var linenums = pre.getAttribute('data-linenums');
      if (linenums) {
        var codeEl = pre.querySelector('code');
        var text = codeEl ? codeEl.textContent : pre.textContent;
        var lineCount = text.split('\n').length;
        if (text.endsWith('\n')) lineCount--;
        var startNum = parseInt(linenums, 10) || 1;
        var gutter = document.createElement('div');
        gutter.className = 'md-code-line-numbers';
        gutter.setAttribute('contenteditable', 'false');
        for (var n = 0; n < lineCount; n++) {
          var span = document.createElement('span');
          span.textContent = String(startNum + n);
          span.setAttribute('data-line', String(startNum + n));
          gutter.appendChild(span);
        }
        pre.insertBefore(gutter, pre.firstChild);
        (function (gutterEl, codeElement) {
          gutterEl.addEventListener('click', function (e) {
            var target = e.target;
            if (target.tagName !== 'SPAN' || !target.hasAttribute('data-line')) return;
            if (!codeElement) return;
            var lineIdx = Array.prototype.indexOf.call(gutterEl.children, target);
            if (lineIdx < 0) return;
            var textNode = codeElement.firstChild;
            if (!textNode || textNode.nodeType !== 3) return;
            var text = textNode.textContent;
            var offset = 0;
            for (var li = 0; li < lineIdx; li++) {
              var nl = text.indexOf('\n', offset);
              if (nl === -1) break;
              offset = nl + 1;
            }
            var range = document.createRange();
            range.setStart(textNode, offset);
            range.collapse(true);
            var sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          });
        })(gutter, codeEl);
      }
    }
  }

  (function patchAdmonitionHtmlToMarkdown() {
    var proto = MarkdownWYSIWYG.prototype;
    var orig = proto._nodeToMarkdownRecursive;
    if (!orig) return;
    proto._nodeToMarkdownRecursive = function (node, options) {
      // #text: preserve multiple spaces (upstream collapses with /  +/g)
      if (node.nodeName === '#text') {
        var text = node.textContent;
        if (options && options.inTableCell) {
          text = text.replace(/\|/g, '\\|');
          if (!this._findParentElement(node, 'PRE') && !this._findParentElement(node, 'CODE')) {
            text = text.replace(/\n/g, '<br>');
          }
        }
        return text;
      }
      // PRE: robust handling when contenteditable splits code blocks (e.g. DIV children, multiple PRE)
      if (node.nodeName === 'PRE' && !(options && options.inTableCell)) {
        var effectiveChildren = 0;
        var codeChild = null;
        for (var ci = 0; ci < node.childNodes.length; ci++) {
          var cn = node.childNodes[ci];
          if (cn.nodeType === 1 && cn.classList && cn.classList.contains('md-code-line-numbers')) continue;
          if (cn.nodeType === 1 && cn.nodeName === 'CODE') { codeChild = cn; effectiveChildren++; }
          else effectiveChildren++;
        }
        var dataLang = (node.getAttribute && node.getAttribute('data-lang')) || '';
        var dataTitle = (node.getAttribute && node.getAttribute('data-title')) || '';
        var dataLinenums = (node.getAttribute && node.getAttribute('data-linenums')) || '';
        var dataHlLines = (node.getAttribute && node.getAttribute('data-hl-lines')) || '';
        function buildFenceInfo(lang) {
          var info = lang;
          if (dataTitle) info += ' title="' + dataTitle + '"';
          if (dataLinenums) info += ' linenums="' + dataLinenums + '"';
          if (dataHlLines) info += ' hl_lines="' + dataHlLines + '"';
          return info;
        }
        if (effectiveChildren === 1 && codeChild) {
          var langMatch = codeChild.className && codeChild.className.match(/language-(\S+)/);
          var lang = dataLang || (langMatch ? langMatch[1] : '');
          var preContent = codeChild.textContent;
          if (preContent.length > 0 && !preContent.endsWith('\n')) preContent += '\n';
          return '```' + buildFenceInfo(lang) + '\n' + preContent + '```\n\n';
        }
        var parts = [];
        for (var k = 0; k < node.childNodes.length; k++) {
          var ch = node.childNodes[k];
          if (ch.nodeType === 1 && ch.classList && ch.classList.contains('md-code-line-numbers')) continue;
          if (ch.nodeType === 3) parts.push(ch.textContent);
          else if (ch.nodeType === 1) parts.push(ch.textContent);
        }
        var preContent2 = parts.join('\n');
        if (preContent2.length > 0 && !preContent2.endsWith('\n')) preContent2 += '\n';
        var codeEl = node.querySelector && node.querySelector('code');
        var langMatch2 = codeEl && codeEl.className && codeEl.className.match(/language-(\S+)/);
        var lang2 = dataLang || (langMatch2 ? langMatch2[1] : '');
        return '```' + buildFenceInfo(lang2) + '\n' + preContent2 + '```\n\n';
      }
      if (node.nodeName === 'DIV' && node.classList && node.classList.contains('md-code-block')) {
        var preChild = node.querySelector('pre');
        if (preChild) {
          var titleDiv = node.querySelector('.md-code-title');
          if (titleDiv) {
            var editedTitle = titleDiv.textContent.trim();
            preChild.setAttribute('data-title', editedTitle);
          }
          return this._nodeToMarkdownRecursive(preChild, options);
        }
        return '';
      }
      if (node.nodeName === 'DIV' && node.classList &&
          (node.classList.contains('md-code-title') || node.classList.contains('md-code-lang') || node.classList.contains('md-code-line-numbers'))) {
        return '';
      }
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
          var title = titleEl ? titleEl.textContent.replace(/\u00a0/g, ' ').trim() : '';
          var contentParts = [];
          for (var j = 0; j < node.childNodes.length; j++) {
            var c = node.childNodes[j];
            if (c.nodeType !== 1 || c === titleEl) continue;
            contentParts.push(orig.call(this, c, options || {}));
          }
          var body = contentParts.join('').trim();
          var bodyIndented = body ? body.split('\n').map(function (l) { return '    ' + l; }).join('\n') : '';
          var out = '!!! ' + type;
          var defaultTitle = type.charAt(0).toUpperCase() + type.slice(1);
          if (title && title !== defaultTitle) out += ' "' + title.replace(/"/g, '\\"') + '"';
          out += '\n' + (bodyIndented ? bodyIndented + '\n' : '');
          return out + '\n';
        }
      }
      return orig.apply(this, arguments);
    };
  })();

  (function patchHtmlToMarkdownPreserveCodeBlockNewlines() {
    var proto = MarkdownWYSIWYG.prototype;
    var origHtmlToMarkdown = proto._htmlToMarkdown;
    if (!origHtmlToMarkdown) return;
    proto._htmlToMarkdown = function (elementOrHtml) {
      var tempDiv;
      if (typeof elementOrHtml === 'string') {
        tempDiv = document.createElement('div');
        tempDiv.innerHTML = elementOrHtml;
      } else {
        tempDiv = elementOrHtml.cloneNode(true);
      }
      tempDiv.innerHTML = tempDiv.innerHTML.replace(/\u200B/g, '');
      var markdown = '';
      this._normalizeNodes(tempDiv);
      for (var i = 0; i < tempDiv.childNodes.length; i++) {
        markdown += this._nodeToMarkdownRecursive(tempDiv.childNodes[i]);
      }
      var codeBlockRe = /(```[^\n]*\n[\s\S]*?```)/g;
      var codeBlocks = [];
      var placeholderPrefix = '\u0000__CODEBLOCK_';
      var placeholderSuffix = '__\u0000';
      var protected_ = markdown.replace(codeBlockRe, function (m) {
        var idx = codeBlocks.length;
        codeBlocks.push(m);
        return placeholderPrefix + idx + placeholderSuffix;
      });
      protected_ = protected_.replace(/\n\s*\n\s*\n+/g, '\n\n');
      protected_ = protected_.replace(/ +\n/g, '\n');
      var cleanBlockquoteTrailing = function (s) {
        var lines = s.split('\n');
        var result = [];
        var i = 0;
        var isEmptyQuoteLine = function (l) { return /^>/.test(l) && !l.replace(/^>/, '').replace(/[\s\u00a0]/g, ''); };
        while (i < lines.length) {
          if (/^>/.test(lines[i])) {
            var block = [];
            while (i < lines.length && /^>/.test(lines[i])) {
              block.push(lines[i]);
              i++;
            }
            while (block.length > 0 && isEmptyQuoteLine(block[block.length - 1])) block.pop();
            for (var bi = 0; bi < block.length; bi++) result.push(block[bi]);
          } else {
            result.push(lines[i]);
            i++;
          }
        }
        return result.join('\n');
      };
      protected_ = cleanBlockquoteTrailing(protected_);
      for (var j = 0; j < codeBlocks.length; j++) {
        protected_ = protected_.split(placeholderPrefix + j + placeholderSuffix).join(codeBlocks[j]);
      }
      return protected_.trim();
    };
  })();

  /**
   * Parse YAML frontmatter from document content.
   * Returns { frontmatter: string, body: string }.
   * Frontmatter must be at the very start: --- newline, YAML, newline ---
   */
  function parseFrontmatter(content) {
    if (!content || typeof content !== 'string') return { frontmatter: '', body: content || '' };
    var m = content.match(/^(---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*[\r\n]*)([\s\S]*)$/);
    if (m) return { frontmatter: m[1].replace(/\s+$/, ''), body: m[2] };
    return { frontmatter: '', body: content };
  }

  function serializeWithFrontmatter(frontmatter, body) {
    if (!frontmatter) return body || '';
    return frontmatter + '\n' + (body || '');
  }

  /**
   * Preprocess unordered list markers (*, -, +) from markdown.
   * Returns { listItems: [{ indent, marker, content }] } for preservation.
   */
  function preprocessListMarkers(markdown) {
    if (!markdown || typeof markdown !== 'string') return { listItems: [] };
    var listItems = [];
    var re = /^(\s*)([-*+])\s+(.*)$/gm;
    var m;
    while ((m = re.exec(markdown)) !== null) {
      listItems.push({ indent: m[1], marker: m[2] + ' ', content: m[3] });
    }
    return { listItems: listItems };
  }

  /**
   * Postprocess markdown to restore original list markers where content matches.
   * New or modified list items use '- '.
   */
  function postprocessListMarkers(markdown, listData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!listData || !listData.listItems || !listData.listItems.length) return markdown;
    var originals = listData.listItems;
    var used = 0;
    return markdown.replace(/^(\s*)(-\s+)(.*)$/gm, function (match, indent, marker, content) {
      for (var i = used; i < originals.length; i++) {
        if (originals[i].indent === indent && originals[i].content === content) {
          used = i + 1;
          return indent + originals[i].marker + content;
        }
      }
      return match;
    });
  }

  function preprocessCodeBlocks(markdown) {
    if (!markdown || typeof markdown !== 'string') return { blocks: [] };
    var blocks = [];
    var lines = markdown.split('\n');
    var i = 0;
    while (i < lines.length) {
      var fenceMatch = lines[i].match(/^(`{3,}|~{3,})(.*)/);
      if (fenceMatch) {
        var openFence = lines[i];
        var fence = fenceMatch[1];
        var contentLines = [];
        i++;
        while (i < lines.length && !lines[i].match(new RegExp('^' + fence.charAt(0) + '{' + fence.length + ',}\\s*$'))) {
          contentLines.push(lines[i]);
          i++;
        }
        var closeFence = i < lines.length ? lines[i] : fence;
        blocks.push({ type: 'fenced', openFence: openFence, closeFence: closeFence, content: contentLines.join('\n') });
        i++;
        continue;
      }
      if (/^(    |\t)/.test(lines[i]) && (i === 0 || /^\s*$/.test(lines[i - 1]))) {
        var indentLines = [];
        while (i < lines.length && (/^(    |\t)/.test(lines[i]) || /^\s*$/.test(lines[i]))) {
          if (/^\s*$/.test(lines[i]) && (i + 1 >= lines.length || !/^(    |\t)/.test(lines[i + 1]))) break;
          indentLines.push(lines[i]);
          i++;
        }
        var content = indentLines.map(function (l) { return l.replace(/^    |\t/, ''); }).join('\n');
        blocks.push({ type: 'indented', content: content });
        continue;
      }
      i++;
    }
    return { blocks: blocks };
  }

  function postprocessCodeBlocks(markdown, codeData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!codeData || !codeData.blocks || !codeData.blocks.length) return markdown;
    var originals = codeData.blocks;
    var used = 0;
    var lines = markdown.split('\n');
    var result = [];
    var i = 0;
    while (i < lines.length) {
      var fenceMatch = lines[i].match(/^(`{3,}|~{3,})(.*)/);
      if (fenceMatch) {
        var fence = fenceMatch[1];
        var contentLines = [];
        var openIdx = i;
        i++;
        while (i < lines.length && !lines[i].match(new RegExp('^' + fence.charAt(0) + '{' + fence.length + ',}\\s*$'))) {
          contentLines.push(lines[i]);
          i++;
        }
        var closeIdx = i;
        var currentContent = contentLines.join('\n');
        var matched = false;
        for (var j = used; j < originals.length; j++) {
          if (originals[j].content.replace(/\s+$/g, '') === currentContent.replace(/\s+$/g, '')) {
            used = j + 1;
            matched = true;
            if (originals[j].type === 'indented') {
              var indentedLines = originals[j].content.split('\n');
              for (var k = 0; k < indentedLines.length; k++) {
                result.push('    ' + indentedLines[k]);
              }
            } else {
              var restoredFence = originals[j].openFence;
              var currentFenceLine = lines[openIdx];
              var currentTitleMatch = currentFenceLine.match(/title="([^"]*)"/);
              var origTitleMatch = restoredFence.match(/title="([^"]*)"/);
              if (currentTitleMatch && origTitleMatch && currentTitleMatch[1] !== origTitleMatch[1]) {
                restoredFence = restoredFence.replace(/title="[^"]*"/, 'title="' + currentTitleMatch[1] + '"');
              } else if (currentTitleMatch && !origTitleMatch) {
                restoredFence = restoredFence.replace(/(\S)(\s*)$/, '$1 title="' + currentTitleMatch[1] + '"$2');
              } else if (!currentTitleMatch && origTitleMatch) {
                restoredFence = restoredFence.replace(/\s*title="[^"]*"/, '');
              }
              result.push(restoredFence);
              for (var k = 0; k < contentLines.length; k++) result.push(contentLines[k]);
              result.push(originals[j].closeFence);
            }
            break;
          }
        }
        if (!matched) {
          result.push(lines[openIdx]);
          for (var k = 0; k < contentLines.length; k++) result.push(contentLines[k]);
          if (closeIdx < lines.length) result.push(lines[closeIdx]);
        }
        i++;
        continue;
      }
      result.push(lines[i]);
      i++;
    }
    return result.join('\n');
  }

  function preprocessTableSeparators(markdown) {
    if (!markdown || typeof markdown !== 'string') return { separators: [] };
    var separators = [];
    var lines = markdown.split('\n');
    for (var i = 1; i < lines.length; i++) {
      if (/^\|[\s:=-]+(\|[\s:=-]+)+\|?\s*$/.test(lines[i]) && /\|/.test(lines[i - 1])) {
        separators.push({ header: lines[i - 1].replace(/\s+/g, ''), separator: lines[i] });
      }
    }
    return { separators: separators };
  }

  function postprocessTableSeparators(markdown, tableData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!tableData || !tableData.separators || !tableData.separators.length) return markdown;
    var originals = tableData.separators;
    var used = 0;
    var lines = markdown.split('\n');
    for (var i = 1; i < lines.length; i++) {
      if (/^\|(\s*---\s*\|)+\s*$/.test(lines[i]) && /\|/.test(lines[i - 1])) {
        var normHeader = lines[i - 1].replace(/\s+/g, '');
        for (var j = used; j < originals.length; j++) {
          if (originals[j].header === normHeader) {
            lines[i] = originals[j].separator;
            used = j + 1;
            break;
          }
        }
      }
    }
    return lines.join('\n');
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.replace(/^<|>$/g, '').trim();
    try {
      url = decodeURIComponent(url);
    } catch (e) {}
    return url.replace(/\/+$/, '') || url;
  }

  function preprocessMarkdownLinks(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return { linkOriginals: [], refDefinitions: '' };
    }
    var linkOriginals = [];
    var refs = {};
    var refDefLines = [];
    var lines = markdown.split('\n');
    var i, m, refId, url, text;

    for (i = 0; i < lines.length; i++) {
      m = lines[i].match(/^\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
      if (m) {
        refId = m[1];
        url = (m[2] || m[3] || '').trim();
        refs[refId.toLowerCase()] = url;
        refDefLines.push(lines[i]);
      }
    }
    var refDefinitions = refDefLines.length ? refDefLines.join('\n') : '';

    var pos = 0;
    var inlineLinkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var inlineImgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var fullRefRe = /\[([^\]]*)\]\[([^\]]*)\]/g;
    var fullImgRefRe = /!\[([^\]]*)\]\[([^\]]*)\]/g;
    var shortcutRe = /\[([^\]]+)\](?!\s*[(\[])/g;
    var shortcutImgRe = /!\[([^\]]+)\](?!\s*[(\[])/g;
    var autolinkRe = /<(https?:\/\/[^>]+)>/g;
    var match, best, bestPos;

    while (pos < markdown.length) {
      best = null;
      bestPos = markdown.length;

      inlineLinkRe.lastIndex = pos;
      match = inlineLinkRe.exec(markdown);
      if (match && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(match[2]), text: match[1], original: match[0] };
      }

      inlineImgRe.lastIndex = pos;
      match = inlineImgRe.exec(markdown);
      if (match && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(match[2]), text: match[1], original: match[0], isImage: true };
      }

      fullRefRe.lastIndex = pos;
      match = fullRefRe.exec(markdown);
      if (match && refs[match[2].toLowerCase()] && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(refs[match[2].toLowerCase()]), text: match[1], original: match[0] };
      }

      fullImgRefRe.lastIndex = pos;
      match = fullImgRefRe.exec(markdown);
      if (match && refs[match[2].toLowerCase()] && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(refs[match[2].toLowerCase()]), text: match[1], original: match[0], isImage: true };
      }

      shortcutRe.lastIndex = pos;
      match = shortcutRe.exec(markdown);
      if (match && refs[match[1].toLowerCase()] && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(refs[match[1].toLowerCase()]), text: match[1], original: match[0] };
      }

      shortcutImgRe.lastIndex = pos;
      match = shortcutImgRe.exec(markdown);
      if (match && refs[match[1].toLowerCase()] && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(refs[match[1].toLowerCase()]), text: match[1], original: match[0], isImage: true };
      }

      autolinkRe.lastIndex = pos;
      match = autolinkRe.exec(markdown);
      if (match && match.index < bestPos) {
        bestPos = match.index;
        best = { url: normalizeUrl(match[1]), text: match[1], original: match[0], isAutolink: true };
      }

      if (!best) break;
      linkOriginals.push(best);
      pos = bestPos + best.original.length;
    }

    return { linkOriginals: linkOriginals, refDefinitions: refDefinitions };
  }

  function postprocessMarkdownLinks(markdown, linkData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!linkData || !linkData.linkOriginals || !linkData.linkOriginals.length) return markdown;

    var linkOriginals = linkData.linkOriginals;
    var refDefinitions = linkData.refDefinitions || '';
    var inlineLinkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var inlineImgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var spanCursorRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR + '\\s*></span>', 'g');
    var spanCursorEndRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR_END + '\\s*></span>', 'g');
    var used = [];

    function stripMarkers(s) {
      return s.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '').replace(spanCursorRe, '').replace(spanCursorEndRe, '');
    }

    function replaceMatch(match, text, url, isImage) {
      var cleanUrl = normalizeUrl(url);
      var cleanText = stripMarkers(text);
      for (var i = 0; i < linkOriginals.length; i++) {
        var origText = stripMarkers(linkOriginals[i].text);
        if (!used[i] && linkOriginals[i].url === cleanUrl && origText === cleanText && !!linkOriginals[i].isImage === !!isImage) {
          used[i] = true;
          var orig = stripMarkers(linkOriginals[i].original);
          if (cleanText !== text) {
            var textStart = orig.indexOf('[') + 1;
            var textEnd = orig.indexOf(']', textStart);
            orig = orig.slice(0, textStart) + text + orig.slice(textEnd);
          }
          return orig;
        }
      }
      return match;
    }

    var result = markdown
      .replace(inlineLinkRe, function (match, text, url) { return replaceMatch(match, text, url, false); })
      .replace(inlineImgRe, function (match, text, url) { return replaceMatch(match, text, url, true); });

    if (refDefinitions && result.indexOf(refDefinitions) === -1) {
      result = result + (result ? '\n\n' : '') + refDefinitions;
    }
    return result;
  }

  function dryDuplicateInlineLinks(markdown, linkData) {
    if (!markdown || typeof markdown !== 'string') return markdown;

    var parsed = parseFrontmatter(markdown);
    var body = parsed.body;
    if (!body) return markdown;


    var codeRanges = [];
    var fencedRe = /^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm;
    var fm;
    var bodyNoFences = body;
    while ((fm = fencedRe.exec(body)) !== null) {
      codeRanges.push({ start: fm.index, end: fm.index + fm[0].length });
      var blank = body.slice(fm.index, fm.index + fm[0].length).replace(/[^\n]/g, ' ');
      bodyNoFences = bodyNoFences.slice(0, fm.index) + blank + bodyNoFences.slice(fm.index + fm[0].length);
    }
    var inlineCodeRe = /`[^`]+`/g;
    while ((fm = inlineCodeRe.exec(bodyNoFences)) !== null) {
      codeRanges.push({ start: fm.index, end: fm.index + fm[0].length });
    }
    function insideCodeBlock(idx) {
      for (var fi = 0; fi < codeRanges.length; fi++) {
        if (idx >= codeRanges[fi].start && idx < codeRanges[fi].end) return true;
      }
      return false;
    }

    var inlineLinkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var match;
    var urlGroups = {};

    while ((match = inlineLinkRe.exec(body)) !== null) {
      if (insideCodeBlock(match.index)) continue;
      var normUrl = normalizeUrl(match[2]);
      if (!urlGroups[normUrl]) urlGroups[normUrl] = [];
      urlGroups[normUrl].push({
        fullMatch: match[0],
        text: match[1],
        rawUrl: match[2],
        index: match.index
      });
    }

    var refsToCreate = {};
    var usedRefNames = {};
    var refCounter = 1;

    var existingRefDefRe = /^\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;
    var existingRef;
    var existingRefsByUrl = {};
    while ((existingRef = existingRefDefRe.exec(body)) !== null) {
      var defName = existingRef[1];
      var defUrl = normalizeUrl(existingRef[2] || existingRef[3] || '');
      usedRefNames[defName.toLowerCase()] = true;
      if (defUrl && !existingRefsByUrl[defUrl]) {
        existingRefsByUrl[defUrl] = defName;
      }
    }

    for (var url in urlGroups) {
      var hasExistingDef = !!existingRefsByUrl[url];

      var origRefName = null;
      if (linkData && linkData.linkOriginals) {
        for (var i = 0; i < linkData.linkOriginals.length; i++) {
          var orig = linkData.linkOriginals[i];
          if (normalizeUrl(orig.url) === url && !orig.isImage) {
            var refMatch = orig.original.match(/\]\[([^\]]+)\]$/);
            if (refMatch && refMatch[1]) {
              origRefName = refMatch[1];
              break;
            }
            var shortMatch = orig.original.match(/^\[([^\]]+)\]$/);
            if (shortMatch) {
              origRefName = shortMatch[1];
              break;
            }
          }
        }
      }

      if (urlGroups[url].length < 2 && !hasExistingDef && !origRefName) continue;

      var refName = null;
      if (hasExistingDef) {
        refName = existingRefsByUrl[url];
      }
      if (!refName && origRefName) {
        refName = origRefName;
      }
      if (!refName) {
        while (usedRefNames[String(refCounter)]) refCounter++;
        refName = String(refCounter);
        refCounter++;
      }

      usedRefNames[refName.toLowerCase()] = true;
      refsToCreate[url] = { refName: refName, rawUrl: urlGroups[url][0].rawUrl };
    }

    var replacements = [];
    for (var url in refsToCreate) {
      var entries = urlGroups[url];
      for (var j = 0; j < entries.length; j++) {
        replacements.push({
          index: entries[j].index,
          length: entries[j].fullMatch.length,
          replacement: '[' + entries[j].text + '][' + refsToCreate[url].refName + ']'
        });
      }
    }

    if (replacements.length === 0) return markdown;

    replacements.sort(function (a, b) { return b.index - a.index; });

    var result = body;
    for (var k = 0; k < replacements.length; k++) {
      var r = replacements[k];
      result = result.slice(0, r.index) + r.replacement + result.slice(r.index + r.length);
    }

    var newDefs = [];
    for (var url in refsToCreate) {
      var info = refsToCreate[url];
      var escapedRefName = info.refName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      var defRegex = new RegExp('^\\[' + escapedRefName + '\\]:', 'mi');
      if (!defRegex.test(result)) {
        newDefs.push('[' + info.refName + ']: ' + info.rawUrl);
      }
    }

    if (newDefs.length > 0) {
      var trimmed = result.replace(/\s+$/, '');
      var lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
      var endsWithRefDef = /^\[([^\]]+)\]:\s/.test(lastLine);
      result = trimmed + (endsWithRefDef ? '\n' : '\n\n') + newDefs.join('\n');
    }

    return serializeWithFrontmatter(parsed.frontmatter, result);
  }

  (function patchSetValueAndSwitchToModeForLinkPrePost() {
    var proto = MarkdownWYSIWYG.prototype;
    var origSetValue = proto.setValue;
    var origSwitchToMode = proto.switchToMode;
    if (!origSetValue || !origSwitchToMode) return;
    proto.setValue = function (markdown, isInitialSetup) {
      if (markdown) {
        this._liveWysiwygLinkData = preprocessMarkdownLinks(markdown);
        this._liveWysiwygListMarkerData = preprocessListMarkers(markdown);
        this._liveWysiwygTableSepData = preprocessTableSeparators(markdown);
        this._liveWysiwygCodeBlockData = preprocessCodeBlocks(markdown);
      }
      return origSetValue.apply(this, arguments);
    };
    proto.switchToMode = function (mode, isInitialSetup) {
      if (mode === 'wysiwyg' && !isInitialSetup && this.markdownArea && this.markdownArea.value) {
        var body = parseFrontmatter(this.markdownArea.value).body;
        this._liveWysiwygLinkData = preprocessMarkdownLinks(body);
        this._liveWysiwygListMarkerData = preprocessListMarkers(body);
        this._liveWysiwygTableSepData = preprocessTableSeparators(body);
        this._liveWysiwygCodeBlockData = preprocessCodeBlocks(body);
      }
      var result = origSwitchToMode.apply(this, arguments);
      if (mode === 'markdown') {
        var md = this.markdownArea.value;
        if (this._liveWysiwygLinkData) {
          md = postprocessMarkdownLinks(md, this._liveWysiwygLinkData);
        }
        if (this._liveWysiwygListMarkerData) {
          md = postprocessListMarkers(md, this._liveWysiwygListMarkerData);
        }
        if (this._liveWysiwygTableSepData) {
          md = postprocessTableSeparators(md, this._liveWysiwygTableSepData);
        }
        if (this._liveWysiwygCodeBlockData) {
          md = postprocessCodeBlocks(md, this._liveWysiwygCodeBlockData);
        }
        if (this._liveWysiwygLinkData) {
          md = dryDuplicateInlineLinks(md, this._liveWysiwygLinkData);
        }
        if (md !== this.markdownArea.value) {
          this.markdownArea.value = md;
          if (this.options && this.options.onUpdate) this.options.onUpdate(this.getValue());
        }
      }
      return result;
    };
  })();

  (function patchGetValueForListMarkers() {
    var proto = MarkdownWYSIWYG.prototype;
    var origGetValue = proto.getValue;
    if (!origGetValue) return;
    proto.getValue = function () {
      var raw = origGetValue.call(this);
      var parsed = parseFrontmatter(raw);
      if (parsed.frontmatter) {
        this._liveWysiwygFrontmatter = parsed.frontmatter;
      }
      var body = parsed.body;
      if (this._liveWysiwygListMarkerData) {
        body = postprocessListMarkers(body, this._liveWysiwygListMarkerData);
      }
      if (this._liveWysiwygTableSepData) {
        body = postprocessTableSeparators(body, this._liveWysiwygTableSepData);
      }
      if (this._liveWysiwygCodeBlockData) {
        body = postprocessCodeBlocks(body, this._liveWysiwygCodeBlockData);
      }
      return body;
    };
  })();

  var CURSOR_MARKER = '\u200C\u200C\u200C\u200C\u200C\u200C';
  var CURSOR_MARKER_RE = /\u200C\u200C\u200C\u200C\u200C\u200C/g;
  var CURSOR_MARKER_END = '\u200D\u200D\u200D\u200D\u200D\u200D';
  var CURSOR_MARKER_END_RE = /\u200D\u200D\u200D\u200D\u200D\u200D/g;
  var CURSOR_SPAN_ATTR = 'data-live-wysiwyg-cursor';
  var CURSOR_SPAN_ATTR_END = 'data-live-wysiwyg-cursor-end';
  var CURSOR_PLACEHOLDER = 'LIVEWYSIWYG_CURSOR_9X7K2';
  var CURSOR_PLACEHOLDER_END = 'LIVEWYSIWYG_CURSOR_END_9X7K2';
  var lastWysiwygSemanticSelection = null;

  (function patchMarkdownToHtmlForCursorMarker() {
    var proto = MarkdownWYSIWYG.prototype;
    var orig = proto._markdownToHtml;
    if (!orig) return;
    var spanPattern = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*></span>', 'g');
    var spanEndPattern = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*></span>', 'g');
    proto._markdownToHtml = function (markdown) {
      var s = (markdown || '').replace(spanPattern, CURSOR_PLACEHOLDER).replace(spanEndPattern, CURSOR_PLACEHOLDER_END);
      var html = orig.call(this, s);
      return (html || '').split(CURSOR_PLACEHOLDER).join(CURSOR_MARKER).split(CURSOR_PLACEHOLDER_END).join(CURSOR_MARKER_END);
    };
  })();

  function insertTextNodeAt(container, offset, textNode) {
    if (container.nodeType === 3) {
      var next = container.splitText(offset);
      container.parentNode.insertBefore(textNode, next);
    } else {
      var ref = container.childNodes[offset] || null;
      container.insertBefore(textNode, ref);
    }
  }

  function injectMarkerAtCaretInEditable(editable) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) return false;
    if (lastWysiwygSemanticSelection) {
      var startParent = range.startContainer;
      if (startParent.nodeType === 3) startParent = startParent.parentNode;
      var currentPrimary = startParent && startParent.className ? startParent.className.split(/\s+/)[0] : '';
      var expectedPrimary = lastWysiwygSemanticSelection.start.parentClass ? lastWysiwygSemanticSelection.start.parentClass.split(/\s+/)[0] : '';
      if (currentPrimary !== expectedPrimary && expectedPrimary) {
        var restored = restoreSelectionFromSemantic(editable, lastWysiwygSemanticSelection);
        if (restored) {
          sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            range = sel.getRangeAt(0);
          }
        }
      }
      lastWysiwygSemanticSelection = null;
    }
    var collapsed = range.collapsed;
    try {
      if (collapsed) {
        var textNode = document.createTextNode(CURSOR_MARKER);
        range.collapse(true);
        range.insertNode(textNode);
      } else {
        var startContainer = range.startContainer;
        var startOffset = range.startOffset;
        var endContainer = range.endContainer;
        var endOffset = range.endOffset;
        insertTextNodeAt(endContainer, endOffset, document.createTextNode(CURSOR_MARKER_END));
        insertTextNodeAt(startContainer, startOffset, document.createTextNode(CURSOR_MARKER));
      }
    } catch (e) {
      if (!collapsed) {
        try {
          range.collapse(true);
          range.insertNode(document.createTextNode(CURSOR_MARKER));
        } catch (e2) {
          console.warn('live-wysiwyg: could not inject selection marker', e2);
        }
      }
    }
    return true;
  }

  function getCaretOffsetInEditable(editable) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    var range = sel.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) return 0;
    var preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editable);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  }

  function getTextOffsetOfMarkerInEditable(editable) {
    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var pos = 0;
    var node;
    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(CURSOR_MARKER);
      if (idx >= 0) return pos + idx;
      pos += node.textContent.length;
    }
    return -1;
  }

  function stripCursorMarkersFromDOM(element) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var toUpdate = [];
    while ((node = walker.nextNode())) {
      if (node.nodeValue.indexOf(CURSOR_MARKER) >= 0 || node.nodeValue.indexOf(CURSOR_MARKER_END) >= 0) {
        toUpdate.push(node);
      }
    }
    for (var i = 0; i < toUpdate.length; i++) {
      toUpdate[i].nodeValue = toUpdate[i].nodeValue.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
    }
    var pres = element.querySelectorAll('pre[data-title], pre[data-lang]');
    for (var j = 0; j < pres.length; j++) {
      var attrNames = ['data-title', 'data-lang'];
      for (var k = 0; k < attrNames.length; k++) {
        var val = pres[j].getAttribute(attrNames[k]);
        if (val && (val.indexOf(CURSOR_MARKER) >= 0 || val.indexOf(CURSOR_MARKER_END) >= 0)) {
          pres[j].setAttribute(attrNames[k], val.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, ''));
        }
      }
    }
  }

  function getTextOffsetsOfMarkersInEditable(editable) {
    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var pos = 0;
    var node;
    var startOffset = -1;
    var endOffset = -1;
    while ((node = walker.nextNode())) {
      var text = node.textContent;
      var idxStart = text.indexOf(CURSOR_MARKER);
      var idxEnd = text.indexOf(CURSOR_MARKER_END);
      if (idxStart >= 0) startOffset = pos + idxStart;
      if (idxEnd >= 0) endOffset = pos + idxEnd;
      pos += text.length;
    }
    return { start: startOffset, end: endOffset };
  }

  function getBlockIndexForLine(md, lineIdx) {
    var lines = md.split('\n');
    var blockIdx = -1;
    var inBlock = false;
    for (var i = 0; i <= Math.min(lineIdx, lines.length - 1); i++) {
      if (lines[i].trim() === '') {
        inBlock = false;
      } else if (!inBlock) {
        blockIdx++;
        inBlock = true;
      }
    }
    return Math.max(0, blockIdx);
  }

  function findCursorSpanAndSetCaret(editable) {
    var span = editable.querySelector('[' + CURSOR_SPAN_ATTR + ']');
    if (!span) return false;
    var range = document.createRange();
    range.setStartBefore(span);
    range.collapse(true);
    var sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    span.parentNode.removeChild(span);
    return true;
  }

  function setCaretInEditable(editable, offset) {
    setSelectionInEditable(editable, offset, offset);
  }

  function setSelectionInEditable(editable, startOffset, endOffset) {
    var sel = window.getSelection();
    if (!sel) return;
    var range = document.createRange();
    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var pos = 0;
    var startNode, startNodeOffset, endNode, endNodeOffset;
    var node;
    while ((node = walker.nextNode())) {
      var len = node.textContent.length;
      if (startNode === undefined && pos + len >= startOffset) {
        startNode = node;
        startNodeOffset = startOffset - pos;
      }
      if (endNode === undefined && pos + len >= endOffset) {
        endNode = node;
        endNodeOffset = endOffset - pos;
        break;
      }
      pos += len;
    }
    if (startNode && endNode) {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function captureSemanticSelection(editable) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) return null;
    function describeEndpoint(container, offset) {
      var parent = container.nodeType === 3 ? container.parentNode : container;
      var cls = (parent && parent.className) ? String(parent.className) : '';
      var tag = parent ? parent.nodeName : '';
      var parentText = parent ? parent.textContent : '';
      var localOffset = offset;
      if (container.nodeType === 3 && parent && parent !== container) {
        var w = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
        var n, pos = 0;
        while ((n = w.nextNode())) {
          if (n === container) { localOffset = pos + offset; break; }
          pos += n.textContent.length;
        }
      }
      var nthOfClass = 0;
      if (cls && parent.parentNode) {
        var sibs = parent.parentNode.children;
        for (var i = 0; i < sibs.length; i++) {
          if (sibs[i] === parent) break;
          if (sibs[i].className === cls) nthOfClass++;
        }
      }
      var nested = false;
      var anc = parent;
      while (anc && anc !== editable) {
        if (anc.getAttribute && anc.getAttribute('contenteditable') === 'true') {
          nested = true;
          break;
        }
        anc = anc.parentNode;
      }
      return {
        parentClass: cls, parentTag: tag, parentText: parentText,
        localOffset: localOffset, nthOfClass: nthOfClass, nestedEditable: nested
      };
    }
    var startD = describeEndpoint(range.startContainer, range.startOffset);
    var endD = range.collapsed ? startD : describeEndpoint(range.endContainer, range.endOffset);
    return { selectedText: range.toString(), collapsed: range.collapsed, start: startD, end: endD };
  }

  function restoreSelectionFromSemantic(editable, sem) {
    if (!sem || !sem.start) return false;
    function findEl(desc) {
      if (!desc.parentClass) return null;
      var primary = desc.parentClass.split(/\s+/)[0];
      if (!primary) return null;
      var elems = editable.getElementsByClassName(primary);
      for (var i = 0; i < elems.length; i++) {
        if (elems[i].textContent === desc.parentText) return elems[i];
      }
      if (elems.length > desc.nthOfClass) return elems[desc.nthOfClass];
      return elems.length > 0 ? elems[0] : null;
    }
    function findTextAt(parent, targetOffset) {
      var w = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
      var n, pos = 0, last = null;
      while ((n = w.nextNode())) {
        last = n;
        var len = n.textContent.length;
        if (pos + len >= targetOffset) return { node: n, offset: Math.min(targetOffset - pos, len) };
        pos += len;
      }
      if (last) return { node: last, offset: last.textContent.length };
      return null;
    }
    var startEl = findEl(sem.start);
    if (!startEl) return false;
    var endEl = sem.collapsed ? startEl : (findEl(sem.end) || startEl);
    var si = findTextAt(startEl, sem.start.localOffset);
    if (!si) return false;
    var ei = sem.collapsed ? si : (findTextAt(endEl, sem.end.localOffset) || si);
    try {
      var range = document.createRange();
      range.setStart(si.node, si.offset);
      range.setEnd(ei.node, ei.offset);
      var sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      if (sem.start.nestedEditable) {
        var anc = si.node.parentNode;
        while (anc && anc !== editable) {
          if (anc.getAttribute && anc.getAttribute('contenteditable') === 'true') {
            anc.focus();
            sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            break;
          }
          anc = anc.parentNode;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function findTextNodeAtOffset(editable, targetOffset) {
    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var pos = 0;
    var node;
    while ((node = walker.nextNode())) {
      var len = node.textContent.length;
      if (pos + len >= targetOffset) {
        return { node: node, offset: Math.min(targetOffset - pos, len) };
      }
      pos += len;
    }
    if (node) return { node: node, offset: node.textContent.length };
    return null;
  }

  function findNestedContenteditable(node, boundary) {
    var anc = node.nodeType === 3 ? node.parentNode : node;
    while (anc && anc !== boundary) {
      if (anc.getAttribute && anc.getAttribute('contenteditable') === 'true') {
        return anc;
      }
      anc = anc.parentNode;
    }
    return null;
  }

  function installSemanticClearListeners(editable) {
    if (editable._semanticClearInstalled) return;
    editable._semanticClearInstalled = true;
    var handler = function () {
      lastWysiwygSemanticSelection = null;
    };
    editable.addEventListener('mousedown', handler);
    editable.addEventListener('keydown', handler);
  }

  function restoreScrollPosition(container, scrollTop) {
    if (container && typeof scrollTop === 'number') {
      container.scrollTop = Math.min(scrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    }
  }

  function findSelectedTextInContent(content, selectedText, contextBefore, contextAfter) {
    if (!content || !selectedText) return null;
    var matchLen = selectedText.length;
    var norm = selectedText.replace(/\s+/g, ' ').trim();
    var searchTexts = norm && norm !== selectedText ? [selectedText, norm] : [selectedText];

    function tryContextMatch(ctxBefore, ctxAfter) {
      if (!ctxBefore && !ctxAfter) return null;
      var needle = (ctxBefore || '') + selectedText + (ctxAfter || '');
      var idx = content.indexOf(needle);
      if (idx >= 0) return { start: idx + (ctxBefore || '').length, end: idx + (ctxBefore || '').length + matchLen };
      if (norm && norm !== selectedText) {
        needle = (ctxBefore || '') + norm + (ctxAfter || '');
        idx = content.indexOf(needle);
        if (idx >= 0) return { start: idx + (ctxBefore || '').length, end: idx + (ctxBefore || '').length + norm.length };
      }
      return null;
    }

    if (contextBefore || contextAfter) {
      var pos = tryContextMatch(contextBefore, contextAfter);
      if (pos) return pos;
      pos = tryContextMatch(contextBefore, null);
      if (pos) return pos;
      pos = tryContextMatch(null, contextAfter);
      if (pos) return pos;
      if (contextBefore && contextBefore.length > 20) {
        pos = tryContextMatch(contextBefore.slice(-20), null);
        if (pos) return pos;
      }
      if (contextAfter && contextAfter.length > 20) {
        pos = tryContextMatch(null, contextAfter.slice(0, 20));
        if (pos) return pos;
      }
    }

    var allMatches = [];
    var idx = -1;
    while ((idx = content.indexOf(selectedText, idx + 1)) >= 0) allMatches.push({ idx: idx, len: selectedText.length });
    if (norm && norm !== selectedText) {
      idx = -1;
      while ((idx = content.indexOf(norm, idx + 1)) >= 0) allMatches.push({ idx: idx, len: norm.length });
    }
    if (allMatches.length === 0) return null;
    if (allMatches.length === 1) {
      var m = allMatches[0];
      return { start: m.idx, end: m.idx + m.len };
    }

    var best = null;
    var bestScore = -1;
    for (var i = 0; i < allMatches.length; i++) {
      var start = allMatches[i].idx;
      var len = allMatches[i].len;
      var before = content.substring(Math.max(0, start - CONTEXT_LEN), start);
      var after = content.substring(start + len, Math.min(content.length, start + len + CONTEXT_LEN));
      var score = 0;
      if (contextBefore && before) {
        var overlap = Math.min(contextBefore.length, before.length);
        for (var j = 1; j <= overlap; j++) {
          if (contextBefore.slice(-j) === before.slice(-j)) score += j;
        }
      }
      if (contextAfter && after) {
        overlap = Math.min(contextAfter.length, after.length);
        for (var k = 1; k <= overlap; k++) {
          if (contextAfter.slice(0, k) === after.slice(0, k)) score += k;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = { start: start, end: start + len };
      }
    }
    return best || { start: allMatches[0].idx, end: allMatches[0].idx + allMatches[0].len };
  }

  function findSelectedTextInMarkdown(markdown, selectedText, contextBefore, contextAfter) {
    return findSelectedTextInContent(markdown, selectedText, contextBefore, contextAfter);
  }

  function applyPendingReadModeSelection(editor) {
    if (!pendingReadModeSelection || !pendingReadModeSelection.selectedText) return false;
    var selectedText = pendingReadModeSelection.selectedText;
    var contextBefore = pendingReadModeSelection.contextBefore || '';
    var contextAfter = pendingReadModeSelection.contextAfter || '';
    pendingReadModeSelection = null;
    var md = editor.currentMode === 'markdown'
      ? editor.markdownArea.value
      : (editor.getValue ? editor.getValue() : '');
    var parsed = parseFrontmatter(md || '');
    var body = parsed.body || '';
    var frontmatterLen = (md || '').length - body.length;
    var pos = findSelectedTextInMarkdown(body, selectedText, contextBefore, contextAfter);
    if (!pos) return false;
    if (editor.currentMode === 'markdown') {
      var ma = editor.markdownArea;
      if (!ma) return false;
      var selStart = pos.start + frontmatterLen;
      var selEnd = pos.end + frontmatterLen;
      var fullLen = ma.value.length;
      selStart = Math.min(selStart, fullLen);
      selEnd = Math.min(selEnd, fullLen);
      ma.focus();
      ma.setSelectionRange(selStart, selEnd);
      scrollToCenterCursor(ma, true, selStart);
      if (editor.markdownLineNumbersDiv) {
        editor.markdownLineNumbersDiv.scrollTop = ma.scrollTop;
      }
      return true;
    }
    var ea = editor.editableArea;
    if (!ea) return false;
    var fullText = '';
    var walker = document.createTreeWalker(ea, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) fullText += node.textContent;
    var pos = findSelectedTextInContent(fullText, selectedText, contextBefore, contextAfter);
    if (pos) {
      setSelectionInEditable(ea, pos.start, pos.end);
      ea.focus();
      requestAnimationFrame(function () { scrollToCenterCursor(ea, false); });
      return true;
    }
    return false;
  }

  function scrollToCenterCursor(container, isTextarea, selectionStart) {
    if (!container) return;
    var clientHeight = container.clientHeight;
    var maxScroll = Math.max(0, container.scrollHeight - clientHeight);
    if (maxScroll <= 0) return;
    var cursorPixelPos;
    if (isTextarea && typeof selectionStart === 'number') {
      var mirror = document.createElement('div');
      var style = window.getComputedStyle(container);
      mirror.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;pointer-events:none;';
      mirror.style.font = style.font;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.padding = style.padding;
      mirror.style.width = container.clientWidth + 'px';
      mirror.style.border = style.border;
      mirror.style.boxSizing = style.boxSizing;
      mirror.textContent = container.value.substring(0, selectionStart);
      container.parentNode.appendChild(mirror);
      cursorPixelPos = mirror.offsetHeight;
      mirror.parentNode.removeChild(mirror);
    } else {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      var cursorRect = range.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      cursorPixelPos = container.scrollTop + (cursorRect.top - containerRect.top);
    }
    var targetScroll = cursorPixelPos - (clientHeight / 2);
    container.scrollTop = Math.max(0, Math.min(targetScroll, maxScroll));
  }

  (function patchSetValueAndGetValueForFrontmatter() {
    var proto = MarkdownWYSIWYG.prototype;
    var origSetValue = proto.setValue;
    var origGetValue = proto.getValue;
    var origSwitchToMode = proto.switchToMode;
    if (!origSetValue || !origGetValue || !origSwitchToMode) return;
    proto.setValue = function (markdown, isInitialSetup) {
      var parsed = parseFrontmatter(markdown || '');
      this._liveWysiwygFrontmatter = parsed.frontmatter;
      var ret = origSetValue.call(this, parsed.body, isInitialSetup);
      if (this.editableArea) {
        enhanceCodeBlocks(this.editableArea);
        if (lastWysiwygSemanticSelection && this.currentMode === 'wysiwyg' && !isInitialSetup) {
          restoreSelectionFromSemantic(this.editableArea, lastWysiwygSemanticSelection);
        }
      }
      return ret;
    };
    proto.getValue = function () {
      var body = origGetValue.call(this);
      return serializeWithFrontmatter(this._liveWysiwygFrontmatter, body);
    };
    proto.switchToMode = function (mode, isInitialSetup) {
      if (this.currentMode === mode && !isInitialSetup) {
        if (mode === 'markdown' && this.markdownArea) {
          var ss = this.markdownArea.selectionStart;
          var se = this.markdownArea.selectionEnd;
          var ta = this.markdownArea;
          requestAnimationFrame(function () { ta.focus(); ta.setSelectionRange(ss, se); });
        } else if (mode === 'wysiwyg' && this.editableArea) {
          this.editableArea.focus();
        }
        return;
      }
      var savedSelStart = this.markdownArea ? this.markdownArea.selectionStart : 0;
      var frontmatterLen = 0;
      if (mode === 'wysiwyg' && !isInitialSetup && this.markdownArea && this.markdownArea.value) {
        var fullLen = this.markdownArea.value.length;
        var parsed = parseFrontmatter(this.markdownArea.value);
        this._liveWysiwygFrontmatter = parsed.frontmatter;
        frontmatterLen = fullLen - (parsed.body || '').length;
        this.markdownArea.value = parsed.body;
        if (frontmatterLen > 0) {
          var adj = Math.max(0, Math.min(savedSelStart - frontmatterLen, parsed.body.length));
          this.markdownArea.setSelectionRange(adj, adj);
        }
      }
      var cursorInFrontmatter = false;
      if (frontmatterLen > 0) {
        var checkStart = capturedMarkdownSelection ? capturedMarkdownSelection.start : savedSelStart;
        cursorInFrontmatter = checkStart < frontmatterLen;
      }
      var cursorAtDocStart = false;
      var cursorBlockFallback = -1;
      var codeTitleSelection = null;
      var savedScroll = null;
      var markdownMarkerInserted = false;
      if (!isInitialSetup) {
        savedScroll = this.currentMode === 'wysiwyg'
          ? (this.editableArea ? this.editableArea.scrollTop : 0)
          : (this.markdownArea ? this.markdownArea.scrollTop : 0);
        if (this.currentMode === 'wysiwyg') {
          injectMarkerAtCaretInEditable(this.editableArea);
        } else if (cursorInFrontmatter) {
          capturedMarkdownSelection = null;
        } else {
          var mdVal = this.markdownArea.value;
          var selStart, selEnd;
          if (capturedMarkdownSelection) {
            selStart = capturedMarkdownSelection.start;
            selEnd = capturedMarkdownSelection.end;
            if (frontmatterLen > 0) {
              selStart = Math.max(0, selStart - frontmatterLen);
              selEnd = Math.max(0, selEnd - frontmatterLen);
            }
            selStart = Math.min(selStart, mdVal.length);
            selEnd = Math.min(selEnd, mdVal.length);
            capturedMarkdownSelection = null;
          } else {
            selStart = Math.min(this.markdownArea.selectionStart, mdVal.length);
            selEnd = Math.min(this.markdownArea.selectionEnd, mdVal.length);
          }
          var insertStart = selStart;
          var insertEnd = selEnd;
          if (insertStart === 0) {
            cursorAtDocStart = true;
          } else if (insertStart === insertEnd) {
            if (insertStart > 0 && mdVal.charAt(insertStart - 1) === '\n') {
              insertStart = insertStart - 1;
              insertEnd = insertEnd - 1;
            }
          } else {
            if (insertEnd > 0 && mdVal.charAt(insertEnd - 1) === '\n' && insertEnd > insertStart) {
              insertEnd = insertEnd - 1;
            }
          }
          if (!cursorAtDocStart) {
            var lines = mdVal.split('\n');
            var cursorLineIdx = mdVal.slice(0, selStart).split('\n').length - 1;
            var cursorLine = lines[cursorLineIdx] || '';
            if (/^(`{3,}|~{3,})/.test(cursorLine)) {
              var fenceTitleMatch = cursorLine.match(/title="([^"]*)"/);
              if (fenceTitleMatch) {
                var titleAttrStart = cursorLine.indexOf(fenceTitleMatch[0]) + 'title="'.length;
                var titleAttrEnd = titleAttrStart + fenceTitleMatch[1].length;
                var lineStartOffset = 0;
                for (var lk = 0; lk < cursorLineIdx; lk++) lineStartOffset += lines[lk].length + 1;
                var selStartInLine = selStart - lineStartOffset;
                var selEndInLine = selEnd - lineStartOffset;
                if (selStartInLine >= titleAttrStart && selEndInLine <= titleAttrEnd) {
                  var fenceCount = 0;
                  for (var fi = 0; fi < lines.length; fi++) {
                    if (fi === cursorLineIdx) break;
                    if (/^(`{3,}|~{3,})/.test(lines[fi])) {
                      var fch = lines[fi].match(/^(`{3,}|~{3,})/)[1];
                      fi++;
                      while (fi < lines.length && !lines[fi].match(new RegExp('^' + fch[0] + '{' + fch.length + ',}\\s*$'))) fi++;
                      fenceCount++;
                    }
                  }
                  codeTitleSelection = {
                    codeBlockIndex: fenceCount,
                    selStart: selStartInLine - titleAttrStart,
                    selEnd: selEndInLine - titleAttrStart,
                    titleText: fenceTitleMatch[1]
                  };
                }
              }
            }
          }
          if (!cursorAtDocStart && !codeTitleSelection) {
            var spanMarker = '<span ' + CURSOR_SPAN_ATTR + '></span>';
            var spanMarkerEnd = '<span ' + CURSOR_SPAN_ATTR_END + '></span>';
            var spanMarkerRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*>\\s*</span>', 'gi');
            var spanMarkerEndRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR_END.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*>\\s*</span>', 'gi');
            var testMd;
            if (insertStart === insertEnd) {
              testMd = mdVal.slice(0, insertStart) + spanMarker + mdVal.slice(insertStart);
            } else {
              testMd = mdVal.slice(0, insertStart) + spanMarker + mdVal.slice(insertStart, insertEnd) + spanMarkerEnd + mdVal.slice(insertEnd);
            }
            var stripAllMarkers = function (s) {
              return (s || '').replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '').replace(spanMarkerRe, '').replace(spanMarkerEndRe, '');
            };
            var normHtml = function (s) { return stripAllMarkers(s).replace(/\s+/g, ' ').trim(); };
            var cleanHtml = normHtml(this._markdownToHtml(mdVal));
            var markerHtml = normHtml(this._markdownToHtml(testMd));
            if (markerHtml === cleanHtml) {
              this.markdownArea.value = testMd;
              markdownMarkerInserted = true;
            } else {
              var lines2 = mdVal.split('\n');
              var cursorLineIdx2 = mdVal.slice(0, selStart).split('\n').length - 1;
              var cursorLine2 = lines2[cursorLineIdx2] || '';
              if (/^\s*>\s*$/.test(cursorLine2) && cursorLineIdx2 > 0) {
                var prevIdx = cursorLineIdx2 - 1;
                while (prevIdx > 0 && /^\s*>\s*$/.test(lines2[prevIdx])) prevIdx--;
                var prevLineEnd = 0;
                for (var li = 0; li <= prevIdx; li++) prevLineEnd += lines2[li].length + 1;
                prevLineEnd -= 1;
                var retryMd = mdVal.slice(0, prevLineEnd) + spanMarker + mdVal.slice(prevLineEnd);
                var retryHtml = normHtml(this._markdownToHtml(retryMd));
                if (retryHtml === cleanHtml) {
                  this.markdownArea.value = retryMd;
                  markdownMarkerInserted = true;
                } else {
                  cursorBlockFallback = getBlockIndexForLine(mdVal, cursorLineIdx2);
                }
              } else if (/^(`{3,}|~{3,})/.test(cursorLine2)) {
                cursorBlockFallback = getBlockIndexForLine(mdVal, cursorLineIdx2);
              } else {
                cursorBlockFallback = getBlockIndexForLine(mdVal, cursorLineIdx2);
              }
            }
          }
        }
      }
      var result = origSwitchToMode.call(this, mode, isInitialSetup);
      if (mode === 'markdown') {
        capturedMarkdownSelection = null;
        if (this._liveWysiwygFrontmatter) {
          this.markdownArea.value = serializeWithFrontmatter(this._liveWysiwygFrontmatter, this.markdownArea.value);
          if (this._updateMarkdownLineNumbers) this._updateMarkdownLineNumbers();
        }
      }
      if (!isInitialSetup && savedScroll !== null) {
        if (mode === 'wysiwyg') {
          var editableArea = this.editableArea;
          enhanceCodeBlocks(editableArea);
          if (cursorInFrontmatter || cursorAtDocStart) {
            requestAnimationFrame(function () {
              editableArea.focus();
              setSelectionInEditable(editableArea, 0, 0);
              editableArea.scrollTop = 0;
            });
          } else if (codeTitleSelection) {
            var ctSel = codeTitleSelection;
            requestAnimationFrame(function () {
              var codeBlocks = editableArea.querySelectorAll('.md-code-block');
              var block = codeBlocks[ctSel.codeBlockIndex];
              var titleEl = block ? block.querySelector('.md-code-title') : null;
              if (!titleEl) {
                for (var ti = 0; ti < codeBlocks.length; ti++) {
                  var t = codeBlocks[ti].querySelector('.md-code-title');
                  if (t && t.textContent === ctSel.titleText) { titleEl = t; break; }
                }
              }
              if (titleEl) {
                titleEl.focus();
                var si = findTextNodeAtOffset(titleEl, ctSel.selStart);
                var ei = (ctSel.selStart === ctSel.selEnd) ? si : findTextNodeAtOffset(titleEl, ctSel.selEnd);
                if (si && ei) {
                  var range = document.createRange();
                  range.setStart(si.node, si.offset);
                  range.setEnd(ei.node, ei.offset);
                  var sel = window.getSelection();
                  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
                }
              } else {
                editableArea.focus();
              }
              lastWysiwygSemanticSelection = captureSemanticSelection(editableArea);
              installSemanticClearListeners(editableArea);
              scrollToCenterCursor(editableArea, false);
            });
          } else if (cursorBlockFallback >= 0) {
            var blockIdx = cursorBlockFallback;
            requestAnimationFrame(function () {
              editableArea.focus();
              var blockEls = [];
              for (var c = editableArea.firstElementChild; c; c = c.nextElementSibling) {
                blockEls.push(c);
              }
              var target = blockEls[Math.min(blockIdx, blockEls.length - 1)];
              if (target) {
                var range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(true);
                var sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
              scrollToCenterCursor(editableArea, false);
            });
          } else {
            var cursorSet = findCursorSpanAndSetCaret(editableArea);
            var offsets = null;
            if (!cursorSet) {
              offsets = getTextOffsetsOfMarkersInEditable(editableArea);
              if (offsets.start >= 0) {
                stripCursorMarkersFromDOM(editableArea);
              } else if (markdownMarkerInserted) {
                var leftover = editableArea.querySelectorAll('[' + CURSOR_SPAN_ATTR + '], [' + CURSOR_SPAN_ATTR_END + ']');
                for (var i = 0; i < leftover.length; i++) leftover[i].parentNode.removeChild(leftover[i]);
              }
            }
            requestAnimationFrame(function () {
              if (cursorSet) {
                editableArea.focus();
              } else if (offsets && offsets.start >= 0) {
                var hasSelection = offsets.end >= 0 && offsets.end > offsets.start;
                var selStart = offsets.start;
                var selEnd = hasSelection
                  ? Math.max(selStart, offsets.end - 6)
                  : selStart;
                var si = findTextNodeAtOffset(editableArea, selStart);
                var ei = (selStart === selEnd) ? si : findTextNodeAtOffset(editableArea, selEnd);
                if (si && ei) {
                  var nested = findNestedContenteditable(si.node, editableArea);
                  if (nested) {
                    nested.focus();
                  } else {
                    editableArea.focus();
                  }
                  var range = document.createRange();
                  range.setStart(si.node, si.offset);
                  range.setEnd(ei.node, ei.offset);
                  var sel = window.getSelection();
                  if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                  }
                } else {
                  editableArea.focus();
                  setSelectionInEditable(editableArea, selStart, selEnd);
                }
              }
              lastWysiwygSemanticSelection = captureSemanticSelection(editableArea);
              installSemanticClearListeners(editableArea);
              scrollToCenterCursor(editableArea, false);
            });
          }
        } else {
          var mdVal = this.markdownArea.value;
          var markerIdx = mdVal.indexOf(CURSOR_MARKER);
          var markerEndIdx = mdVal.indexOf(CURSOR_MARKER_END);
          if (markerIdx >= 0) {
            var selStart = markerIdx;
            var selEnd = markerIdx;
            if (markerEndIdx >= 0 && markerEndIdx > markerIdx) {
              selEnd = markerEndIdx;
            }
            var strippedMd = mdVal.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
            var bqLines = strippedMd.split('\n');
            var bqOut = [];
            var bqi = 0;
            while (bqi < bqLines.length) {
              if (/^>/.test(bqLines[bqi])) {
                var bqBlk = [];
                while (bqi < bqLines.length && /^>/.test(bqLines[bqi])) { bqBlk.push(bqLines[bqi]); bqi++; }
                while (bqBlk.length > 0 && /^>/.test(bqBlk[bqBlk.length - 1]) && !bqBlk[bqBlk.length - 1].replace(/^>/, '').replace(/[\s\u00a0]/g, '')) bqBlk.pop();
                for (var bk = 0; bk < bqBlk.length; bk++) bqOut.push(bqBlk[bk]);
              } else { bqOut.push(bqLines[bqi]); bqi++; }
            }
            this.markdownArea.value = bqOut.join('\n');
            var len = this.markdownArea.value.length;
            if (markerEndIdx >= 0 && markerEndIdx > markerIdx) {
              selEnd = markerEndIdx - 6;
            }
            selStart = Math.min(selStart, len);
            selEnd = Math.min(Math.max(selEnd, selStart), len);
            var selText = this.markdownArea.value.substring(selStart, selEnd);
            var headingMatch = selText.match(/^(\s*#{1,6}\s+)/);
            if (headingMatch) {
              selStart += headingMatch[1].length;
            }
            selStart = Math.min(selStart, len);
            selEnd = Math.min(Math.max(selEnd, selStart), len);
            this.markdownArea.setSelectionRange(selStart, selEnd);
            if (this._updateMarkdownLineNumbers) this._updateMarkdownLineNumbers();
          }
          scrollToCenterCursor(this.markdownArea, true, this.markdownArea.selectionStart);
          if (this.markdownLineNumbersDiv) this.markdownLineNumbersDiv.scrollTop = this.markdownArea.scrollTop;
        }
      } else if (mode === 'wysiwyg' && this.editableArea) {
        enhanceCodeBlocks(this.editableArea);
      }
      return result;
    };
  })();

  const COOKIE_NAME = 'liveWysiwygEditorEnabled';

  function getEditorStateFromCookie() {
    if (typeof document === 'undefined' || !document.cookie) return null;
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    if (!match) return null;
    var val = match[1];
    var parts = val.split(':');
    var enabled = parts[0] === '1' || parts[0] === 'true';
    var mode = (parts[1] === 'wysiwyg' || parts[1] === 'markdown') ? parts[1] : 'wysiwyg';
    return { enabled: enabled, mode: mode };
  }

  function setEditorStateCookie(enabled, mode) {
    if (typeof document === 'undefined') return;
    var modeVal = (mode === 'markdown' || mode === 'wysiwyg') ? mode : 'wysiwyg';
    var value = (enabled ? '1' : '0') + ':' + modeVal;
    var maxAge = 365 * 24 * 60 * 60;
    document.cookie = COOKIE_NAME + '=' + value + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
  }

  function isEditorEnabledByCookie() {
    var state = getEditorStateFromCookie();
    if (state === null) return null;
    return state.enabled;
  }

  function getEditorModeFromCookie() {
    var state = getEditorStateFromCookie();
    if (state === null) return 'wysiwyg';
    return state.mode;
  }

  let wysiwygEditor = null;
  let wysiwygContainer = null;
  let cancelObserver = null;
  let toggleButton = null;
  let bodyObserver = null;
  var capturedMarkdownSelection = null;
  var pendingReadModeSelection = null;

  function isInReadMode() {
    if (wysiwygEditor) return false;
    var textarea = document.querySelector('.live-edit-source');
    if (!textarea) return true;
    return textarea.classList.contains('live-edit-hidden') || textarea.offsetParent === null;
  }

  function isSelectionInEditForm(sel) {
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    var container = range.commonAncestorContainer;
    var node = container.nodeType === 3 ? container.parentNode : container;
    if (!node) return false;
    return !!(node.closest && (
      node.closest('.live-edit-wysiwyg-wrapper') ||
      node.closest('.live-edit-source') ||
      node.closest('.live-edit-controls')
    ));
  }

  var CONTEXT_LEN = 60;

  function getSelectionContext(range) {
    var root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    while (root && root !== document.body) {
      var r = root.getAttribute && root.getAttribute('role');
      if (r === 'main' || root.tagName === 'ARTICLE' || (root.classList && root.classList.contains('md-content'))) break;
      root = root.parentNode;
    }
    if (!root) root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    var fullText = root.textContent || '';
    var preRange = document.createRange();
    preRange.selectNodeContents(root);
    preRange.setEnd(range.startContainer, range.startOffset);
    var startOffset = preRange.toString().length;
    var postRange = document.createRange();
    postRange.selectNodeContents(root);
    postRange.setStart(range.endContainer, range.endOffset);
    var endOffset = fullText.length - postRange.toString().length;
    var contextBefore = fullText.substring(Math.max(0, startOffset - CONTEXT_LEN), startOffset);
    var contextAfter = fullText.substring(endOffset, Math.min(fullText.length, endOffset + CONTEXT_LEN));
    return { contextBefore: contextBefore, contextAfter: contextAfter };
  }

  function storeSelectionIfReadMode(sel) {
    if (!isInReadMode()) return;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    if (isSelectionInEditForm(sel)) return;
    var range = sel.getRangeAt(0);
    var selectedText = range.toString();
    if (!selectedText || selectedText.length === 0) return;
    var ctx = getSelectionContext(range);
    pendingReadModeSelection = {
      selectedText: selectedText,
      contextBefore: ctx.contextBefore,
      contextAfter: ctx.contextAfter
    };
  }

  var selectionEditPopup = null;
  var selectionEditPopupHideTimer = null;

  function findEditModeTrigger() {
    var candidates = document.querySelectorAll('.live-edit-controls button, .live-edit-controls a, a, button');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.closest && el.closest('.live-edit-wysiwyg-wrapper')) continue;
      var text = (el.textContent || '').trim();
      if (text.indexOf('Editor') >= 0) continue;
      if (text.indexOf('Edit') >= 0) return el;
      if (el.getAttribute && (el.getAttribute('title') || '').indexOf('Edit') >= 0) return el;
    }
    return null;
  }

  function ensureSelectionEditPopup() {
    if (selectionEditPopup) return;
    selectionEditPopup = document.createElement('div');
    selectionEditPopup.className = 'live-wysiwyg-selection-edit-popup';
    selectionEditPopup.innerHTML = '<button type="button" class="live-wysiwyg-selection-edit-btn" title="Edit selection">Edit</button>';
    selectionEditPopup.style.cssText = 'position:fixed;z-index:9999;padding:4px 8px;background:#333;color:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-size:12px;font-family:inherit;opacity:0;transition:opacity 0.15s;pointer-events:none;visibility:hidden;';
    var btn = selectionEditPopup.querySelector('button');
    btn.style.cssText = 'background:transparent;border:none;color:inherit;cursor:pointer;padding:0 4px;font-size:inherit;';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      storeSelectionIfReadMode(window.getSelection());
      var trigger = findEditModeTrigger();
      if (trigger) trigger.click();
      hideSelectionEditPopup();
    });
    document.body.appendChild(selectionEditPopup);
  }

  function showSelectionEditPopup(rect) {
    ensureSelectionEditPopup();
    if (selectionEditPopupHideTimer) {
      clearTimeout(selectionEditPopupHideTimer);
      selectionEditPopupHideTimer = null;
    }
    var popup = selectionEditPopup;
    var popupRect = popup.getBoundingClientRect();
    var top = rect.top - popupRect.height - 6;
    if (top < 8) top = rect.bottom + 6;
    var left = rect.left + (rect.width / 2) - (popup.offsetWidth / 2);
    if (left < 8) left = 8;
    if (left + popup.offsetWidth > window.innerWidth - 8) left = window.innerWidth - popup.offsetWidth - 8;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.opacity = '1';
    popup.style.pointerEvents = 'auto';
    popup.style.visibility = 'visible';
  }

  function hideSelectionEditPopup() {
    if (!selectionEditPopup) return;
    selectionEditPopup.style.opacity = '0';
    selectionEditPopup.style.pointerEvents = 'none';
    if (selectionEditPopupHideTimer) clearTimeout(selectionEditPopupHideTimer);
    selectionEditPopupHideTimer = setTimeout(function () {
      if (selectionEditPopup) selectionEditPopup.style.visibility = 'hidden';
      selectionEditPopupHideTimer = null;
    }, 150);
  }

  function updateSelectionEditPopup() {
    if (!isInReadMode()) {
      hideSelectionEditPopup();
      return;
    }
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideSelectionEditPopup();
      return;
    }
    if (isSelectionInEditForm(sel)) {
      hideSelectionEditPopup();
      return;
    }
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) {
      hideSelectionEditPopup();
      return;
    }
    showSelectionEditPopup(rect);
  }

  function captureReadModeSelectionOnChange() {
    document.addEventListener('selectionchange', function () {
      storeSelectionIfReadMode(window.getSelection());
      updateSelectionEditPopup();
    });
    document.addEventListener('mousedown', function (e) {
      storeSelectionIfReadMode(window.getSelection());
      if (selectionEditPopup && selectionEditPopup.contains(e.target)) return;
      hideSelectionEditPopup();
    }, true);
    document.addEventListener('scroll', hideSelectionEditPopup, true);
  }
  captureReadModeSelectionOnChange();

  function getControlsElement(textarea) {
    var controls = textarea ? textarea.closest('.live-edit-controls') : null;
    if (controls) return controls;
    return document.querySelector('.live-edit-controls');
  }

  function getButtonLabel(isWysiwygActive) {
    var text = isWysiwygActive ? 'Disable Editor' : 'Enable Editor';
    if (typeof liveWysiwygIconDataUrl !== 'undefined' && liveWysiwygIconDataUrl) {
      return '<img src="' + liveWysiwygIconDataUrl + '" alt="" class="live-wysiwyg-btn-icon" aria-hidden="true"> ' + text;
    }
    return text;
  }

  function updateToggleButton(isWysiwygActive) {
    if (!toggleButton) return;
    if (typeof liveWysiwygIconDataUrl !== 'undefined' && liveWysiwygIconDataUrl) {
      toggleButton.innerHTML = getButtonLabel(isWysiwygActive);
    } else {
      toggleButton.textContent = getButtonLabel(isWysiwygActive);
    }
  }

  function ensureToggleButton(textarea, isWysiwygActive) {
    if (toggleButton && toggleButton.parentNode) return;
    var controls = getControlsElement(textarea);
    if (!controls) return;
    var label = controls.querySelector('.live-edit-label');
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'live-edit-button';
    if (typeof liveWysiwygIconDataUrl !== 'undefined' && liveWysiwygIconDataUrl) {
      toggleButton.innerHTML = getButtonLabel(isWysiwygActive);
    } else {
      toggleButton.textContent = getButtonLabel(isWysiwygActive);
    }
    toggleButton.title = isWysiwygActive ? 'Switch to plain textarea' : 'Switch to WYSIWYG editor';
    toggleButton.addEventListener('click', function () {
      if (wysiwygEditor) {
        setEditorStateCookie(false, wysiwygEditor.currentMode);
        destroyWysiwyg(textarea, false, true);
        updateToggleButton(false);
      } else {
        setEditorStateCookie(true, getEditorModeFromCookie());
        replaceTextareaWithWysiwyg(textarea);
        updateToggleButton(true);
      }
    });
    controls.insertBefore(toggleButton, label ? label.nextSibling : controls.firstChild);
  }

  function removeToggleButton() {
    if (toggleButton && toggleButton.parentNode) {
      toggleButton.parentNode.removeChild(toggleButton);
      toggleButton = null;
    }
  }

  function startBodyObserver() {
    if (bodyObserver) return;
    function checkAndHandle() {
      if (observeForTextarea()) {
        stopBodyObserver();
      }
    }
    bodyObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length) {
          checkAndHandle();
          return;
        }
        if (m.type === 'attributes' && m.attributeName === 'class') {
          var el = m.target;
          if (el.classList && el.classList.contains('live-edit-source') && !el.classList.contains('live-edit-hidden')) {
            checkAndHandle();
            return;
          }
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    var hiddenTextarea = document.querySelector('.live-edit-source.live-edit-hidden');
    if (hiddenTextarea) {
      bodyObserver.observe(hiddenTextarea, { attributes: true, attributeFilter: ['class'] });
    }
    checkAndHandle();
  }

  function stopBodyObserver() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
  }

  function destroyWysiwyg(textarea, leavingEditMode, userRequestedDisable) {
    var cursorState = null;
    if (textarea && wysiwygEditor && !leavingEditMode) {
      var ed = wysiwygEditor;
      if (ed.currentMode === 'markdown') {
        var mdContent = ed.markdownArea.value;
        if (mdContent && !mdContent.endsWith('\n')) mdContent += '\n';
        textarea.value = mdContent;
        cursorState = {
          start: ed.markdownArea.selectionStart,
          end: ed.markdownArea.selectionEnd,
          scrollTop: ed.markdownArea ? ed.markdownArea.scrollTop : 0
        };
      } else {
        injectMarkerAtCaretInEditable(ed.editableArea);
        var md = ed.getValue();
        var markerIdx = md.indexOf(CURSOR_MARKER);
        if (markerIdx >= 0) {
          cursorState = {
            start: markerIdx,
            end: markerIdx,
            scrollTop: ed.editableArea ? ed.editableArea.scrollTop : 0
          };
          ed.editableArea.innerHTML = ed.editableArea.innerHTML.replace(CURSOR_MARKER_RE, '');
        }
      }
    }
    if (cancelObserver) {
      cancelObserver.disconnect();
      cancelObserver = null;
    }
    var lastMode = wysiwygEditor ? wysiwygEditor.currentMode : null;
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
    if (leavingEditMode) {
      if (lastMode) {
        setEditorStateCookie(true, lastMode);
      }
      pendingReadModeSelection = null;
      removeToggleButton();
      startBodyObserver();
    }
    if (textarea) {
      textarea.style.display = '';
      textarea.removeAttribute('data-live-wysiwyg-replaced');
      if (cursorState) {
        textarea.selectionStart = Math.min(cursorState.start, textarea.value.length);
        textarea.selectionEnd = Math.min(cursorState.end, textarea.value.length);
        scrollToCenterCursor(textarea, true, textarea.selectionStart);
      }
      if (leavingEditMode) {
        return;
      }
      if (userRequestedDisable) {
        ensureToggleButton(textarea, false);
        updateToggleButton(false);
      } else {
        var ck = isEditorEnabledByCookie();
        var shouldReload = ck !== null ? ck : (typeof liveWysiwygAutoload !== 'undefined' && liveWysiwygAutoload);
        if (shouldReload) {
          setupReplacementObserver(textarea);
        } else {
          ensureToggleButton(textarea, false);
          updateToggleButton(false);
        }
      }
    }
  }

  function setupReplacementObserver(textarea) {
    if (!textarea || !textarea.parentNode) return;
    if (cancelObserver) cancelObserver.disconnect();
    cancelObserver = new MutationObserver(function () {
      if (!textarea.parentNode) return;
      if (!textarea.classList.contains('live-edit-hidden') && !textarea.dataset.liveWysiwygReplaced) {
        var ck = isEditorEnabledByCookie();
        if (!(ck !== null ? ck : (typeof liveWysiwygAutoload !== 'undefined' && liveWysiwygAutoload))) return;
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
    var savedCursor = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      scrollTop: textarea.scrollTop
    };

    wysiwygContainer = document.createElement('div');
    wysiwygContainer.id = 'live-edit-wysiwyg-container';
    wysiwygContainer.className = 'live-edit-wysiwyg-wrapper';
    wysiwygContainer.style.cssText = 'width: 100%; min-height: 50vh; margin: 5px;';

    textarea.parentNode.insertBefore(wysiwygContainer, textarea);
    textarea.style.display = 'none';

    var preferredMode = getEditorModeFromCookie();
    try {
      wysiwygEditor = new MarkdownWYSIWYG('live-edit-wysiwyg-container', {
        initialValue: initialValue,
        initialMode: preferredMode,
        showToolbar: true,
        onUpdate: function (markdownContent) {
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygLinkData) {
            markdownContent = postprocessMarkdownLinks(markdownContent, wysiwygEditor._liveWysiwygLinkData);
          }
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygListMarkerData) {
            markdownContent = postprocessListMarkers(markdownContent, wysiwygEditor._liveWysiwygListMarkerData);
          }
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygTableSepData) {
            markdownContent = postprocessTableSeparators(markdownContent, wysiwygEditor._liveWysiwygTableSepData);
          }
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygCodeBlockData) {
            markdownContent = postprocessCodeBlocks(markdownContent, wysiwygEditor._liveWysiwygCodeBlockData);
          }
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygLinkData) {
            markdownContent = dryDuplicateInlineLinks(markdownContent, wysiwygEditor._liveWysiwygLinkData);
          }
          if (markdownContent) {
            markdownContent = markdownContent.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
            if (!markdownContent.endsWith('\n')) {
              markdownContent = markdownContent + '\n';
            }
          }
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

    (function () {
      var ma = wysiwygEditor.markdownArea;
      if (ma && !ma.dataset.liveWysiwygBlurAttached) {
        ma.dataset.liveWysiwygBlurAttached = '1';
        ma.addEventListener('blur', function () {
          capturedMarkdownSelection = { start: ma.selectionStart, end: ma.selectionEnd };
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygPasteAttached) {
        ea.dataset.liveWysiwygPasteAttached = '1';
        var urlRe = /^https?:\/\/\S+$/;
        ea.addEventListener('paste', function (e) {
          var sel = window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          var pasted = (e.clipboardData || window.clipboardData).getData('text');
          if (!pasted || !urlRe.test(pasted.trim())) return;
          e.preventDefault();
          var url = pasted.trim();
          document.execCommand('createLink', false, url);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        });
      }
    })();

    const observer = new MutationObserver(function () {
      if (!textarea.parentNode) return;
      if (textarea.classList.contains('live-edit-hidden')) {
        observer.disconnect();
        destroyWysiwyg(textarea, true, false);
      }
    });
    observer.observe(textarea, { attributes: true, attributeFilter: ['class'] });
    ensureToggleButton(textarea, true);
    updateToggleButton(true);

    (function patchEditorModeCookie() {
      var orig = wysiwygEditor.switchToMode;
      wysiwygEditor.switchToMode = function (mode, isInitialSetup) {
        var result = orig.apply(this, arguments);
        if (!isInitialSetup && wysiwygEditor) {
          setEditorStateCookie(true, mode);
        }
        return result;
      };
    })();

    if (wysiwygEditor) {
      wysiwygEditor.switchToMode(preferredMode, true);
      var appliedReadModeSelection = applyPendingReadModeSelection(wysiwygEditor);
      if (!appliedReadModeSelection) {
        if (preferredMode === 'markdown') {
          wysiwygEditor.markdownArea.setSelectionRange(0, 0);
          wysiwygEditor.markdownArea.scrollTop = 0;
          if (wysiwygEditor.markdownLineNumbersDiv) {
            wysiwygEditor.markdownLineNumbersDiv.scrollTop = 0;
          }
        } else {
          var ea = wysiwygEditor.editableArea;
          if (ea) {
            ea.scrollTop = 0;
            if (lastWysiwygSemanticSelection && restoreSelectionFromSemantic(ea, lastWysiwygSemanticSelection)) {
              installSemanticClearListeners(ea);
            } else {
              var range = document.createRange();
              range.selectNodeContents(ea);
              range.collapse(true);
              var sel = window.getSelection();
              if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            }
          }
        }
      }
    }
  }

  function observeForTextarea() {
    var textarea = document.querySelector('.live-edit-source');
    if (!textarea || textarea.classList.contains('live-edit-hidden')) return false;
    var cookieEnabled = isEditorEnabledByCookie();
    var shouldAutoload = cookieEnabled !== null ? cookieEnabled : (typeof liveWysiwygAutoload !== 'undefined' && liveWysiwygAutoload);
    ensureToggleButton(textarea, false);
    if (shouldAutoload) {
      replaceTextareaWithWysiwyg(textarea);
    } else {
      updateToggleButton(false);
    }
    return true;
  }

  function init() {
    if (!observeForTextarea()) {
      startBodyObserver();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
