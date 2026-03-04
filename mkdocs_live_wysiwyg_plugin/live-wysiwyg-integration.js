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

  /**
   * Ensure new list items in a checklist get a checkbox. When user presses Enter in a
   * checklist item, the browser creates a new LI without a checkbox. This adds one.
   */
  function ensureChecklistNewItems(editableArea) {
    if (!editableArea) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    var node = range.startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    var li = node;
    while (li && li !== editableArea) {
      if (li.nodeName === 'LI') break;
      li = li.parentNode;
    }
    if (!li || li.parentNode.nodeName !== 'UL') return;
    var ul = li.parentNode;
    var hasCheckbox = ul.querySelector('li input[type="checkbox"]');
    if (!hasCheckbox) return;
    var firstChild = li.firstChild;
    while (firstChild && firstChild.nodeType === 3 && !firstChild.textContent.trim()) firstChild = firstChild.nextSibling;
    if (firstChild && firstChild.nodeName === 'INPUT' && firstChild.type === 'checkbox') return;
    var prevLi = li.previousElementSibling;
    var prevChecked = false;
    if (prevLi && prevLi.nodeName === 'LI') {
      var prevCb = getDirectCheckboxOfLi(prevLi);
      if (prevCb) prevChecked = prevCb.checked;
    }
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = prevChecked;
    cb.setAttribute('data-live-wysiwyg-checklist', '1');
    cb.setAttribute('contenteditable', 'false');
    (function (checkbox) {
      function onCheckboxMouseDown(e) {
        if (e.target !== checkbox) return;
        e.preventDefault();
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        var editable = checkbox.closest && checkbox.closest('[contenteditable="true"]');
        if (editable && editable.dispatchEvent) {
          editable.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      function onCheckboxClick(e) {
        if (e.target !== checkbox) return;
        e.preventDefault();
        e.stopPropagation();
      }
      checkbox.addEventListener('mousedown', onCheckboxMouseDown, true);
      checkbox.addEventListener('click', onCheckboxClick, true);
    })(cb);
    var savedNode = range.startContainer;
    var savedOffset = range.startOffset;

    var space = document.createTextNode('\u00a0 ');
    li.insertBefore(space, li.firstChild);
    li.insertBefore(cb, space);

    var cursorBeforeCb = (savedNode === li && savedOffset <= 2) ||
        savedNode === cb || savedNode === space;
    var newRange = document.createRange();
    try {
      if (cursorBeforeCb) {
        newRange.setStart(space, 2);
      } else {
        newRange.setStart(savedNode, savedOffset);
      }
    } catch (ex) {
      newRange.setStart(space, 2);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  /**
   * Fix malformed nested lists: when indent creates UL/OL as sibling of LI instead of
   * child, move the list into the previous LI so markdown indentation persists.
   */
  function fixMalformedNestedLists(editableArea) {
    if (!editableArea) return;
    var changed;
    do {
      changed = false;
      var lists = editableArea.querySelectorAll('ul, ol');
      for (var i = 0; i < lists.length; i++) {
        var list = lists[i];
        var parent = list.parentNode;
        if (!parent || (parent.nodeName !== 'UL' && parent.nodeName !== 'OL')) continue;
        var prev = list.previousSibling;
        while (prev && prev.nodeType !== 1) prev = prev.previousSibling;
        if (prev && prev.nodeName === 'LI') {
          prev.appendChild(list);
          changed = true;
          break;
        }
      }
    } while (changed);
  }

  /**
   * Enhance checklist items: make checkboxes clickable and toggle on click.
   * Checkboxes are rendered by marked (GFM task lists) as disabled; we remove disabled
   * and add a handler to toggle checked state. Uses mousedown in capture phase so we
   * intercept before contenteditable handles the event (which can block checkbox toggling).
   */
  function enhanceChecklists(editableArea) {
    if (!editableArea) return;
    var checkboxes = editableArea.querySelectorAll('li input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      if (cb.getAttribute('data-live-wysiwyg-checklist') === '1') continue;
      cb.setAttribute('data-live-wysiwyg-checklist', '1');
      cb.removeAttribute('disabled');
      cb.setAttribute('contenteditable', 'false');
      (function (checkbox) {
        function onCheckboxMouseDown(e) {
          if (e.target !== checkbox) return;
          e.preventDefault();
          e.stopPropagation();
          checkbox.checked = !checkbox.checked;
          var editable = checkbox.closest && checkbox.closest('[contenteditable="true"]');
          if (editable && editable.dispatchEvent) {
            editable.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        function onCheckboxClick(e) {
          if (e.target !== checkbox) return;
          e.preventDefault();
          e.stopPropagation();
        }
        checkbox.addEventListener('mousedown', onCheckboxMouseDown, true);
        checkbox.addEventListener('click', onCheckboxClick, true);
      })(cb);
    }
  }

  var CODE_LANG_LIST = [
    'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp',
    'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'bash',
    'shell', 'sql', 'html', 'css', 'json', 'yaml', 'xml', 'markdown',
    'dockerfile', 'terraform', 'lua', 'perl', 'r', 'matlab', 'groovy'
  ];

  var _indentSettingsCache = null;
  function getIndentSettings() {
    if (_indentSettingsCache) return _indentSettingsCache;
    var defaults = { enabled: true, type: 'space', size: 4 };
    try {
      var match = document.cookie.match(/(?:^|;\s*)liveWysiwygIndent=([^;]*)/);
      if (match) {
        var parsed = JSON.parse(decodeURIComponent(match[1]));
        defaults.enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
        defaults.type = parsed.type === 'tab' ? 'tab' : 'space';
        defaults.size = [2, 4, 8].indexOf(parsed.size) !== -1 ? parsed.size : 4;
      }
    } catch (e) {}
    _indentSettingsCache = defaults;
    return defaults;
  }
  function setIndentSettings(settings) {
    _indentSettingsCache = settings;
    var val = encodeURIComponent(JSON.stringify(settings));
    document.cookie = 'liveWysiwygIndent=' + val + ';path=/;max-age=31536000;SameSite=Lax';
  }

  var _activeSettingsDropdown = null;
  function dismissActiveSettingsDropdown() {
    if (_activeSettingsDropdown) {
      if (_activeSettingsDropdown.el.parentNode) _activeSettingsDropdown.el.parentNode.removeChild(_activeSettingsDropdown.el);
      if (_activeSettingsDropdown.closeHandler) document.removeEventListener('mousedown', _activeSettingsDropdown.closeHandler, true);
      if (_activeSettingsDropdown.scrollHandler) window.removeEventListener('scroll', _activeSettingsDropdown.scrollHandler, true);
      _activeSettingsDropdown = null;
    }
  }

  var _activeLangDropdown = null;

  function dismissActiveLangDropdown() {
    if (_activeLangDropdown) {
      if (_activeLangDropdown.el.parentNode) _activeLangDropdown.el.parentNode.removeChild(_activeLangDropdown.el);
      if (_activeLangDropdown.closeHandler) document.removeEventListener('mousedown', _activeLangDropdown.closeHandler, true);
      if (_activeLangDropdown.scrollHandler) window.removeEventListener('scroll', _activeLangDropdown.scrollHandler, true);
      _activeLangDropdown = null;
    }
  }

  function createLangDropdown(anchorBtn, currentLang, onSelect) {
    dismissActiveLangDropdown();
    var dropdown = document.createElement('div');
    dropdown.className = 'md-code-lang-dropdown';
    dropdown.setAttribute('contenteditable', 'false');
    var filter = document.createElement('input');
    filter.className = 'md-code-lang-filter';
    filter.type = 'text';
    filter.placeholder = 'Filter...';
    filter.value = currentLang || '';
    dropdown.appendChild(filter);
    var list = document.createElement('div');
    list.className = 'md-code-lang-list';
    dropdown.appendChild(list);
    function render(filterText) {
      list.innerHTML = '';
      var ft = (filterText || '').toLowerCase();
      var langs = CODE_LANG_LIST.filter(function (l) { return !ft || l.indexOf(ft) !== -1; });
      if (ft && langs.indexOf(ft) === -1 && ft.match(/^[a-z0-9_+#.-]+$/i)) {
        langs.unshift(ft);
      }
      for (var i = 0; i < langs.length; i++) {
        var item = document.createElement('div');
        item.className = 'md-code-lang-item';
        if (langs[i] === currentLang) item.classList.add('md-code-lang-item-active');
        item.textContent = langs[i];
        item.setAttribute('data-lang', langs[i]);
        list.appendChild(item);
      }
    }
    render(filter.value);
    filter.addEventListener('input', function () { render(filter.value); });
    function wrappedSelect(chosen) {
      dismissActiveLangDropdown();
      onSelect(chosen);
    }
    list.addEventListener('mousedown', function (e) {
      var item = e.target;
      if (!item.classList || !item.classList.contains('md-code-lang-item')) return;
      e.preventDefault();
      e.stopPropagation();
      wrappedSelect(item.getAttribute('data-lang'));
    });
    filter.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = list.querySelector('.md-code-lang-item');
        if (first) wrappedSelect(first.getAttribute('data-lang'));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        wrappedSelect(null);
      }
    });

    function positionDropdown() {
      var rect = anchorBtn.getBoundingClientRect();
      var left = rect.right - 180;
      if (left < 0) left = rect.left;
      dropdown.style.top = (rect.bottom + 2) + 'px';
      dropdown.style.left = left + 'px';
    }

    document.body.appendChild(dropdown);
    positionDropdown();

    var closeHandler = function (ev) {
      if (dropdown.contains(ev.target) || ev.target === anchorBtn) return;
      dismissActiveLangDropdown();
    };
    document.addEventListener('mousedown', closeHandler, true);

    var scrollHandler = function () { positionDropdown(); };
    window.addEventListener('scroll', scrollHandler, true);

    _activeLangDropdown = { el: dropdown, closeHandler: closeHandler, scrollHandler: scrollHandler };

    return { el: dropdown, focusFilter: function () { requestAnimationFrame(function () { filter.focus(); }); } };
  }

  function addLangButtonToBasicPre(pre, editableArea) {
    if (pre.querySelector('.md-code-lang-btn')) return;
    if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('md-code-block')) return;
    var btn = document.createElement('button');
    btn.className = 'md-code-lang-btn';
    btn.setAttribute('contenteditable', 'false');
    btn.textContent = 'lang';
    btn.type = 'button';
    pre.style.position = 'relative';
    pre.appendChild(btn);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (_activeLangDropdown) return;
      var dd = createLangDropdown(btn, '', function (chosen) {
        if (!chosen) return;
        convertBasicToAdvanced(pre, chosen, editableArea);
      });
      dd.focusFilter();
    });
    addSettingsButtonToBasicPre(pre);
  }

  function convertBasicToAdvanced(pre, lang, editableArea) {
    pre.setAttribute('data-lang', lang);
    var codeEl = pre.querySelector('code');
    if (codeEl) codeEl.className = 'language-' + lang;
    var oldBtn = pre.querySelector('.md-code-lang-btn');
    if (oldBtn) oldBtn.parentNode.removeChild(oldBtn);
    var oldDD = pre.querySelector('.md-code-lang-dropdown');
    if (oldDD) oldDD.parentNode.removeChild(oldDD);
    var oldSettings = pre.querySelector('.md-code-settings-btn');
    if (oldSettings) oldSettings.parentNode.removeChild(oldSettings);
    var oldSettingsDD = pre.querySelector('.md-code-settings-dropdown');
    if (oldSettingsDD) oldSettingsDD.parentNode.removeChild(oldSettingsDD);
    enhanceCodeBlocks(editableArea);
    if (wysiwygEditor && wysiwygEditor._finalizeUpdate) {
      wysiwygEditor._finalizeUpdate(editableArea.innerHTML);
    }
  }

  function addLangButtonToAdvancedBlock(wrapper) {
    if (wrapper.querySelector('.md-code-lang-btn-advanced')) return;
    var pre = wrapper.querySelector('pre');
    if (!pre) return;
    var currentLang = pre.getAttribute('data-lang') || '';
    var btn = document.createElement('button');
    btn.className = 'md-code-lang-btn-advanced';
    btn.setAttribute('contenteditable', 'false');
    btn.textContent = currentLang || 'lang';
    btn.type = 'button';
    wrapper.style.position = 'relative';
    wrapper.appendChild(btn);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (_activeLangDropdown) return;
      var dd = createLangDropdown(btn, pre.getAttribute('data-lang') || '', function (chosen) {
        if (!chosen) return;
        pre.setAttribute('data-lang', chosen);
        var codeEl = pre.querySelector('code');
        if (codeEl) codeEl.className = 'language-' + chosen;
        btn.textContent = chosen;
        var titleBar = wrapper.querySelector('.md-code-title, .md-code-lang');
        if (titleBar && titleBar.classList.contains('md-code-lang')) {
          titleBar.textContent = chosen;
        }
        if (wysiwygEditor && wysiwygEditor._finalizeUpdate) {
          var ea = pre.closest('[contenteditable="true"]');
          if (ea) wysiwygEditor._finalizeUpdate(ea.innerHTML);
        }
      });
      dd.focusFilter();
    });
    addSettingsButtonToAdvancedBlock(wrapper);
  }

  var GEAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  function createSettingsDropdown(anchorBtn) {
    dismissActiveSettingsDropdown();
    var settings = getIndentSettings();
    var dropdown = document.createElement('div');
    dropdown.className = 'md-code-settings-dropdown';
    dropdown.setAttribute('contenteditable', 'false');

    function buildUI() {
      dropdown.innerHTML = '';
      var s = getIndentSettings();

      var row1 = document.createElement('div');
      row1.className = 'md-code-settings-row';
      var lbl1 = document.createElement('span');
      lbl1.className = 'md-code-settings-label';
      lbl1.textContent = 'Auto-indent';
      row1.appendChild(lbl1);
      var toggle = document.createElement('button');
      toggle.className = 'md-code-settings-toggle' + (s.enabled ? ' active' : '');
      toggle.type = 'button';
      toggle.textContent = s.enabled ? 'ON' : 'OFF';
      toggle.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        s.enabled = !s.enabled;
        setIndentSettings(s);
        buildUI();
      });
      row1.appendChild(toggle);
      dropdown.appendChild(row1);

      var row2 = document.createElement('div');
      row2.className = 'md-code-settings-row';
      var lbl2 = document.createElement('span');
      lbl2.className = 'md-code-settings-label';
      lbl2.textContent = 'Type';
      row2.appendChild(lbl2);
      var btnGroup1 = document.createElement('div');
      btnGroup1.className = 'md-code-settings-btn-group';
      var btnSpaces = document.createElement('button');
      btnSpaces.type = 'button';
      btnSpaces.className = 'md-code-settings-opt' + (s.type === 'space' ? ' active' : '');
      btnSpaces.textContent = 'Spaces';
      btnSpaces.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        s.type = 'space';
        setIndentSettings(s);
        buildUI();
      });
      btnGroup1.appendChild(btnSpaces);
      var btnTabs = document.createElement('button');
      btnTabs.type = 'button';
      btnTabs.className = 'md-code-settings-opt' + (s.type === 'tab' ? ' active' : '');
      btnTabs.textContent = 'Tabs';
      btnTabs.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        s.type = 'tab';
        setIndentSettings(s);
        buildUI();
      });
      btnGroup1.appendChild(btnTabs);
      row2.appendChild(btnGroup1);
      dropdown.appendChild(row2);

      if (s.type === 'space') {
        var row3 = document.createElement('div');
        row3.className = 'md-code-settings-row';
        var lbl3 = document.createElement('span');
        lbl3.className = 'md-code-settings-label';
        lbl3.textContent = 'Size';
        row3.appendChild(lbl3);
        var btnGroup2 = document.createElement('div');
        btnGroup2.className = 'md-code-settings-btn-group';
        [2, 4, 8].forEach(function (n) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'md-code-settings-opt' + (s.size === n ? ' active' : '');
          b.textContent = String(n);
          b.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            s.size = n;
            setIndentSettings(s);
            buildUI();
          });
          btnGroup2.appendChild(b);
        });
        row3.appendChild(btnGroup2);
        dropdown.appendChild(row3);
      }
    }
    buildUI();

    function positionDropdown() {
      var rect = anchorBtn.getBoundingClientRect();
      var left = rect.right - 200;
      if (left < 0) left = rect.left;
      dropdown.style.top = (rect.bottom + 2) + 'px';
      dropdown.style.left = left + 'px';
    }
    document.body.appendChild(dropdown);
    positionDropdown();

    var closeHandler = function (ev) {
      if (dropdown.contains(ev.target) || ev.target === anchorBtn) return;
      dismissActiveSettingsDropdown();
    };
    document.addEventListener('mousedown', closeHandler, true);
    var scrollHandler = function () { positionDropdown(); };
    window.addEventListener('scroll', scrollHandler, true);
    _activeSettingsDropdown = { el: dropdown, closeHandler: closeHandler, scrollHandler: scrollHandler };
  }

  function addSettingsButtonToBasicPre(pre) {
    if (pre.querySelector('.md-code-settings-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'md-code-settings-btn';
    btn.setAttribute('contenteditable', 'false');
    btn.innerHTML = GEAR_SVG;
    btn.type = 'button';
    pre.appendChild(btn);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (_activeSettingsDropdown) { dismissActiveSettingsDropdown(); return; }
      createSettingsDropdown(btn);
    });
  }

  function addSettingsButtonToAdvancedBlock(wrapper) {
    if (wrapper.querySelector('.md-code-settings-btn-advanced')) return;
    var btn = document.createElement('button');
    btn.className = 'md-code-settings-btn-advanced';
    btn.setAttribute('contenteditable', 'false');
    btn.innerHTML = GEAR_SVG;
    btn.type = 'button';
    wrapper.appendChild(btn);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (_activeSettingsDropdown) { dismissActiveSettingsDropdown(); return; }
      createSettingsDropdown(btn);
    });
  }

  function enhanceBasicPreBlocks(editableArea) {
    if (!editableArea) return;
    var pres = editableArea.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('md-code-block')) continue;
      if (pre.hasAttribute('data-title') || pre.hasAttribute('data-linenums') || pre.hasAttribute('data-lang')) continue;
      addLangButtonToBasicPre(pre, editableArea);
    }
  }

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
      addLangButtonToAdvancedBlock(wrapper);
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
    enhanceBasicPreBlocks(editableArea);
    var advancedBlocks = editableArea.querySelectorAll('.md-code-block');
    for (var j = 0; j < advancedBlocks.length; j++) {
      addLangButtonToAdvancedBlock(advancedBlocks[j]);
    }
  }

  function createInteractiveCheckbox(checked) {
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.setAttribute('data-live-wysiwyg-checklist', '1');
    cb.setAttribute('contenteditable', 'false');
    (function (checkbox) {
      function onCheckboxMouseDown(e) {
        if (e.target !== checkbox) return;
        e.preventDefault();
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        var editable = checkbox.closest && checkbox.closest('[contenteditable="true"]');
        if (editable && editable.dispatchEvent) {
          editable.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      function onCheckboxClick(e) {
        if (e.target !== checkbox) return;
        e.preventDefault();
        e.stopPropagation();
      }
      checkbox.addEventListener('mousedown', onCheckboxMouseDown, true);
      checkbox.addEventListener('click', onCheckboxClick, true);
    })(cb);
    return cb;
  }

  /** Get the direct-child checkbox of an LI (not from nested children). */
  function getDirectCheckboxOfLi(li) {
    for (var c = li.firstChild; c; c = c.nextSibling) {
      if (c.nodeName === 'INPUT' && c.type === 'checkbox') return c;
    }
    return null;
  }

  /** Return { node, offset } for the first character of content (first non-whitespace after checkbox). Does not modify DOM. */
  function getFirstContentPosition(li) {
    var cb = getDirectCheckboxOfLi(li);
    if (!cb) return null;
    function findFirst(node) {
      if (!node || node === li) return null;
      if (node.nodeType === 3) {
        var text = node.textContent || '';
        for (var i = 0; i < text.length; i++) {
          var c = text.charAt(i);
          if (c !== ' ' && c !== '\u00a0' && c !== '\t' && c !== '\n' && c !== '\r') {
            var code = c.charCodeAt(0);
            if (code !== 0x200B && code !== 0x200C && code !== 0x200D && code !== 0xFEFF) return { node: node, offset: i };
          }
        }
        return null;
      }
      if (node.nodeType === 1) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') return null;
        for (var c = node.firstChild; c; c = c.nextSibling) {
          var r = findFirst(c);
          if (r) return r;
        }
      }
      return null;
    }
    for (var n = cb.nextSibling; n; n = n.nextSibling) {
      var r = findFirst(n);
      if (r) return r;
    }
    return getPositionAfterCheckboxSpaces(li);
  }

  /** Return { node, offset } for position after the space(s) following the checkbox. Does not modify DOM. */
  function getPositionAfterCheckboxSpaces(li) {
    var cb = getDirectCheckboxOfLi(li);
    if (!cb) return null;
    var n = cb.nextSibling;
    var totalLen = 0;
    var lastNode = null;
    var lastOffset = 0;
    while (n && n.nodeType === 3 && /^[\s ]*$/.test(n.textContent)) {
      lastNode = n;
      lastOffset = n.textContent.length;
      totalLen += n.textContent.length;
      n = n.nextSibling;
    }
    if (!lastNode) return null;
    var pos = 0;
    n = cb.nextSibling;
    while (n && n.nodeType === 3 && /^[\s\u00a0]*$/.test(n.textContent)) {
      var len = (n.textContent || '').length;
      if (pos + len >= 2) return { node: n, offset: 2 - pos };
      pos += len;
      n = n.nextSibling;
    }
    return { node: lastNode, offset: lastOffset };
  }

  /** Return { node, offset } for the last character of content before any nested UL/OL. */
  function getLastContentPositionBeforeNestedList(li) {
    var cb = getDirectCheckboxOfLi(li);
    if (!cb) return null;
    function findLast(node) {
      if (!node || node === li) return null;
      if (node.nodeType === 3) {
        var len = (node.textContent || '').length;
        return len > 0 ? { node: node, offset: len } : null;
      }
      if (node.nodeType === 1) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') return null;
        var last = null;
        for (var c = node.lastChild; c; c = c.previousSibling) {
          var r = findLast(c);
          if (r) return r;
        }
      }
      return null;
    }
    var lastPos = null;
    for (var n = cb.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n.nodeName === 'UL' || n.nodeName === 'OL')) break;
      var r = findLast(n);
      if (r) lastPos = r;
    }
    return lastPos || getPositionAfterCheckboxSpaces(li);
  }

  /** Return the last (deepest) LI in the subtree, for visual order traversal. */
  function getLastLeafLi(li) {
    var nested = null;
    for (var c = li.firstChild; c; c = c.nextSibling) {
      if (c.nodeName === 'UL' || c.nodeName === 'OL') { nested = c; break; }
    }
    if (!nested || !nested.lastElementChild || nested.lastElementChild.nodeName !== 'LI') return li;
    return getLastLeafLi(nested.lastElementChild);
  }

  function addCheckboxToLi(li, checked) {
    if (li.querySelector('input[type="checkbox"]')) return;
    var cb = createInteractiveCheckbox(checked === undefined ? false : !!checked);
    var space = document.createTextNode('\u00a0 ');
    li.insertBefore(space, li.firstChild);
    li.insertBefore(cb, space);
  }

  function removeCheckboxFromLi(li) {
    var cb = li.querySelector('input[type="checkbox"]');
    if (!cb) return;
    var next = cb.nextSibling;
    if (next && next.nodeType === 3 && /^[\s\u00a0]/.test(next.textContent)) {
      next.textContent = next.textContent.replace(/^[\s\u00a0]/, '');
      if (!next.textContent) next.parentNode.removeChild(next);
    }
    cb.parentNode.removeChild(cb);
  }

  function findCursorList(ea) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    var li = node;
    while (li && li !== ea) {
      if (li.nodeName === 'LI') break;
      li = li.parentNode;
    }
    if (!li || li.nodeName !== 'LI') return null;
    var list = li.parentNode;
    if (!list || (list.nodeName !== 'UL' && list.nodeName !== 'OL')) return null;
    var isChecklist = false;
    if (list.nodeName === 'UL') {
      for (var i = 0; i < list.children.length; i++) {
        var child = list.children[i];
        if (child.nodeName === 'LI') {
          var cb = child.querySelector('input[type="checkbox"]');
          if (cb && cb.parentNode === child) { isChecklist = true; break; }
        }
      }
    }
    return { list: list, li: li, isChecklist: isChecklist };
  }

  function convertListTag(list, newTag) {
    if (list.nodeName === newTag) return list;
    var newList = document.createElement(newTag);
    while (list.firstChild) newList.appendChild(list.firstChild);
    list.parentNode.replaceChild(newList, list);
    return newList;
  }

  function createListInContainer(ea, listTag, isChecklist) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    var node = range.startContainer;
    if (node.nodeType === 3) node = node.parentNode;

    var container = ea;
    var anc = node;
    while (anc && anc !== ea) {
      var inLi = anc.nodeName === 'LI' && anc.parentNode && (anc.parentNode.nodeName === 'UL' || anc.parentNode.nodeName === 'OL');
      if ((anc.classList && anc.classList.contains('admonition')) || anc.nodeName === 'BLOCKQUOTE' || inLi) {
        container = anc;
        break;
      }
      anc = anc.parentNode;
    }

    var inner = node;
    while (inner && inner !== container && inner.parentNode !== container) {
      inner = inner.parentNode;
    }
    var targetBlock = (inner && inner !== container && inner.parentNode === container) ? inner : null;

    if (container === ea && !targetBlock) {
      var block = node;
      while (block && block !== ea && block.parentNode !== ea) block = block.parentNode;
      if (block && block !== ea && block.parentNode === ea) targetBlock = block;
    }

    var list = document.createElement(listTag);
    var li = document.createElement('li');

    if (targetBlock) {
      var text = (targetBlock.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
      if (text && targetBlock.nodeType === 1) {
        while (targetBlock.firstChild) li.appendChild(targetBlock.firstChild);
      } else {
        li.innerHTML = '&#8203;';
      }
      list.appendChild(li);
      if (isChecklist) addCheckboxToLi(li);
      container.insertBefore(list, targetBlock);
      container.removeChild(targetBlock);
    } else {
      li.innerHTML = '&#8203;';
      list.appendChild(li);
      if (isChecklist) addCheckboxToLi(li);
      container.appendChild(list);
    }

    sel = window.getSelection();
    if (sel) {
      var newRange = document.createRange();
      var focusNode = li;
      if (isChecklist) {
        var cb = li.querySelector('input[type="checkbox"]');
        if (cb && cb.nextSibling) {
          focusNode = cb.nextSibling;
          newRange.setStart(focusNode, focusNode.nodeType === 3 ? focusNode.textContent.length : 0);
        } else {
          newRange.selectNodeContents(li);
          newRange.collapse(false);
        }
      } else {
        newRange.selectNodeContents(li);
        newRange.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  }

  (function patchToggleChecklist() {
    var proto = MarkdownWYSIWYG.prototype;

    proto._toggleChecklist = function () {
      if (this.currentMode === 'wysiwyg') {
        this.editableArea.focus();
        var ea = this.editableArea;
        var info = findCursorList(ea);
        if (info) {
          var list = info.list;
          var cursorLi = info.li;
          var sel = window.getSelection();
          var savedNode = null, savedOffset = 0;
          if (sel && sel.rangeCount > 0) {
            var r = sel.getRangeAt(0);
            savedNode = r.startContainer;
            savedOffset = r.startOffset;
          }
          if (info.isChecklist) {
            for (var i = 0; i < list.children.length; i++) {
              if (list.children[i].nodeName === 'LI') removeCheckboxFromLi(list.children[i]);
            }
          } else {
            if (list.nodeName === 'OL') {
              list = convertListTag(list, 'UL');
            }
            for (var i = 0; i < list.children.length; i++) {
              if (list.children[i].nodeName === 'LI') addCheckboxToLi(list.children[i]);
            }
          }
          if (sel && savedNode) {
            try {
              var rng = document.createRange();
              if (savedNode.parentNode) {
                rng.setStart(savedNode, Math.min(savedOffset, savedNode.nodeType === 3 ? savedNode.textContent.length : savedNode.childNodes.length));
              } else {
                rng.selectNodeContents(cursorLi);
                rng.collapse(false);
              }
              rng.collapse(true);
              sel.removeAllRanges();
              sel.addRange(rng);
            } catch (ex) {
              /* cursor restore failed, leave as-is */
            }
          }
        } else {
          createListInContainer(ea, 'UL', true);
        }
        this._finalizeUpdate(this.editableArea.innerHTML);
      } else {
        var textarea = this.markdownArea;
        var text = textarea.value;
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var firstLineStart = text.lastIndexOf('\n', start - 1) + 1;
        if (start === 0 && text.charAt(0) !== '\n') firstLineStart = 0;
        var lastLineEnd = text.indexOf('\n', end);
        if (lastLineEnd === -1) lastLineEnd = text.length;
        var regionText = text.substring(firstLineStart, lastLineEnd);
        var lines = regionText.split('\n');
        var checklistRe = /^(\s*)([-*+])\s+\[[ xX]\]\s/;
        var listRe = /^(\s*)([-*+])\s/;
        var hasContent = false;
        var allChecklist = true;
        var allList = true;
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          hasContent = true;
          if (!checklistRe.test(lines[i])) allChecklist = false;
          if (!listRe.test(lines[i])) allList = false;
        }
        if (!hasContent) { allChecklist = false; allList = false; }
        var newLines;
        if (allChecklist) {
          newLines = lines.map(function (line) {
            return line.replace(/^(\s*)([-*+])\s+\[[ xX]\]\s/, '$1$2 ');
          });
        } else if (allList) {
          newLines = lines.map(function (line) {
            if (!line.trim()) return line;
            return line.replace(/^(\s*)([-*+])\s/, '$1$2 [ ] ');
          });
        } else {
          newLines = lines.map(function (line) {
            if (!line.trim()) return line;
            return '- [ ] ' + line;
          });
        }
        var newText = newLines.join('\n');
        textarea.value = text.substring(0, firstLineStart) + newText + text.substring(lastLineEnd);
        textarea.focus();
        textarea.setSelectionRange(firstLineStart, firstLineStart + newText.length);
        this._finalizeUpdate(textarea.value);
      }
    };

    var origWysiwygActive = proto._updateWysiwygToolbarActiveStates;
    if (origWysiwygActive) {
      proto._updateWysiwygToolbarActiveStates = function () {
        origWysiwygActive.apply(this, arguments);
        var sel = window.getSelection();

        var checklistBtn = this.toolbar && this.toolbar.querySelector('.md-toolbar-button-checklist');
        if (checklistBtn) {
          checklistBtn.classList.remove('active');
          if (sel && sel.rangeCount > 0) {
            var node = sel.getRangeAt(0).commonAncestorContainer;
            if (node.nodeType === 3) node = node.parentNode;
            while (node && node !== this.editableArea) {
              if (node.nodeName === 'UL') break;
              node = node.parentNode;
            }
            if (node && node.nodeName === 'UL') {
              var hasDirectCheckbox = false;
              for (var k = 0; k < node.children.length; k++) {
                var li = node.children[k];
                if (li.nodeName === 'LI') {
                  var cb = li.querySelector('input[type="checkbox"]');
                  if (cb && cb.parentNode === li) { hasDirectCheckbox = true; break; }
                }
              }
              if (hasDirectCheckbox) checklistBtn.classList.add('active');
            }
          }
        }

        var hBtn = this.headingButton;
        if (hBtn) {
          if (!hBtn._originalIcon) hBtn._originalIcon = hBtn.innerHTML;
          var headingTag = null;
          if (sel && sel.rangeCount > 0) {
            var el = sel.getRangeAt(0).commonAncestorContainer;
            if (el.nodeType === 3) el = el.parentNode;
            while (el && el !== this.editableArea) {
              if (/^H[1-6]$/.test(el.nodeName)) { headingTag = el.nodeName; break; }
              el = el.parentNode;
            }
          }
          if (headingTag) {
            hBtn.textContent = headingTag;
          } else {
            hBtn.innerHTML = hBtn._originalIcon;
          }
        }
      };
    }

    var origMarkdownActive = proto._updateMarkdownToolbarActiveStates;
    if (origMarkdownActive) {
      proto._updateMarkdownToolbarActiveStates = function () {
        origMarkdownActive.apply(this, arguments);
        var btn = this.toolbar && this.toolbar.querySelector('.md-toolbar-button-checklist');
        if (!btn) return;
        btn.classList.remove('active');
        if (!this.markdownArea) return;
        var text = this.markdownArea.value;
        var selStart = this.markdownArea.selectionStart;
        var lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
        if (selStart === 0 && lineStart > 0 && text.charAt(0) !== '\n') lineStart = 0;
        var lineEnd = text.indexOf('\n', lineStart);
        var line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
        if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
          btn.classList.add('active');
        }
      };
    }

    var origHandleToolbarClick = proto._handleToolbarClick;
    if (origHandleToolbarClick) {
      proto._handleToolbarClick = function (buttonConfig, buttonElement) {
        var isListBtn = (buttonConfig.id === 'ul' || buttonConfig.id === 'ol') && this.currentMode === 'wysiwyg';
        if (isListBtn) {
          this.editableArea.focus();
          var ea = this.editableArea;
          var info = findCursorList(ea);
          if (info) {
            var list = info.list;
            var requestedTag = (buttonConfig.id === 'ol') ? 'OL' : 'UL';
            if (list.nodeName === requestedTag && !info.isChecklist) {
              origHandleToolbarClick.apply(this, arguments);
              return;
            }
            var sel = window.getSelection();
            var savedNode = null, savedOffset = 0;
            if (sel && sel.rangeCount > 0) {
              var r = sel.getRangeAt(0);
              savedNode = r.startContainer;
              savedOffset = r.startOffset;
            }
            if (info.isChecklist) {
              for (var i = 0; i < list.children.length; i++) {
                if (list.children[i].nodeName === 'LI') removeCheckboxFromLi(list.children[i]);
              }
            }
            convertListTag(list, requestedTag);
            if (sel && savedNode) {
              try {
                var rng = document.createRange();
                if (savedNode.parentNode) {
                  rng.setStart(savedNode, Math.min(savedOffset, savedNode.nodeType === 3 ? savedNode.textContent.length : savedNode.childNodes.length));
                } else {
                  rng.selectNodeContents(info.li);
                  rng.collapse(false);
                }
                rng.collapse(true);
                sel.removeAllRanges();
                sel.addRange(rng);
              } catch (ex) { /* cursor restore failed */ }
            }
            this._finalizeUpdate(ea.innerHTML);
            this._updateToolbarActiveStates();
            return;
          }
          createListInContainer(ea, (buttonConfig.id === 'ol') ? 'OL' : 'UL', false);
          this._finalizeUpdate(ea.innerHTML);
          this._updateToolbarActiveStates();
          return;
        }
        origHandleToolbarClick.apply(this, arguments);
      };
    }
  })();

  var ADMONITION_ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>';
  var ADMONITION_ICON_FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>';
  var ADMONITION_ICON_ALERT = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
  var ADMONITION_ICON_ZAP = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>';
  var ADMONITION_ICON_CLIPBOARD = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>';
  var ADMONITION_ICON_INFO = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  var ADMONITION_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  var ADMONITION_ICON_QUESTION = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>';
  var ADMONITION_ICON_XMARK = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>';
  var ADMONITION_ICON_BUG = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>';
  var ADMONITION_ICON_BEAKER = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z"/></svg>';
  var ADMONITION_ICON_QUOTE = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>';

  var ADMONITION_TYPES = [
    { id: 'note',      label: 'Note',      color: '#448aff', icon: ADMONITION_ICON_PENCIL },
    { id: 'abstract',  label: 'Abstract',  color: '#00b0ff', icon: ADMONITION_ICON_CLIPBOARD },
    { id: 'info',      label: 'Info',      color: '#00b8d4', icon: ADMONITION_ICON_INFO },
    { id: 'tip',       label: 'Tip',       color: '#00c853', icon: ADMONITION_ICON_FLAME },
    { id: 'hint',      label: 'Hint',      color: '#00b0ff', icon: ADMONITION_ICON_FLAME },
    { id: 'important', label: 'Important', color: '#ff6d00', icon: ADMONITION_ICON_FLAME },
    { id: 'success',   label: 'Success',   color: '#00c853', icon: ADMONITION_ICON_CHECK },
    { id: 'question',  label: 'Question',  color: '#64dd17', icon: ADMONITION_ICON_QUESTION },
    { id: 'warning',   label: 'Warning',   color: '#ff9100', icon: ADMONITION_ICON_ALERT },
    { id: 'caution',   label: 'Caution',   color: '#ffc400', icon: ADMONITION_ICON_ALERT },
    { id: 'attention', label: 'Attention', color: '#ffab00', icon: ADMONITION_ICON_ALERT },
    { id: 'failure',   label: 'Failure',   color: '#ff5252', icon: ADMONITION_ICON_XMARK },
    { id: 'danger',    label: 'Danger',    color: '#ff1744', icon: ADMONITION_ICON_ZAP },
    { id: 'error',     label: 'Error',     color: '#ff5252', icon: ADMONITION_ICON_ZAP },
    { id: 'bug',       label: 'Bug',       color: '#f50057', icon: ADMONITION_ICON_BUG },
    { id: 'example',   label: 'Example',   color: '#7c4dff', icon: ADMONITION_ICON_BEAKER },
    { id: 'quote',     label: 'Quote',     color: '#9e9e9e', icon: ADMONITION_ICON_QUOTE }
  ];

  var ADMONITION_TYPE_IDS = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention', 'abstract', 'info', 'success', 'question', 'failure', 'bug', 'example', 'quote'];

  function isAdmonitionElement(node) {
    if (!node || !node.classList) return false;
    if (node.nodeName === 'DIV' && node.classList.contains('admonition')) return true;
    if (node.nodeName === 'DETAILS') {
      for (var i = 0; i < ADMONITION_TYPE_IDS.length; i++) {
        if (node.classList.contains(ADMONITION_TYPE_IDS[i])) return true;
      }
    }
    return false;
  }

  function getAdmonitionType(node) {
    for (var i = 0; i < ADMONITION_TYPE_IDS.length; i++) {
      if (node.classList.contains(ADMONITION_TYPE_IDS[i])) return ADMONITION_TYPE_IDS[i];
    }
    return null;
  }

  function convertToCollapsible(adDiv) {
    var type = getAdmonitionType(adDiv);
    if (!type) return adDiv;
    var details = document.createElement('details');
    details.setAttribute('open', '');
    var classes = type;
    if (adDiv.classList.contains('inline')) classes += ' inline';
    if (adDiv.classList.contains('end')) classes += ' end';
    details.className = classes;
    details.setAttribute('contenteditable', 'true');

    var titleEl = adDiv.querySelector(':scope > .admonition-title');
    var summary = document.createElement('summary');
    summary.textContent = titleEl ? titleEl.textContent : (type.charAt(0).toUpperCase() + type.slice(1));
    details.appendChild(summary);

    while (adDiv.firstChild) {
      var child = adDiv.firstChild;
      if (child === titleEl) { adDiv.removeChild(child); continue; }
      if (child.classList && child.classList.contains('md-admonition-settings-btn')) { adDiv.removeChild(child); continue; }
      details.appendChild(child);
    }
    if (adDiv.parentNode) adDiv.parentNode.replaceChild(details, adDiv);
    return details;
  }

  function convertToNonCollapsible(detailsEl) {
    var type = getAdmonitionType(detailsEl);
    if (!type) return detailsEl;
    var div = document.createElement('div');
    var classes = 'admonition ' + type;
    if (detailsEl.classList.contains('inline')) classes += ' inline';
    if (detailsEl.classList.contains('end')) classes += ' end';
    div.className = classes;
    div.setAttribute('contenteditable', 'true');

    var summaryEl = detailsEl.querySelector(':scope > summary');
    var titleP = document.createElement('p');
    titleP.className = 'admonition-title';
    titleP.textContent = summaryEl ? summaryEl.textContent : (type.charAt(0).toUpperCase() + type.slice(1));
    div.appendChild(titleP);

    while (detailsEl.firstChild) {
      var child = detailsEl.firstChild;
      if (child === summaryEl) { detailsEl.removeChild(child); continue; }
      if (child.classList && child.classList.contains('md-admonition-settings-btn')) { detailsEl.removeChild(child); continue; }
      div.appendChild(child);
    }
    if (detailsEl.parentNode) detailsEl.parentNode.replaceChild(div, detailsEl);
    return div;
  }

  var _activeAdmonitionDropdown = null;
  function dismissAdmonitionSettingsDropdown() {
    if (_activeAdmonitionDropdown) {
      if (_activeAdmonitionDropdown.el.parentNode) _activeAdmonitionDropdown.el.parentNode.removeChild(_activeAdmonitionDropdown.el);
      if (_activeAdmonitionDropdown.closeHandler) document.removeEventListener('mousedown', _activeAdmonitionDropdown.closeHandler, true);
      if (_activeAdmonitionDropdown.scrollHandler) window.removeEventListener('scroll', _activeAdmonitionDropdown.scrollHandler, true);
      _activeAdmonitionDropdown = null;
    }
  }

  function createAdmonitionSettingsDropdown(anchorBtn, adEl, ea) {
    dismissAdmonitionSettingsDropdown();
    dismissActiveSettingsDropdown();

    var dropdown = document.createElement('div');
    dropdown.className = 'md-admonition-settings-dropdown';
    dropdown.setAttribute('contenteditable', 'false');

    function positionDropdown() {
      var rect = anchorBtn.getBoundingClientRect();
      var left = rect.right - 210;
      if (left < 0) left = rect.left;
      dropdown.style.top = (rect.bottom + 2) + 'px';
      dropdown.style.left = left + 'px';
    }

    function readState() {
      var isCollapsible = (adEl.nodeName === 'DETAILS');
      var isCollapsed = isCollapsible && adEl.hasAttribute('data-default-collapsed');
      var hasInline = adEl.classList.contains('inline');
      var hasEnd = adEl.classList.contains('end');
      var hideTitle = adEl.hasAttribute('data-hide-title');
      var placement = hasInline ? (hasEnd ? 'inline-end' : 'inline') : 'standalone';
      return { isCollapsible: isCollapsible, isCollapsed: isCollapsed, placement: placement, hideTitle: hideTitle };
    }

    function buildUI() {
      dropdown.innerHTML = '';
      var state = readState();

      var placementGroup = document.createElement('div');
      placementGroup.className = 'md-admonition-placement-group';

      var btnStandalone = document.createElement('button');
      btnStandalone.type = 'button';
      btnStandalone.className = 'md-admonition-placement-full' + (state.placement === 'standalone' ? ' active' : '');
      btnStandalone.textContent = 'Standalone';
      btnStandalone.addEventListener('mousedown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        adEl.classList.remove('inline', 'end');
        syncAndRebuild();
      });

      var halvesRow = document.createElement('div');
      halvesRow.className = 'md-admonition-placement-halves';

      var btnInlineLeft = document.createElement('button');
      btnInlineLeft.type = 'button';
      btnInlineLeft.className = 'md-admonition-placement-half' + (state.placement === 'inline' ? ' active' : '');
      btnInlineLeft.innerHTML = '&#9664; Inline';
      btnInlineLeft.addEventListener('mousedown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        adEl.classList.add('inline');
        adEl.classList.remove('end');
        syncAndRebuild();
      });

      var btnInlineRight = document.createElement('button');
      btnInlineRight.type = 'button';
      btnInlineRight.className = 'md-admonition-placement-half' + (state.placement === 'inline-end' ? ' active' : '');
      btnInlineRight.innerHTML = 'Inline &#9654;';
      btnInlineRight.addEventListener('mousedown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        adEl.classList.add('inline', 'end');
        syncAndRebuild();
      });

      halvesRow.appendChild(btnInlineLeft);
      halvesRow.appendChild(btnInlineRight);
      placementGroup.appendChild(btnStandalone);
      placementGroup.appendChild(halvesRow);
      dropdown.appendChild(placementGroup);

      var collapsibleRow = document.createElement('div');
      collapsibleRow.className = 'md-admonition-settings-row';
      var collapsibleLabel = document.createElement('span');
      collapsibleLabel.className = 'md-admonition-settings-label';
      collapsibleLabel.textContent = 'Collapsible';
      var collapsibleToggle = document.createElement('button');
      collapsibleToggle.type = 'button';
      collapsibleToggle.className = 'md-admonition-settings-toggle' + (state.isCollapsible ? ' active' : '');
      collapsibleToggle.textContent = state.isCollapsible ? 'ON' : 'OFF';
      collapsibleToggle.addEventListener('mousedown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (adEl.nodeName === 'DETAILS') {
          adEl = convertToNonCollapsible(adEl);
        } else {
          adEl = convertToCollapsible(adEl);
        }
        addSettingsButtonToAdmonition(adEl);
        anchorBtn = adEl.querySelector(':scope > .md-admonition-settings-btn');
        positionDropdown();
        syncAndRebuild();
      });
      collapsibleRow.appendChild(collapsibleLabel);
      collapsibleRow.appendChild(collapsibleToggle);
      dropdown.appendChild(collapsibleRow);

      if (state.isCollapsible) {
        var collapsedRow = document.createElement('div');
        collapsedRow.className = 'md-admonition-settings-row';
        var collapsedLabel = document.createElement('span');
        collapsedLabel.className = 'md-admonition-settings-label';
        collapsedLabel.textContent = 'Collapsed';
        var collapsedToggle = document.createElement('button');
        collapsedToggle.type = 'button';
        collapsedToggle.className = 'md-admonition-settings-toggle' + (state.isCollapsed ? ' active' : '');
        collapsedToggle.textContent = state.isCollapsed ? 'ON' : 'OFF';
        collapsedToggle.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (adEl.hasAttribute('data-default-collapsed')) {
            adEl.removeAttribute('data-default-collapsed');
          } else {
            adEl.setAttribute('data-default-collapsed', '1');
          }
          syncAndRebuild();
        });
        collapsedRow.appendChild(collapsedLabel);
        collapsedRow.appendChild(collapsedToggle);
        dropdown.appendChild(collapsedRow);
      }

      if (!state.isCollapsible) {
        var hideTitleRow = document.createElement('div');
        hideTitleRow.className = 'md-admonition-settings-row';
        var hideTitleLabel = document.createElement('span');
        hideTitleLabel.className = 'md-admonition-settings-label';
        hideTitleLabel.textContent = 'Hide title';
        var hideTitleToggle = document.createElement('button');
        hideTitleToggle.type = 'button';
        hideTitleToggle.className = 'md-admonition-settings-toggle' + (state.hideTitle ? ' active' : '');
        hideTitleToggle.textContent = state.hideTitle ? 'ON' : 'OFF';
        hideTitleToggle.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (adEl.hasAttribute('data-hide-title')) {
            adEl.removeAttribute('data-hide-title');
            var type = getAdmonitionType(adEl);
            var defTitle = type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Note';
            var existingTitle = adEl.querySelector(':scope > .admonition-title');
            if (!existingTitle) {
              var titleP = document.createElement('p');
              titleP.className = 'admonition-title';
              titleP.textContent = defTitle;
              adEl.insertBefore(titleP, adEl.firstChild);
            }
          } else {
            adEl.setAttribute('data-hide-title', '1');
            var titleEl = adEl.querySelector(':scope > .admonition-title');
            if (titleEl) adEl.removeChild(titleEl);
          }
          syncAndRebuild();
        });
        hideTitleRow.appendChild(hideTitleLabel);
        hideTitleRow.appendChild(hideTitleToggle);
        dropdown.appendChild(hideTitleRow);
      }
    }

    function syncAndRebuild() {
      if (wysiwygEditor && wysiwygEditor._finalizeUpdate) {
        wysiwygEditor._finalizeUpdate(ea.innerHTML);
      }
      buildUI();
    }

    buildUI();
    document.body.appendChild(dropdown);
    positionDropdown();

    var closeHandler = function (ev) {
      if (dropdown.contains(ev.target) || anchorBtn.contains(ev.target)) return;
      dismissAdmonitionSettingsDropdown();
    };
    var scrollHandler = function () { positionDropdown(); };
    document.addEventListener('mousedown', closeHandler, true);
    window.addEventListener('scroll', scrollHandler, true);

    _activeAdmonitionDropdown = { el: dropdown, closeHandler: closeHandler, scrollHandler: scrollHandler };
  }

  function addSettingsButtonToAdmonition(adEl) {
    if (adEl.querySelector(':scope > .md-admonition-settings-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'md-admonition-settings-btn';
    btn.setAttribute('contenteditable', 'false');
    btn.innerHTML = GEAR_SVG;
    btn.type = 'button';
    adEl.appendChild(btn);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (_activeAdmonitionDropdown) {
        dismissAdmonitionSettingsDropdown();
        return;
      }
      var ea = adEl.closest('.md-editable-area') || adEl.closest('[contenteditable="true"]');
      if (!ea) {
        var p = adEl.parentNode;
        while (p) {
          if (p.classList && p.classList.contains('md-editable-area')) { ea = p; break; }
          p = p.parentNode;
        }
      }
      if (ea) createAdmonitionSettingsDropdown(btn, adEl, ea);
    });
  }

  function restoreEmptyAdmonitionTitle(titleEl) {
    if (!titleEl) return;
    var text = (titleEl.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
    if (text.length > 0) return;
    var adEl = titleEl.parentNode;
    if (!adEl || !isAdmonitionElement(adEl)) return;
    var type = getAdmonitionType(adEl);
    var defTitle = type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Note';
    titleEl.textContent = defTitle;
  }

  function findTitleFromNode(node, ea) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    while (el && el !== ea) {
      if (el.classList && el.classList.contains('admonition-title')) return el;
      if (el.nodeName === 'SUMMARY' && el.parentNode && el.parentNode.nodeName === 'DETAILS') return el;
      el = el.parentNode;
    }
    return null;
  }

  function populateRawHtmlBlocks(editableArea) {
    if (!editableArea) return;
    var blocks = editableArea.querySelectorAll('[' + RAW_HTML_BLOCK_ATTR + ']');
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      if (block._rawHtmlPopulated) continue;
      var b64 = block.getAttribute(RAW_HTML_BLOCK_ATTR);
      if (!b64) continue;
      var decoded = _b64Decode(b64);
      block.innerHTML = decoded;
      block.setAttribute('contenteditable', 'false');
      block.style.border = '1px dashed #ccc';
      block.style.borderRadius = '4px';
      block.style.padding = '4px';
      block.style.margin = '4px 0';
      block.style.opacity = '0.85';
      block.style.pointerEvents = 'none';
      block._rawHtmlPopulated = true;
    }
  }

  function _isInsideRawHtmlBlock(el) {
    var p = el.parentNode;
    while (p && p !== document) {
      if (p.getAttribute && p.getAttribute(RAW_HTML_BLOCK_ATTR)) return true;
      p = p.parentNode;
    }
    return false;
  }

  function enhanceAdmonitions(editableArea) {
    if (!editableArea) return;
    var admonitions = editableArea.querySelectorAll('.admonition');
    for (var i = 0; i < admonitions.length; i++) {
      if (_isInsideRawHtmlBlock(admonitions[i])) continue;
      addSettingsButtonToAdmonition(admonitions[i]);
    }
    for (var j = 0; j < ADMONITION_TYPE_IDS.length; j++) {
      var detailsEls = editableArea.querySelectorAll('details.' + ADMONITION_TYPE_IDS[j]);
      for (var k = 0; k < detailsEls.length; k++) {
        var det = detailsEls[k];
        if (_isInsideRawHtmlBlock(det)) continue;
        det.setAttribute('open', '');
        addSettingsButtonToAdmonition(det);
        var summary = det.querySelector(':scope > summary');
        if (summary) {
          if (!summary.dataset.liveWysiwygClickPatched) {
            summary.dataset.liveWysiwygClickPatched = '1';
            summary.addEventListener('click', function (e) {
              var d = this.parentNode;
              if (d && d.nodeName === 'DETAILS') {
                requestAnimationFrame(function () { d.setAttribute('open', ''); });
              }
            });
          }
        }
      }
    }
  }

  (function patchInsertAdmonition() {
    var proto = MarkdownWYSIWYG.prototype;
    var dropdown = null;
    var activeEditor = null;

    function getOrCreateDropdown(editor) {
      if (dropdown) return dropdown;
      dropdown = document.createElement('div');
      dropdown.className = 'md-admonition-dropdown';
      dropdown.style.cssText = 'display:none;position:absolute;z-index:100;background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);min-width:160px;padding:4px 0;margin-top:2px;';
      for (var i = 0; i < ADMONITION_TYPES.length; i++) {
        (function (t) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'md-admonition-dropdown-item';
          item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:13px;color:#333;text-align:left;transition:background-color 0.15s;';
          var iconSpan = document.createElement('span');
          iconSpan.style.cssText = 'display:inline-flex;align-items:center;flex-shrink:0;color:' + t.color + ';';
          iconSpan.innerHTML = t.icon;
          var label = document.createElement('span');
          label.textContent = t.label;
          item.appendChild(iconSpan);
          item.appendChild(label);
          item.addEventListener('mouseenter', function () { item.style.backgroundColor = '#e9e9e9'; });
          item.addEventListener('mouseleave', function () { item.style.backgroundColor = 'transparent'; });
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            hideDropdown();
            if (activeEditor) insertAdmonition(activeEditor, t.id);
          });
          dropdown.appendChild(item);
        })(ADMONITION_TYPES[i]);
      }
      document.body.appendChild(dropdown);
      return dropdown;
    }

    function showDropdown(editor, buttonEl) {
      activeEditor = editor;
      var dd = getOrCreateDropdown(editor);
      if (editor.currentMode === 'wysiwyg') {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editor.editableArea.contains(sel.getRangeAt(0).commonAncestorContainer)) {
          editor.savedRangeInfo = sel.getRangeAt(0).cloneRange();
        }
      } else {
        editor.savedRangeInfo = { start: editor.markdownArea.selectionStart, end: editor.markdownArea.selectionEnd };
      }
      var rect = buttonEl.getBoundingClientRect();
      dd.style.display = 'block';
      dd.style.top = (rect.bottom + window.scrollY + 2) + 'px';
      dd.style.left = (rect.left + window.scrollX) + 'px';
      setTimeout(function () {
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onDocEsc, true);
      }, 0);
    }

    function hideDropdown() {
      if (dropdown) dropdown.style.display = 'none';
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onDocEsc, true);
    }

    function onDocClick(e) {
      if (dropdown && !dropdown.contains(e.target)) hideDropdown();
    }
    function onDocEsc(e) {
      if (e.key === 'Escape') hideDropdown();
    }

    function insertAdmonition(editor, type) {
      var title = type.charAt(0).toUpperCase() + type.slice(1);
      if (editor.currentMode === 'wysiwyg') {
        var ea = editor.editableArea;
        ea.focus();
        var sel = window.getSelection();
        if (editor.savedRangeInfo instanceof Range && ea.contains(editor.savedRangeInfo.commonAncestorContainer)) {
          sel.removeAllRanges();
          sel.addRange(editor.savedRangeInfo);
        }
        var adDiv = document.createElement('div');
        adDiv.className = 'admonition ' + type;
        adDiv.setAttribute('contenteditable', 'true');
        var titleP = document.createElement('p');
        titleP.className = 'admonition-title';
        titleP.textContent = title;
        var bodyP = document.createElement('p');
        bodyP.textContent = 'Content here.';
        adDiv.appendChild(titleP);
        adDiv.appendChild(bodyP);
        var range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (range) {
          var insertParent = ea;
          var targetBlock = null;
          var ancestor = range.startContainer;
          if (ancestor.nodeType === 3) ancestor = ancestor.parentNode;
          var foundContainer = null;
          var cur = ancestor;
          while (cur && cur !== ea) {
            if (isAdmonitionElement(cur)) { foundContainer = cur; break; }
            if (cur.nodeName === 'BLOCKQUOTE') { foundContainer = cur; break; }
            cur = cur.parentNode;
          }
          if (foundContainer) {
            insertParent = foundContainer;
            var inner = ancestor;
            while (inner && inner !== foundContainer && inner.parentNode !== foundContainer) {
              inner = inner.parentNode;
            }
            if (inner && inner !== foundContainer && inner.parentNode === foundContainer) {
              var isTitleOrGear = (inner.classList && (inner.classList.contains('admonition-title') || inner.classList.contains('md-admonition-settings-btn'))) || inner.nodeName === 'SUMMARY';
              if (!isTitleOrGear) targetBlock = inner;
            }
          } else {
            var block = ancestor;
            while (block && block !== ea && block.parentNode !== ea) {
              block = block.parentNode;
            }
            if (block && block !== ea && block.parentNode === ea) {
              targetBlock = block;
            }
          }
          if (targetBlock && targetBlock.parentNode === insertParent) {
            var blockText = (targetBlock.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            var hasContent = blockText.length > 0;
            if (hasContent) {
              insertParent.insertBefore(adDiv, targetBlock.nextSibling);
            } else {
              insertParent.insertBefore(adDiv, targetBlock);
              insertParent.removeChild(targetBlock);
            }
          } else {
            range.collapse(false);
            range.insertNode(adDiv);
          }
          var newRange = document.createRange();
          newRange.selectNodeContents(bodyP);
          sel.removeAllRanges();
          sel.addRange(newRange);
        } else {
          ea.appendChild(adDiv);
        }
        enhanceAdmonitions(ea);
        editor.savedRangeInfo = null;
        editor._finalizeUpdate(ea.innerHTML);
      } else {
        var textarea = editor.markdownArea;
        var start, end;
        if (editor.savedRangeInfo && typeof editor.savedRangeInfo.start === 'number') {
          start = editor.savedRangeInfo.start;
          end = editor.savedRangeInfo.end;
        } else {
          start = textarea.selectionStart;
          end = textarea.selectionEnd;
        }
        var text = textarea.value;
        var before = text.substring(0, start);
        var after = text.substring(end);
        var prefix = (before.length > 0 && !before.endsWith('\n')) ? '\n' : '';
        var suffix = (after.length > 0 && !after.startsWith('\n')) ? '\n' : '';
        var snippet = prefix + '!!! ' + type + '\n    Content here.\n' + suffix;
        textarea.value = before + snippet + after;
        var cursorStart = before.length + prefix.length + ('!!! ' + type + '\n    ').length;
        textarea.focus();
        textarea.setSelectionRange(cursorStart, cursorStart + 'Content here.'.length);
        editor.savedRangeInfo = null;
        editor._finalizeUpdate(textarea.value);
      }
    }

    proto._insertAdmonition = function (buttonEl) {
      if (dropdown && dropdown.style.display !== 'none') {
        hideDropdown();
        return;
      }
      var btn = buttonEl || (this.toolbar && this.toolbar.querySelector('.md-toolbar-button-admonition'));
      if (btn) showDropdown(this, btn);
    };
  })();

  (function patchBlockquoteInAdmonition() {
    var proto = MarkdownWYSIWYG.prototype;
    var origWrap = proto._wrapSelectionInBlockquote;
    if (!origWrap) return;
    proto._wrapSelectionInBlockquote = function () {
      var ea = this.editableArea;
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return origWrap.call(this);
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      if (node.nodeType === 3) node = node.parentNode;
      var ad = null;
      var anc = node;
      while (anc && anc !== ea) {
        if (anc.classList && anc.classList.contains('admonition')) {
          ad = anc;
          break;
        }
        anc = anc.parentNode;
      }
      if (!ad) return origWrap.call(this);
      var topBlockFor = function (n, container) {
        var cur = n;
        if (cur.nodeType === 3) cur = cur.parentNode;
        while (cur && cur.parentNode !== container) cur = cur.parentNode;
        return cur;
      };
      var startBlock = topBlockFor(range.startContainer, ad);
      var endBlock = topBlockFor(range.endContainer, ad);
      var titleEl = ad.querySelector('.admonition-title');
      var bodyBlocks = [];
      for (var i = 0; i < ad.childNodes.length; i++) {
        var c = ad.childNodes[i];
        if (c !== titleEl) bodyBlocks.push(c);
      }
      var startIdx = bodyBlocks.indexOf(startBlock);
      var endIdx = bodyBlocks.indexOf(endBlock);
      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = startIdx;
      if (startIdx > endIdx) { var t = startIdx; startIdx = endIdx; endIdx = t; }
      var blocks = bodyBlocks.slice(startIdx, endIdx + 1);
      if (blocks.length === 0) return origWrap.call(this);
      var isEmptyNode = function (n) {
        if (n.nodeType === 3) return !n.textContent.replace(/[\s\u00a0]/g, '');
        if (n.nodeName === 'BR') return true;
        var text = (n.textContent || '').replace(/[\s\u00a0]/g, '');
        if (!text && !n.querySelector('img, table, hr')) return true;
        return false;
      };
      var filtered = [];
      for (var i = 0; i < blocks.length; i++) {
        if (!isEmptyNode(blocks[i])) filtered.push(blocks[i]);
      }
      if (filtered.length === 0) return origWrap.call(this);
      var bq = document.createElement('blockquote');
      ad.insertBefore(bq, filtered[0]);
      for (var j = 0; j < blocks.length; j++) {
        var block = blocks[j];
        if (filtered.indexOf(block) === -1) {
          if (block.parentNode) block.parentNode.removeChild(block);
        } else {
          if (this._isBlockElement(block)) {
            bq.appendChild(block);
          } else {
            var p = document.createElement('p');
            p.appendChild(block);
            bq.appendChild(p);
          }
        }
      }
      sel.removeAllRanges();
      var newRange = document.createRange();
      newRange.selectNodeContents(bq);
      sel.addRange(newRange);
      this._finalizeUpdate(ea.innerHTML);
    };
  })();

  (function patchInsertCodeBlock() {
    var proto = MarkdownWYSIWYG.prototype;
    var origInsertCodeBlock = proto._insertCodeBlock;
    if (!origInsertCodeBlock) return;
    proto._insertCodeBlock = function () {
      if (this.currentMode === 'wysiwyg') {
        var ea = this.editableArea;
        ea.focus();
        var selection = window.getSelection();
        var initialSelectedText = selection ? selection.toString() : '';
        var pre = document.createElement('pre');
        var code = document.createElement('code');
        code.textContent = initialSelectedText || 'code';
        pre.appendChild(code);
        if (selection && selection.rangeCount > 0) {
          var range = selection.getRangeAt(0);
          var block = range.startContainer;
          if (block.nodeType === 3) block = block.parentNode;
          while (block && block !== ea && block.parentNode !== ea) {
            block = block.parentNode;
          }
          var insertParent = ea;
          var targetBlock = null;
          var anc = range.startContainer;
          if (anc.nodeType === 3) anc = anc.parentNode;
          while (anc && anc !== ea) {
            var inLi = anc.nodeName === 'LI' && anc.parentNode && (anc.parentNode.nodeName === 'UL' || anc.parentNode.nodeName === 'OL');
            if ((anc.classList && anc.classList.contains('admonition')) || anc.nodeName === 'BLOCKQUOTE' || inLi) {
              insertParent = anc;
              var inner = range.startContainer;
              if (inner.nodeType === 3) inner = inner.parentNode;
              while (inner && inner !== anc && inner.parentNode !== anc) {
                inner = inner.parentNode;
              }
              if (inner && inner !== anc && inner.parentNode === anc) {
                targetBlock = inner;
              }
              break;
            }
            anc = anc.parentNode;
          }
          if (insertParent === ea && block && block !== ea && block.parentNode === ea) {
            targetBlock = block;
          }
          if (targetBlock && targetBlock.parentNode === insertParent) {
            var blockText = (targetBlock.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            var hasContent = blockText.length > 0;
            if (hasContent && !initialSelectedText) {
              insertParent.insertBefore(pre, targetBlock.nextSibling);
            } else if (hasContent) {
              range.deleteContents();
              var blockTextAfter = (targetBlock.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
              if (blockTextAfter.length === 0) {
                insertParent.insertBefore(pre, targetBlock);
                insertParent.removeChild(targetBlock);
              } else {
                insertParent.insertBefore(pre, targetBlock.nextSibling);
              }
            } else {
              insertParent.insertBefore(pre, targetBlock);
              insertParent.removeChild(targetBlock);
            }
          } else {
            range.deleteContents();
            range.insertNode(pre);
          }
          var newRange = document.createRange();
          newRange.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(newRange);
        } else {
          ea.appendChild(pre);
        }
        enhanceBasicPreBlocks(ea);
        this._finalizeUpdate(ea.innerHTML);
      } else {
        origInsertCodeBlock.call(this);
      }
    };
  })();

  (function patchInsertInlineCode() {
    var proto = MarkdownWYSIWYG.prototype;
    var origInsertInlineCode = proto._insertInlineCode;
    if (!origInsertInlineCode) return;
    proto._insertInlineCode = function () {
      if (this.currentMode !== 'wysiwyg') {
        origInsertInlineCode.call(this);
        return;
      }
      var ea = this.editableArea;
      ea.focus();
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        origInsertInlineCode.call(this);
        return;
      }

      var range = sel.getRangeAt(0);
      var node = range.commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;

      var codeAncestor = null;
      var anc = node;
      while (anc && anc !== ea) {
        if (anc.nodeName === 'CODE' && (!anc.parentNode || anc.parentNode.nodeName !== 'PRE')) {
          codeAncestor = anc;
          break;
        }
        anc = anc.parentNode;
      }

      if (!sel.isCollapsed) {
        var codeEls = [];
        var searchRoot = range.commonAncestorContainer;
        if (searchRoot.nodeType === 3) searchRoot = searchRoot.parentNode;
        while (searchRoot && searchRoot !== ea && searchRoot.nodeName !== 'CODE') {
          if (searchRoot.parentNode === ea || searchRoot.parentNode === null) break;
          searchRoot = searchRoot.parentNode;
        }
        if (!searchRoot || searchRoot.nodeName === 'CODE') searchRoot = ea;
        var codes = searchRoot.querySelectorAll('code');
        for (var i = 0; i < codes.length; i++) {
          if (codes[i].parentNode && codes[i].parentNode.nodeName === 'PRE') continue;
          var codeRange = document.createRange();
          codeRange.selectNode(codes[i]);
          var overlaps = range.compareBoundaryPoints(Range.START_TO_END, codeRange) > 0 &&
                         range.compareBoundaryPoints(Range.END_TO_START, codeRange) < 0;
          if (overlaps) codeEls.push(codes[i]);
        }
        if (codeAncestor && codeEls.indexOf(codeAncestor) === -1) {
          codeEls.push(codeAncestor);
        }

        if (codeEls.length > 0) {
          var firstText = null;
          var lastText = null;
          var totalLen = 0;
          for (var j = 0; j < codeEls.length; j++) {
            var ce = codeEls[j];
            var parent = ce.parentNode;
            var text = ce.textContent;
            var textNode = document.createTextNode(text);
            parent.insertBefore(textNode, ce);
            parent.removeChild(ce);
            if (!firstText) firstText = textNode;
            lastText = textNode;
            totalLen += text.length;
          }
          if (firstText && lastText) {
            var newRange = document.createRange();
            newRange.setStart(firstText, 0);
            newRange.setEnd(lastText, lastText.textContent.length);
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
          if (this._finalizeUpdate) this._finalizeUpdate(ea.innerHTML);
          return;
        }

        origInsertInlineCode.call(this);
        return;
      }

      if (codeAncestor) {
        var text = codeAncestor.textContent;
        var parent = codeAncestor.parentNode;
        var textNode = document.createTextNode(text);
        parent.insertBefore(textNode, codeAncestor);
        parent.removeChild(codeAncestor);
        var cursorRange = document.createRange();
        cursorRange.setStart(textNode, 0);
        cursorRange.setEnd(textNode, text.length);
        sel.removeAllRanges();
        sel.addRange(cursorRange);
        if (this._finalizeUpdate) this._finalizeUpdate(ea.innerHTML);
        return;
      }

      origInsertInlineCode.call(this);
    };
  })();

  (function patchAdmonitionHtmlToMarkdown() {
    var proto = MarkdownWYSIWYG.prototype;
    var orig = proto._nodeToMarkdownRecursive;
    if (!orig) return;
    proto._nodeToMarkdownRecursive = function (node, options) {
      // INPUT type=checkbox: checklist items from GFM task lists
      if (node.nodeName === 'INPUT' && node.type === 'checkbox') {
        return (node.checked ? '[x]' : '[ ]');
      }
      if (node.nodeType === 8) {
        if (node._liveWysiwygConsumed) return '';
        var commentData = (node.data || '').trim();
        if (commentData.indexOf(RAW_HTML_CLOSE_PREFIX) === 0) {
          var b64 = commentData.substring(RAW_HTML_CLOSE_PREFIX.length);
          return _b64Decode(b64) + '\n';
        }
        return '';
      }
      if (node.nodeType === 1 && node.getAttribute) {
        var rawBlockB64 = node.getAttribute(RAW_HTML_BLOCK_ATTR);
        if (rawBlockB64) {
          var decoded = _b64Decode(rawBlockB64);
          if (!this._rawHtmlPlaceholders) this._rawHtmlPlaceholders = [];
          var idx = this._rawHtmlPlaceholders.length;
          this._rawHtmlPlaceholders.push(decoded);
          return '\u0000__RAWHTMLBLOCK_' + idx + '__\u0000\n';
        }
        var commentB64 = node.getAttribute(RAW_HTML_COMMENT_ATTR);
        if (commentB64) {
          var decoded = _b64Decode(commentB64);
          if (!this._rawHtmlPlaceholders) this._rawHtmlPlaceholders = [];
          var idx = this._rawHtmlPlaceholders.length;
          this._rawHtmlPlaceholders.push(decoded);
          return '\u0000__RAWHTMLBLOCK_' + idx + '__\u0000\n';
        }
        var rawTagB64 = node.getAttribute(RAW_HTML_ATTR);
        if (rawTagB64) {
          var originalOpenTag = _b64Decode(rawTagB64);
          var childMd = '';
          for (var ri = 0; ri < node.childNodes.length; ri++) {
            var rChild = node.childNodes[ri];
            if (rChild.nodeType === 8) {
              var rData = (rChild.data || '').trim();
              if (rData.indexOf(RAW_HTML_CLOSE_PREFIX) === 0) continue;
            }
            if (rChild.nodeType === 1 && rChild.getAttribute) {
              if (rChild.getAttribute(RAW_HTML_COMMENT_ATTR) || rChild.getAttribute(RAW_HTML_ATTR)) {
                childMd += this._nodeToMarkdownRecursive(rChild, options || {});
              } else {
                childMd += _serializeElementAsHtml(rChild);
              }
            } else if (rChild.nodeType === 3) {
              childMd += rChild.textContent;
            } else {
              childMd += this._nodeToMarkdownRecursive(rChild, options || {});
            }
          }
          var closeTag = '';
          var nextSib = node.nextSibling;
          while (nextSib) {
            if (nextSib.nodeType === 8) {
              var nd = (nextSib.data || '').trim();
              if (nd.indexOf(RAW_HTML_CLOSE_PREFIX) === 0) {
                closeTag = _b64Decode(nd.substring(RAW_HTML_CLOSE_PREFIX.length));
                nextSib._liveWysiwygConsumed = true;
                break;
              }
            }
            if (nextSib.nodeType === 1 || (nextSib.nodeType === 3 && nextSib.textContent.trim())) break;
            nextSib = nextSib.nextSibling;
          }
          return originalOpenTag + '\n' + childMd + (closeTag ? closeTag + '\n' : '');
        }
      }
      // #text: preserve multiple spaces (upstream collapses with /  +/g)
      if (node.nodeName === '#text') {
        var text = node.textContent.replace(/\u00a0/g, ' ');
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
          if (cn.nodeType === 1 && cn.classList && (cn.classList.contains('md-code-lang-btn') || cn.classList.contains('md-code-lang-dropdown') || cn.classList.contains('md-code-settings-btn') || cn.classList.contains('md-code-settings-btn-advanced'))) continue;
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
          if (ch.nodeType === 1 && ch.classList && (ch.classList.contains('md-code-lang-btn') || ch.classList.contains('md-code-lang-dropdown') || ch.classList.contains('md-code-settings-btn') || ch.classList.contains('md-code-settings-btn-advanced'))) continue;
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
          (node.classList.contains('md-code-title') || node.classList.contains('md-code-lang') || node.classList.contains('md-code-line-numbers') || node.classList.contains('md-code-lang-dropdown'))) {
        return '';
      }
      if (node.nodeName === 'BUTTON' && node.classList &&
          (node.classList.contains('md-code-lang-btn') || node.classList.contains('md-code-lang-btn-advanced') || node.classList.contains('md-code-settings-btn') || node.classList.contains('md-code-settings-btn-advanced'))) {
        return '';
      }
      if (node.nodeName === 'BUTTON' && node.classList &&
          node.classList.contains('md-admonition-settings-btn')) {
        return '';
      }
      var _admonitionTypes = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention', 'abstract', 'info', 'success', 'question', 'failure', 'bug', 'example', 'quote'];
      var _isAdmonitionDiv = node.nodeName === 'DIV' && node.classList && node.classList.contains('admonition');
      var _isDetailsAdmonition = node.nodeName === 'DETAILS' && node.classList;
      if (_isAdmonitionDiv || _isDetailsAdmonition) {
        var type = null;
        for (var i = 0; i < _admonitionTypes.length; i++) {
          if (node.classList.contains(_admonitionTypes[i])) {
            type = _admonitionTypes[i];
            break;
          }
        }
        if (type) {
          var isCollapsible = (node.nodeName === 'DETAILS');
          var isExpanded = isCollapsible && !node.hasAttribute('data-default-collapsed');
          var hasInline = node.classList.contains('inline');
          var hasEnd = node.classList.contains('end');
          var hideTitle = node.hasAttribute('data-hide-title');

          var titleEl = isCollapsible ? node.querySelector(':scope > summary') : node.querySelector(':scope > .admonition-title');
          var title = titleEl ? titleEl.textContent.replace(/\u00a0/g, ' ').trim() : '';

          var contentParts = [];
          for (var j = 0; j < node.childNodes.length; j++) {
            var c = node.childNodes[j];
            if (c === titleEl) continue;
            if (c.nodeType === 1 && c.classList && c.classList.contains('md-admonition-settings-btn')) continue;
            if (c.nodeType === 3) {
              var txt = c.textContent;
              if (txt && !/^[\s\u200B\u200C\u200D\uFEFF]*$/.test(txt)) contentParts.push(txt);
              continue;
            }
            if (c.nodeType !== 1) continue;
            contentParts.push(this._nodeToMarkdownRecursive(c, options || {}));
          }
          var body = contentParts.join('').trim();
          var bodyIndented = body ? body.split('\n').map(function (l) { return l ? '    ' + l : ''; }).join('\n') : '';

          var prefix = isCollapsible ? (isExpanded ? '???+' : '???') : '!!!';
          var out = prefix + ' ' + type;
          if (hasInline) out += ' inline';
          if (hasEnd) out += ' end';

          var defaultTitle = type.charAt(0).toUpperCase() + type.slice(1);
          if (hideTitle && !isCollapsible) {
            out += ' ""';
          } else if (title && title !== defaultTitle) {
            out += ' "' + title.replace(/"/g, '\\"') + '"';
          }
          out += '\n' + (bodyIndented ? bodyIndented + '\n' : '');
          return out + '\n';
        }
      }
      if (node.nodeName === 'A') {
        var href = node.getAttribute('href') || '';
        var linkText = this._processInlineContainerRecursive ? this._processInlineContainerRecursive(node, options || {}).trim() : node.textContent.trim();
        var linkData = this._liveWysiwygLinkData;
        if (linkData && linkData.linkOriginals) {
          var cleanUrl = normalizeUrl(href);
          var cleanText = (linkText || '').replace(CURSOR_UNICODE_RE, '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
          for (var k = 0; k < linkData.linkOriginals.length; k++) {
            var o = linkData.linkOriginals[k];
            if (o.isImage) continue;
            var origUrl = normalizeUrl(o.url);
            var origText = (o.text || '').replace(CURSOR_UNICODE_RE, '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
            if (origUrl === cleanUrl && origText === cleanText) {
              if (o.isAutolink) {
                return '<' + href + '>';
              }
              var shortMatch = (o.original || '').match(/^\[([^\]]+)\]$/);
              if (shortMatch) {
                return '[' + linkText + ']';
              }
              break;
            }
          }
        }
        var bareText = (linkText || '').replace(CURSOR_UNICODE_RE, '').trim();
        if (bareText && href && normalizeUrl(bareText) === normalizeUrl(href)) {
          return bareText;
        }
      }
      return orig.apply(this, arguments);
    };
  })();

  function removeZeroWidthFromNodes(node) {
    if (node.nodeType === 3) {
      if (node.textContent.indexOf('\u200B') !== -1) {
        node.textContent = node.textContent.replace(/\u200B/g, '');
      }
      return;
    }
    if (node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute('href')) {
        var h = node.getAttribute('href');
        if (/[\u200C\u200D]/.test(h)) {
          node.setAttribute('href', h.replace(/[\u200C\u200D]/g, ''));
        }
      }
      if (node.childNodes) {
        for (var i = 0; i < node.childNodes.length; i++) {
          removeZeroWidthFromNodes(node.childNodes[i]);
        }
      }
    }
  }

  (function patchListToMarkdownRecursiveForMarkerPreservation() {
    var proto = MarkdownWYSIWYG.prototype;
    var origListToMarkdown = proto._listToMarkdownRecursive;
    if (!origListToMarkdown) return;
    proto._listToMarkdownRecursive = function (listNode, indent, listType, listCounter, options) {
      var result = origListToMarkdown.apply(this, arguments);
      var listData = this._liveWysiwygListMarkerData;
      if (!listData || !listData.listItems || !listData.listItems.length) return result;
      if (listType === 'OL') {
        var olOriginals = listData.listItems;
        var olUsed = listData._olUsed || 0;
        var olLines = result.split('\n');
        var olStyle = listData.olStyle;
        for (var oi = 0; oi < olLines.length; oi++) {
          var olm = olLines[oi].match(/^(\s*)(\d+)\.\s+(.*)$/);
          if (!olm) continue;
          var olIndent = olm[1];
          var olContent = olm[3];
          var olNorm = normalizeContentForListMatch(olContent);
          var matched = false;
          for (var oj = olUsed; oj < olOriginals.length; oj++) {
            var oo = olOriginals[oj];
            if (!oo.isOrdered) continue;
            if (oo.indent !== olIndent) continue;
            if (normalizeContentForListMatch(oo.content) === olNorm) {
              olUsed = oj + 1;
              olLines[oi] = olIndent + oo.number + '. ' + olContent;
              matched = true;
              break;
            }
          }
          if (!matched && olStyle === 'all-ones') {
            olLines[oi] = olIndent + '1. ' + olContent;
          }
        }
        listData._olUsed = olUsed;
        var olResult = olLines.join('\n');
        olResult = _compactOlBlankLines(olResult);
        return olResult;
      }
      var originals = listData.listItems;
      var used = 0;
      var lines = result.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var m = line.match(/^(\s*)(-\s+)(.*)$/);
        if (!m) continue;
        var lineIndent = m[1];
        var content = m[3];
        var normContent = normalizeContentForListMatch(content);
        var checklistMatch = content.match(/^\[([ xX])\]\s+/);
        var isChecklist = !!checklistMatch;
        var contentOnly = isChecklist ? content.replace(/^\[[ xX]\]\s+/, '') : content;
        var normContentOnly = normalizeContentForListMatch(contentOnly);
        for (var j = used; j < originals.length; j++) {
          var o = originals[j];
          if (o.indent !== lineIndent) continue;
          if (o.isChecklist && isChecklist) {
            if (normalizeContentForListMatch(o.content) === normContentOnly) {
              used = j + 1;
              var currentCheck = checklistMatch[1];
              var check = /[xX]/.test(currentCheck) ? '[x]' : '[ ]';
              lines[i] = lineIndent + o.marker + check + ' ' + contentOnly;
              break;
            }
          } else if (!o.isChecklist && !isChecklist) {
            if (normalizeContentForListMatch(o.content) === normContent) {
              used = j + 1;
              lines[i] = lineIndent + o.marker + content;
              break;
            }
          }
        }
      }
      var ulResult = lines.join('\n');
      ulResult = _compactUlBlankLines(ulResult);
      return ulResult;
    };
  })();

  (function patchNodeToMarkdownForCheckbox() {
    var proto = MarkdownWYSIWYG.prototype;
    var origNodeToMarkdown = proto._nodeToMarkdownRecursive;
    if (!origNodeToMarkdown) return;
    proto._nodeToMarkdownRecursive = function (node, options) {
      if (node.nodeName === 'INPUT' && node.type === 'checkbox') {
        return (node.checked ? '[x]' : '[ ]');
      }
      return origNodeToMarkdown.apply(this, arguments);
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
      removeZeroWidthFromNodes(tempDiv);
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
        codeBlocks[j] = codeBlocks[j].replace(/[ \t]+$/gm, '');
        protected_ = protected_.split(placeholderPrefix + j + placeholderSuffix).join(codeBlocks[j]);
      }
      var rawHtmlBlocks = this._rawHtmlPlaceholders || [];
      this._rawHtmlPlaceholders = null;
      var rawPrefix = '\u0000__RAWHTMLBLOCK_';
      var rawSuffix = '__\u0000';
      for (var ri = 0; ri < rawHtmlBlocks.length; ri++) {
        var rawPh = rawPrefix + ri + rawSuffix;
        var rawIdx = protected_.indexOf(rawPh);
        if (rawIdx === -1) continue;
        var lineStart = protected_.lastIndexOf('\n', rawIdx - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;
        var beforePh = protected_.substring(lineStart, rawIdx);
        var lineEnd = protected_.indexOf('\n', rawIdx + rawPh.length);
        if (lineEnd === -1) lineEnd = protected_.length;
        if (/^\s*$/.test(beforePh)) {
          protected_ = protected_.substring(0, lineStart) + rawHtmlBlocks[ri] + protected_.substring(lineEnd);
        } else {
          protected_ = protected_.substring(0, rawIdx) + rawHtmlBlocks[ri] + protected_.substring(rawIdx + rawPh.length);
        }
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
   * Preprocess unordered list markers (*, -, +) and checklist items from markdown.
   * Returns { listItems: [{ indent, marker, content, isChecklist?, checked? }] } for preservation.
   */
  function preprocessListMarkers(markdown) {
    if (!markdown || typeof markdown !== 'string') return { listItems: [], olStyle: null };
    var listItems = [];
    var lines = markdown.split('\n');
    var checklistRe = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/;
    var regularRe = /^(\s*)([-*+])\s+(.*)$/;
    var orderedRe = /^(\s*)(\d+)(\.)\s+(.*)$/;
    var olNumbers = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(checklistRe);
      if (m) {
        listItems.push({
          indent: m[1],
          marker: m[2] + ' ',
          content: m[4],
          isChecklist: true,
          checked: /[xX]/.test(m[3])
        });
        continue;
      }
      m = lines[i].match(orderedRe);
      if (m) {
        var num = m[2];
        olNumbers.push(parseInt(num, 10));
        listItems.push({ indent: m[1], marker: num + '. ', content: m[4], isOrdered: true, number: num });
        continue;
      }
      m = lines[i].match(regularRe);
      if (m) {
        listItems.push({ indent: m[1], marker: m[2] + ' ', content: m[3] });
      }
    }
    var olStyle = null;
    if (olNumbers.length > 1) {
      var allOnes = olNumbers.every(function(n) { return n === 1; });
      olStyle = allOnes ? 'all-ones' : 'incrementing';
    }
    return { listItems: listItems, olStyle: olStyle };
  }

  /**
   * Postprocess markdown to restore original list markers where content matches.
   * Handles both regular list items and checklist items (- [ ] / - [x]).
   * New or modified list items use '- '; new checklists use '- [ ] '.
   */
  function normalizeContentForListMatch(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  }

  function postprocessListMarkers(markdown, listData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!listData || !listData.listItems || !listData.listItems.length) return markdown;
    var originals = listData.listItems;
    var used = 0;
    var olUsed = 0;
    function restoreRegular(match, indent, marker, content) {
      var normContent = normalizeContentForListMatch(content);
      for (var i = used; i < originals.length; i++) {
        var o = originals[i];
        if (!o.isChecklist && !o.isOrdered && o.indent === indent && normalizeContentForListMatch(o.content) === normContent) {
          used = i + 1;
          return indent + o.marker + content;
        }
      }
      return match;
    }
    function restoreChecklist(match, indent, marker, checkChar, content) {
      var normContent = normalizeContentForListMatch(content);
      for (var i = used; i < originals.length; i++) {
        var o = originals[i];
        if (o.isChecklist && o.indent === indent && normalizeContentForListMatch(o.content) === normContent) {
          used = i + 1;
          var check = /[xX]/.test(checkChar) ? '[x]' : '[ ]';
          return indent + o.marker + check + ' ' + content;
        }
      }
      return match;
    }
    function restoreOrdered(match, indent, num, content) {
      var normContent = normalizeContentForListMatch(content);
      for (var i = olUsed; i < originals.length; i++) {
        var o = originals[i];
        if (o.isOrdered && o.indent === indent && normalizeContentForListMatch(o.content) === normContent) {
          olUsed = i + 1;
          return indent + o.number + '. ' + content;
        }
      }
      if (listData.olStyle === 'all-ones') {
        return indent + '1. ' + content;
      }
      return match;
    }
    var result = markdown
      .replace(/^(\s*)(-\s+)\[([ xX])\]\s+(.*)$/gm, restoreChecklist)
      .replace(/^(\s*)(-\s+)(.*)$/gm, restoreRegular)
      .replace(/^(\s*)(\d+)\.\s+(.*)$/gm, restoreOrdered);
    result = _compactOlBlankLines(result);
    result = _compactUlBlankLines(result);
    return result;
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
              var currentLangMatch = currentFenceLine.match(/^(?:`{3,}|~{3,})(\S*)/);
              var origLangMatch = restoredFence.match(/^(?:`{3,}|~{3,})(\S*)/);
              var currentLang = (currentLangMatch && currentLangMatch[1]) || '';
              var origLang = (origLangMatch && origLangMatch[1]) || '';
              if (currentLang !== origLang) {
                if (origLang) {
                  restoredFence = restoredFence.replace(/^(`{3,}|~{3,})\S+/, '$1' + currentLang);
                } else {
                  restoredFence = restoredFence.replace(/^(`{3,}|~{3,})/, '$1' + currentLang);
                }
              }
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

  function preprocessHorizontalRules(markdown) {
    if (!markdown || typeof markdown !== 'string') return { rules: [] };
    var rules = [];
    var lines = markdown.split('\n');
    var inFencedCode = false;
    var fencePattern = null;
    var hrRe = /^\s*([-*_])(\s*\1){2,}\s*$/;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (inFencedCode) {
        if (fencePattern && fencePattern.test(line)) {
          inFencedCode = false;
          fencePattern = null;
        }
        continue;
      }
      var fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        inFencedCode = true;
        var fc = fenceMatch[2];
        fencePattern = new RegExp('^\\s*' + fc.charAt(0) + '{' + fc.length + ',}\\s*$');
        continue;
      }
      if (!hrRe.test(line)) continue;
      if (/^\s*-/.test(line)) {
        var isSetext = false;
        for (var j = i - 1; j >= 0; j--) {
          if (/^\s*$/.test(lines[j])) break;
          isSetext = true;
          break;
        }
        if (isSetext) continue;
      }
      rules.push(line);
    }
    return { rules: rules };
  }

  function postprocessHorizontalRules(markdown, hrData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!hrData || !hrData.rules || !hrData.rules.length) return markdown;
    var originals = hrData.rules;
    var used = 0;
    var lines = markdown.split('\n');
    var inFencedCode = false;
    var fencePattern = null;
    for (var i = 0; i < lines.length; i++) {
      if (used >= originals.length) break;
      var line = lines[i];
      if (inFencedCode) {
        if (fencePattern && fencePattern.test(line)) {
          inFencedCode = false;
          fencePattern = null;
        }
        continue;
      }
      var fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        inFencedCode = true;
        var fc = fenceMatch[2];
        fencePattern = new RegExp('^\\s*' + fc.charAt(0) + '{' + fc.length + ',}\\s*$');
        continue;
      }
      if (/^\s*---\s*$/.test(line)) {
        lines[i] = originals[used];
        used++;
      }
    }
    return lines.join('\n');
  }

  var RAW_HTML_ATTR = 'data-live-wysiwyg-raw-html';
  var RAW_HTML_CLOSE_PREFIX = 'live-wysiwyg-raw-close:';
  var RAW_HTML_COMMENT_ATTR = 'data-live-wysiwyg-html-comment';
  var RAW_HTML_BLOCK_ATTR = 'data-live-wysiwyg-raw-html-block';

  function _serializeElementAsHtml(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toLowerCase();
    var attrs = '';
    if (node.attributes) {
      for (var ai = 0; ai < node.attributes.length; ai++) {
        var attr = node.attributes[ai];
        if (attr.name === RAW_HTML_ATTR || attr.name === RAW_HTML_COMMENT_ATTR || attr.name === RAW_HTML_BLOCK_ATTR) continue;
        attrs += ' ' + attr.name + '="' + attr.value.replace(/"/g, '&quot;') + '"';
      }
    }
    var voidTags = ['br','hr','img','input','col','area','base','link','meta','source','track','wbr'];
    if (voidTags.indexOf(tag) >= 0) return '<' + tag + attrs + '>';
    var inner = '';
    for (var ci = 0; ci < node.childNodes.length; ci++) {
      inner += _serializeElementAsHtml(node.childNodes[ci]);
    }
    return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
  }

  function _countBlockTagDepth(line, tagName) {
    var re = new RegExp('<(/??)\\s*' + tagName + '\\b([^>]*?)(/?)\\s*>', 'gi');
    var depth = 0;
    var m;
    while ((m = re.exec(line)) !== null) {
      var isClose = m[1] === '/';
      var isSelfClose = m[3] === '/';
      if (isClose) depth--;
      else if (!isSelfClose) depth++;
    }
    return depth;
  }

  var _rawHtmlVoidTags = ['br','hr','img','input','col','area','base','link','meta','source','track','wbr'];

  function _b64Encode(str) {
    try { return btoa(unescape(encodeURIComponent(str))); }
    catch (e) { return btoa(str); }
  }

  function _b64Decode(str) {
    try { return decodeURIComponent(escape(atob(str))); }
    catch (e) { try { return atob(str); } catch (e2) { return str; } }
  }

  function _stripCommonLeadingWhitespace(text) {
    var lines = text.split('\n');
    var minIndent = Infinity;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim().length === 0) continue;
      var leading = lines[i].match(/^(\s*)/)[1].length;
      if (leading < minIndent) minIndent = leading;
    }
    if (minIndent > 0 && minIndent < Infinity) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim().length === 0) continue;
        lines[i] = lines[i].substring(minIndent);
      }
    }
    return lines.join('\n');
  }

  var _keepBlankBeforeListRe = /^\s*(`{3,}|~{3,})\s*$|^\s*<|^\s*>|\u0000__RAWHTMLBLOCK_/;
  var _isListContextLineRe = /^\s|^\d+\.\s|^[-*+]\s/;

  function _compactOlBlankLines(text) {
    return text.replace(/([^\n]*)\n[ \t]*\n(?=\s*\d+\.\s)/g, function (match, prevLine) {
      if (_keepBlankBeforeListRe.test(prevLine)) return match;
      if (!_isListContextLineRe.test(prevLine)) return match;
      return prevLine + '\n';
    });
  }

  function _compactUlBlankLines(text) {
    return text.replace(/([^\n]*)\n[ \t]*\n(?=\s*[-*+]\s)/g, function (match, prevLine) {
      if (_keepBlankBeforeListRe.test(prevLine)) return match;
      if (!_isListContextLineRe.test(prevLine)) return match;
      return prevLine + '\n';
    });
  }

  function _isHtmlTagKnownToMarkdown(tag) {
    var m = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    if (!m) return false;
    var name = m[1].toLowerCase();
    var mdTags = ['p','br','hr','em','strong','del','s','strike','b','i','u',
      'h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote',
      'pre','code','a','img','table','thead','tbody','tr','th','td',
      'input','sup','sub'];
    return mdTags.indexOf(name) >= 0;
  }

  function preprocessRawHtml(markdown) {
    if (!markdown || typeof markdown !== 'string') return { markdown: markdown, comments: [], tags: [] };
    var comments = [];
    var tags = [];

    var lines = markdown.split('\n');
    var inFencedCode = false;
    var fencePattern = null;
    var result = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (inFencedCode) {
        if (fencePattern && fencePattern.test(line)) {
          inFencedCode = false;
          fencePattern = null;
        }
        result.push(line);
        continue;
      }

      var fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        inFencedCode = true;
        var fc = fenceMatch[2];
        fencePattern = new RegExp('^\\s*' + fc.charAt(0) + '{' + fc.length + ',}\\s*$');
        result.push(line);
        continue;
      }

      var admonitionMatch = line.match(/^(\s*)(\?\?\?\+|\?\?\?|!!!)\s+\w+/);
      if (admonitionMatch) {
        result.push(line);
        continue;
      }

      var blockOpenMatch = line.match(/^(\s*)<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/);
      if (blockOpenMatch && !/\/\s*>$/.test(blockOpenMatch[0])) {
        var bTagName = blockOpenMatch[2].toLowerCase();
        if (!_isHtmlTagKnownToMarkdown('<' + bTagName + '>') && _rawHtmlVoidTags.indexOf(bTagName) < 0) {
          var blockLines = [line];
          var depth = _countBlockTagDepth(line, bTagName);
          var blockClosed = (depth <= 0);
          if (depth > 0) {
            var j = i + 1;
            while (j < lines.length && depth > 0) {
              blockLines.push(lines[j]);
              depth += _countBlockTagDepth(lines[j], bTagName);
              j++;
            }
            blockClosed = (depth <= 0);
            if (blockClosed) i = j - 1;
          }
          if (blockClosed) {
            var fullBlock = blockLines.join('\n');
            var encoded = _b64Encode(fullBlock);
            var blockIndent = blockOpenMatch[1] || '';
            result.push(blockIndent + '<div ' + RAW_HTML_BLOCK_ATTR + '="' + encoded + '"></div>');
            continue;
          }
        }
      }

      var commentProcessed = _preprocessLineComments(line, lines, i, comments, result);
      if (commentProcessed !== false) {
        i = commentProcessed;
        continue;
      }

      var tagProcessed = _preprocessLineTags(line, tags, result);
      if (tagProcessed) {
        continue;
      }

      result.push(line);
    }

    return { markdown: result.join('\n'), comments: comments, tags: tags };
  }

  function _preprocessLineComments(line, lines, idx, comments, result) {
    var commentStart = line.indexOf('<!--');
    if (commentStart === -1) return false;

    var commentEnd = line.indexOf('-->', commentStart + 4);
    if (commentEnd !== -1) {
      var before = line.substring(0, commentStart);
      var comment = line.substring(commentStart, commentEnd + 3);
      var after = line.substring(commentEnd + 3);
      var isBlockComment = !before.trim() && !after.trim();
      var originalForEncode = isBlockComment ? before + comment : comment;
      var encoded = _b64Encode(originalForEncode);
      var idx_ = comments.length;
      comments.push({ original: comment, leading: isBlockComment ? before : '', lineIdx: idx });
      var placeholder = '<span ' + RAW_HTML_COMMENT_ATTR + '="' + encoded + '" style="display:none"></span>';
      if (isBlockComment) {
        result.push(before + placeholder + after);
      } else {
        result.push(before + placeholder + after);
      }
      return idx;
    }

    var multiLines = [line];
    var j = idx + 1;
    while (j < lines.length) {
      multiLines.push(lines[j]);
      if (lines[j].indexOf('-->') !== -1) break;
      j++;
    }
    var fullComment = multiLines.join('\n');
    var endPos = fullComment.indexOf('-->');
    if (endPos === -1) {
      result.push(line);
      return false;
    }
    var leading = line.substring(0, commentStart);
    var commentText = fullComment.substring(commentStart, endPos + 3);
    var afterComment = fullComment.substring(endPos + 3);
    var isBlockComment = !leading.trim();
    var originalForEncode = isBlockComment ? leading + commentText : commentText;

    var encoded = _b64Encode(originalForEncode);
    comments.push({ original: commentText, leading: isBlockComment ? leading : '', lineIdx: idx });
    var placeholder = '<span ' + RAW_HTML_COMMENT_ATTR + '="' + encoded + '" style="display:none"></span>';
    var afterLines = afterComment.split('\n');
    result.push(leading + placeholder + afterLines[0]);
    for (var k = 1; k < afterLines.length; k++) {
      result.push(afterLines[k]);
    }
    return j;
  }

  function _preprocessLineTags(line, tags, result) {
    var tagRe = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g;
    var out = '';
    var lastIdx = 0;
    var changed = false;
    var m;

    var codeSpans = [];
    var csRe = /`[^`\n]+`/g;
    var csm;
    while ((csm = csRe.exec(line)) !== null) {
      codeSpans.push({ start: csm.index, end: csm.index + csm[0].length });
    }
    function isInsideCodeSpan(pos) {
      for (var k = 0; k < codeSpans.length; k++) {
        if (pos >= codeSpans[k].start && pos < codeSpans[k].end) return true;
      }
      return false;
    }

    while ((m = tagRe.exec(line)) !== null) {
      if (isInsideCodeSpan(m.index)) continue;

      var fullTag = m[0];
      var tagName = m[2];
      var isClose = m[1] === '/';
      var isSelfClose = m[4] === '/';

      if (_isHtmlTagKnownToMarkdown(fullTag)) continue;

      var tagContent = m[3] || '';
      if (!isClose && /^:\/\//.test(tagContent)) continue;
      var innerText = tagName + tagContent;
      if (!isClose && innerText.indexOf('@') >= 0 && innerText.indexOf(' ') === -1) continue;

      changed = true;

      var prefixText = line.substring(lastIdx, m.index);
      var onlyWhitespace = /^[ \t]*$/.test(prefixText);
      var originalForEncode = (onlyWhitespace && lastIdx === 0) ? prefixText + fullTag : fullTag;

      out += prefixText;

      if (isSelfClose) {
        var encoded = _b64Encode(originalForEncode);
        tags.push({ original: originalForEncode, type: 'selfclose' });
        out += fullTag.replace(/\/?>$/, ' ' + RAW_HTML_ATTR + '="' + encoded + '"/>');
      } else if (isClose) {
        var encoded = _b64Encode(originalForEncode);
        tags.push({ original: originalForEncode, type: 'close' });
        out += fullTag + '<!--' + RAW_HTML_CLOSE_PREFIX + encoded + '-->';
      } else {
        var encoded = _b64Encode(originalForEncode);
        tags.push({ original: originalForEncode, type: 'open' });
        out += fullTag.replace(/>$/, ' ' + RAW_HTML_ATTR + '="' + encoded + '">');
      }
      lastIdx = m.index + fullTag.length;
    }

    if (!changed) return false;
    out += line.substring(lastIdx);
    result.push(out);
    return true;
  }

  function postprocessRawHtml(markdown, rawHtmlData) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    if (!rawHtmlData) return markdown;
    return markdown;
  }

  var CURSOR_SPAN_HTML_RE = /<span\s+data-live-wysiwyg-cursor(?:-end)?[^>]*>\s*<\/span>/gi;
  var CURSOR_UNICODE_RE = /[\u200C\u200D]{2,}/g;

  function stripCursorSpanHtml(s) {
    if (!s || typeof s !== 'string') return s || '';
    return s.replace(CURSOR_SPAN_HTML_RE, '');
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.replace(/^<|>$/g, '').replace(CURSOR_UNICODE_RE, '').trim();
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
      m = lines[i].match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
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
    if (!linkData) return markdown;

    var linkOriginals = linkData.linkOriginals || [];
    var refDefinitions = linkData.refDefinitions || '';
    var refDefsByUrl = {};
    if (refDefinitions) {
      var refDefRe = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;
      var rd;
      while ((rd = refDefRe.exec(refDefinitions)) !== null) {
        var rDefName = rd[1];
        var rDefUrl = normalizeUrl(rd[2] || rd[3] || '');
        if (rDefUrl && !refDefsByUrl[rDefUrl]) refDefsByUrl[rDefUrl] = rDefName;
      }
    }

    var inlineLinkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var inlineImgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    var spanCursorRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR + '\\s*></span>', 'g');
    var spanCursorEndRe = new RegExp('<span\\s+' + CURSOR_SPAN_ATTR_END + '\\s*></span>', 'g');
    var used = [];

    function stripMarkers(s) {
      return s.replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '').replace(spanCursorRe, '').replace(spanCursorEndRe, '');
    }

    function normalizeLinkText(s) {
      return (stripMarkers(s) || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
    }
    function replaceMatch(match, text, url, isImage) {
      var cleanUrl = normalizeUrl(url);
      var cleanText = normalizeLinkText(text);
      for (var i = 0; i < linkOriginals.length; i++) {
        var origText = normalizeLinkText(linkOriginals[i].text);
        var origUrl = normalizeUrl(linkOriginals[i].url);
        if (!used[i] && origUrl === cleanUrl && origText === cleanText && !!linkOriginals[i].isImage === !!isImage) {
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
      if (!isImage) {
        var shortcutRefName = refDefsByUrl[cleanUrl];
        if (shortcutRefName && shortcutRefName.toLowerCase() === cleanText.toLowerCase()) {
          return '[' + text + ']';
        }
      }
      return match;
    }

    var result = markdown
      .replace(inlineLinkRe, function (match, text, url) { return replaceMatch(match, text, url, false); })
      .replace(inlineImgRe, function (match, text, url) { return replaceMatch(match, text, url, true); });

    if (refDefinitions) {
      var refDefNameRe = /^\s{0,3}\[([^\]]+)\]:/;
      var existingRefNames = {};
      var resultLines = result.split('\n');
      for (var ri = 0; ri < resultLines.length; ri++) {
        var rm = resultLines[ri].match(refDefNameRe);
        if (rm) existingRefNames[rm[1].toLowerCase()] = true;
      }
      var defLines = refDefinitions.split('\n');
      var missingDefs = [];
      for (var di = 0; di < defLines.length; di++) {
        if (!defLines[di].trim()) continue;
        var dm = defLines[di].match(refDefNameRe);
        if (dm && existingRefNames[dm[1].toLowerCase()]) continue;
        missingDefs.push(defLines[di]);
      }
      if (missingDefs.length > 0) {
        var defsToAppend = missingDefs.join('\n');
        var trimmed = result.replace(/\s+$/, '');
        var lastOpenIdx = trimmed.lastIndexOf('<!--');
        var inserted = false;
        if (lastOpenIdx >= 0) {
          var afterLastOpen = trimmed.slice(lastOpenIdx);
          var closingIdx = afterLastOpen.indexOf('-->');
          if (closingIdx >= 0 && afterLastOpen.slice(closingIdx + 3).trim() === '') {
            var before = trimmed.slice(0, lastOpenIdx).replace(/\s+$/, '');
            var after = trimmed.slice(lastOpenIdx);
            var lastLineBefore = before.slice(before.lastIndexOf('\n') + 1);
            var endsWithRefDef = refDefNameRe.test(lastLineBefore);
            result = before + (endsWithRefDef ? '\n' : '\n\n') + defsToAppend + '\n' + after + '\n';
            inserted = true;
          }
        }
        if (!inserted) {
          var lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
          var endsWithRefDef = refDefNameRe.test(lastLine);
          result = trimmed + (endsWithRefDef ? '\n' : '\n\n') + defsToAppend + '\n';
        }
      }
    }
    return result;
  }

  /**
   * Convert redundant reference-style links [text][ref] back to shortcut form [text]
   * when ref id equals link text (case-insensitive). Preserves original shortcut style.
   */
  function collapseRedundantReferenceToShortcut(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown;
    return markdown.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, function (match, text, ref) {
      if (text.toLowerCase() === ref.toLowerCase()) return '[' + text + ']';
      return match;
    });
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
      if (normalizeUrl(match[1]) === normalizeUrl(match[2])) continue;
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

    var existingRefDefRe = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;
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
    var linkDataRefsByUrl = {};
    if (linkData && linkData.refDefinitions) {
      var refDefRe = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;
      var rd;
      while ((rd = refDefRe.exec(linkData.refDefinitions)) !== null) {
        var rDefName = rd[1];
        var rDefUrl = normalizeUrl(rd[2] || rd[3] || '');
        if (rDefUrl && !linkDataRefsByUrl[rDefUrl]) {
          linkDataRefsByUrl[rDefUrl] = rDefName;
        }
      }
    }

    for (var url in urlGroups) {
      var hasExistingDef = !!existingRefsByUrl[url];

      var origRefName = linkDataRefsByUrl[url] || null;
      if (!origRefName && linkData && linkData.linkOriginals) {
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

      var hasRefInfo = hasExistingDef || origRefName;
      if (urlGroups[url].length < 2 && !hasRefInfo) continue;

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
      var defRegex = new RegExp('^\\s{0,3}\\[' + escapedRefName + '\\]:', 'mi');
      if (!defRegex.test(result)) {
        newDefs.push('[' + info.refName + ']: ' + info.rawUrl);
      }
    }

    if (newDefs.length > 0) {
      var trimmed = result.replace(/\s+$/, '');
      var lastOpenIdx = trimmed.lastIndexOf('<!--');
      var insertedDefs = false;
      if (lastOpenIdx >= 0) {
        var afterLastOpen = trimmed.slice(lastOpenIdx);
        var closingIdx = afterLastOpen.indexOf('-->');
        if (closingIdx >= 0 && afterLastOpen.slice(closingIdx + 3).trim() === '') {
          var before = trimmed.slice(0, lastOpenIdx).replace(/\s+$/, '');
          var after = trimmed.slice(lastOpenIdx);
          var lastLineBefore = before.slice(before.lastIndexOf('\n') + 1);
          var endsWithRefDef = /^\s{0,3}\[([^\]]+)\]:\s/.test(lastLineBefore);
          result = before + (endsWithRefDef ? '\n' : '\n\n') + newDefs.join('\n') + '\n' + after;
          insertedDefs = true;
        }
      }
      if (!insertedDefs) {
        var lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
        var endsWithRefDef = /^\s{0,3}\[([^\]]+)\]:\s/.test(lastLine);
        result = trimmed + (endsWithRefDef ? '\n' : '\n\n') + newDefs.join('\n');
      }
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
        this._liveWysiwygHrData = preprocessHorizontalRules(markdown);
      }
      return origSetValue.apply(this, arguments);
    };
    proto.switchToMode = function (mode, isInitialSetup) {
      if (mode === 'wysiwyg' && !isInitialSetup && this.markdownArea && this.markdownArea.value) {
        var body = parseFrontmatter(this.markdownArea.value).body;
        var cleanBody = stripCursorSpanHtml(body);
        var newLinkData = preprocessMarkdownLinks(cleanBody);
        var newListData = preprocessListMarkers(cleanBody);
        this._liveWysiwygTableSepData = preprocessTableSeparators(cleanBody);
        this._liveWysiwygCodeBlockData = preprocessCodeBlocks(cleanBody);
        this._liveWysiwygHrData = preprocessHorizontalRules(cleanBody);
        if (newLinkData.refDefinitions) {
          this._liveWysiwygLinkData = newLinkData;
        }
        if (newListData.listItems && newListData.listItems.length) {
          this._liveWysiwygListMarkerData = newListData;
        }
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
        if (this._liveWysiwygRawHtmlData) {
          md = postprocessRawHtml(md, this._liveWysiwygRawHtmlData);
        }
        if (this._liveWysiwygHrData) {
          md = postprocessHorizontalRules(md, this._liveWysiwygHrData);
        }
        if (this._liveWysiwygLinkData) {
          md = dryDuplicateInlineLinks(md, this._liveWysiwygLinkData);
          md = collapseRedundantReferenceToShortcut(md);
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
      if (this._liveWysiwygLinkData) {
        body = postprocessMarkdownLinks(body, this._liveWysiwygLinkData);
      }
      if (this._liveWysiwygListMarkerData) {
        body = postprocessListMarkers(body, this._liveWysiwygListMarkerData);
      }
      if (this._liveWysiwygTableSepData) {
        body = postprocessTableSeparators(body, this._liveWysiwygTableSepData);
      }
      if (this._liveWysiwygCodeBlockData) {
        body = postprocessCodeBlocks(body, this._liveWysiwygCodeBlockData);
      }
      if (this._liveWysiwygRawHtmlData) {
        body = postprocessRawHtml(body, this._liveWysiwygRawHtmlData);
      }
      if (this._liveWysiwygHrData) {
        body = postprocessHorizontalRules(body, this._liveWysiwygHrData);
      }
      if (this._liveWysiwygLinkData) {
        body = dryDuplicateInlineLinks(body, this._liveWysiwygLinkData);
        body = collapseRedundantReferenceToShortcut(body);
      }
      body = stripCursorSpanHtml(body).replace(CURSOR_UNICODE_RE, '');
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

  function findAndStripCursorMarkerPositions(editable) {
    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var startInfo = null, endInfo = null;
    while ((node = walker.nextNode())) {
      var text = node.textContent;
      if (!startInfo) {
        var is = text.indexOf(CURSOR_MARKER);
        if (is >= 0) startInfo = { node: node, idx: is };
      }
      if (!endInfo) {
        var ie = text.indexOf(CURSOR_MARKER_END);
        if (ie >= 0) endInfo = { node: node, idx: ie };
      }
      if (startInfo && endInfo) break;
    }
    if (!startInfo) return null;
    var sameNode = endInfo && startInfo.node === endInfo.node;
    var startOffset = startInfo.idx;
    var endNode, endOffset, hasSelection;
    if (endInfo) {
      endNode = endInfo.node;
      endOffset = sameNode ? endInfo.idx - CURSOR_MARKER.length : endInfo.idx;
      hasSelection = sameNode ? endOffset > startOffset : true;
    } else {
      endNode = startInfo.node;
      endOffset = startInfo.idx;
      hasSelection = false;
    }
    stripCursorMarkersFromDOM(editable);
    return {
      startNode: startInfo.node, startOffset: startOffset,
      endNode: endNode, endOffset: endOffset,
      hasSelection: hasSelection
    };
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

  function focusCursorAtDocStart(editable) {
    var first = editable.firstElementChild;
    if (first && /^H[1-6]$/.test(first.nodeName)) {
      var walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT, null, false);
      var textNode = walker.nextNode();
      if (textNode) {
        var stripMarkers = /[\u200B\u200C\u200D\uFEFF]/g;
        var offset = 0;
        var raw = textNode.textContent || '';
        while (offset < raw.length && stripMarkers.test(raw[offset])) { offset++; stripMarkers.lastIndex = 0; }
        var range = document.createRange();
        range.setStart(textNode, offset);
        range.collapse(true);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        return;
      }
    }
    setSelectionInEditable(editable, 0, 0);
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

  function emojiToShortcode(emoji) {
    var map = typeof liveWysiwygEmojiMap !== 'undefined' ? liveWysiwygEmojiMap : {};
    for (var key in map) {
      if (map[key] === emoji) return ':' + key + ':';
    }
    return null;
  }

  function replaceEmojiCharsWithShortcodes(text) {
    var map = typeof liveWysiwygEmojiMap !== 'undefined' ? liveWysiwygEmojiMap : {};
    var result = text;
    for (var key in map) {
      if (map.hasOwnProperty(key) && result.indexOf(map[key]) >= 0) {
        result = result.split(map[key]).join(':' + key + ':');
      }
    }
    return result;
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
    if (!pos) {
      var sc = emojiToShortcode(selectedText);
      if (sc) {
        pos = findSelectedTextInMarkdown(body, sc, contextBefore, contextAfter);
      }
    }
    if (!pos) {
      var withShortcodes = replaceEmojiCharsWithShortcodes(selectedText);
      if (withShortcodes !== selectedText) {
        pos = findSelectedTextInMarkdown(body, withShortcodes, contextBefore, contextAfter);
      }
    }
    if (editor.currentMode === 'markdown') {
      if (!pos) return false;
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
    if (pos) {
      var spanMarker = '<span ' + CURSOR_SPAN_ATTR + '></span>';
      var spanMarkerEnd = '<span ' + CURSOR_SPAN_ATTR_END + '></span>';
      var markedBody = body.slice(0, pos.start) + spanMarker +
                       body.slice(pos.start, pos.end) + spanMarkerEnd +
                       body.slice(pos.end);
      ea.innerHTML = editor._markdownToHtml(markedBody);
      if (typeof populateRawHtmlBlocks === 'function') populateRawHtmlBlocks(ea);
      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(ea);
      if (typeof enhanceChecklists === 'function') enhanceChecklists(ea);
      if (typeof enhanceAdmonitions === 'function') enhanceAdmonitions(ea);
      var mPos = findAndStripCursorMarkerPositions(ea);
      if (mPos) {
        ea.focus();
        var range = document.createRange();
        range.setStart(mPos.startNode, mPos.startOffset);
        range.setEnd(mPos.endNode, mPos.endOffset);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        requestAnimationFrame(function () { scrollToCenterCursor(ea, false); });
        return true;
      }
    }
    if (!pos) {
      var imgs = ea.querySelectorAll('img[data-emoji-shortcode]');
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].alt === selectedText) {
          var r = document.createRange();
          r.selectNode(imgs[i]);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          ea.focus();
          requestAnimationFrame(function () { scrollToCenterCursor(ea, false); });
          return true;
        }
      }
    }
    var fullText = '';
    var walker = document.createTreeWalker(ea, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) fullText += node.textContent;
    var pos2 = findSelectedTextInContent(fullText, selectedText, contextBefore, contextAfter);
    if (pos2) {
      setSelectionInEditable(ea, pos2.start, pos2.end);
      ea.focus();
      requestAnimationFrame(function () { scrollToCenterCursor(ea, false); });
      return true;
    }
    return false;
  }

  // ---- Read-only to edit-mode selection heuristics ----

  function buildPseudoMarkdown(root) {
    var md = '';
    var hashTable = {};
    var hid = 0;
    var listStack = [];
    var olCounters = [];

    function ensureTrailingNewlines(n) {
      if (md.length === 0 && n > 0) return;
      var trailing = 0;
      for (var k = md.length - 1; k >= 0 && md[k] === '\n'; k--) trailing++;
      while (trailing < n) { md += '\n'; trailing++; }
    }

    function isBlockTag(t) {
      return /^(P|DIV|H[1-6]|LI|TR|HR|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|UL|OL|DL|DT|DD|DETAILS|SUMMARY|SECTION|HEADER|FOOTER|FIGURE|FIGCAPTION)$/.test(t);
    }

    function walk(node) {
      if (node.nodeType === 3) {
        var t = node.textContent;
        if (/^\s+$/.test(t) && node.parentNode) {
          var prev = node.previousSibling;
          var next = node.nextSibling;
          if ((prev && prev.nodeType === 1 && isBlockTag(prev.nodeName)) ||
              (next && next.nodeType === 1 && isBlockTag(next.nodeName))) return;
        }
        md += t;
        return;
      }
      if (node.nodeType !== 1) return;

      var tag = node.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (node.classList && (
        node.classList.contains('live-edit-controls') ||
        node.classList.contains('live-wysiwyg-selection-edit-popup') ||
        node.classList.contains('live-edit-source') ||
        node.classList.contains('live-edit-wysiwyg-wrapper') ||
        node.classList.contains('md-wysiwyg-editor-wrapper')
      )) return;
      if (tag === 'A' && node.classList && node.classList.contains('headerlink')) return;
      if (tag === 'TD' && node.classList && node.classList.contains('linenos')) return;

      if (/^H([1-6])$/.test(tag)) {
        var level = parseInt(tag.charAt(1));
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        for (var h = 0; h < level; h++) md += '#';
        md += ' ';
        walkChildren(node);
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'P') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        walkChildren(node);
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'STRONG' || tag === 'B') {
        md += '**';
        walkChildren(node);
        md += '**';
        return;
      }

      if (tag === 'EM' || tag === 'I') {
        md += '*';
        walkChildren(node);
        md += '*';
        return;
      }

      if (tag === 'CODE') {
        var inPre = false;
        var p = node.parentNode;
        while (p) { if (p.nodeName === 'PRE') { inPre = true; break; } p = p.parentNode; }
        if (!inPre) {
          md += '`';
          walkChildren(node);
          md += '`';
          return;
        }
      }

      if (tag === 'IMG') {
        var sc = node.getAttribute('data-emoji-shortcode');
        var title = node.getAttribute('title') || '';
        var alt = node.alt || '';
        var key = '_h' + (hid++);
        var shortcode = null;
        if (sc) {
          shortcode = ':' + sc + ':';
        } else if (title && /^:[a-z0-9_+-]+:$/.test(title)) {
          shortcode = title;
        }
        hashTable[key] = { kind: sc ? 'emoji' : 'image', alt: alt, shortcode: shortcode };
        md += shortcode || alt;
        return;
      }

      if (tag === 'BR') { md += '\n'; return; }

      if (tag === 'UL') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        listStack.push('ul');
        walkChildren(node);
        listStack.pop();
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'OL') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        listStack.push('ol');
        olCounters.push(0);
        walkChildren(node);
        listStack.pop();
        olCounters.pop();
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'LI') {
        if (md.length > 0 && md[md.length - 1] !== '\n') md += '\n';
        var curList = listStack.length > 0 ? listStack[listStack.length - 1] : 'ul';
        if (curList === 'ol') {
          var cnt = olCounters.length > 0 ? ++olCounters[olCounters.length - 1] : 1;
          md += cnt + '. ';
        } else {
          md += '- ';
        }
        walkChildren(node);
        if (md.length > 0 && md[md.length - 1] !== '\n') md += '\n';
        return;
      }

      if (tag === 'BLOCKQUOTE') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        md += '> ';
        walkChildren(node);
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'PRE') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        var lang = '';
        var wrapper = node.parentNode;
        while (wrapper && wrapper !== root) {
          var cls = wrapper.className || '';
          var m = cls.match(/language-(\S+)/);
          if (m) { lang = m[1]; break; }
          wrapper = wrapper.parentNode;
        }
        md += '```' + lang + '\n';
        walkChildren(node);
        if (md.length > 0 && md[md.length - 1] !== '\n') md += '\n';
        md += '```';
        ensureTrailingNewlines(2);
        return;
      }

      if (tag === 'DIV' && node.classList && node.classList.contains('admonition')) {
        var adType = null;
        var adTypes = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention', 'abstract', 'info', 'success', 'question', 'failure', 'bug', 'example', 'quote'];
        for (var ati = 0; ati < adTypes.length; ati++) {
          if (node.classList.contains(adTypes[ati])) { adType = adTypes[ati]; break; }
        }
        if (adType) {
          ensureTrailingNewlines(md.length > 0 ? 2 : 0);
          var adPrefix = '!!! ' + adType;
          if (node.classList.contains('inline')) adPrefix += ' inline';
          if (node.classList.contains('end')) adPrefix += ' end';
          var adTitleEl = null;
          for (var tc = node.firstChild; tc; tc = tc.nextSibling) {
            if (tc.nodeType === 1 && tc.classList && tc.classList.contains('admonition-title')) { adTitleEl = tc; break; }
          }
          if (node.hasAttribute('data-hide-title')) {
            adPrefix += ' ""';
          } else if (adTitleEl) {
            var adTitleText = adTitleEl.textContent.replace(/\u00b6/g, '').trim();
            var adDefaultTitle = adType.charAt(0).toUpperCase() + adType.slice(1);
            if (adTitleText && adTitleText !== adDefaultTitle) adPrefix += ' "' + adTitleText + '"';
          }
          md += adPrefix + '\n';
          var savedMdLen = md.length;
          for (var ac = node.firstChild; ac; ac = ac.nextSibling) {
            if (ac === adTitleEl) continue;
            if (ac.nodeType === 1 && ac.classList && ac.classList.contains('md-admonition-settings-btn')) continue;
            walk(ac);
          }
          var bodyContent = md.slice(savedMdLen);
          md = md.slice(0, savedMdLen);
          var bodyLines = bodyContent.split('\n');
          for (var bli = 0; bli < bodyLines.length; bli++) {
            md += bodyLines[bli] ? '    ' + bodyLines[bli] : '';
            if (bli < bodyLines.length - 1) md += '\n';
          }
          ensureTrailingNewlines(2);
          return;
        }
      }

      if (tag === 'DETAILS' && node.classList) {
        var detType = null;
        var detTypes = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention', 'abstract', 'info', 'success', 'question', 'failure', 'bug', 'example', 'quote'];
        for (var dti = 0; dti < detTypes.length; dti++) {
          if (node.classList.contains(detTypes[dti])) { detType = detTypes[dti]; break; }
        }
        if (detType) {
          ensureTrailingNewlines(md.length > 0 ? 2 : 0);
          var detIsExpanded = node.hasAttribute('open') && !node.hasAttribute('data-default-collapsed');
          var detPrefix = detIsExpanded ? '???+ ' + detType : '??? ' + detType;
          if (node.classList.contains('inline')) detPrefix += ' inline';
          if (node.classList.contains('end')) detPrefix += ' end';
          var summaryEl = null;
          for (var sc = node.firstChild; sc; sc = sc.nextSibling) {
            if (sc.nodeType === 1 && sc.nodeName === 'SUMMARY') { summaryEl = sc; break; }
          }
          if (summaryEl) {
            var summaryText = summaryEl.textContent.replace(/\u00b6/g, '').trim();
            var detDefaultTitle = detType.charAt(0).toUpperCase() + detType.slice(1);
            if (summaryText && summaryText !== detDefaultTitle) detPrefix += ' "' + summaryText + '"';
          }
          md += detPrefix + '\n';
          var savedMdLen2 = md.length;
          for (var dc = node.firstChild; dc; dc = dc.nextSibling) {
            if (dc === summaryEl) continue;
            if (dc.nodeType === 1 && dc.classList && dc.classList.contains('md-admonition-settings-btn')) continue;
            walk(dc);
          }
          var bodyContent2 = md.slice(savedMdLen2);
          md = md.slice(0, savedMdLen2);
          var bodyLines2 = bodyContent2.split('\n');
          for (var bli2 = 0; bli2 < bodyLines2.length; bli2++) {
            md += bodyLines2[bli2] ? '    ' + bodyLines2[bli2] : '';
            if (bli2 < bodyLines2.length - 1) md += '\n';
          }
          ensureTrailingNewlines(2);
          return;
        }
      }

      if (tag === 'HR') {
        ensureTrailingNewlines(md.length > 0 ? 2 : 0);
        md += '---';
        ensureTrailingNewlines(2);
        return;
      }

      walkChildren(node);
    }

    function walkChildren(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
    }

    walk(root);
    return { md: md, hashTable: hashTable };
  }

  function buildSearchable(text) {
    var out = '';
    var posMap = [];
    var i = 0;
    var len = text.length;
    var lastWasSpace = false;

    while (i < len) {
      if (i === 0 || text[i - 1] === '\n') {
        var j = i;
        while (j < len && text[j] === '#') j++;
        if (j > i && j - i <= 6 && j < len && text[j] === ' ') {
          i = j + 1;
          continue;
        }
      }
      if (text[i] === '`') { i++; continue; }
      if (text[i] === '*' && i + 1 < len && text[i + 1] === '*') { i += 2; continue; }
      if (/\s/.test(text[i])) {
        if (!lastWasSpace && out.length > 0) {
          posMap.push(i);
          out += ' ';
          lastWasSpace = true;
        }
        i++;
        continue;
      }
      lastWasSpace = false;
      posMap.push(i);
      out += text[i];
      i++;
    }
    while (out.length > 0 && out[out.length - 1] === ' ') {
      out = out.slice(0, -1);
      posMap.pop();
    }
    return { text: out, posMap: posMap };
  }

  function normalizeForSearch(text) {
    return text.replace(/\u00b6/g, '').replace(/\s+/g, ' ').trim();
  }

  function readonly_to_edit_mode_text_selection(editor) {
    if (!pendingReadModeSelection || !pendingReadModeSelection.selectedText) return false;
    var saved = {
      selectedText: pendingReadModeSelection.selectedText,
      contextBefore: pendingReadModeSelection.contextBefore || '',
      contextAfter: pendingReadModeSelection.contextAfter || ''
    };
    if (applyPendingReadModeSelection(editor)) return true;

    var mdRaw = editor.currentMode === 'markdown'
      ? editor.markdownArea.value
      : (editor.getValue ? editor.getValue() : '');
    var parsed = parseFrontmatter(mdRaw || '');
    var body = parsed.body || '';
    var frontmatterLen = (mdRaw || '').length - body.length;

    var normSel = normalizeForSearch(saved.selectedText);
    if (!normSel) return false;
    var normCtxBefore = normalizeForSearch(saved.contextBefore);
    var normCtxAfter = normalizeForSearch(saved.contextAfter);

    var pos = null;

    var bodyS = buildSearchable(body);
    pos = findInSearchable(bodyS, normSel, normCtxBefore, normCtxAfter);

    if (!pos) {
      var normSelSC = normalizeForSearch(replaceEmojiCharsWithShortcodes(saved.selectedText));
      if (normSelSC !== normSel) {
        pos = findInSearchable(bodyS, normSelSC, normCtxBefore, normCtxAfter);
      }
    }

    if (!pos) {
      var articleEl = document.querySelector('[role="main"] article')
        || document.querySelector('article.md-typeset')
        || document.querySelector('.md-content');
      if (articleEl) {
        var pm = buildPseudoMarkdown(articleEl);
        var pmS = buildSearchable(pm.md);
        var pmMatch = findInSearchable(pmS, normSel, normCtxBefore, normCtxAfter);
        if (!pmMatch) {
          var normSelSC2 = normalizeForSearch(replaceEmojiCharsWithShortcodes(saved.selectedText));
          if (normSelSC2 !== normSel) pmMatch = findInSearchable(pmS, normSelSC2, normCtxBefore, normCtxAfter);
        }
        if (pmMatch) {
          var pmSubstr = pm.md.slice(pmMatch.start, pmMatch.end);
          pos = findSelectedTextInContent(body, pmSubstr, '', '');
          if (!pos) {
            var normPmSub = pmSubstr.replace(/\s+/g, ' ').trim();
            pos = findInSearchable(bodyS, normPmSub, '', '');
          }
        }
      }
    }

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
    var spanMarker = '<span ' + CURSOR_SPAN_ATTR + '></span>';
    var spanMarkerEnd = '<span ' + CURSOR_SPAN_ATTR_END + '></span>';
    var markedBody = body.slice(0, pos.start) + spanMarker +
                     body.slice(pos.start, pos.end) + spanMarkerEnd +
                     body.slice(pos.end);
    ea.innerHTML = editor._markdownToHtml(markedBody);
    if (typeof populateRawHtmlBlocks === 'function') populateRawHtmlBlocks(ea);
    if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(ea);
    if (typeof enhanceChecklists === 'function') enhanceChecklists(ea);
    if (typeof enhanceAdmonitions === 'function') enhanceAdmonitions(ea);
    var mPos = findAndStripCursorMarkerPositions(ea);
    if (mPos) {
      ea.focus();
      var range = document.createRange();
      range.setStart(mPos.startNode, mPos.startOffset);
      range.setEnd(mPos.endNode, mPos.endOffset);
      var sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      requestAnimationFrame(function () { scrollToCenterCursor(ea, false); });
      return true;
    }
    return false;
  }

  function findInSearchable(searchable, normNeedle, normCtxBefore, normCtxAfter) {
    var allMatches = [];
    var startFrom = 0;
    while (true) {
      var idx = searchable.text.indexOf(normNeedle, startFrom);
      if (idx < 0) break;
      var endIdx = idx + normNeedle.length - 1;
      var oS = idx < searchable.posMap.length ? searchable.posMap[idx] : 0;
      var oE = endIdx < searchable.posMap.length ? searchable.posMap[endIdx] + 1 : searchable.posMap[searchable.posMap.length - 1] + 1;
      allMatches.push({ start: oS, end: oE, sIdx: idx });
      startFrom = idx + 1;
    }
    if (allMatches.length === 0) return null;
    if (allMatches.length === 1) return allMatches[0];

    var best = null;
    var bestScore = -1;
    for (var i = 0; i < allMatches.length; i++) {
      var m = allMatches[i];
      var score = 0;
      if (normCtxBefore) {
        var before = searchable.text.substring(Math.max(0, m.sIdx - normCtxBefore.length), m.sIdx);
        for (var j = 1; j <= Math.min(normCtxBefore.length, before.length); j++) {
          if (normCtxBefore.slice(-j) === before.slice(-j)) score += j;
        }
      }
      if (normCtxAfter) {
        var mEnd = m.sIdx + normNeedle.length;
        var after = searchable.text.substring(mEnd, Math.min(searchable.text.length, mEnd + normCtxAfter.length));
        for (var k = 1; k <= Math.min(normCtxAfter.length, after.length); k++) {
          if (normCtxAfter.slice(0, k) === after.slice(0, k)) score += k;
        }
      }
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best || allMatches[0];
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
        populateRawHtmlBlocks(this.editableArea);
        enhanceCodeBlocks(this.editableArea);
        enhanceChecklists(this.editableArea);
        enhanceAdmonitions(this.editableArea);
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
          populateRawHtmlBlocks(editableArea);
          enhanceCodeBlocks(editableArea);
          enhanceChecklists(editableArea);
          enhanceAdmonitions(editableArea);
          if (cursorInFrontmatter || cursorAtDocStart) {
            requestAnimationFrame(function () {
              editableArea.focus();
              focusCursorAtDocStart(editableArea);
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
            var markerPos = null;
            if (!cursorSet) {
              markerPos = findAndStripCursorMarkerPositions(editableArea);
              if (!markerPos && markdownMarkerInserted) {
                var leftover = editableArea.querySelectorAll('[' + CURSOR_SPAN_ATTR + '], [' + CURSOR_SPAN_ATTR_END + ']');
                for (var i = 0; i < leftover.length; i++) leftover[i].parentNode.removeChild(leftover[i]);
              }
            }
            requestAnimationFrame(function () {
              if (cursorSet) {
                editableArea.focus();
              } else if (markerPos) {
                var nested = findNestedContenteditable(markerPos.startNode, editableArea);
                if (nested) {
                  nested.focus();
                } else {
                  editableArea.focus();
                }
                var range = document.createRange();
                range.setStart(markerPos.startNode, markerPos.startOffset);
                range.setEnd(markerPos.endNode, markerPos.endOffset);
                var sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(range);
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
        populateRawHtmlBlocks(this.editableArea);
        enhanceCodeBlocks(this.editableArea);
        enhanceChecklists(this.editableArea);
        enhanceAdmonitions(this.editableArea);
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

  function visibleTextContent(el) {
    var result = '';
    (function walk(node) {
      if (node.nodeType === 3) {
        result += node.textContent;
      } else if (node.nodeType === 1) {
        if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
        for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      }
    })(el);
    return result;
  }

  function getSelectionContext(range) {
    var root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    while (root && root !== document.body) {
      var r = root.getAttribute && root.getAttribute('role');
      if (r === 'main' || root.tagName === 'ARTICLE' || (root.classList && root.classList.contains('md-content'))) break;
      root = root.parentNode;
    }
    if (!root) root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    var fullText = visibleTextContent(root);
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

  function rangeToTextWithImgAlt(range) {
    var frag = range.cloneContents();
    var result = '';
    (function walk(node) {
      if (node.nodeType === 3) {
        result += node.textContent;
      } else if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') {
        return;
      } else if (node.nodeName === 'IMG' && node.alt) {
        result += node.alt;
      } else {
        for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      }
    })(frag);
    return result;
  }

  function storeSelectionIfReadMode(sel) {
    if (!isInReadMode()) return;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    if (isSelectionInEditForm(sel)) return;
    var range = sel.getRangeAt(0);
    var selectedText = range.toString();
    if (range.startContainer.nodeType !== 3 || range.endContainer.nodeType !== 3) {
      var richText = rangeToTextWithImgAlt(range);
      if (richText.length > selectedText.length) selectedText = richText;
    }
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
    var controls = document.querySelector('.live-edit-controls');
    if (!controls) return null;
    var candidates = controls.querySelectorAll('button, a');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.closest && el.closest('.live-edit-wysiwyg-wrapper')) continue;
      if (el.closest && el.closest('.live-wysiwyg-selection-edit-popup')) continue;
      var text = (el.textContent || '').trim();
      if (text.indexOf('Editor') >= 0) continue;
      if (text.indexOf('Edit') >= 0) return el;
      if (el.getAttribute && (el.getAttribute('title') || '').indexOf('Edit') >= 0) return el;
    }
    return null;
  }

  function getPagePathFromDOM() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var m = (scripts[i].textContent || '').match(/page_path\s*=\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    }
    return null;
  }

  var _pendingEditTriggerObserver = null;
  function clickEditTriggerOrDefer() {
    cancelPendingEditTrigger();
    var trigger = findEditModeTrigger();
    if (trigger) {
      trigger.click();
      return;
    }
    var path = getPagePathFromDOM();
    if (path) {
      window.dispatchEvent(new CustomEvent('live-edit-request-edit', { detail: { path: path } }));
      return;
    }
    _pendingEditTriggerObserver = new MutationObserver(function () {
      var t = findEditModeTrigger();
      if (t) {
        cancelPendingEditTrigger();
        t.click();
      } else {
        var p = getPagePathFromDOM();
        if (p) {
          cancelPendingEditTrigger();
          window.dispatchEvent(new CustomEvent('live-edit-request-edit', { detail: { path: p } }));
        }
      }
    });
    _pendingEditTriggerObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { cancelPendingEditTrigger(); }, 15000);
  }
  function cancelPendingEditTrigger() {
    if (_pendingEditTriggerObserver) {
      _pendingEditTriggerObserver.disconnect();
      _pendingEditTriggerObserver = null;
    }
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
      hideSelectionEditPopup();
      clickEditTriggerOrDefer();
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

  document.addEventListener('keydown', function (e) {
    if (e.key !== '.') return;
    if (!isInReadMode()) return;
    var tag = (document.activeElement || document.body).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    storeSelectionIfReadMode(window.getSelection());
    hideSelectionEditPopup();
    clickEditTriggerOrDefer();
  }, true);

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
    var contentToRestore = null;
    if (textarea && wysiwygEditor) {
      var ed = wysiwygEditor;
      contentToRestore = ed.getValue();
      if (contentToRestore && !contentToRestore.endsWith('\n')) contentToRestore += '\n';
      if (!leavingEditMode) {
        if (ed.currentMode === 'markdown') {
          textarea.value = contentToRestore;
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
      if (contentToRestore) {
        textarea.value = contentToRestore;
      }
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
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygHrData) {
            markdownContent = postprocessHorizontalRules(markdownContent, wysiwygEditor._liveWysiwygHrData);
          }
          if (wysiwygEditor.currentMode === 'wysiwyg' && wysiwygEditor._liveWysiwygLinkData) {
            markdownContent = dryDuplicateInlineLinks(markdownContent, wysiwygEditor._liveWysiwygLinkData);
            markdownContent = collapseRedundantReferenceToShortcut(markdownContent);
          }
          if (markdownContent) {
            markdownContent = stripCursorSpanHtml(markdownContent).replace(CURSOR_MARKER_RE, '').replace(CURSOR_MARKER_END_RE, '').replace(CURSOR_UNICODE_RE, '');
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
      if (ea && !ea.dataset.liveWysiwygAdmonitionTitleMousedownAttached) {
        ea.dataset.liveWysiwygAdmonitionTitleMousedownAttached = '1';
        ea.addEventListener('mousedown', function () {
          var sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;
          var titleEl = findTitleFromNode(sel.anchorNode, ea);
          if (titleEl) restoreEmptyAdmonitionTitle(titleEl);
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygChecklistInputAttached) {
        ea.dataset.liveWysiwygChecklistInputAttached = '1';
        ea.addEventListener('input', function () {
          ensureChecklistNewItems(ea);
          fixMalformedNestedLists(ea);
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygChecklistBackspaceAttached) {
        ea.dataset.liveWysiwygChecklistBackspaceAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'Backspace') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var range = sel.getRangeAt(0);
          var node = range.startContainer;
          var offset = range.startOffset;

          var li = node;
          while (li && li !== ea) {
            if (li.nodeName === 'LI') break;
            li = li.parentNode;
          }
          if (!li || li.nodeName !== 'LI') return;
          var cb = li.querySelector('input[type="checkbox"]');
          if (!cb) return;

          var posFirst = getFirstContentPosition(li);
          if (!posFirst) return;
          var firstRange = document.createRange();
          firstRange.setStart(posFirst.node, posFirst.offset);
          firstRange.collapse(true);
          var cmp = range.compareBoundaryPoints(Range.START_TO_START, firstRange);
          if (cmp > 0) return;
          var text = (li.textContent || '').replace(/[​‌‍﻿]/g, '').replace(/[\s ]/g, '');
          var isEmpty = text.length === 0;

          e.preventDefault();
          if (isEmpty) {
            var list = li.parentNode;
            var prevLi = li.previousElementSibling;
            var nextLi = li.nextElementSibling;
            list.removeChild(li);
            if (list.childNodes.length === 0 && list.parentNode && list.parentNode.nodeName === 'LI') {
              list.parentNode.removeChild(list);
            }
            var newRange = document.createRange();
            if (prevLi && prevLi.nodeName === 'LI') {
              newRange.selectNodeContents(prevLi);
              newRange.collapse(false);
            } else if (nextLi && nextLi.nodeName === 'LI') {
              var nextPos = getFirstContentPosition(nextLi);
              if (nextPos) {
                newRange.setStart(nextPos.node, nextPos.offset);
                newRange.collapse(true);
              } else {
                newRange.selectNodeContents(nextLi);
                newRange.collapse(true);
              }
            } else {
              var p = document.createElement('p');
              p.innerHTML = '<br>';
              if (list.nextSibling) {
                list.parentNode.insertBefore(p, list.nextSibling);
              } else {
                list.parentNode.appendChild(p);
              }
              list.parentNode.removeChild(list);
              newRange.setStart(p, 0);
              newRange.collapse(true);
            }
            sel.removeAllRanges();
            sel.addRange(newRange);
          } else {
            removeCheckboxFromLi(li);
          }
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygChecklistCursorNormAttached) {
        ea.dataset.liveWysiwygChecklistCursorNormAttached = '1';
        function normalizeChecklistCursor() {
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var range = sel.getRangeAt(0);
          var node = range.startContainer;
          if (node.nodeType === 3) node = node.parentNode;
          var li = node;
          while (li && li !== ea) {
            if (li.nodeName === 'LI') break;
            li = li.parentNode;
          }
          if (!li || li.nodeName !== 'LI') return;
          var cb = getDirectCheckboxOfLi(li);
          if (!cb) return;
          var pos = getFirstContentPosition(li);
          if (!pos) return;
          var firstRange = document.createRange();
          firstRange.setStart(pos.node, pos.offset);
          firstRange.collapse(true);
          var cmp = range.compareBoundaryPoints(Range.START_TO_START, firstRange);
          if (cmp >= 0) return;
          var newRange = document.createRange();
          newRange.setStart(pos.node, pos.offset);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
        ea.addEventListener('mouseup', function () {
          setTimeout(normalizeChecklistCursor, 0);
        });
        ea.addEventListener('focus', function () {
          setTimeout(normalizeChecklistCursor, 0);
        });
        ea.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setTimeout(normalizeChecklistCursor, 0);
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygChecklistArrowAttached) {
        ea.dataset.liveWysiwygChecklistArrowAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var range = sel.getRangeAt(0);
          var node = range.startContainer;
          if (node.nodeType === 3) node = node.parentNode;
          var block = node;
          while (block && block !== ea) {
            if (block.nodeName === 'LI' || block.nodeName === 'P' || (block.nodeName.match && block.nodeName.match(/^H[1-6]$/))) break;
            block = block.parentNode;
          }
          if (!block || block === ea) return;
          if (e.key === 'ArrowLeft') {
            var atStart = false;
            var prevBlock = null;
            var cameFromParent = false;
            if (block.nodeName === 'LI') {
              var cb = getDirectCheckboxOfLi(block);
              if (!cb) return;
              var pos = getFirstContentPosition(block);
              if (!pos) return;
              var firstRange = document.createRange();
              firstRange.setStart(pos.node, pos.offset);
              firstRange.collapse(true);
              var cmp = range.compareBoundaryPoints(Range.START_TO_START, firstRange);
              if (cmp !== 0) return;
              atStart = true;
              var prev = block.previousElementSibling;
              if (!prev && block.parentNode && (block.parentNode.nodeName === 'UL' || block.parentNode.nodeName === 'OL')) {
                var listParent = block.parentNode.parentNode;
                if (listParent && listParent.nodeName === 'LI') {
                  prev = listParent;
                  cameFromParent = true;
                } else {
                  prev = block.parentNode.previousElementSibling;
                }
              }
              prevBlock = prev;
              if (prev && (prev.nodeName === 'UL' || prev.nodeName === 'OL') && prev.lastElementChild && prev.lastElementChild.nodeName === 'LI') prevBlock = prev.lastElementChild;
            } else if (block.nodeName === 'P' || (block.nodeName.match && block.nodeName.match(/^H[1-6]$/))) {
              var startRange = document.createRange();
              startRange.selectNodeContents(block);
              startRange.collapse(true);
              atStart = range.compareBoundaryPoints(Range.START_TO_START, startRange) === 0;
              if (!atStart) return;
              prevBlock = block.previousElementSibling;
            }
            if (atStart && prevBlock && (prevBlock.nodeName === 'LI' || prevBlock.nodeName === 'P' || (prevBlock.nodeName.match && prevBlock.nodeName.match(/^H[1-6]$/)))) {
              e.preventDefault();
              var newRange = document.createRange();
              if (prevBlock.nodeName === 'LI' && prevBlock.querySelector('ul, ol')) {
                if (cameFromParent) {
                  var lastPos = getLastContentPositionBeforeNestedList(prevBlock);
                  if (lastPos) {
                    newRange.setStart(lastPos.node, lastPos.offset);
                    newRange.collapse(true);
                  } else {
                    newRange.selectNodeContents(prevBlock);
                    newRange.collapse(false);
                  }
                } else {
                  var leaf = getLastLeafLi(prevBlock);
                  newRange.selectNodeContents(leaf);
                  newRange.collapse(false);
                }
              } else {
                newRange.selectNodeContents(prevBlock);
                newRange.collapse(false);
              }
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          } else {
            var endRange = document.createRange();
            endRange.selectNodeContents(block);
            endRange.collapse(false);
            var atEnd = range.compareBoundaryPoints(Range.START_TO_END, endRange) === 0;
            var lastBeforeNested = block.nodeName === 'LI' ? getLastContentPositionBeforeNestedList(block) : null;
            var atEndOfDirectContent = lastBeforeNested && (function() {
              var r = document.createRange();
              r.setStart(lastBeforeNested.node, lastBeforeNested.offset);
              r.collapse(true);
              return range.compareBoundaryPoints(Range.START_TO_END, r) === 0;
            })();
            if (!atEnd && !atEndOfDirectContent) return;
            var nextLi = null;
            if (atEndOfDirectContent && block.nodeName === 'LI') {
              var nested = null;
            for (var c = block.firstChild; c; c = c.nextSibling) {
              if (c.nodeName === 'UL' || c.nodeName === 'OL') { nested = c; break; }
            }
              if (nested && nested.firstElementChild && nested.firstElementChild.nodeName === 'LI') nextLi = nested.firstElementChild;
            }
            if (!nextLi && atEnd) {
              var next = block.nextElementSibling;
              if (!next && block.parentNode && (block.parentNode.nodeName === 'UL' || block.parentNode.nodeName === 'OL')) next = block.parentNode.parentNode ? block.parentNode.parentNode.nextElementSibling : null;
              if (next && next.nodeName === 'LI') nextLi = next;
              else if (next && (next.nodeName === 'UL' || next.nodeName === 'OL') && next.firstElementChild && next.firstElementChild.nodeName === 'LI') nextLi = next.firstElementChild;
            }
            if (nextLi) {
              var nextPos = getFirstContentPosition(nextLi);
              if (nextPos) {
                e.preventDefault();
                var newRange = document.createRange();
                newRange.setStart(nextPos.node, nextPos.offset);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
              }
            }
          }
        }, true);
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
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygInlineCodeAttached) {
        ea.dataset.liveWysiwygInlineCodeAttached = '1';
        var pendingBacktick = null;

        function clearPending() { pendingBacktick = null; }

        ea.addEventListener('blur', clearPending);
        ea.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' || e.key === 'Enter' ||
              e.key.indexOf('Arrow') === 0 ||
              e.key === 'Home' || e.key === 'End' ||
              e.key === 'PageUp' || e.key === 'PageDown') {
            clearPending();
          }
        });

        function doConvert(anchorNode, openingIdx, closingIdx, sel) {
          var text = anchorNode.textContent;
          var inner = text.substring(openingIdx + 1, closingIdx);
          if (inner.length === 0) return false;
          if (inner.charAt(0) === ' ' || inner.charAt(inner.length - 1) === ' ') return false;

          var before = text.substring(0, openingIdx);
          var after = text.substring(closingIdx + 1);

          var codeEl = document.createElement('code');
          codeEl.textContent = inner;

          var parentNode = anchorNode.parentNode;
          var afterNode = document.createTextNode('\u200B' + after);

          if (before) {
            anchorNode.textContent = before;
            parentNode.insertBefore(codeEl, anchorNode.nextSibling);
            parentNode.insertBefore(afterNode, codeEl.nextSibling);
          } else {
            parentNode.insertBefore(codeEl, anchorNode);
            parentNode.insertBefore(afterNode, codeEl.nextSibling);
            parentNode.removeChild(anchorNode);
          }

          var range = document.createRange();
          range.setStart(afterNode, 1);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);

          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
          return true;
        }

        ea.addEventListener('input', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          if (e.inputType !== 'insertText' || e.data !== '`') return;

          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var anchorNode = sel.anchorNode;
          var anchorOffset = sel.anchorOffset;
          if (!anchorNode || anchorNode.nodeType !== 3) return;

          var anc = anchorNode.parentNode;
          while (anc && anc !== ea) {
            var tag = anc.nodeName;
            if (tag === 'PRE' || tag === 'CODE') return;
            anc = anc.parentNode;
          }

          var text = anchorNode.textContent;
          var closingIdx = anchorOffset - 1;
          if (closingIdx < 0 || text.charAt(closingIdx) !== '`') return;
          if (closingIdx > 0 && text.charAt(closingIdx - 1) === '`') {
            clearPending();
            return;
          }

          if (pendingBacktick && pendingBacktick.node === anchorNode) {
            var pIdx = pendingBacktick.offset;
            if (pIdx >= 0 && pIdx < closingIdx && text.charAt(pIdx) === '`') {
              clearPending();
              if (doConvert(anchorNode, pIdx, closingIdx, sel)) return;
              return;
            }
          }

          pendingBacktick = { node: anchorNode, offset: closingIdx };
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygTripleBacktickAttached) {
        ea.dataset.liveWysiwygTripleBacktickAttached = '1';
        ea.addEventListener('input', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          if (e.inputType !== 'insertText' || e.data !== '`') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var anchorNode = sel.anchorNode;
          var anchorOffset = sel.anchorOffset;
          if (!anchorNode || anchorNode.nodeType !== 3) return;
          var anc = anchorNode.parentNode;
          while (anc && anc !== ea) {
            if (anc.nodeName === 'PRE' || anc.nodeName === 'CODE') return;
            anc = anc.parentNode;
          }
          var text = anchorNode.textContent;
          if (anchorOffset < 3) return;
          var segment = text.substring(anchorOffset - 3, anchorOffset);
          if (segment !== '```') return;
          var lineStart = text.lastIndexOf('\n', anchorOffset - 3) + 1;
          var beforeInLine = text.substring(lineStart, anchorOffset - 3);
          if (beforeInLine.trim().length > 0) return;
          e.preventDefault && e.preventDefault();
          var parentBlock = anchorNode.parentNode;
          while (parentBlock && parentBlock !== ea && parentBlock.parentNode !== ea) {
            parentBlock = parentBlock.parentNode;
          }
          if (!parentBlock || parentBlock === ea) parentBlock = anchorNode.parentNode;
          var insertParent = ea;
          var targetBlock = parentBlock;
          var anc = anchorNode.parentNode;
          while (anc && anc !== ea) {
            var inLi = anc.nodeName === 'LI' && anc.parentNode && (anc.parentNode.nodeName === 'UL' || anc.parentNode.nodeName === 'OL');
            if ((anc.classList && anc.classList.contains('admonition')) || anc.nodeName === 'BLOCKQUOTE' || inLi) {
              insertParent = anc;
              var inner = anchorNode.parentNode;
              while (inner && inner !== anc && inner.parentNode !== anc) {
                inner = inner.parentNode;
              }
              if (inner && inner !== anc && inner.parentNode === anc) {
                targetBlock = inner;
              }
              break;
            }
            anc = anc.parentNode;
          }
          var pre = document.createElement('pre');
          var code = document.createElement('code');
          code.textContent = '\n';
          pre.appendChild(code);
          if (targetBlock && targetBlock.parentNode === insertParent) {
            insertParent.insertBefore(pre, targetBlock);
            insertParent.removeChild(targetBlock);
          } else {
            ea.appendChild(pre);
          }
          enhanceCodeBlocks(ea);
          enhanceBasicPreBlocks(ea);
          populateRawHtmlBlocks(ea);
          enhanceAdmonitions(ea);
          requestAnimationFrame(function () {
            var codeEl = pre.querySelector('code') || pre;
            var textNode = codeEl.firstChild;
            if (!textNode || textNode.nodeType !== 3) {
              textNode = document.createTextNode('\n');
              codeEl.appendChild(textNode);
            }
            var range = document.createRange();
            range.setStart(textNode, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            ea.focus();
          });
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }

    (function emojiShortcodeSupport() {
      var EMOJI_MAP = (typeof liveWysiwygEmojiMap !== "undefined" ? liveWysiwygEmojiMap : {});
      var shortcodeRe = /:([a-z0-9_+-]+):/g;
      var EMOJI_KEYS = Object.keys(EMOJI_MAP);
      var MAX_SUGGESTIONS = 8;

      function getTextBeforeCursor(sel, ea) {
        if (!sel || !sel.rangeCount) return { text: "", node: null, offset: 0 };
        var r = sel.getRangeAt(0);
        var node = r.startContainer;
        var offset = r.startOffset;
        if (node.nodeType === 3) {
          return { text: node.textContent.substring(0, offset), node: node, offset: offset };
        }
        return { text: "", node: null, offset: 0 };
      }

      function replaceRangeWithEmoji(node, startOffset, endOffset, emoji, shortcode) {
        if (!node || node.nodeType !== 3) return false;
        var text = node.textContent;
        var before = text.substring(0, startOffset);
        var after = text.substring(endOffset);
        if (!shortcode) {
          node.textContent = before + emoji + after;
          return true;
        }
        var parent = node.parentNode;
        if (!parent) return false;
        var el;
        if (typeof window.liveWysiwygEmojiToImgHtml === "function") {
          var tmp = document.createElement("div");
          tmp.innerHTML = window.liveWysiwygEmojiToImgHtml(shortcode, emoji);
          el = tmp.firstChild;
        } else {
          el = document.createElement("span");
          el.setAttribute("data-emoji-shortcode", shortcode);
          el.textContent = emoji;
        }
        var beforeNode = document.createTextNode(before);
        var afterNode = document.createTextNode(after);
        parent.insertBefore(afterNode, node.nextSibling);
        parent.insertBefore(el, afterNode);
        parent.insertBefore(beforeNode, node);
        parent.removeChild(node);
        return el;
      }

      function fuzzyMatch(needle, haystack) {
        var n = needle.toLowerCase();
        var h = haystack.toLowerCase();
        var j = 0;
        for (var i = 0; i < n.length; i++) {
          j = h.indexOf(n[i], j);
          if (j === -1) return false;
          j++;
        }
        return true;
      }
      function showEmojiAutocomplete(ea, prefix, anchorRect, onSelect) {
        var limit = prefix.length === 0 ? EMOJI_KEYS.length : MAX_SUGGESTIONS;
        var matches = EMOJI_KEYS.filter(function (k) {
          return prefix.length === 0 || k.indexOf(prefix) >= 0 || fuzzyMatch(prefix, k);
        }).sort(function (a, b) {
          if (prefix.length === 0) return 0;
          var aPrefix = a.indexOf(prefix) === 0 ? 0 : (a.indexOf(prefix) >= 0 ? 100 : 200);
          var bPrefix = b.indexOf(prefix) === 0 ? 0 : (b.indexOf(prefix) >= 0 ? 100 : 200);
          if (aPrefix !== bPrefix) return aPrefix - bPrefix;
          return (a.indexOf(prefix) >= 0 ? a.indexOf(prefix) : 999) - (b.indexOf(prefix) >= 0 ? b.indexOf(prefix) : 999);
        }).slice(0, limit);
        if (matches.length === 0 && prefix.length === 0) return null;
        var pop = document.createElement("div");
        pop.className = "live-wysiwyg-emoji-autocomplete";
        pop.style.cssText = "position:fixed;z-index:10000;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-height:" + (matches.length > 12 ? "320px" : "240px") + ";overflow-y:auto;font-family:inherit;font-size:14px;";
        if (matches.length === 0) {
          var noMatchRow = document.createElement("div");
          noMatchRow.className = "live-wysiwyg-emoji-no-matches";
          noMatchRow.style.cssText = "padding:6px 12px;color:#999;";
          noMatchRow.textContent = "No matches";
          pop.appendChild(noMatchRow);
        }
        matches.forEach(function (key, i) {
          var row = document.createElement("div");
          row.className = "live-wysiwyg-emoji-item" + (i === 0 ? " live-wysiwyg-emoji-selected" : "");
          row.style.cssText = "padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap;";
          if (i === 0) row.style.background = "#e3f2fd";
          row.dataset.key = key;
          row.innerHTML = "<span style=\"font-size:1.2em\">" + EMOJI_MAP[key] + "</span><span style=\"color:#666\">:" + key + ":</span>";
          row.addEventListener("mouseenter", function () {
            pop.querySelectorAll(".live-wysiwyg-emoji-selected").forEach(function (el) { el.classList.remove("live-wysiwyg-emoji-selected"); el.style.background = ""; });
            row.classList.add("live-wysiwyg-emoji-selected");
            row.style.background = "#e3f2fd";
          });
          row.addEventListener("click", function (e) {
            e.preventDefault();
            if (pop._closeHandler) document.removeEventListener("mousedown", pop._closeHandler);
            onSelect(key);
            if (pop.parentNode) pop.parentNode.removeChild(pop);
          });
          pop.appendChild(row);
        });
        document.body.appendChild(pop);
        var rect = anchorRect || { left: 0, bottom: 20 };
        pop.style.left = rect.left + "px";
        pop.style.top = (rect.bottom + 4) + "px";
        var closeHandler = function (e) {
          if (pop.parentNode && !pop.contains(e.target)) {
            pop.parentNode.removeChild(pop);
            document.removeEventListener("mousedown", closeHandler);
          }
        };
        setTimeout(function () { document.addEventListener("mousedown", closeHandler); }, 0);
        pop._closeHandler = closeHandler;
        return { pop: pop, matches: matches, onSelect: onSelect };
      }

      function attachEmojiSupport(ea) {
        if (!ea || ea.dataset.liveWysiwygEmojiAttached) return;
        ea.dataset.liveWysiwygEmojiAttached = "1";
        var autocompleteState = null;

        ea.addEventListener("input", function (e) {
          if (wysiwygEditor.currentMode !== "wysiwyg") return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var anc = sel.anchorNode;
          if (anc.nodeType === 3) anc = anc.parentNode;
          while (anc && anc !== ea) {
            if (anc.nodeName === "PRE" || anc.nodeName === "CODE") return;
            anc = anc.parentNode;
          }
          var info = getTextBeforeCursor(sel, ea);
          var text = info.text;
          var node = sel.anchorNode;
          var offset = sel.anchorOffset;
          if (node.nodeType !== 3) return;

          var lastColon = text.lastIndexOf(":");
          if (lastColon >= 0) {
            var openColon = lastColon > 0 ? text.lastIndexOf(":", lastColon - 1) : -1;
            var between = openColon >= 0 ? text.substring(openColon + 1, lastColon) : text.substring(lastColon + 1);
            if (e.inputType === "insertText" && e.data === ":") {
              var shortcode = between;
              if (shortcode.indexOf(" ") < 0 && shortcode.indexOf(":") < 0) {
                var emoji = EMOJI_MAP[shortcode];
                if (emoji) {
                  e.preventDefault();
                  var start = openColon >= 0 ? openColon : lastColon;
                  var repl = replaceRangeWithEmoji(node, start, offset, emoji, ":" + shortcode + ":");
                  ea.focus();
                  sel.removeAllRanges();
                  var range = document.createRange();
                  if (repl && repl.nodeType) {
                    range.setStartAfter(repl);
                    range.collapse(true);
                  } else {
                    range.setStart(node, start + emoji.length);
                    range.collapse(true);
                  }
                  sel.addRange(range);
                  if (wysiwygEditor._finalizeUpdate) wysiwygEditor._finalizeUpdate(ea.innerHTML);
                  if (autocompleteState && autocompleteState.pop.parentNode) {
                    autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
                  }
                  autocompleteState = null;
                  return;
                }
              }
            }
            if (between.length >= 2 && between.indexOf(" ") < 0 && between.indexOf(":") < 0) {
              var r = node.getBoundingClientRect ? node.getBoundingClientRect() : ea.getBoundingClientRect();
              var range = sel.getRangeAt(0);
              try {
                var cr = range.getBoundingClientRect();
                if (cr) r = cr;
              } catch (err) {}
              var anchorRect = { left: r.left, bottom: r.bottom };
              if (autocompleteState && autocompleteState.pop.parentNode) {
                autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
              }
              autocompleteState = showEmojiAutocomplete(ea, between, anchorRect, function (key) {
                var emoji = EMOJI_MAP[key];
                if (emoji) {
                  var repl = replaceRangeWithEmoji(node, lastColon, offset, emoji, ":" + key + ":");
                  ea.focus();
                  sel.removeAllRanges();
                  var range = document.createRange();
                  if (repl && repl.nodeType) {
                    range.setStartAfter(repl);
                    range.collapse(true);
                  } else {
                    range.setStart(node, lastColon + emoji.length);
                    range.collapse(true);
                  }
                  sel.addRange(range);
                }
                if (wysiwygEditor._finalizeUpdate) wysiwygEditor._finalizeUpdate(ea.innerHTML);
                autocompleteState = null;
              });
            } else if (autocompleteState && autocompleteState.pop.parentNode) {
              autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
              autocompleteState = null;
            }
          }
        }, true);

        ea.addEventListener("keydown", function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === " ") {
            e.preventDefault();
            if (wysiwygEditor.currentMode !== "wysiwyg") return;
            var anc = ea.querySelector("*") || ea;
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var anc2 = sel.anchorNode;
            if (anc2 && anc2.nodeType === 3) anc2 = anc2.parentNode;
            while (anc2 && anc2 !== ea) {
              if (anc2.nodeName === "PRE" || anc2.nodeName === "CODE") return;
              anc2 = anc2.parentNode;
            }
            var r = ea.getBoundingClientRect();
            try {
              var cr = sel.getRangeAt(0).getBoundingClientRect();
              if (cr) r = cr;
            } catch (err) {}
            var anchorRect = { left: r.left, bottom: r.bottom };
            if (autocompleteState && autocompleteState.pop.parentNode) {
              autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
            }
            var savedRange = sel.getRangeAt(0).cloneRange();
            var beforeCursor = getTextBeforeCursor(sel, ea);
            var removeColonOnly = beforeCursor.text.endsWith(" :") && beforeCursor.node && beforeCursor.node.nodeType === 3 && beforeCursor.offset >= 1;
            var state = showEmojiAutocomplete(ea, "", anchorRect, function (key) {
              var emoji = EMOJI_MAP[key];
              if (emoji) {
                var node = beforeCursor.node;
                var insertEnd = beforeCursor.offset;
                if (removeColonOnly && replaceRangeWithEmoji(node, beforeCursor.offset - 1, beforeCursor.offset, emoji)) {
                  insertEnd = beforeCursor.offset - 1 + emoji.length;
                } else {
                  sel.removeAllRanges();
                  sel.addRange(savedRange);
                  var el;
                  if (typeof window.liveWysiwygEmojiToImgHtml === "function") {
                    var tmp = document.createElement("div");
                    tmp.innerHTML = window.liveWysiwygEmojiToImgHtml(":" + key + ":", emoji);
                    el = tmp.firstChild;
                  } else {
                    el = document.createElement("span");
                    el.setAttribute("data-emoji-shortcode", ":" + key + ":");
                    el.textContent = emoji;
                  }
                  savedRange.deleteContents();
                  savedRange.insertNode(el);
                  var r = document.createRange();
                  r.setStartAfter(el);
                  r.collapse(true);
                  node = el.parentNode;
                  insertEnd = Array.prototype.indexOf.call(node.childNodes, el) + 1;
                }
                ea.focus();
                sel.removeAllRanges();
                var range = document.createRange();
                range.setStart(node, insertEnd);
                range.collapse(true);
                sel.addRange(range);
              }
              if (wysiwygEditor._finalizeUpdate) wysiwygEditor._finalizeUpdate(ea.innerHTML);
              autocompleteState = null;
            });
            if (state) {
              state.ea = ea;
              state.anchorRect = anchorRect;
              state.filterPrefix = "";
              state.openedByCtrlSpace = true;
            }
            autocompleteState = state;
            return;
          }
          if (!autocompleteState || !autocompleteState.pop.parentNode) return;
          if (autocompleteState.openedByCtrlSpace && (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey || e.key === "Backspace")) {
            e.preventDefault();
            if (e.key === "Backspace") {
              autocompleteState.filterPrefix = autocompleteState.filterPrefix.slice(0, -1);
              if (autocompleteState.filterPrefix.length === 0) {
                if (autocompleteState.pop._closeHandler) document.removeEventListener("mousedown", autocompleteState.pop._closeHandler);
                if (autocompleteState.pop.parentNode) autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
                autocompleteState = null;
                return;
              }
            } else {
              autocompleteState.filterPrefix += e.key;
            }
            if (autocompleteState.pop._closeHandler) document.removeEventListener("mousedown", autocompleteState.pop._closeHandler);
            if (autocompleteState.pop.parentNode) autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
            var newState = showEmojiAutocomplete(autocompleteState.ea, autocompleteState.filterPrefix, autocompleteState.anchorRect, autocompleteState.onSelect);
            if (newState) {
              autocompleteState.pop = newState.pop;
              autocompleteState.matches = newState.matches;
              setTimeout(function () { document.addEventListener("mousedown", autocompleteState.pop._closeHandler); }, 0);
            } else {
              autocompleteState = null;
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            if (autocompleteState.pop._closeHandler) document.removeEventListener("mousedown", autocompleteState.pop._closeHandler);
            if (autocompleteState.pop.parentNode) autocompleteState.pop.parentNode.removeChild(autocompleteState.pop);
            autocompleteState = null;
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab") {
            var sel = autocompleteState.pop.querySelector(".live-wysiwyg-emoji-selected");
            var items = autocompleteState.pop.querySelectorAll(".live-wysiwyg-emoji-item");
            var idx = Array.prototype.indexOf.call(items, sel);
            if (e.key === "ArrowDown" && idx < items.length - 1) {
              e.preventDefault();
              sel.classList.remove("live-wysiwyg-emoji-selected");
              sel.style.background = "";
              var next = items[idx + 1];
              next.classList.add("live-wysiwyg-emoji-selected");
              next.style.background = "#e3f2fd";
              next.scrollIntoView({ block: "nearest", behavior: "smooth" });
              return;
            }
            if (e.key === "ArrowUp" && idx > 0) {
              e.preventDefault();
              sel.classList.remove("live-wysiwyg-emoji-selected");
              sel.style.background = "";
              var prev = items[idx - 1];
              prev.classList.add("live-wysiwyg-emoji-selected");
              prev.style.background = "#e3f2fd";
              prev.scrollIntoView({ block: "nearest", behavior: "smooth" });
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && sel) {
              e.preventDefault();
              e.stopPropagation();
              var key = sel.dataset.key;
              var pop = autocompleteState.pop;
              var onSelectCb = autocompleteState.onSelect;
              if (pop._closeHandler) document.removeEventListener("mousedown", pop._closeHandler);
              if (pop.parentNode) pop.parentNode.removeChild(pop);
              autocompleteState = null;
              if (key && onSelectCb) onSelectCb(key);
            }
          }
        }, true);
      }

      var ea = wysiwygEditor.editableArea;
      if (ea) attachEmojiSupport(ea);
    })();

    })();



    (function patchMarkdownToHtmlShortcodeToEmoji() {
      var FALLBACK = {"white_check_mark":"\u2705","check_mark":"\u2714","heart_eyes":"\ud83d\ude0d","thumbsup":"\ud83d\udc4d","heart":"\u2764","smile":"\ud83d\ude04","fire":"\ud83d\udd25","star":"\u2b50","warning":"\u26a0","x":"\u274c"};
      var EMOJI_MAP = (typeof liveWysiwygEmojiMap !== "undefined" && Object.keys(liveWysiwygEmojiMap || {}).length > 0) ? liveWysiwygEmojiMap : FALLBACK;
      var shortcodeRe = /:([a-z0-9_+-]+):/g;
      var EMOJIONE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/emojione/2.2.7/assets/svg/";
      function emojiToEmojionePath(emoji) {
        var parts = [];
        for (var i = 0; i < emoji.length; ) {
          var cp = emoji.codePointAt(i);
          parts.push(cp.toString(16));
          i += cp > 0xFFFF ? 2 : 1;
        }
        return parts.join("-");
      }
      function emojiToImgHtml(shortcode, emoji) {
        var path = emojiToEmojionePath(emoji);
        return "<img alt=\"" + emoji + "\" class=\"emojione\" src=\"" + EMOJIONE_CDN + path + ".svg\" title=\"" + shortcode + "\" data-emoji-shortcode=\"" + shortcode + "\">";
      }
      if (typeof window !== "undefined") window.liveWysiwygEmojiToImgHtml = emojiToImgHtml;
      function replaceShortcodeInHtml(html) {
        var protectedBlocks = [];
        var ph = "\u0000PB";
        var protectBlock = function (m) {
          var idx = protectedBlocks.length;
          protectedBlocks.push(m);
          return ph + idx + ph;
        };
        var protected_ = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, protectBlock);
        protected_ = protected_.replace(/<img[^>]*data-emoji-shortcode[^>]*>/gi, protectBlock);
        protected_ = protected_.replace(/<code[^>]*>[\s\S]*?<\/code>/gi, protectBlock);
        protected_ = protected_.replace(shortcodeRe, function (m, key) {
          var em = EMOJI_MAP[key];
          return em ? emojiToImgHtml(":" + key + ":", em) : m;
        });
        for (var i = 0; i < protectedBlocks.length; i++) {
          protected_ = protected_.split(ph + i + ph).join(protectedBlocks[i]);
        }
        return protected_;
      }
      var proto = MarkdownWYSIWYG.prototype;
      var origMarkdownToHtml = proto._markdownToHtml;
      if (!origMarkdownToHtml) return;
      function replaceShortcodeInMarkdown(md) {
        var codeBlocks = [];
        var ph = "\u0000CB";
        var protectBlock = function (m) {
          var idx = codeBlocks.length;
          codeBlocks.push(m);
          return ph + idx + ph;
        };
        var protected_ = md.replace(/\`\`\`[\s\S]*?\`\`\`/g, protectBlock);
        protected_ = protected_.replace(/`[^`\n]+`/g, protectBlock);
        // Protect emoji img tags (raw HTML) so shortcode replacement does not run inside
        // attribute values (e.g. title=":white_check_mark:") - that causes recursive nesting.
        protected_ = protected_.replace(/<img[^>]*data-emoji-shortcode[^>]*>/gi, protectBlock);
        protected_ = protected_.replace(shortcodeRe, function (m, key) {
          var em = EMOJI_MAP[key];
          return em ? emojiToImgHtml(":" + key + ":", em) : m;
        });
        for (var i = 0; i < codeBlocks.length; i++) {
          protected_ = protected_.split(ph + i + ph).join(codeBlocks[i]);
        }
        return protected_;
      }
      proto._markdownToHtml = function (markdown) {
        var md = markdown || "";
        var mdWithEmoji = replaceShortcodeInMarkdown(md);
        var html = origMarkdownToHtml.call(this, mdWithEmoji);
        return replaceShortcodeInHtml(html);
      };
    })();

    (function patchMarkdownToHtmlForRawHtml() {
      var proto = MarkdownWYSIWYG.prototype;
      var origMdToHtml = proto._markdownToHtml;
      if (!origMdToHtml) return;
      proto._markdownToHtml = function (markdown) {
        var md = markdown || '';
        var rawResult = preprocessRawHtml(md);
        this._liveWysiwygRawHtmlData = rawResult;
        return origMdToHtml.call(this, rawResult.markdown);
      };
    })();

    (function patchHtmlToMarkdownEmojiToShortcode() {
      var MARKER = "\uFFFF\uFFFF\uFFFF";
      var MARKER_END = "\uFFFE\uFFFE\uFFFE";
      var proto = MarkdownWYSIWYG.prototype;
      var origNodeToMarkdown = proto._nodeToMarkdownRecursive;
      if (!origNodeToMarkdown) return;
      var shortcodePattern = /^:[a-z0-9_+-]+:$/;
      proto._nodeToMarkdownRecursive = function (node, options) {
        if (node.nodeName === "IMG" && node.getAttribute) {
          var sc = node.getAttribute("data-emoji-shortcode");
          if (sc && shortcodePattern.test(sc)) return sc;
        }
        if (node.nodeName === "SPAN" && node.getAttribute) {
          var shortcode = node.getAttribute("data-emoji-shortcode");
          if (!shortcode || !shortcodePattern.test(shortcode)) {
            return origNodeToMarkdown.apply(this, arguments);
          }
          var childContent = "";
          for (var i = 0; i < node.childNodes.length; i++) {
            childContent += origNodeToMarkdown.call(this, node.childNodes[i], options || {});
          }
          if (childContent.indexOf(MARKER) >= 0 || childContent.indexOf(MARKER_END) >= 0) {
            var emojiChar = node.textContent.split(MARKER).join("").split(MARKER_END).join("");
            return childContent.split(emojiChar).join(shortcode);
          }
          return shortcode;
        }
        return origNodeToMarkdown.apply(this, arguments);
      };
    })();


    // Selection preservation across mode switches is handled by the frontmatter
    // patch above (via injectMarkerAtCaretInEditable / CURSOR_MARKER).  That
    // approach naturally handles emoji <img> ↔ :shortcode: mapping because
    // _htmlToMarkdown converts <img data-emoji-shortcode> to :shortcode: with
    // adjacent CURSOR_MARKER text, and _markdownToHtml converts :shortcode: to
    // <img> with adjacent CURSOR_MARKER text.  No separate marker-based patch
    // is needed.

    // Re-render editable area with emoji patches now applied
    if (wysiwygEditor && wysiwygEditor.editableArea && wysiwygEditor.markdownArea) {
      var md = wysiwygEditor.markdownArea.value;
      if (md) {
        wysiwygEditor.editableArea.innerHTML = wysiwygEditor._markdownToHtml(md);
        populateRawHtmlBlocks(wysiwygEditor.editableArea);
      }
    }



    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygCodeBlockBackspaceAttached) {
        ea.dataset.liveWysiwygCodeBlockBackspaceAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'Backspace' && e.key !== 'Delete') return;
          var sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;
          if (!sel.isCollapsed) {
            var r = sel.getRangeAt(0);
            var toRemove = [];
            var allAds = ea.querySelectorAll('.admonition');
            for (var ai = 0; ai < allAds.length; ai++) {
              var ad = allAds[ai];
              if (!r.intersectsNode(ad)) continue;
              var titleEl = ad.querySelector('.admonition-title');
              if (!titleEl || !r.intersectsNode(titleEl)) continue;
              var bodyIntersects = false;
              for (var bi = 0; bi < ad.childNodes.length; bi++) {
                var bc = ad.childNodes[bi];
                if (bc.nodeType === 1 && bc.classList && bc.classList.contains('admonition-title')) continue;
                if (r.intersectsNode(bc)) { bodyIntersects = true; break; }
              }
              if (bodyIntersects) toRemove.push(ad);
            }
            var allCodeBlocks = ea.querySelectorAll('.md-code-block');
            for (var ci = 0; ci < allCodeBlocks.length; ci++) {
              var cb = allCodeBlocks[ci];
              if (!r.intersectsNode(cb)) continue;
              var cbTitle = cb.querySelector('.md-code-title, .md-code-lang');
              if (!cbTitle || !r.intersectsNode(cbTitle)) continue;
              var cbPre = cb.querySelector('pre');
              if (cbPre && r.intersectsNode(cbPre)) toRemove.push(cb);
            }
            if (toRemove.length === 0) return;
            e.preventDefault();
            var insertionParent = toRemove[0].parentNode;
            var insertionRef = toRemove[0].nextSibling;
            for (var ri = 0; ri < toRemove.length; ri++) {
              var el = toRemove[ri];
              if (el.parentNode) {
                if (ri === 0) {
                  insertionParent = el.parentNode;
                  insertionRef = el.nextSibling;
                }
                el.parentNode.removeChild(el);
              }
            }
            try { r.deleteContents(); } catch (ex) {}
            var emptyBqs = ea.querySelectorAll('blockquote');
            for (var qi = emptyBqs.length - 1; qi >= 0; qi--) {
              var bq = emptyBqs[qi];
              if (!bq.textContent.replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '') && !bq.querySelector('pre, .md-code-block, .admonition, img')) {
                bq.parentNode.removeChild(bq);
              }
            }
            var newP = document.createElement('p');
            newP.innerHTML = '<br>';
            if (insertionParent && ea.contains(insertionParent)) {
              if (insertionRef && insertionParent.contains(insertionRef)) {
                insertionParent.insertBefore(newP, insertionRef);
              } else {
                insertionParent.appendChild(newP);
              }
            } else {
              ea.appendChild(newP);
            }
            var range = document.createRange();
            range.setStart(newP, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            if (wysiwygEditor._finalizeUpdate) {
              wysiwygEditor._finalizeUpdate(ea.innerHTML);
            }
            return;
          }
          var node = sel.anchorNode;
          var pre = null;
          var wrapper = null;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.nodeName === 'PRE') pre = anc;
            if (anc.classList && anc.classList.contains('md-code-block')) wrapper = anc;
            anc = anc.parentNode;
          }
          if (!pre) return;
          var codeEl = pre.querySelector('code') || pre;
          var content = codeEl.textContent;
          var blockContainer = wrapper || pre;

          if (content === '' || content === '\n') {
            e.preventDefault();
            var nextSib = blockContainer.nextSibling;
            var parentNode = blockContainer.parentNode;
            parentNode.removeChild(blockContainer);
            var p = document.createElement('p');
            var br = document.createElement('br');
            p.appendChild(br);
            if (nextSib) {
              parentNode.insertBefore(p, nextSib);
            } else {
              parentNode.appendChild(p);
            }
            var range = document.createRange();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            if (wysiwygEditor._finalizeUpdate) {
              wysiwygEditor._finalizeUpdate(ea.innerHTML);
            }
            return;
          }

        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygAdmonitionBackspaceAttached) {
        ea.dataset.liveWysiwygAdmonitionBackspaceAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'Backspace') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var node = sel.anchorNode;
          if (node.nodeType === 3) node = node.parentNode;
          var ad = null;
          var inTitle = false;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.classList && anc.classList.contains('admonition')) {
              ad = anc;
              var titleEl = ad.querySelector('.admonition-title');
              inTitle = titleEl && (titleEl === node || titleEl.contains(node));
              break;
            }
            anc = anc.parentNode;
          }
          if (!ad) return;
          if (inTitle) {
            var titleEl = ad.querySelector('.admonition-title');
            var titleText = (titleEl.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            if (titleText.length === 0) {
              e.preventDefault();
              return;
            }
            var r = sel.getRangeAt(0);
            var atStart = false;
            var sn = r.startContainer;
            var so = r.startOffset;
            if (sn === titleEl && so === 0) {
              atStart = true;
            } else if (sn.nodeType === 3 && so === 0) {
              var prev = sn;
              while (prev && prev !== titleEl) {
                if (prev.previousSibling) { atStart = false; break; }
                prev = prev.parentNode;
                if (prev === titleEl) { atStart = true; break; }
              }
            } else if (sn.nodeType === 1 && so === 0 && (sn === titleEl || titleEl.contains(sn))) {
              var prev = sn;
              while (prev && prev !== titleEl) {
                if (prev.previousSibling) { atStart = false; break; }
                prev = prev.parentNode;
                if (prev === titleEl) { atStart = true; break; }
              }
            }
            if (atStart) {
              e.preventDefault();
            }
            return;
          }
          var bodyContent = '';
          for (var j = 0; j < ad.childNodes.length; j++) {
            var c = ad.childNodes[j];
            if (c.nodeType === 1 && c.classList && c.classList.contains('admonition-title')) continue;
            bodyContent += (c.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
          }
          bodyContent = bodyContent.replace(/\s/g, '');
          if (bodyContent.length === 0) {
            e.preventDefault();
            var nextSib = ad.nextSibling;
            var parentNode = ad.parentNode;
            parentNode.removeChild(ad);
            var p = document.createElement('p');
            var br = document.createElement('br');
            p.appendChild(br);
            if (nextSib) {
              parentNode.insertBefore(p, nextSib);
            } else {
              parentNode.appendChild(p);
            }
            var range = document.createRange();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            if (wysiwygEditor._finalizeUpdate) {
              wysiwygEditor._finalizeUpdate(ea.innerHTML);
            }
          }
        });
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygListEnterExitAttached) {
        ea.dataset.liveWysiwygListEnterExitAttached = '1';
        var listConsecutiveEnters = 0;
        var lastEnterList = null;
        var stripMarkersList = /[\u200B\u200C\u200D\uFEFF]/g;
        function isLiEmpty(li) {
          var t = (li.textContent || '').replace(stripMarkersList, '').replace(/[\s ]/g, '');
          return t.length === 0;
        }
        ea.addEventListener('keydown', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg' || e.key !== 'Enter') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) {
            listConsecutiveEnters = 0;
            lastEnterList = null;
            return;
          }
          var r = sel.getRangeAt(0);
          var node = r.startContainer;
          if (node.nodeType === 3) node = node.parentNode;
          var list = null;
          var li = null;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.nodeName === 'LI') li = anc;
            if (anc.nodeName === 'UL' || anc.nodeName === 'OL') {
              list = anc;
              break;
            }
            anc = anc.parentNode;
          }
          if (!list || !li) {
            listConsecutiveEnters = 0;
            lastEnterList = null;
            return;
          }

          if (lastEnterList !== list) {
            listConsecutiveEnters = 0;
            lastEnterList = list;
          }
          if (!isLiEmpty(li)) {
            listConsecutiveEnters++;
            if (listConsecutiveEnters < 2) return;
            return;
          }
          listConsecutiveEnters++;
          if (listConsecutiveEnters < 2) return;
          var hasLiAfter = false;
          var nextLi = li.nextSibling;
          while (nextLi) {
            if (nextLi.nodeName === 'LI' && !isLiEmpty(nextLi)) {
              hasLiAfter = true;
              break;
            }
            nextLi = nextLi.nextSibling;
          }
          if (hasLiAfter) {
            listConsecutiveEnters = 0;
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          listConsecutiveEnters = 0;
          lastEnterList = null;
          var lis = [];
          for (var j = 0; j < list.childNodes.length; j++) {
            if (list.childNodes[j].nodeName === 'LI') lis.push(list.childNodes[j]);
          }
          var removed = 0;
          for (var i = lis.length - 1; i >= 0 && removed < 2; i--) {
            if (isLiEmpty(lis[i])) {
              list.removeChild(lis[i]);
              removed++;
            } else {
              break;
            }
          }
          var parentLi = list.parentNode;
          var isNestedList = parentLi && parentLi.nodeName === 'LI';
          if (isNestedList) {
            var parentList = parentLi.parentNode;
            if (parentList && (parentList.nodeName === 'UL' || parentList.nodeName === 'OL')) {
              if (list.childNodes.length === 0) {
                parentLi.removeChild(list);
              }
              var newLi = document.createElement('li');
              var hasCheckbox = false;
              for (var k = 0; k < parentList.children.length; k++) {
                var sib = parentList.children[k];
                if (sib.nodeName === 'LI') {
                  var cb = sib.querySelector('input[type="checkbox"]');
                  if (cb && cb.parentNode === sib) { hasCheckbox = true; break; }
                }
              }
              if (hasCheckbox) {
                var prevCb = getDirectCheckboxOfLi(parentLi);
                addCheckboxToLi(newLi, prevCb ? prevCb.checked : false);
              } else newLi.innerHTML = '<br>';
              var nextSib = parentLi.nextSibling;
              if (nextSib) {
                parentList.insertBefore(newLi, nextSib);
              } else {
                parentList.appendChild(newLi);
              }
              var range = document.createRange();
              if (hasCheckbox) {
                var space = newLi.querySelector('input[type="checkbox"]');
                if (space) space = space.nextSibling;
                if (space && space.nodeType === 3) range.setStart(space, space.length || 1);
                else range.setStart(newLi, 0);
              } else {
                range.setStart(newLi, 0);
              }
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              if (wysiwygEditor._finalizeUpdate) {
                wysiwygEditor._finalizeUpdate(ea.innerHTML);
              }
              return;
            }
          }
          var p = document.createElement('p');
          p.innerHTML = '<br>';
          var insertParent, insertBefore;
          var adFromList = null;
          if (list.childNodes.length === 0) {
            var listParent = list.parentNode;
            var nextSib = list.nextSibling;
            listParent.removeChild(list);
            var a = listParent;
            while (a && a !== ea) {
              if (a.classList && a.classList.contains('admonition')) { adFromList = a; break; }
              a = a.parentNode;
            }
            if (adFromList && listParent.parentNode === adFromList) {
              insertParent = adFromList;
              insertBefore = listParent.nextSibling;
            } else {
              insertParent = listParent.parentNode;
              insertBefore = listParent.nextSibling;
            }
          } else {
            var bodyEl = list.parentNode;
            var a = bodyEl;
            while (a && a !== ea) {
              if (a.classList && a.classList.contains('admonition')) { adFromList = a; break; }
              a = a.parentNode;
            }
            if (adFromList && bodyEl.parentNode === adFromList) {
              insertParent = adFromList;
              insertBefore = bodyEl.nextSibling;
            } else {
              insertParent = list.parentNode;
              insertBefore = list.nextSibling;
            }
          }
          if (insertBefore) {
            insertParent.insertBefore(p, insertBefore);
          } else {
            insertParent.appendChild(p);
          }
          if (adFromList) {
            ea.__liveWysiwygAdmonitionEnterCredit = { count: 2, ad: adFromList };
          }
          var bqFromList = null;
          var a = insertParent;
          while (a && a !== ea) {
            if (a.nodeName === 'BLOCKQUOTE') { bqFromList = a; break; }
            a = a.parentNode;
          }
          if (bqFromList) {
            ea.__liveWysiwygBlockquoteEnterCredit = { count: 2, bq: bqFromList };
          }
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygAdmonitionEnterExitAttached) {
        ea.dataset.liveWysiwygAdmonitionEnterExitAttached = '1';
        var adConsecutiveEnters = 0;
        var lastEnterAd = null;
        ea.addEventListener('keydown', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg' || e.key !== 'Enter') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) {
            adConsecutiveEnters = 0;
            lastEnterAd = null;
            return;
          }
          var node = sel.anchorNode;
          if (node.nodeType === 3) node = node.parentNode;
          var ad = null;
          var inTitle = false;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.classList && anc.classList.contains('admonition')) {
              ad = anc;
              var titleEl = ad.querySelector('.admonition-title');
              inTitle = titleEl && (titleEl === node || titleEl.contains(node));
              break;
            }
            anc = anc.parentNode;
          }
          if (!ad) {
            adConsecutiveEnters = 0;
            lastEnterAd = null;
            return;
          }
          if (inTitle) {
            adConsecutiveEnters = 0;
            lastEnterAd = null;
            e.preventDefault();
            var titleEl = ad.querySelector('.admonition-title');
            var r = sel.getRangeAt(0);
            var checkRange = document.createRange();
            checkRange.setStart(titleEl, 0);
            checkRange.setEnd(r.startContainer, r.startOffset);
            var atTitleStart = checkRange.toString().length === 0;
            var titleText = (titleEl.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            if (atTitleStart && titleText.length > 0) {
              var p = document.createElement('p');
              p.innerHTML = '<br>';
              ad.parentNode.insertBefore(p, ad);
              var range = document.createRange();
              range.setStart(p, 0);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              if (wysiwygEditor._finalizeUpdate) {
                wysiwygEditor._finalizeUpdate(ea.innerHTML);
              }
            } else {
              if (titleText.length === 0) {
                var adType = null;
                var types = ['note', 'warning', 'danger', 'tip', 'hint', 'important', 'caution', 'error', 'attention'];
                for (var ti = 0; ti < types.length; ti++) {
                  if (ad.classList.contains(types[ti])) { adType = types[ti]; break; }
                }
                if (adType) {
                  titleEl.textContent = adType.charAt(0).toUpperCase() + adType.slice(1);
                } else {
                  titleEl.textContent = 'Note';
                }
              }
              var firstBody = null;
              for (var ci = 0; ci < ad.childNodes.length; ci++) {
                var cn = ad.childNodes[ci];
                if (cn.nodeType === 1 && cn !== titleEl && cn.nodeName !== 'BR') {
                  firstBody = cn;
                  break;
                }
              }
              if (!firstBody) {
                firstBody = document.createElement('p');
                firstBody.innerHTML = '<br>';
                ad.appendChild(firstBody);
              }
              var range = document.createRange();
              if (firstBody.firstChild && firstBody.firstChild.nodeType === 3) {
                range.setStart(firstBody.firstChild, 0);
              } else {
                range.setStart(firstBody, 0);
              }
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              if (wysiwygEditor._finalizeUpdate) {
                wysiwygEditor._finalizeUpdate(ea.innerHTML);
              }
            }
            return;
          }
          var inListItem = false;
          var a = node;
          while (a && a !== ad) {
            if (a.nodeName === 'LI') { inListItem = true; break; }
            a = a.parentNode;
          }
          if (inListItem) {
            adConsecutiveEnters = 0;
            lastEnterAd = null;
            return;
          }
          var directChild = node;
          while (directChild && directChild.parentNode !== ad) {
            directChild = directChild.parentNode;
          }
          var isBlock = directChild && (directChild.nodeName === 'P' || directChild.nodeName === 'DIV') && (!directChild.classList || !directChild.classList.contains('admonition-title'));
          if (!isBlock) {
            adConsecutiveEnters = 0;
            lastEnterAd = null;
            return;
          }
          var hadCredit = false;
          var credit = ea.__liveWysiwygAdmonitionEnterCredit;
          if (credit && credit.ad === ad) {
            ea.__liveWysiwygAdmonitionEnterCredit = null;
            var blockTextCheck = (directChild.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            var onlyBr = directChild.childNodes.length === 1 && directChild.firstChild && directChild.firstChild.nodeName === 'BR';
            var hasContent = blockTextCheck.length > 0 && !onlyBr;
            if (hasContent) {
              adConsecutiveEnters = 0;
              lastEnterAd = ad;
            } else {
              adConsecutiveEnters = credit.count;
              lastEnterAd = ad;
              hadCredit = true;
            }
          } else if (lastEnterAd !== ad) {
            adConsecutiveEnters = 0;
            lastEnterAd = ad;
          }
          adConsecutiveEnters++;
          if (adConsecutiveEnters < 3) return;
          var hasContentAfter = false;
          var sib = directChild ? directChild.nextSibling : null;
          while (sib) {
            if (sib.nodeType === 1) {
              var sibText = (sib.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
              if (sibText.length > 0) { hasContentAfter = true; break; }
            } else if (sib.nodeType === 3) {
              var sibText = (sib.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
              if (sibText.length > 0) { hasContentAfter = true; break; }
            }
            sib = sib.nextSibling;
          }
          if (hasContentAfter) {
            adConsecutiveEnters = 0;
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          adConsecutiveEnters = 0;
          lastEnterAd = null;
          var stripMarkersAd = /[\u200B\u200C\u200D\uFEFF]/g;
          function removeTrailingEmptyBlocks(container) {
            var kids = container.childNodes;
            for (var i = kids.length - 1; i >= 0; i--) {
              var k = kids[i];
              if (k.nodeType !== 1) continue;
              var tag = k.nodeName;
              if (tag !== 'P' && tag !== 'DIV') continue;
              var t = (k.textContent || '').replace(stripMarkersAd, '').replace(/\s/g, '');
              if (t.length === 0) {
                container.removeChild(k);
              } else {
                break;
              }
            }
          }
          var bodyEls = [];
          for (var j = 0; j < ad.childNodes.length; j++) {
            var c = ad.childNodes[j];
            if (c.nodeType === 1 && c.classList && c.classList.contains('admonition-title')) continue;
            removeTrailingEmptyBlocks(c);
            bodyEls.push(c);
          }
          var maxToRemove = hadCredit ? 1 : 999;
          var removed = 0;
          while (bodyEls.length > 0 && removed < maxToRemove) {
            var last = bodyEls[bodyEls.length - 1];
            var t = (last.textContent || '').replace(stripMarkersAd, '').replace(/\s/g, '');
            if (t.length === 0) {
              ad.removeChild(last);
              bodyEls.pop();
              removed++;
            } else {
              var txt = (last.textContent || '').replace(stripMarkersAd, '');
              var trimmed = txt.replace(/\n+$/, '');
              if (trimmed !== txt && last.childNodes.length === 1 && last.firstChild && last.firstChild.nodeType === 3) {
                last.firstChild.textContent = trimmed;
              }
              break;
            }
          }
          var p = document.createElement('p');
          p.innerHTML = '<br>';
          if (ad.nextSibling) {
            ad.parentNode.insertBefore(p, ad.nextSibling);
          } else {
            ad.parentNode.appendChild(p);
          }
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          var adParent = ad.parentNode;
          if (adParent && adParent.nodeName === 'BLOCKQUOTE') {
            ea.__liveWysiwygBlockquoteEnterCredit = { count: 2, bq: adParent };
          }
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygBlockquoteEnterExitAttached) {
        ea.dataset.liveWysiwygBlockquoteEnterExitAttached = '1';
        var bqConsecutiveEnters = 0;
        var lastEnterBq = null;
        ea.addEventListener('keydown', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg' || e.key !== 'Enter') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) {
            bqConsecutiveEnters = 0;
            lastEnterBq = null;
            return;
          }
          var node = sel.anchorNode;
          if (node.nodeType === 3) node = node.parentNode;
          var bq = null;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.nodeName === 'BLOCKQUOTE') {
              bq = anc;
              break;
            }
            anc = anc.parentNode;
          }
          if (!bq) {
            bqConsecutiveEnters = 0;
            lastEnterBq = null;
            return;
          }
          var inAdmonition = false;
          var a = node;
          while (a && a !== bq) {
            if (a.classList && a.classList.contains('admonition')) { inAdmonition = true; break; }
            a = a.parentNode;
          }
          if (inAdmonition) {
            bqConsecutiveEnters = 0;
            lastEnterBq = null;
            return;
          }
          var inListItem = false;
          var a = node;
          while (a && a !== bq) {
            if (a.nodeName === 'LI') { inListItem = true; break; }
            a = a.parentNode;
          }
          if (inListItem) {
            bqConsecutiveEnters = 0;
            lastEnterBq = null;
            return;
          }
          var directChild = node;
          while (directChild && directChild.parentNode !== bq) {
            directChild = directChild.parentNode;
          }
          var isAdmonitionChild = directChild && directChild.classList && directChild.classList.contains('admonition');
          var isBlock = directChild && (directChild.nodeName === 'P' || directChild.nodeName === 'DIV') && !isAdmonitionChild;
          if (!isBlock) {
            bqConsecutiveEnters = 0;
            lastEnterBq = null;
            return;
          }
          var cursorBlock = node;
          while (cursorBlock && cursorBlock !== bq && cursorBlock.nodeName !== 'P' && cursorBlock.nodeName !== 'DIV') {
            cursorBlock = cursorBlock.parentNode;
          }
          var hadCredit = false;
          var credit = ea.__liveWysiwygBlockquoteEnterCredit;
          if (credit && credit.bq === bq) {
            ea.__liveWysiwygBlockquoteEnterCredit = null;
            var contentBlock = (cursorBlock && cursorBlock !== bq) ? cursorBlock : directChild;
            var blockTextCheck = (contentBlock.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
            var onlyBr = contentBlock.childNodes.length === 1 && contentBlock.firstChild && contentBlock.firstChild.nodeName === 'BR';
            var hasContent = blockTextCheck.length > 0 && !onlyBr;
            if (hasContent) {
              bqConsecutiveEnters = 0;
              lastEnterBq = bq;
            } else {
              bqConsecutiveEnters = credit.count;
              lastEnterBq = bq;
              hadCredit = true;
            }
          } else if (lastEnterBq !== bq) {
            bqConsecutiveEnters = 0;
            lastEnterBq = bq;
          }
          bqConsecutiveEnters++;
          if (bqConsecutiveEnters < 3) return;
          var hasContentAfterBq = false;
          var sibBq = directChild ? directChild.nextSibling : null;
          while (sibBq) {
            if (sibBq.nodeType === 1) {
              var sibTextBq = (sibBq.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
              if (sibTextBq.length > 0) { hasContentAfterBq = true; break; }
            } else if (sibBq.nodeType === 3) {
              var sibTextBq = (sibBq.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
              if (sibTextBq.length > 0) { hasContentAfterBq = true; break; }
            }
            sibBq = sibBq.nextSibling;
          }
          if (hasContentAfterBq) {
            bqConsecutiveEnters = 0;
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          bqConsecutiveEnters = 0;
          lastEnterBq = null;
          var stripMarkersBq = /[\u200B\u200C\u200D\uFEFF]/g;
          function removeTrailingEmptyBlocksBq(container) {
            var kids = container.childNodes;
            for (var i = kids.length - 1; i >= 0; i--) {
              var k = kids[i];
              if (k.nodeType !== 1) continue;
              var tag = k.nodeName;
              if (tag !== 'P' && tag !== 'DIV') continue;
              var t = (k.textContent || '').replace(stripMarkersBq, '').replace(/\s/g, '');
              if (t.length === 0) {
                container.removeChild(k);
              } else {
                break;
              }
            }
          }
          var bodyEls = [];
          for (var j = 0; j < bq.childNodes.length; j++) {
            var c = bq.childNodes[j];
            removeTrailingEmptyBlocksBq(c);
            bodyEls.push(c);
          }
          var maxToRemove = hadCredit ? 1 : 999;
          var removed = 0;
          while (bodyEls.length > 0 && removed < maxToRemove) {
            var last = bodyEls[bodyEls.length - 1];
            var t = (last.textContent || '').replace(stripMarkersBq, '').replace(/\s/g, '');
            if (t.length === 0) {
              bq.removeChild(last);
              bodyEls.pop();
              removed++;
            } else {
              var txt = (last.textContent || '').replace(stripMarkersBq, '');
              var trimmed = txt.replace(/\n+$/, '');
              if (trimmed !== txt && last.childNodes.length === 1 && last.firstChild && last.firstChild.nodeType === 3) {
                last.firstChild.textContent = trimmed;
              }
              break;
            }
          }
          var p = document.createElement('p');
          p.innerHTML = '<br>';
          if (bq.nextSibling) {
            bq.parentNode.insertBefore(p, bq.nextSibling);
          } else {
            bq.parentNode.appendChild(p);
          }
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygHeadingEnterAttached) {
        ea.dataset.liveWysiwygHeadingEnterAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var r = sel.getRangeAt(0);
          var node = r.startContainer;
          var heading = null;
          var el = (node.nodeType === 3) ? node.parentNode : node;
          while (el && el !== ea) {
            if (/^H[1-6]$/.test(el.nodeName)) { heading = el; break; }
            el = el.parentNode;
          }
          if (!heading) return;
          var atStart = false;
          if (r.startContainer === heading && r.startOffset === 0) {
            atStart = true;
          } else if (r.startContainer.nodeType === 3 && r.startOffset === 0) {
            var prev = r.startContainer;
            while (prev) {
              var ps = prev.previousSibling;
              if (ps) {
                var text = (ps.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
                if (text.length > 0) break;
                prev = ps;
              } else {
                if (prev.parentNode === heading) { atStart = true; break; }
                prev = prev.parentNode;
              }
            }
          }
          if (!atStart) return;
          e.preventDefault();
          var p = document.createElement('p');
          p.innerHTML = '&#8203;';
          heading.parentNode.insertBefore(p, heading);
          var newRange = document.createRange();
          newRange.setStart(p.firstChild || p, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygHiddenTitleAdmonitionEnterAttached) {
        ea.dataset.liveWysiwygHiddenTitleAdmonitionEnterAttached = '1';
        ea.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          var r = sel.getRangeAt(0);
          var node = r.startContainer;
          var admonition = null;
          var el = (node.nodeType === 3) ? node.parentNode : node;
          while (el && el !== ea) {
            if (isAdmonitionElement(el)) { admonition = el; break; }
            el = el.parentNode;
          }
          if (!admonition || !admonition.hasAttribute('data-hide-title')) return;

          var firstContent = null;
          for (var ch = admonition.firstChild; ch; ch = ch.nextSibling) {
            if (ch.nodeType !== 1) continue;
            if (ch.classList && ch.classList.contains('md-admonition-settings-btn')) continue;
            firstContent = ch;
            break;
          }
          if (!firstContent) return;

          var cursorBlock = node;
          while (cursorBlock && cursorBlock.parentNode !== admonition) {
            cursorBlock = cursorBlock.parentNode;
          }
          if (cursorBlock !== firstContent) return;

          var atStart = false;
          if (r.startContainer === firstContent && r.startOffset === 0) {
            atStart = true;
          } else if (r.startContainer.nodeType === 3 && r.startOffset === 0) {
            var prev = r.startContainer;
            while (prev) {
              var ps = prev.previousSibling;
              if (ps) {
                var text = (ps.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
                if (text.length > 0) break;
                prev = ps;
              } else {
                if (prev.parentNode === firstContent) { atStart = true; break; }
                prev = prev.parentNode;
              }
            }
          }
          if (!atStart) return;

          e.preventDefault();
          var p = document.createElement('p');
          p.innerHTML = '&#8203;';
          admonition.parentNode.insertBefore(p, admonition);
          var newRange = document.createRange();
          newRange.setStart(p.firstChild || p, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygCodeBlockEnterExitAttached) {
        ea.dataset.liveWysiwygCodeBlockEnterExitAttached = '1';
        var stripMarkers = /[\u200B\u200C\u200D\uFEFF]/g;
        var consecutiveEnters = 0;
        var lastEnterPre = null;

        ea.addEventListener('keydown', function (e) {
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;

          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) {
            consecutiveEnters = 0;
            lastEnterPre = null;
            return;
          }

          var node = sel.anchorNode;
          var pre = null;
          var wrapper = null;
          var title = null;
          var anc = node;
          while (anc && anc !== ea) {
            if (anc.nodeName === 'PRE') pre = anc;
            if (anc.classList && anc.classList.contains('md-code-block')) wrapper = anc;
            if (anc.classList && anc.classList.contains('md-code-title')) title = anc;
            anc = anc.parentNode;
          }

          if (title && !pre && (e.key === 'Enter' || e.key === 'Backspace')) {
            var titleStripMarkers = /[​‌‍﻿]/g;
            var atTitleStart = false;
            var r = sel.getRangeAt(0);
            var sn = r.startContainer;
            var so = r.startOffset;
            if (sn === title && so === 0) {
              atTitleStart = true;
            } else if (sn.nodeType === 3 && so === 0) {
              var prev = sn;
              while (prev && prev !== title) {
                if (prev.previousSibling) { atTitleStart = false; break; }
                prev = prev.parentNode;
                if (prev === title) { atTitleStart = true; break; }
              }
            } else if (sn.nodeType === 1 && so === 0 && (sn === title || title.contains(sn))) {
              var prev = sn;
              while (prev && prev !== title) {
                if (prev.previousSibling) { atTitleStart = false; break; }
                prev = prev.parentNode;
                if (prev === title) { atTitleStart = true; break; }
              }
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopImmediatePropagation();
              var titleText = (title.textContent || '').replace(titleStripMarkers, '').trim();
              if (atTitleStart && titleText.length > 0) {
                var codeBlock = wrapper || title.parentNode;
                while (codeBlock && codeBlock !== ea && !(codeBlock.classList && codeBlock.classList.contains('md-code-block'))) {
                  codeBlock = codeBlock.parentNode;
                }
                if (!codeBlock || codeBlock === ea) codeBlock = title.parentNode;
                var p = document.createElement('p');
                p.innerHTML = '<br>';
                codeBlock.parentNode.insertBefore(p, codeBlock);
                var range = document.createRange();
                range.setStart(p, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                if (wysiwygEditor._finalizeUpdate) {
                  wysiwygEditor._finalizeUpdate(ea.innerHTML);
                }
              } else {
                var codeBlock = wrapper || title.parentNode;
                while (codeBlock && codeBlock !== ea && !(codeBlock.classList && codeBlock.classList.contains('md-code-block'))) {
                  codeBlock = codeBlock.parentNode;
                }
                if (!codeBlock || codeBlock === ea) codeBlock = title.parentNode;
                var targetPre = codeBlock.querySelector('pre');
                if (targetPre) {
                  var codeEl = targetPre.querySelector('code');
                  var focusTarget = codeEl || targetPre;
                  var range = document.createRange();
                  if (focusTarget.firstChild && focusTarget.firstChild.nodeType === 3) {
                    range.setStart(focusTarget.firstChild, 0);
                  } else {
                    range.setStart(focusTarget, 0);
                  }
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
              title.blur();
              title.dispatchEvent(new Event('blur'));
              return;
            }

            if (e.key === 'Backspace' && atTitleStart) {
              var titleText = (title.textContent || '').replace(titleStripMarkers, '').trim();
              if (titleText.length > 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
              }
              e.preventDefault();
              e.stopImmediatePropagation();
              var codeBlock = wrapper || title.parentNode;
              while (codeBlock && codeBlock !== ea && !(codeBlock.classList && codeBlock.classList.contains('md-code-block'))) {
                codeBlock = codeBlock.parentNode;
              }
              if (!codeBlock || codeBlock === ea) return;
              var targetPre = codeBlock.querySelector('pre');
              if (!targetPre) return;
              targetPre.removeAttribute('data-lang');
              targetPre.removeAttribute('data-title');
              targetPre.removeAttribute('data-linenums');
              targetPre.removeAttribute('data-hl-lines');
              var codeEl = targetPre.querySelector('code');
              if (codeEl) codeEl.className = '';
              var parent = codeBlock.parentNode;
              parent.insertBefore(targetPre, codeBlock);
              parent.removeChild(codeBlock);
              targetPre.style.position = 'relative';
              addLangButtonToBasicPre(targetPre, ea);
              var focusTarget = codeEl || targetPre;
              var range = document.createRange();
              if (focusTarget.firstChild && focusTarget.firstChild.nodeType === 3) {
                range.setStart(focusTarget.firstChild, 0);
              } else {
                range.setStart(focusTarget, 0);
              }
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              if (wysiwygEditor._finalizeUpdate) {
                wysiwygEditor._finalizeUpdate(ea.innerHTML);
              }
              return;
            }
          }

          function normalizePreTextNodes(preEl, selection) {
            var codeEl = preEl.querySelector('code');
            if (!codeEl) return;
            var stray = [];
            for (var ci = 0; ci < preEl.childNodes.length; ci++) {
              var cn = preEl.childNodes[ci];
              if (cn === codeEl) continue;
              if (cn.nodeType === 1 && cn.classList && (cn.classList.contains('md-code-lang-btn') || cn.classList.contains('md-code-lang-dropdown') || cn.classList.contains('md-code-settings-btn') || cn.classList.contains('md-code-settings-btn-advanced') || cn.classList.contains('md-code-settings-dropdown') || cn.classList.contains('md-code-line-numbers'))) continue;
              if (cn.nodeType === 3 || cn.nodeType === 1) stray.push(cn);
            }
            if (stray.length === 0) return;
            var r = (selection && selection.rangeCount) ? selection.getRangeAt(0) : null;
            var cursorInStray = false;
            var cursorStrayNode = null;
            var cursorStrayOffset = 0;
            if (r) {
              for (var si = 0; si < stray.length; si++) {
                if (stray[si] === r.startContainer || stray[si].contains(r.startContainer)) {
                  cursorInStray = true;
                  cursorStrayNode = r.startContainer;
                  cursorStrayOffset = r.startOffset;
                  break;
                }
              }
            }
            var offsetInCode = codeEl.textContent.length;
            for (var si = 0; si < stray.length; si++) {
              var txt = stray[si].textContent;
              if (txt) codeEl.appendChild(document.createTextNode(txt));
              preEl.removeChild(stray[si]);
            }
            if (cursorInStray && r) {
              var newOffset = offsetInCode;
              var prevStrayText = '';
              for (var si = 0; si < stray.length; si++) {
                if (stray[si] === cursorStrayNode || stray[si].contains(cursorStrayNode)) {
                  newOffset = offsetInCode + prevStrayText.length + cursorStrayOffset;
                  break;
                }
                prevStrayText += stray[si].textContent;
              }
              var walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null, false);
              var acc = 0;
              var wn;
              while ((wn = walker.nextNode())) {
                if (acc + wn.textContent.length >= newOffset) {
                  r.setStart(wn, newOffset - acc);
                  r.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(r);
                  break;
                }
                acc += wn.textContent.length;
              }
            }
          }

          if (pre && e.key === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation();
            consecutiveEnters = 0;
            lastEnterPre = null;
            normalizePreTextNodes(pre, sel);
            var codeEl = pre.querySelector('code');
            if (codeEl) {
              var r = sel.getRangeAt(0);
              if (codeEl.contains(r.startContainer)) {
                var indentSettings = getIndentSettings();
                var tabStr = indentSettings.type === 'tab' ? '\t' : new Array((indentSettings.size || 4) + 1).join(' ');
                var doc = codeEl.ownerDocument;
                var tabNode = doc.createTextNode(tabStr);
                r.insertNode(tabNode);
                r.setStart(tabNode, tabStr.length);
                r.setEnd(tabNode, tabStr.length);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                if (ea.dispatchEvent) {
                  ea.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }
            }
            return;
          }

          if (e.key !== 'Enter') {
            if (pre && e.key === 'Backspace' && consecutiveEnters > 0) {
              consecutiveEnters = Math.max(0, consecutiveEnters - 1);
            } else {
              consecutiveEnters = 0;
              lastEnterPre = null;
            }
            return;
          }

          if (!pre) {
            consecutiveEnters = 0;
            lastEnterPre = null;
            return;
          }

          if (lastEnterPre !== pre) {
            consecutiveEnters = 0;
            lastEnterPre = pre;
          }

          consecutiveEnters++;
          e.preventDefault();
          e.stopImmediatePropagation();
          normalizePreTextNodes(pre, sel);

          if (consecutiveEnters < 3) {
            var codeEl = pre.querySelector('code');
            if (codeEl) {
              var r = sel.getRangeAt(0);
              if (codeEl.contains(r.startContainer)) {
                var indentStr = '';
                var indentSettings = getIndentSettings();
                if (indentSettings.enabled) {
                  var fullText = codeEl.textContent;
                  var cursorOffset = 0;
                  var walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null, false);
                  var wn;
                  while ((wn = walker.nextNode())) {
                    if (wn === r.startContainer) { cursorOffset += r.startOffset; break; }
                    cursorOffset += wn.textContent.length;
                  }
                  var lineStart = fullText.lastIndexOf('\n', cursorOffset - 1) + 1;
                  var currentLine = fullText.substring(lineStart, cursorOffset);
                  var leadingMatch = currentLine.match(/^([ \t]*)/);
                  indentStr = leadingMatch ? leadingMatch[1] : '';
                  var trimmedLine = currentLine.trimEnd();
                  if (/[:{(\[]\s*$/.test(trimmedLine)) {
                    var unit = indentSettings.type === 'tab' ? '\t' : new Array(indentSettings.size + 1).join(' ');
                    indentStr += unit;
                  }
                }
                var doc = codeEl.ownerDocument;
                var nl = doc.createTextNode('\n' + indentStr);
                r.insertNode(nl);
                r.setStart(nl, 1 + indentStr.length);
                r.setEnd(nl, 1 + indentStr.length);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                var afterText = codeEl.textContent.substring(
                  (function () {
                    var off = 0;
                    var w = doc.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null, false);
                    var n;
                    while ((n = w.nextNode())) {
                      if (n === nl) return off + 1 + indentStr.length;
                      off += n.textContent.length;
                    }
                    return codeEl.textContent.length;
                  })()
                );
                if (!afterText || !afterText.replace(/[\n\r\s\t\u200B\u200C\u200D\uFEFF]/g, '')) {
                  var lastTextNode = null;
                  var tw = doc.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null, false);
                  var tn;
                  while ((tn = tw.nextNode())) lastTextNode = tn;
                  if (lastTextNode) {
                    if (!lastTextNode.textContent.endsWith('\n')) {
                      lastTextNode.textContent += '\n';
                    }
                  } else {
                    codeEl.appendChild(doc.createTextNode('\n'));
                  }
                }
                if (ea.dispatchEvent) {
                  ea.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }
            }
            return;
          }

          var codeElCheck = pre.querySelector('code');
          var cursorAtEnd = false;
          if (codeElCheck) {
            var rCheck = sel.getRangeAt(0);
            if (codeElCheck.contains(rCheck.startContainer)) {
              var fullTextCheck = codeElCheck.textContent;
              var cursorOffsetCheck = 0;
              var walkerCheck = document.createTreeWalker(codeElCheck, NodeFilter.SHOW_TEXT, null, false);
              var wnCheck;
              while ((wnCheck = walkerCheck.nextNode())) {
                if (wnCheck === rCheck.startContainer) { cursorOffsetCheck += rCheck.startOffset; break; }
                cursorOffsetCheck += wnCheck.textContent.length;
              }
              var afterCursor = fullTextCheck.substring(cursorOffsetCheck);
              if (afterCursor.replace(/[\n\r\s\t\u200B\u200C\u200D\uFEFF]/g, '').length === 0) {
                cursorAtEnd = true;
              }
            }
          }
          if (!cursorAtEnd) {
            consecutiveEnters = 0;
            var codeEl = pre.querySelector('code');
            if (codeEl) {
              var r = sel.getRangeAt(0);
              if (codeEl.contains(r.startContainer)) {
                var doc = codeEl.ownerDocument;
                var nl = doc.createTextNode('\n');
                r.insertNode(nl);
                r.setStart(nl, 1);
                r.setEnd(nl, 1);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                if (ea.dispatchEvent) {
                  ea.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }
            }
            return;
          }

          consecutiveEnters = 0;
          lastEnterPre = null;

          var blockContainer = wrapper || pre;
          var el = pre;
          while (el && el !== ea) {
            if (el.classList && el.classList.contains('md-code-block')) {
              blockContainer = el;
            }
            el = el.parentNode;
          }
          if (pre) {
            var codeEl = pre.querySelector('code');
            var codeClass = (codeEl && codeEl.className) ? codeEl.className : '';
            var effectiveChildren = 0;
            var singleCode = null;
            for (var ei = 0; ei < pre.childNodes.length; ei++) {
              var en = pre.childNodes[ei];
              if (en.nodeType === 1 && en.classList && (en.classList.contains('md-code-lang-btn') || en.classList.contains('md-code-lang-dropdown') || en.classList.contains('md-code-line-numbers') || en.classList.contains('md-code-settings-btn') || en.classList.contains('md-code-settings-btn-advanced'))) continue;
              if (en.nodeType === 1 && en.nodeName === 'CODE') { singleCode = en; effectiveChildren++; }
              else effectiveChildren++;
            }
            var rawContent;
            if (effectiveChildren === 1 && singleCode) {
              rawContent = singleCode.textContent;
            } else {
              var parts = [];
              for (var ci = 0; ci < pre.childNodes.length; ci++) {
                var cn = pre.childNodes[ci];
                if (cn.nodeType === 1 && cn.classList && (cn.classList.contains('md-code-lang-btn') || cn.classList.contains('md-code-lang-dropdown') || cn.classList.contains('md-code-line-numbers') || cn.classList.contains('md-code-settings-btn') || cn.classList.contains('md-code-settings-btn-advanced'))) continue;
                if (cn.nodeType === 3) parts.push(cn.textContent);
                else if (cn.nodeType === 1) parts.push(cn.textContent);
              }
              rawContent = parts.join('\n');
            }
            rawContent = rawContent.replace(stripMarkers, '');
            var cleaned = rawContent.replace(/(\n[ \t]*)+$/, '');
            while (pre.firstChild) pre.removeChild(pre.firstChild);
            var newCode = document.createElement('code');
            if (codeClass) newCode.className = codeClass;
            newCode.textContent = cleaned.length > 0 ? cleaned + '\n' : '\n';
            pre.appendChild(newCode);
            if (!wrapper) {
              enhanceBasicPreBlocks(ea);
            }
          }
          var p = document.createElement('p');
          var br = document.createElement('br');
          p.appendChild(br);
          blockContainer.insertAdjacentElement('afterend', p);
          var codeBlockAncestor = p.parentNode;
          while (codeBlockAncestor && codeBlockAncestor !== ea) {
            if (codeBlockAncestor.classList && codeBlockAncestor.classList.contains('md-code-block')) {
              codeBlockAncestor.parentNode.insertBefore(p, codeBlockAncestor.nextSibling);
              break;
            }
            codeBlockAncestor = codeBlockAncestor.parentNode;
          }
          var actualParent = p.parentNode;
          if (actualParent && actualParent !== ea) {
            if (actualParent.classList && actualParent.classList.contains('admonition')) {
              ea.__liveWysiwygAdmonitionEnterCredit = { count: 2, ad: actualParent };
            } else if (actualParent.nodeName === 'BLOCKQUOTE') {
              ea.__liveWysiwygBlockquoteEnterCredit = { count: 2, bq: actualParent };
            }
          }
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          if (wysiwygEditor._finalizeUpdate) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          }
        }, true);
      }
    })();

    function _isCodeUINode(n) {
      if (n.nodeType !== 1 || !n.classList) return false;
      return n.classList.contains('md-code-lang-btn') || n.classList.contains('md-code-lang-btn-advanced') ||
             n.classList.contains('md-code-lang-dropdown') || n.classList.contains('md-code-line-numbers') ||
             n.classList.contains('md-code-settings-btn') || n.classList.contains('md-code-settings-btn-advanced') ||
             n.classList.contains('md-code-settings-dropdown');
    }

    function _buildTargetRange(target) {
      var range = document.createRange();
      if (target.nodeName === 'PRE') {
        var codeEl = target.querySelector('code');
        var isSingleCode = false;
        if (codeEl) {
          var effectiveCount = 0;
          for (var si = 0; si < target.childNodes.length; si++) {
            if (_isCodeUINode(target.childNodes[si])) continue;
            effectiveCount++;
          }
          isSingleCode = (effectiveCount === 1 && codeEl.childNodes.length === 1 &&
                          codeEl.firstChild && codeEl.firstChild.nodeType === 3);
        }
        if (isSingleCode) {
          var textNode = codeEl.firstChild;
          var len = textNode.textContent.length;
          if (textNode.textContent.endsWith('\n') && len > 0) len = len - 1;
          range.setStart(textNode, 0);
          range.setEnd(textNode, len);
        } else {
          var firstContent = null, lastContent = null;
          for (var ci = 0; ci < target.childNodes.length; ci++) {
            var cn = target.childNodes[ci];
            if (_isCodeUINode(cn)) continue;
            if (!firstContent) firstContent = cn;
            lastContent = cn;
          }
          if (firstContent) {
            range.setStartBefore(firstContent);
            if (lastContent.nodeType === 3 && lastContent.textContent.endsWith('\n')) {
              range.setEnd(lastContent, lastContent.textContent.length - 1);
            } else {
              range.setEndAfter(lastContent);
            }
          } else {
            range.selectNodeContents(target);
          }
        }
      } else {
        range.selectNodeContents(target);
      }
      return range;
    }

    function _buildAdmonitionBodyRange(ad) {
      var range = document.createRange();
      var firstBody = null, lastBody = null;
      for (var ci = 0; ci < ad.childNodes.length; ci++) {
        var cn = ad.childNodes[ci];
        if (cn.nodeType === 1 && cn.classList && cn.classList.contains('admonition-title')) continue;
        if (cn.nodeType === 3 && !cn.textContent.replace(/[​‌‍﻿\s]/g, '')) continue;
        if (!firstBody) firstBody = cn;
        lastBody = cn;
      }
      if (firstBody && lastBody) {
        range.setStartBefore(firstBody);
        range.setEndAfter(lastBody);
      } else {
        range.selectNodeContents(ad);
      }
      return range;
    }

    function _selectionCoversRange(sel, targetRange) {
      if (!sel.rangeCount) return false;
      var cur = sel.getRangeAt(0);
      try {
        return cur.compareBoundaryPoints(Range.START_TO_START, targetRange) <= 0 &&
               cur.compareBoundaryPoints(Range.END_TO_END, targetRange) >= 0;
      } catch (ex) { return false; }
    }

    (function () {
      var ea = wysiwygEditor.editableArea;
      if (ea && !ea.dataset.liveWysiwygProgressiveSelectAllAttached) {
        ea.dataset.liveWysiwygProgressiveSelectAllAttached = '1';

        var isCodeUINode = _isCodeUINode;
        var buildTargetRange = _buildTargetRange;
        var buildAdmonitionBodyRange = _buildAdmonitionBodyRange;
        var selectionCoversRange = _selectionCoversRange;

        function isSelectableTarget(node) {
          if (node === ea) return true;
          if (node.nodeType !== 1) return false;
          var name = node.nodeName;
          var cl = node.classList;
          if (name === 'CODE' && !node.closest('pre')) return true;
          if (cl && (cl.contains('md-code-title') || cl.contains('md-code-lang'))) return true;
          if (name === 'PRE') return true;
          if (cl && cl.contains('md-code-block')) return true;
          if (cl && cl.contains('admonition')) return true;
          if (/^(P|H[1-6]|LI|TD|TH)$/.test(name)) return true;
          if (/^(UL|OL|TABLE|BLOCKQUOTE)$/.test(name)) return true;
          return false;
        }

        var HEADING_RE = /^H[1-6]$/;

        function buildHeadingSectionRange(siblings, startIdx, endIdx) {
          var range = document.createRange();
          range.setStartBefore(siblings[startIdx]);
          range.setEndAfter(siblings[endIdx]);
          return range;
        }

        ea.addEventListener('keydown', function (e) {
          if (!(e.key === 'a' && (e.metaKey || e.ctrlKey))) return;
          if (wysiwygEditor.currentMode !== 'wysiwyg') return;
          var sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;

          var targetRanges = [];
          var node = sel.anchorNode;
          var r = sel.rangeCount ? sel.getRangeAt(0) : null;

          if (node === ea && r) {
            if (r.startContainer === ea) {
              for (var ri = r.startOffset; ri < ea.childNodes.length; ri++) {
                if (ea.childNodes[ri].nodeType === 1) { node = ea.childNodes[ri]; break; }
              }
            } else {
              node = r.startContainer;
            }
          } else if (node && node.nodeType === 3 && r && /^\s*$/.test(node.textContent)) {
            var sc = r.startContainer;
            if (sc === ea) {
              for (var ri = r.startOffset; ri < ea.childNodes.length; ri++) {
                if (ea.childNodes[ri].nodeType === 1) { node = ea.childNodes[ri]; break; }
              }
              if (!node || node.nodeType !== 1) {
                for (var ri = r.startOffset - 1; ri >= 0; ri--) {
                  if (ea.childNodes[ri].nodeType === 1) { node = ea.childNodes[ri]; break; }
                }
              }
            } else if (sc && sc.nodeType === 3) {
              node = sc.parentNode;
              if (node === ea) {
                var idx = -1;
                for (var i = 0; i < ea.childNodes.length; i++) {
                  if (ea.childNodes[i] === sc) { idx = i; break; }
                }
                if (idx >= 0) {
                  for (var ri = idx + 1; ri < ea.childNodes.length; ri++) {
                    if (ea.childNodes[ri].nodeType === 1) { node = ea.childNodes[ri]; break; }
                  }
                  if (!node || node.nodeType !== 1) {
                    for (var ri = idx - 1; ri >= 0; ri--) {
                      if (ea.childNodes[ri].nodeType === 1) { node = ea.childNodes[ri]; break; }
                    }
                  }
                }
              }
            } else if (sc && sc.nodeType === 1) {
              node = sc;
            }
          }

          var elCur = (node && node.nodeType === 3) ? node.parentNode : node;
          while (elCur && elCur !== ea) {
            if (isSelectableTarget(elCur)) {
              if (elCur.classList && elCur.classList.contains('admonition')) {
                var inTitle = false;
                var titleEl = elCur.querySelector('.admonition-title');
                var check = (node && node.nodeType === 3) ? node.parentNode : node;
                while (check && check !== elCur) {
                  if (check === titleEl) { inTitle = true; break; }
                  check = check.parentNode;
                }
                if (!inTitle) {
                  targetRanges.push(buildAdmonitionBodyRange(elCur));
                }
              }
              targetRanges.push(buildTargetRange(elCur));
            }
            elCur = elCur.parentNode;
          }

          var topChild = (node && node.nodeType === 3) ? node.parentNode : node;
          while (topChild && topChild !== ea && topChild.parentNode !== ea) {
            topChild = topChild.parentNode;
          }
          if (topChild && topChild.parentNode === ea) {
            var siblings = ea.childNodes;
            var topIdx = -1;
            for (var ti = 0; ti < siblings.length; ti++) {
              if (siblings[ti] === topChild) { topIdx = ti; break; }
            }
            if (topIdx >= 0) {
              if (topChild.nodeType === 1 && HEADING_RE.test(topChild.nodeName)) {
                var ownLevel = parseInt(topChild.nodeName.charAt(1));
                var ownEnd = siblings.length - 1;
                for (var oi = topIdx + 1; oi < siblings.length; oi++) {
                  var os = siblings[oi];
                  if (os.nodeType === 1 && HEADING_RE.test(os.nodeName) && parseInt(os.nodeName.charAt(1)) <= ownLevel) {
                    ownEnd = oi - 1;
                    break;
                  }
                }
                if (ownEnd >= topIdx + 1) {
                  targetRanges.push(buildHeadingSectionRange(siblings, topIdx, ownEnd));
                }
              }

              var curLevel = (topChild.nodeType === 1 && HEADING_RE.test(topChild.nodeName))
                ? parseInt(topChild.nodeName.charAt(1))
                : 7;

              for (var hi = topIdx - 1; hi >= 0; hi--) {
                var sib = siblings[hi];
                if (sib.nodeType !== 1 || !HEADING_RE.test(sib.nodeName)) continue;
                var hLevel = parseInt(sib.nodeName.charAt(1));
                if (hLevel >= curLevel) continue;
                var secStart = hi + 1;
                var secEnd = siblings.length - 1;
                for (var si = hi + 1; si < siblings.length; si++) {
                  var ss = siblings[si];
                  if (ss.nodeType === 1 && HEADING_RE.test(ss.nodeName) && parseInt(ss.nodeName.charAt(1)) <= hLevel) {
                    secEnd = si - 1;
                    break;
                  }
                }
                if (secStart <= secEnd) {
                  targetRanges.push(buildHeadingSectionRange(siblings, hi, secEnd));
                }
                curLevel = hLevel;
              }
            }
          }

          targetRanges.push(buildTargetRange(ea));

          for (var i = 0; i < targetRanges.length; i++) {
            if (!selectionCoversRange(sel, targetRanges[i])) {
              e.preventDefault();
              sel.removeAllRanges();
              sel.addRange(targetRanges[i]);
              return;
            }
          }
        });
      }
    })();

    (function blockCutPasteHandler() {
      var ea = wysiwygEditor.editableArea;
      if (!ea || ea.dataset.liveWysiwygBlockCutPasteAttached) return;
      ea.dataset.liveWysiwygBlockCutPasteAttached = '1';

      var BLOCK_ATTR = 'data-wysiwyg-block';

      function classifyBlock(node) {
        if (!node || node.nodeType !== 1) return null;
        var name = node.nodeName;
        var cl = node.classList;
        if (name === 'UL' || name === 'OL') return 'list';
        if (cl && cl.contains('admonition')) return 'admonition';
        if (name === 'DETAILS' && isAdmonitionElement(node)) return 'admonition';
        if (cl && cl.contains('md-code-block')) return 'codeblock';
        if (name === 'PRE') return 'codeblock';
        if (name === 'BLOCKQUOTE') return 'blockquote';
        return null;
      }

      function findSelectedBlock(sel) {
        if (!sel || !sel.rangeCount) return null;
        var node = sel.anchorNode;
        if (!node) return null;
        var el = (node.nodeType === 3) ? node.parentNode : node;
        var candidates = [];
        while (el && el !== ea) {
          var type = classifyBlock(el);
          if (type) {
            candidates.push({ node: el, type: type });
          }
          el = el.parentNode;
        }
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          var targetRange = _buildTargetRange(c.node);
          if (_selectionCoversRange(sel, targetRange)) {
            if (c.node.nodeName === 'PRE' && c.node.parentNode &&
                c.node.parentNode.classList && c.node.parentNode.classList.contains('md-code-block')) {
              return { node: c.node.parentNode, type: 'codeblock' };
            }
            return c;
          }
        }
        return null;
      }

      function isEmptyContainer(container) {
        var text = (container.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
        if (text.length > 0) return false;
        if (container.querySelector('pre, .md-code-block, .admonition, details, img, table, blockquote, ul, ol')) return false;
        return true;
      }

      function insertPlaceholder(parent) {
        var p = document.createElement('p');
        p.innerHTML = '&#8203;';
        parent.appendChild(p);
        var sel = window.getSelection();
        if (sel) {
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }

      function stripCodeUIFromClone(clone) {
        var uis = clone.querySelectorAll('.md-code-lang-btn, .md-code-lang-btn-advanced, .md-code-lang-dropdown, .md-code-settings-btn, .md-code-settings-btn-advanced, .md-code-settings-dropdown, .md-admonition-settings-btn');
        for (var i = uis.length - 1; i >= 0; i--) {
          uis[i].parentNode.removeChild(uis[i]);
        }
        return clone;
      }

      ea.addEventListener('cut', function (e) {
        if (wysiwygEditor.currentMode !== 'wysiwyg') return;
        var sel = window.getSelection();
        var block = findSelectedBlock(sel);
        if (!block) return;

        e.preventDefault();

        var clone = block.node.cloneNode(true);
        stripCodeUIFromClone(clone);

        var wrapperHtml = '<div ' + BLOCK_ATTR + '="' + block.type + '">' + clone.outerHTML + '</div>';
        e.clipboardData.setData('text/html', wrapperHtml);

        var tempDiv = document.createElement('div');
        tempDiv.appendChild(clone.cloneNode(true));
        var plainText = '';
        try {
          plainText = wysiwygEditor._htmlToMarkdown(tempDiv);
        } catch (ex) {
          plainText = block.node.textContent || '';
        }
        e.clipboardData.setData('text/plain', plainText);

        var parent = block.node.parentNode;
        parent.removeChild(block.node);

        if (isEmptyContainer(parent)) {
          if (parent === ea) {
            insertPlaceholder(ea);
          } else if (isAdmonitionElement(parent)) {
            var titleEl = (parent.nodeName === 'DETAILS')
              ? parent.querySelector(':scope > summary')
              : parent.querySelector(':scope > .admonition-title');
            var gearBtn = parent.querySelector(':scope > .md-admonition-settings-btn');
            var hasOtherContent = false;
            for (var ci = 0; ci < parent.childNodes.length; ci++) {
              var cn = parent.childNodes[ci];
              if (cn === titleEl || cn === gearBtn) continue;
              if (cn.nodeType === 3 && !cn.textContent.replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '')) continue;
              hasOtherContent = true;
              break;
            }
            if (!hasOtherContent) {
              var bp = document.createElement('p');
              bp.innerHTML = '&#8203;';
              parent.appendChild(bp);
            }
          } else if (parent.nodeName === 'BLOCKQUOTE' || parent.nodeName === 'LI') {
            var bp = document.createElement('p');
            bp.innerHTML = '&#8203;';
            parent.appendChild(bp);
          }
        }

        if (wysiwygEditor._finalizeUpdate) {
          wysiwygEditor._finalizeUpdate(ea.innerHTML);
        }
      }, true);

      function findPasteContext(sel) {
        if (!sel || !sel.rangeCount) return { type: 'toplevel', container: ea, targetBlock: null };
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        var el = (node.nodeType === 3) ? node.parentNode : node;

        if (el === ea && range.startOffset < ea.childNodes.length) {
          var child = ea.childNodes[range.startOffset];
          if (child && child.nodeType === 1) {
            el = child;
          }
        }

        var ctx = { type: 'toplevel', container: ea, targetBlock: null, li: null, admonition: null, blockquote: null };

        var cur = el;
        while (cur && cur !== ea) {
          if (cur.nodeName === 'LI' && !ctx.li) {
            ctx.li = cur;
            ctx.type = 'list-item';
          }
          if (!ctx.admonition && isAdmonitionElement(cur)) {
            ctx.admonition = cur;
            if (ctx.type === 'toplevel') ctx.type = 'admonition';
          }
          if (cur.nodeName === 'BLOCKQUOTE' && !ctx.blockquote) {
            ctx.blockquote = cur;
            if (ctx.type === 'toplevel') ctx.type = 'blockquote';
          }
          cur = cur.parentNode;
        }

        var inner = el;
        var contextParent = null;
        if (ctx.type === 'list-item') contextParent = ctx.li;
        else if (ctx.type === 'admonition') contextParent = ctx.admonition;
        else if (ctx.type === 'blockquote') contextParent = ctx.blockquote;
        else contextParent = ea;

        while (inner && inner !== contextParent && inner.parentNode !== contextParent) {
          inner = inner.parentNode;
        }
        if (inner && inner !== contextParent && inner.parentNode === contextParent) {
          ctx.targetBlock = inner;
        }

        ctx.container = contextParent;
        return ctx;
      }

      function isEmptyParagraph(node) {
        if (!node || node.nodeName !== 'P') return false;
        var text = (node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
        return text.length === 0 && !node.querySelector('img, pre, .md-code-block, .admonition, details, table, blockquote, ul, ol');
      }

      function insertBlockAfterTarget(block, ctx) {
        var target = ctx.targetBlock;
        var container = ctx.container;
        if (target && isEmptyParagraph(target)) {
          container.insertBefore(block, target);
          container.removeChild(target);
        } else if (target && target.parentNode === container) {
          container.insertBefore(block, target.nextSibling);
        } else {
          container.appendChild(block);
        }
      }

      function isEmptyListItem(li) {
        var text = (li.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF\s]/g, '');
        if (text.length > 0) return false;
        if (li.querySelector('img, pre, .md-code-block, .admonition, table, blockquote, ul, ol')) return false;
        return true;
      }

      function pasteList(listEl, ctx) {
        if (ctx.type === 'list-item') {
          var parentList = ctx.li.parentNode;
          if (!parentList || (parentList.nodeName !== 'UL' && parentList.nodeName !== 'OL')) {
            insertBlockAfterTarget(listEl, ctx);
            return;
          }
          var liWasEmpty = isEmptyListItem(ctx.li);
          if (liWasEmpty) {
            var liCount = 0;
            for (var ci = 0; ci < parentList.childNodes.length; ci++) {
              if (parentList.childNodes[ci].nodeName === 'LI') liCount++;
            }
            if (liCount === 1) {
              parentList.parentNode.insertBefore(listEl, parentList);
              parentList.parentNode.removeChild(parentList);
              return;
            }
          }
          var items = [];
          while (listEl.firstChild) {
            if (listEl.firstChild.nodeName === 'LI') {
              items.push(listEl.firstChild);
            }
            listEl.removeChild(listEl.firstChild);
          }
          var ref = ctx.li.nextSibling;
          for (var i = 0; i < items.length; i++) {
            parentList.insertBefore(items[i], ref);
          }
          if (liWasEmpty && ctx.li.parentNode) {
            ctx.li.parentNode.removeChild(ctx.li);
          }
        } else {
          insertBlockAfterTarget(listEl, ctx);
        }
      }

      function pasteAdmonition(adEl, ctx) {
        if (ctx.type === 'list-item') {
          var topBlock = ctx.li;
          while (topBlock && topBlock.parentNode !== ea) topBlock = topBlock.parentNode;
          if (topBlock && topBlock.parentNode === ea) {
            ea.insertBefore(adEl, topBlock.nextSibling);
          } else {
            ea.appendChild(adEl);
          }
        } else if (ctx.type === 'admonition') {
          insertBlockAfterTarget(adEl, ctx);
        } else if (ctx.type === 'blockquote') {
          insertBlockAfterTarget(adEl, ctx);
        } else {
          insertBlockAfterTarget(adEl, ctx);
        }
      }

      function pasteCodeblock(blockEl, ctx) {
        if (ctx.type === 'list-item') {
          var target = ctx.targetBlock;
          if (target && target.parentNode === ctx.li) {
            ctx.li.insertBefore(blockEl, target.nextSibling);
          } else {
            ctx.li.appendChild(blockEl);
          }
        } else {
          insertBlockAfterTarget(blockEl, ctx);
        }
      }

      function pasteBlockquote(bqEl, ctx) {
        if (ctx.type === 'list-item') {
          var target = ctx.targetBlock;
          if (target && target.parentNode === ctx.li) {
            ctx.li.insertBefore(bqEl, target.nextSibling);
          } else {
            ctx.li.appendChild(bqEl);
          }
        } else if (ctx.type === 'admonition') {
          insertBlockAfterTarget(bqEl, ctx);
        } else {
          insertBlockAfterTarget(bqEl, ctx);
        }
      }

      function focusInsidePastedBlock(blockType, blockEl) {
        var sel = window.getSelection();
        if (!sel) return;
        var rng = document.createRange();
        var target = null;

        if (blockType === 'list') {
          var lastLi = null;
          for (var i = blockEl.children.length - 1; i >= 0; i--) {
            if (blockEl.children[i].nodeName === 'LI') { lastLi = blockEl.children[i]; break; }
          }
          if (lastLi) {
            var deepest = lastLi;
            for (;;) {
              var nestedList = null;
              for (var j = deepest.children.length - 1; j >= 0; j--) {
                if (deepest.children[j].nodeName === 'UL' || deepest.children[j].nodeName === 'OL') {
                  nestedList = deepest.children[j];
                  break;
                }
              }
              if (nestedList) {
                var nestedLi = null;
                for (var k = nestedList.children.length - 1; k >= 0; k--) {
                  if (nestedList.children[k].nodeName === 'LI') { nestedLi = nestedList.children[k]; break; }
                }
                if (nestedLi) { deepest = nestedLi; } else break;
              } else break;
            }
            target = deepest;
          }
        } else if (blockType === 'admonition') {
          var bodyEl = null;
          for (var i = blockEl.childNodes.length - 1; i >= 0; i--) {
            var cn = blockEl.childNodes[i];
            if (cn.nodeType === 1 && !(cn.classList && cn.classList.contains('admonition-title'))) {
              bodyEl = cn;
              break;
            }
          }
          target = bodyEl || blockEl;
        } else if (blockType === 'codeblock') {
          var pre = blockEl.nodeName === 'PRE' ? blockEl : blockEl.querySelector('pre');
          if (pre) {
            var code = pre.querySelector('code');
            var textNode = code ? code.firstChild : pre.firstChild;
            if (textNode && textNode.nodeType === 3) {
              rng.setStart(textNode, textNode.textContent.length);
              rng.collapse(true);
              sel.removeAllRanges();
              sel.addRange(rng);
              return;
            }
          }
          target = pre || blockEl;
        } else if (blockType === 'blockquote') {
          var lastChild = null;
          for (var i = blockEl.childNodes.length - 1; i >= 0; i--) {
            if (blockEl.childNodes[i].nodeType === 1) { lastChild = blockEl.childNodes[i]; break; }
          }
          target = lastChild || blockEl;
        }

        if (target) {
          rng.selectNodeContents(target);
          rng.collapse(false);
          sel.removeAllRanges();
          sel.addRange(rng);
        }
      }

      function focusInsidePastedListItems(items) {
        if (!items || items.length === 0) return;
        var lastItem = items[items.length - 1];
        var deepest = lastItem;
        for (;;) {
          var nestedList = null;
          for (var j = deepest.children.length - 1; j >= 0; j--) {
            if (deepest.children[j].nodeName === 'UL' || deepest.children[j].nodeName === 'OL') {
              nestedList = deepest.children[j];
              break;
            }
          }
          if (nestedList) {
            var nestedLi = null;
            for (var k = nestedList.children.length - 1; k >= 0; k--) {
              if (nestedList.children[k].nodeName === 'LI') { nestedLi = nestedList.children[k]; break; }
            }
            if (nestedLi) { deepest = nestedLi; } else break;
          } else break;
        }
        var sel = window.getSelection();
        if (sel) {
          var rng = document.createRange();
          rng.selectNodeContents(deepest);
          rng.collapse(false);
          sel.removeAllRanges();
          sel.addRange(rng);
        }
      }

      ea.addEventListener('paste', function (e) {
        if (wysiwygEditor.currentMode !== 'wysiwyg') return;
        var clipHtml = (e.clipboardData || window.clipboardData).getData('text/html');
        if (!clipHtml) return;

        var temp = document.createElement('div');
        temp.innerHTML = clipHtml;
        var wrapper = temp.querySelector('[' + BLOCK_ATTR + ']');
        if (!wrapper) return;

        var blockType = wrapper.getAttribute(BLOCK_ATTR);
        if (!blockType) return;

        var blockContent = wrapper.firstElementChild;
        if (!blockContent) return;

        e.preventDefault();

        var sel = window.getSelection();
        var ctx = findPasteContext(sel);

        switch (blockType) {
          case 'list':
            var pastedItems = [];
            for (var pi = 0; pi < blockContent.children.length; pi++) {
              if (blockContent.children[pi].nodeName === 'LI') pastedItems.push(blockContent.children[pi]);
            }
            pasteList(blockContent, ctx);
            if (blockContent.parentNode) {
              focusInsidePastedBlock('list', blockContent);
            } else if (pastedItems.length > 0) {
              focusInsidePastedListItems(pastedItems);
            }
            break;
          case 'admonition':
            blockContent.setAttribute('contenteditable', 'true');
            pasteAdmonition(blockContent, ctx);
            enhanceAdmonitions(ea);
            focusInsidePastedBlock('admonition', blockContent);
            break;
          case 'codeblock':
            pasteCodeblock(blockContent, ctx);
            enhanceBasicPreBlocks(ea);
            enhanceCodeBlocks(ea);
            enhanceAdmonitions(ea);
            focusInsidePastedBlock('codeblock', blockContent);
            break;
          case 'blockquote':
            pasteBlockquote(blockContent, ctx);
            focusInsidePastedBlock('blockquote', blockContent);
            break;
        }

        if (wysiwygEditor._finalizeUpdate) {
          wysiwygEditor._finalizeUpdate(ea.innerHTML);
        }
      }, true);
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

    (function attachCtrlSSave() {
      if (document.__liveWysiwygCtrlSAttached) return;
      document.__liveWysiwygCtrlSAttached = true;
      document.addEventListener('keydown', function (e) {
        if (!((e.metaKey || e.ctrlKey) && e.key === 's')) return;
        if (!wysiwygEditor) return;
        var ea = wysiwygEditor.editableArea;
        var ma = wysiwygEditor.markdownArea;
        var activeEl = document.activeElement;
        var isInEditor = (ea && ea.contains(activeEl)) || activeEl === ea ||
                         (ma && (activeEl === ma || ma.contains(activeEl)));
        if (!isInEditor) return;
        e.preventDefault();
        if (wysiwygEditor._finalizeUpdate) {
          if (wysiwygEditor.currentMode === 'wysiwyg' && ea) {
            wysiwygEditor._finalizeUpdate(ea.innerHTML);
          } else if (wysiwygEditor.currentMode === 'markdown' && ma) {
            wysiwygEditor._finalizeUpdate(ma.value);
          }
        }
        var saveBtn = document.querySelector('.live-edit-save-button');
        if (saveBtn && !saveBtn.disabled) {
          saveBtn.click();
        }
      });
    })();

    if (wysiwygEditor) {
      wysiwygEditor.switchToMode(preferredMode, true);
      var appliedReadModeSelection = readonly_to_edit_mode_text_selection(wysiwygEditor);
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
              focusCursorAtDocStart(ea);
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
