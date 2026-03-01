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
        var hasSingleCodeChild = node.firstChild && node.firstChild.nodeName === 'CODE' && node.childNodes.length === 1;
        if (!hasSingleCodeChild) {
          var parts = [];
          for (var k = 0; k < node.childNodes.length; k++) {
            var ch = node.childNodes[k];
            if (ch.nodeType === 3) parts.push(ch.textContent);
            else if (ch.nodeType === 1) parts.push(ch.textContent);
          }
          var preContent = parts.join('\n');
          if (preContent.length > 0 && !preContent.endsWith('\n')) preContent += '\n';
          var codeEl = node.querySelector && node.querySelector('code');
          var langMatch = codeEl && codeEl.className && codeEl.className.match(/language-(\S+)/);
          var lang = langMatch ? langMatch[1] : '';
          return '```' + lang + '\n' + preContent + '```\n\n';
        }
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
    var used = [];

    function replaceMatch(match, text, url, isImage) {
      var cleanUrl = normalizeUrl(url);
      for (var i = 0; i < linkOriginals.length; i++) {
        if (!used[i] && linkOriginals[i].url === cleanUrl && linkOriginals[i].text === text && !!linkOriginals[i].isImage === !!isImage) {
          used[i] = true;
          return linkOriginals[i].original;
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

  (function patchSetValueAndSwitchToModeForLinkPrePost() {
    var proto = MarkdownWYSIWYG.prototype;
    var origSetValue = proto.setValue;
    var origSwitchToMode = proto.switchToMode;
    if (!origSetValue || !origSwitchToMode) return;
    proto.setValue = function (markdown, isInitialSetup) {
      if (markdown) {
        this._liveWysiwygLinkData = preprocessMarkdownLinks(markdown);
        this._liveWysiwygListMarkerData = preprocessListMarkers(markdown);
      }
      return origSetValue.apply(this, arguments);
    };
    proto.switchToMode = function (mode, isInitialSetup) {
      if (mode === 'wysiwyg' && !isInitialSetup && this.markdownArea && this.markdownArea.value) {
        var body = parseFrontmatter(this.markdownArea.value).body;
        this._liveWysiwygLinkData = preprocessMarkdownLinks(body);
        this._liveWysiwygListMarkerData = preprocessListMarkers(body);
      }
      var result = origSwitchToMode.apply(this, arguments);
      if (mode === 'markdown') {
        var md = this.markdownArea.value;
        if (this._liveWysiwygLinkData) {
          md = postprocessMarkdownLinks(md, this._liveWysiwygLinkData);
          if (md !== this.markdownArea.value) {
            this.markdownArea.value = md;
            if (this.options && this.options.onUpdate) this.options.onUpdate(this.getValue());
          }
        }
        if (this._liveWysiwygListMarkerData) {
          md = postprocessListMarkers(this.markdownArea.value, this._liveWysiwygListMarkerData);
          if (md !== this.markdownArea.value) {
            this.markdownArea.value = md;
            if (this.options && this.options.onUpdate) this.options.onUpdate(this.getValue());
          }
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

  function restoreScrollPosition(container, scrollTop) {
    if (container && typeof scrollTop === 'number') {
      container.scrollTop = Math.min(scrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    }
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
      return origSetValue.call(this, parsed.body, isInitialSetup);
    };
    proto.getValue = function () {
      var body = origGetValue.call(this);
      return serializeWithFrontmatter(this._liveWysiwygFrontmatter, body);
    };
    proto.switchToMode = function (mode, isInitialSetup) {
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
            var spanMarker = '<span ' + CURSOR_SPAN_ATTR + '></span>';
            var spanMarkerEnd = '<span ' + CURSOR_SPAN_ATTR_END + '></span>';
            var testMd;
            if (insertStart === insertEnd) {
              testMd = mdVal.slice(0, insertStart) + spanMarker + mdVal.slice(insertStart);
            } else {
              testMd = mdVal.slice(0, insertStart) + spanMarker + mdVal.slice(insertStart, insertEnd) + spanMarkerEnd + mdVal.slice(insertEnd);
            }
            var testHtml = this._markdownToHtml(testMd);
            var roundTrippedMd = this._htmlToMarkdown(testHtml);
            roundTrippedMd = roundTrippedMd.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
            var normMd = function (s) { return (s || '').replace(/\n\s*\n\s*\n+/g, '\n\n').replace(/ +\n/g, '\n').trim(); };
            if (normMd(roundTrippedMd) === normMd(mdVal)) {
              this.markdownArea.value = testMd;
              markdownMarkerInserted = true;
            } else {
              cursorBlockFallback = getBlockIndexForLine(mdVal, mdVal.slice(0, selStart).split('\n').length - 1);
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
          if (cursorInFrontmatter || cursorAtDocStart) {
            requestAnimationFrame(function () {
              editableArea.focus();
              setSelectionInEditable(editableArea, 0, 0);
              editableArea.scrollTop = 0;
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
                var html = editableArea.innerHTML;
                editableArea.innerHTML = html.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
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
                editableArea.focus();
                setSelectionInEditable(editableArea, selStart, selEnd);
              }
              scrollToCenterCursor(editableArea, false);
              editableArea.focus();
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
            this.markdownArea.value = mdVal.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '');
            var len = this.markdownArea.value.length;
            if (markerEndIdx >= 0 && markerEndIdx > markerIdx) {
              selEnd = markerEndIdx - 6;
            }
            selStart = Math.min(selStart, len);
            selEnd = Math.min(Math.max(selEnd, selStart), len);
            this.markdownArea.setSelectionRange(selStart, selEnd);
            if (this._updateMarkdownLineNumbers) this._updateMarkdownLineNumbers();
          }
          scrollToCenterCursor(this.markdownArea, true, this.markdownArea.selectionStart);
          if (this.markdownLineNumbersDiv) this.markdownLineNumbersDiv.scrollTop = this.markdownArea.scrollTop;
        }
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
          if (markdownContent && !markdownContent.endsWith('\n')) {
            markdownContent = markdownContent + '\n';
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

    if (savedCursor.start >= 0 && wysiwygEditor) {
      var parsed = parseFrontmatter(initialValue);
      var frontmatterLen = (parsed.frontmatter || '').length;
      var bodyStart = Math.max(0, savedCursor.start - frontmatterLen);
      var bodyEnd = Math.max(0, savedCursor.end - frontmatterLen);
      wysiwygEditor.markdownArea.setSelectionRange(bodyStart, bodyEnd);
      scrollToCenterCursor(wysiwygEditor.markdownArea, true, bodyStart);
      if (wysiwygEditor.markdownLineNumbersDiv) {
        wysiwygEditor.markdownLineNumbersDiv.scrollTop = wysiwygEditor.markdownArea.scrollTop;
      }
      wysiwygEditor.switchToMode(preferredMode, true);
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
