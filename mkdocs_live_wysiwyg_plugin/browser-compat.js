/**
 * Browser Compatibility Layer for mkdocs-live-wysiwyg-plugin.
 *
 * Centralizes all browser-specific detection, command execution normalization,
 * composition guards, clipboard abstraction, location guard, range utilities,
 * and fullscreen helpers. Loaded before vendor/editor.js and the integration
 * script so that the global document.execCommand patch is in place before any
 * consumer calls it.
 *
 * Exposes window.LiveWysiwygCompat for the integration IIFE to capture as a
 * local reference (var _compat = window.LiveWysiwygCompat).
 */
(function () {
  'use strict';

  // ── Engine Detection (feature-based, no userAgent sniffing) ──────────

  var _engine = 'unknown';
  var _docStyle = document.documentElement.style;

  if (typeof CSS !== 'undefined' && CSS.supports) {
    if (CSS.supports('-moz-appearance', 'none') || 'MozBoxSizing' in _docStyle) {
      _engine = 'gecko';
    } else if (!!window.chrome || (CSS.supports('selector(:is(*))') && !CSS.supports('-moz-appearance', 'none') && !('webkitLineBreak' in _docStyle))) {
      _engine = 'blink';
    } else if ('webkitLineBreak' in _docStyle) {
      _engine = 'webkit';
    }
  } else {
    if ('MozBoxSizing' in _docStyle) {
      _engine = 'gecko';
    } else if ('webkitLineBreak' in _docStyle) {
      _engine = !!window.chrome ? 'blink' : 'webkit';
    }
  }

  // ── Platform Detection ───────────────────────────────────────────────

  var _nav = navigator.platform || '';
  var _platform = /Mac|iPhone|iPad|iPod/.test(_nav) ? 'mac'
    : /Win/.test(_nav) ? 'windows' : 'linux';

  // ── execCommand Wrapper ──────────────────────────────────────────────
  //
  // Saves the native execCommand, patches document.execCommand globally
  // so vendor/editor.js calls automatically route through normalization.

  var _nativeExec = document.execCommand.bind(document);

  function _normalizeTagName(parent, oldTag, newTag) {
    if (!parent) return;
    var els = parent.getElementsByTagName(oldTag);
    var arr = [];
    for (var i = 0; i < els.length; i++) arr.push(els[i]);
    if (arr.length === 0) return;

    var sel = window.getSelection();
    var saved = null;
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      saved = {
        sc: r.startContainer, so: r.startOffset,
        ec: r.endContainer, eo: r.endOffset
      };
    }

    for (var j = 0; j < arr.length; j++) {
      var el = arr[j];
      var replacement = document.createElement(newTag);
      while (el.firstChild) replacement.appendChild(el.firstChild);
      for (var k = 0; k < el.attributes.length; k++) {
        replacement.setAttribute(el.attributes[k].name, el.attributes[k].value);
      }
      el.parentNode.replaceChild(replacement, el);
    }

    if (saved) {
      try {
        var nr = document.createRange();
        nr.setStart(saved.sc, saved.so);
        nr.setEnd(saved.ec, saved.eo);
        sel.removeAllRanges();
        sel.addRange(nr);
      } catch (ex) { /* nodes invalidated — accept selection loss */ }
    }
  }

  function _getEditableAncestor() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var node = sel.anchorNode;
    while (node) {
      if (node.nodeType === 1 && node.getAttribute('contenteditable') === 'true') return node;
      node = node.parentNode;
    }
    return null;
  }

  function exec(command, showUI, value) {
    if (showUI === undefined) showUI = false;

    // Gecko: formatBlock requires angle brackets around the tag name
    if (_engine === 'gecko' && command === 'formatBlock' && value && value.charAt(0) !== '<') {
      value = '<' + value + '>';
    }

    var result = _nativeExec(command, showUI, value);

    // Gecko: bold may produce <b> instead of <strong>; italic may produce
    // <i> instead of <em>. Normalize to the tags the HTML-to-Markdown
    // converter expects.
    if (_engine === 'gecko') {
      if (command === 'bold') {
        var ea = _getEditableAncestor();
        if (ea) _normalizeTagName(ea, 'b', 'strong');
      } else if (command === 'italic') {
        var ea2 = _getEditableAncestor();
        if (ea2) _normalizeTagName(ea2, 'i', 'em');
      }
    }

    return result;
  }

  document.execCommand = function (command, showUI, value) {
    return exec(command, showUI, value);
  };

  // ── queryCommandState Wrapper ────────────────────────────────────────
  //
  // Gecko can report false for bold/italic at element boundaries where
  // Blink reports true. The fallback walks up from the anchor node.

  var _nativeQueryState = document.queryCommandState.bind(document);

  var _stateTagMap = {
    bold: { STRONG: true, B: true },
    italic: { EM: true, I: true },
    strikeThrough: { STRIKE: true, S: true, DEL: true }
  };

  function queryCommandState(command) {
    var native = _nativeQueryState(command);
    if (native) return true;

    if (_engine === 'gecko' && _stateTagMap[command]) {
      var tags = _stateTagMap[command];
      var sel = window.getSelection();
      if (sel && sel.anchorNode) {
        var node = sel.anchorNode;
        if (node.nodeType === 3) node = node.parentNode;
        while (node && node.nodeType === 1) {
          if (node.getAttribute('contenteditable') === 'true') break;
          if (tags[node.nodeName]) return true;
          node = node.parentNode;
        }
      }
    }
    return false;
  }

  document.queryCommandState = function (command) {
    return queryCommandState(command);
  };

  // ── Composition Guard ────────────────────────────────────────────────

  function isComposing(e) {
    return e.isComposing === true || e.keyCode === 229;
  }

  // ── Keyboard Helpers ─────────────────────────────────────────────────

  function isModifierCombo(e) {
    return e.metaKey || e.ctrlKey;
  }

  function isPrintableKey(e) {
    if (isComposing(e)) return false;
    if (e.key === 'Dead' || e.key === 'Process') return false;
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }

  // ── Clipboard Normalization ──────────────────────────────────────────

  var _cachedClipboardText = null;

  function readClipboardText() {
    if (_cachedClipboardText !== null) {
      var cached = _cachedClipboardText;
      _cachedClipboardText = null;
      return Promise.resolve(cached);
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        return navigator.clipboard.readText().catch(function () { return ''; });
      } catch (e) {
        return Promise.resolve('');
      }
    }
    return Promise.resolve('');
  }

  /**
   * Pre-read clipboard text synchronously during a user gesture so that
   * Safari does not reject the async read inside a requestAnimationFrame.
   * Call this at the top of a click handler; the cached value is consumed
   * by the next readClipboardText() call.
   */
  function cacheClipboardForGesture() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        navigator.clipboard.readText()
          .then(function (t) { _cachedClipboardText = t; })
          .catch(function () { _cachedClipboardText = ''; });
      } catch (e) { _cachedClipboardText = ''; }
    }
  }

  function getClipboardData(e, type) {
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return '';
    try { return cd.getData(type || 'text') || ''; }
    catch (err) { return ''; }
  }

  function setClipboardData(e, type, data) {
    if (!e.clipboardData) return;
    try { e.clipboardData.setData(type, data); }
    catch (err) { /* untrusted event or restricted context */ }
  }

  function writeClipboardText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        return navigator.clipboard.writeText(text).then(function () { return true; })
          .catch(function () { return false; });
      } catch (e) { return Promise.resolve(false); }
    }
    return Promise.resolve(false);
  }

  // ── Location Guard ───────────────────────────────────────────────────
  //
  // Centralizes the Object.defineProperty(location, ...) try/catch pattern
  // used by both _installReloadGuard and _installFocusModeGuard.

  var _locGuardInstalled = false;
  var _locGuardCallbacks = [];

  var _origReload = null;
  var _origAssign = null;
  var _origReplace = null;
  var _origHrefDesc = null;

  function _shouldSuppress() {
    for (var i = 0; i < _locGuardCallbacks.length; i++) {
      var result = _locGuardCallbacks[i].check();
      if (result) return result;
    }
    return null;
  }

  function _installLocationPatches() {
    if (_locGuardInstalled) return;
    _locGuardInstalled = true;

    try {
      _origReload = location.reload.bind(location);
      Object.defineProperty(location, 'reload', {
        configurable: true,
        value: function () {
          var cb = _shouldSuppress();
          if (cb) { if (cb.onIntercept) cb.onIntercept(); return; }
          return _origReload();
        }
      });
    } catch (e) { _origReload = null; }

    try {
      _origAssign = location.assign.bind(location);
      Object.defineProperty(location, 'assign', {
        configurable: true,
        value: function (url) {
          var cb = _shouldSuppress();
          if (cb) { if (cb.onIntercept) cb.onIntercept(); return; }
          return _origAssign(url);
        }
      });
    } catch (e) { _origAssign = null; }

    try {
      _origReplace = location.replace.bind(location);
      Object.defineProperty(location, 'replace', {
        configurable: true,
        value: function (url) {
          var cb = _shouldSuppress();
          if (cb) { if (cb.onIntercept) cb.onIntercept(); return; }
          return _origReplace(url);
        }
      });
    } catch (e) { _origReplace = null; }

    try {
      _origHrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href') ||
        Object.getOwnPropertyDescriptor(location, 'href');
      if (_origHrefDesc && _origHrefDesc.set) {
        Object.defineProperty(location, 'href', {
          configurable: true,
          get: _origHrefDesc.get ? _origHrefDesc.get.bind(location) : function () { return location.toString(); },
          set: function (v) {
            var cb = _shouldSuppress();
            if (cb) { if (cb.onIntercept) cb.onIntercept(); return; }
            _origHrefDesc.set.call(location, v);
          }
        });
      }
    } catch (e) { _origHrefDesc = null; }
  }

  function _removeLocationPatches() {
    if (!_locGuardInstalled) return;
    if (_locGuardCallbacks.length > 0) return;
    _locGuardInstalled = false;

    if (_origReload) {
      try { Object.defineProperty(location, 'reload', { configurable: true, value: _origReload }); } catch (e) { }
      _origReload = null;
    }
    if (_origAssign) {
      try { Object.defineProperty(location, 'assign', { configurable: true, value: _origAssign }); } catch (e) { }
      _origAssign = null;
    }
    if (_origReplace) {
      try { Object.defineProperty(location, 'replace', { configurable: true, value: _origReplace }); } catch (e) { }
      _origReplace = null;
    }
    if (_origHrefDesc) {
      try { Object.defineProperty(location, 'href', _origHrefDesc); } catch (e) { }
      _origHrefDesc = null;
    }
  }

  /**
   * Register a location guard.
   *
   * @param {Object} opts
   * @param {string} opts.id - Unique identifier (e.g. 'reload-guard', 'focus-mode')
   * @param {Function} opts.isActive - Returns truthy when this guard should suppress navigation
   * @param {Function} [opts.onIntercept] - Called when navigation is intercepted while active
   * @returns {{ remove: Function }} Handle to unregister this guard
   */
  function installLocationGuard(opts) {
    _installLocationPatches();
    var entry = {
      id: opts.id,
      check: function () {
        return opts.isActive() ? { onIntercept: opts.onIntercept || null } : null;
      }
    };
    _locGuardCallbacks.push(entry);
    return {
      remove: function () {
        for (var i = _locGuardCallbacks.length - 1; i >= 0; i--) {
          if (_locGuardCallbacks[i] === entry) { _locGuardCallbacks.splice(i, 1); break; }
        }
        _removeLocationPatches();
      }
    };
  }

  // ── Range Utilities ──────────────────────────────────────────────────

  function getRangeRect(range) {
    var rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0 || !range.collapsed)) {
      return rect;
    }
    var span = document.createElement('span');
    span.textContent = '\u200B';
    try {
      range.insertNode(span);
      rect = span.getBoundingClientRect();
      var parent = span.parentNode;
      parent.removeChild(span);
      parent.normalize();
    } catch (e) {
      rect = range.getBoundingClientRect();
    }
    return rect;
  }

  // ── Caret Position from Point ───────────────────────────────────────

  function caretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      var range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    return null;
  }

  // ── Fullscreen Helpers ───────────────────────────────────────────────

  var _fullscreenEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'];

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || null;
  }

  // ── Public API ───────────────────────────────────────────────────────

  window.LiveWysiwygCompat = {
    engine: _engine,
    platform: _platform,

    exec: exec,
    nativeExec: _nativeExec,
    queryCommandState: queryCommandState,
    nativeQueryCommandState: _nativeQueryState,

    isComposing: isComposing,
    isModifierCombo: isModifierCombo,
    isPrintableKey: isPrintableKey,

    readClipboardText: readClipboardText,
    writeClipboardText: writeClipboardText,
    cacheClipboardForGesture: cacheClipboardForGesture,
    getClipboardData: getClipboardData,
    setClipboardData: setClipboardData,

    installLocationGuard: installLocationGuard,

    getRangeRect: getRangeRect,
    caretRangeFromPoint: caretRangeFromPoint,

    fullscreenElement: fullscreenElement,
    fullscreenEvents: _fullscreenEvents
  };
})();
