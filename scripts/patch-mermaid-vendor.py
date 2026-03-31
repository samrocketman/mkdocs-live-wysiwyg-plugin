#!/usr/bin/env python3
"""Apply vendor patches to the mermaid-live-editor built output.

This script modifies the SvelteKit adapter-static output so the editor
works correctly when served from an arbitrary sub-path (e.g. /mermaid-editor/)
inside an iframe with no network access.

Run after building the SvelteKit app and BEFORE copying to vendor/:
    python3 scripts/patch-mermaid-vendor.py <build-dir>

Or run directly on the vendored copy:
    python3 scripts/patch-mermaid-vendor.py mkdocs_live_wysiwyg_plugin/vendor/mermaid-live-editor

Patches are idempotent — running twice produces identical output.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

BRIDGE_SCRIPT = r'''<script>
(function(){
  /* ===================================================================
   * PostMessage Bridge + Keyboard Isolation Layer
   *
   * Injected by patch P1 into edit.html and index.html.  Six services:
   *
   * 1. CONTENT SYNC — reads editor content from the mermaid-live-editor's
   *    localStorage ("codeStore" key) and PUTs it to the API server's
   *    mermaid session endpoint.  The parent GETs from the same endpoint.
   *    No postMessage content, no cross-origin DOM access.
   *
   * 2. KEYBOARD ISOLATION — intercepts ESC, Ctrl+S, Ctrl+. at capture
   *    phase.  See DESIGN-centralized-keyboard.md § Mermaid Mode.
   *
   * 3. SVG LOAD MONITOR — polls for the rendered SVG in #container to
   *    confirm initial diagram load.  Reloads the iframe on timeout.
   *    See DESIGN-mermaid-diagram-selection.md § Initial SVG Load Monitor.
   *
   * 4. DIAGRAM SELECTION — attaches click handlers to SVG text elements
   *    (node labels + edge labels) that select the corresponding text in
   *    the Monaco editor and scroll it into view.
   *    See DESIGN-mermaid-diagram-selection.md.
   *
   * Sentinel: live-wysiwyg-mermaid-init (used by patch idempotency check)
   *
   * 5. LINK INTERCEPT + MENU CLEANUP — intercepts all <a> clicks,
   *    blocks internal links (New, Duplicate), and forwards allowed
   *    external URLs to the parent via postMessage for opening in a
   *    new tab.  Uses a domain allow-list for security.
   *
   * 6. AMD GLOBAL SHIM — defines window.define.amd before Monaco loads
   *    so that Monaco's conditional (typeof define==="function"&&define.amd)
   *    evaluates to true and sets globalThis.monaco.  This gives the bridge
   *    access to monaco.editor.getEditors() for editor instance discovery.
   *    See DESIGN-monaco-subsystem.md § AMD Global Shim.
   *
   * P8 (preventDefault override) neutralizes vendor preventDefault()
   * for parent-controlled shortcut keys as a defensive layer.
   * =================================================================== */

  var _hideAiStyle = document.createElement("style");
  _hideAiStyle.textContent =
    ".button-container-for-animation { display: none !important; }" +
    "[monaco-view-zone] { display: none !important; }" +
    ".cgmr.suggestion-icon { display: none !important; }";
  document.head.appendChild(_hideAiStyle);

  if (typeof window.define !== "function") {
    window.define = function() {};
    window.define.amd = true;
  }

  var _origPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function() {
    if (this instanceof KeyboardEvent) {
      if (this.key === "Escape" ||
          ((this.ctrlKey || this.metaKey) && (this.key === "s" || this.key === "."))) {
        return;
      }
    }
    return _origPreventDefault.call(this);
  };

  var _sessionId = (function() {
    var m = window.location.search.match(/[?&]session=([^&#]+)/);
    return m ? m[1] : "";
  })();
  var _apiBase = window.location.origin;

  function _readEditorCode() {
    try {
      var raw = localStorage.getItem("codeStore");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.code === "string" && parsed.code) return parsed.code;
      }
    } catch(ex) {}
    try {
      var lines = document.querySelectorAll(".view-lines .view-line");
      if (lines.length > 0) {
        var parts = [];
        for (var i = 0; i < lines.length; i++) parts.push(lines[i].textContent);
        var text = parts.join("\n");
        if (text.trim()) return text;
      }
    } catch(ex) {}
    return "";
  }

  function _putSession(code) {
    if (!_sessionId) return;
    try {
      fetch(_apiBase + "/mermaid-session/" + _sessionId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      }).catch(function() {});
    } catch(ex) {}
  }

  var _lastSentCode = "";
  setInterval(function() {
    var code = _readEditorCode();
    if (code && code !== _lastSentCode) {
      _lastSentCode = code;
      _putSession(code);
    }
  }, 1000);

  function _isActuallyVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }
  function _hasVisibleOverlay() {
    var selectors = [
      ".suggest-widget:not(.hidden)",
      ".cm-tooltip",
      ".context-view",
      ".monaco-hover",
      ".find-widget.visible",
      ".parameter-hints-widget.visible",
      ".monaco-dialog-box",
      ".rename-box",
      ".monaco-menu",
      ".quick-input-widget",
      "[data-dialog-content]",
      "[data-popover-content]"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && _isActuallyVisible(el)) return true;
    }
    var shadowHosts = document.querySelectorAll(".shadow-root-host");
    for (var s = 0; s < shadowHosts.length; s++) {
      var sr = shadowHosts[s].shadowRoot;
      if (!sr) continue;
      for (var j = 0; j < selectors.length; j++) {
        var shadowEl = sr.querySelector(selectors[j]);
        if (shadowEl && _isActuallyVisible(shadowEl)) return true;
      }
    }
    return false;
  }

  function _closeAndSignal(save) {
    var code = _readEditorCode();
    _putSession(code);
    var msg = { type: "live-wysiwyg-mermaid-close" };
    if (save) msg.save = true;
    try { window.parent.postMessage(msg, "*"); } catch(ex) {}
  }

  window.addEventListener("message", function(evt) {
    var data = evt.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "live-wysiwyg-mermaid-request-close") {
      _closeAndSignal(data.save);
    }
  });

  function _hasMultipleCursors() {
    var cursors = document.querySelectorAll(".cursors-layer .cursor");
    var visible = 0;
    for (var i = 0; i < cursors.length; i++) {
      if (cursors[i].offsetWidth > 0 || cursors[i].offsetHeight > 0) visible++;
    }
    return visible > 1;
  }

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      if (_hasVisibleOverlay() || _hasMultipleCursors()) return;
      _closeAndSignal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.stopImmediatePropagation();
      _closeAndSignal(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ".") {
      e.stopImmediatePropagation();
      return;
    }
  }, true);

  /* --- Link Intercept + Menu Cleanup (service 6) --- */

  var _allowedLinkDomains = [
    "discord.com",
    "discord.gg",
    "github.com",
    "mermaid.js.org"
  ];

  var _hiddenMenuLabels = ["New", "Duplicate"];

  function _isAllowedUrl(href) {
    try {
      var u = new URL(href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      for (var i = 0; i < _allowedLinkDomains.length; i++) {
        var d = _allowedLinkDomains[i];
        if (u.hostname === d || u.hostname.endsWith("." + d)) return true;
      }
    } catch(ex) {}
    return false;
  }

  function _resolveHref(link) {
    if (link.href && typeof link.href === "string") return link.href;
    if (link.href && link.href.baseVal) return link.href.baseVal;
    var h = link.getAttribute("href") || link.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    return h || "";
  }

  document.addEventListener("click", function(e) {
    var link = e.target.closest ? (e.target.closest("a[href]") || e.target.closest("a")) : null;
    if (!link) return;
    var href = _resolveHref(link);
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (_isAllowedUrl(href)) {
      try {
        window.parent.postMessage({
          type: "live-wysiwyg-open-url",
          url: href
        }, "*");
      } catch(ex) {}
    }
  }, true);

  function _cleanupMenu(popover) {
    var links = popover.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      var text = (links[i].textContent || "").trim();
      for (var h = 0; h < _hiddenMenuLabels.length; h++) {
        if (text === _hiddenMenuLabels[h]) {
          links[i].style.display = "none";
          break;
        }
      }
    }
  }

  var _menuObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute && node.hasAttribute("data-popover-content")) {
          _cleanupMenu(node);
        }
        var inner = node.querySelectorAll ? node.querySelectorAll("[data-popover-content]") : [];
        for (var k = 0; k < inner.length; k++) _cleanupMenu(inner[k]);
      }
    }
  });
  _menuObserver.observe(document.documentElement, { childList: true, subtree: true });

  function _cleanupPrivacyDialog(dialog) {
    var paragraphs = dialog.querySelectorAll("p");
    for (var i = 0; i < paragraphs.length; i++) {
      var text = (paragraphs[i].textContent || "").trim();
      if (text.indexOf("No privacy policy") === 0) {
        paragraphs[i].textContent = "This is a custom Mermaid Live Editor built for mkdocs-live-wysiwyg plugin.";
        var pFeature = document.createElement("p");
        pFeature.textContent = "Exclusive to this editor: There's a new feature added which allows you to click on diagram elements.";
        paragraphs[i].parentNode.insertBefore(pFeature, paragraphs[i].nextSibling);
        var ul = document.createElement("ul");
        var li1 = document.createElement("li");
        li1.textContent = "Clicking elements will select text in the editor.";
        ul.appendChild(li1);
        var li2 = document.createElement("li");
        li2.textContent = "The default layout has also been changed specifically for mkdocs-live-wysiwyg.";
        ul.appendChild(li2);
        pFeature.parentNode.insertBefore(ul, pFeature.nextSibling);
        var pSelfHosted = document.createElement("p");
        pSelfHosted.textContent = "This is a self-hosted instance (on your computer) of Mermaid Live Editor with no internet requirements.";
        ul.parentNode.insertBefore(pSelfHosted, ul.nextSibling);
      }
      if (text.indexOf("If you are self-hosting") === 0) {
        paragraphs[i].style.display = "none";
      }
    }
  }

  var _dialogObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute && node.hasAttribute("data-dialog-content")) {
          _cleanupPrivacyDialog(node);
        }
        var inner = node.querySelectorAll ? node.querySelectorAll("[data-dialog-content]") : [];
        for (var k = 0; k < inner.length; k++) _cleanupPrivacyDialog(inner[k]);
      }
    }
  });
  _dialogObserver.observe(document.documentElement, { childList: true, subtree: true });

  var _cardsCleanedUp = false;
  function _cleanupCards() {
    if (_cardsCleanedUp) return;
    var toolbars = document.querySelectorAll('.card [role="toolbar"]');
    var found = 0;
    for (var i = 0; i < toolbars.length; i++) {
      var text = (toolbars[i].textContent || "").trim();
      var card = toolbars[i].closest(".card");
      if (!card) continue;
      if (text.indexOf("Actions") !== -1) {
        card.style.display = "none";
        found++;
      }
      if (text.indexOf("Sample Diagrams") !== -1) {
        if (card.classList.contains("isOpen")) {
          toolbars[i].click();
        }
        found++;
      }
    }
    var shareBtn = document.querySelector('button[data-dialog-trigger]');
    if (shareBtn && (shareBtn.textContent || "").trim() === "Share") {
      shareBtn.style.display = "none";
      found++;
    }
    var expandLink = document.querySelector('a[title="Full Screen"]');
    if (expandLink) {
      expandLink.style.display = "none";
      found++;
    }
    if (found >= 4) _cardsCleanedUp = true;
  }

  var _cardObserver = new MutationObserver(function() {
    if (_cardsCleanedUp) { _cardObserver.disconnect(); return; }
    _cleanupCards();
  });
  _cardObserver.observe(document.documentElement, { childList: true, subtree: true });

  var _panesEqualized = false;
  function _equalizePanes() {
    if (_panesEqualized) return;
    var resizer = document.getElementById("paneforge-3");
    if (!resizer) return;
    var prev = resizer.previousElementSibling;
    var next = resizer.nextElementSibling;
    if (!prev || !next) return;
    prev.style.flexBasis = "50%";
    next.style.flexBasis = "50%";
    _panesEqualized = true;
  }

  var _paneObserver = new MutationObserver(function() {
    if (_panesEqualized) { _paneObserver.disconnect(); return; }
    _equalizePanes();
  });
  _paneObserver.observe(document.documentElement, { childList: true, subtree: true });

  /* --- SVG Load Monitor + Diagram Selection (services 3 & 4) --- */

  var _cachedEditor = null;

  function _getMonacoEditor() {
    if (_cachedEditor) {
      try { if (_cachedEditor.getModel()) return _cachedEditor; } catch(ex) {}
      _cachedEditor = null;
    }
    if (window.monaco && window.monaco.editor &&
        typeof window.monaco.editor.getEditors === "function") {
      var editors = window.monaco.editor.getEditors();
      for (var i = 0; i < editors.length; i++) {
        try {
          if (editors[i] && typeof editors[i].getModel === "function" && editors[i].getModel()) {
            _cachedEditor = editors[i];
            console.log("[BRIDGE-SEL] Editor found via monaco.editor.getEditors() [" + i + "/" + editors.length + "]");
            return _cachedEditor;
          }
        } catch(ex) {}
      }
      console.log("[BRIDGE-SEL] monaco.editor.getEditors() returned " + editors.length + " editor(s), none with a valid model");
    } else {
      console.log("[BRIDGE-SEL] window.monaco not available (AMD shim may not have triggered)");
    }
    return null;
  }

  var _entityDecodeEl = document.createElement("textarea");
  function _decodeEntities(str) {
    _entityDecodeEl.innerHTML = str;
    return _entityDecodeEl.value;
  }

  function _normalizeText(text) {
    var s = (text || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "");
    s = _decodeEntities(s);
    s = s.replace(/\u00AB/g, "<<").replace(/\u00BB/g, ">>");
    return s.replace(/\s+/g, " ").trim();
  }

  function _getContextHint(el) {
    var node = el;
    while (node && node !== document && node.nodeType === 1) {
      if (node.id && node.tagName && node.tagName.toLowerCase() === "g") return node.id;
      node = node.parentNode;
    }
    return "";
  }

  function _extractHintTokens(hint) {
    if (!hint) return [];
    var parts = hint.split("-");
    var tokens = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^\d+$/.test(p) || p.length <= 1) continue;
      if (/^(classId|entity|state|flowchart)$/i.test(p)) continue;
      tokens.push(p);
    }
    if (hint.length > 1 && tokens.indexOf(hint) === -1) tokens.unshift(hint);
    return tokens;
  }

  function _pickBestMatch(matches, lines, contextHint) {
    var tokens = _extractHintTokens(contextHint);
    if (tokens.length === 0) return matches[0];
    var best = matches[0];
    var bestDist = 9999;
    var bestAfter = false;
    for (var m = 0; m < matches.length; m++) {
      var mLine = matches[m].lineNumber - 1;
      for (var t = 0; t < tokens.length; t++) {
        for (var off = 0; off <= 10; off++) {
          var above = mLine - off;
          var below = mLine + off;
          var foundAbove = above >= 0 && lines[above].indexOf(tokens[t]) !== -1;
          var foundBelow = below < lines.length && lines[below].indexOf(tokens[t]) !== -1;
          if (foundAbove || foundBelow) {
            var isAfter = foundAbove && !foundBelow;
            if (off < bestDist || (off === bestDist && isAfter && !bestAfter)) {
              bestDist = off;
              best = matches[m];
              bestAfter = isAfter;
            }
          }
        }
      }
    }
    console.log("[BRIDGE-SEL] Disambiguated " + matches.length + " matches via hint '" + contextHint + "', best line " + best.lineNumber + " (dist=" + bestDist + ")");
    return best;
  }

  function _findTextInCode(code, searchText, contextHint) {
    if (!code || !searchText) { console.log("[BRIDGE-SEL] _findTextInCode: empty code or searchText"); return null; }
    var normSearch = _normalizeText(searchText);
    if (!normSearch) { console.log("[BRIDGE-SEL] _findTextInCode: normalized search is empty"); return null; }
    console.log("[BRIDGE-SEL] Searching for: '" + normSearch + "' in " + code.split("\n").length + " lines");
    var lines = code.split("\n");
    var bracketMatches = [];
    var wholeLineMatches = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bracketPatterns = [
        /\["([^"]*?)"\]/g,
        /\[([^\]]*?)\]/g,
        /\("([^"]*?)"\)/g,
        /\(([^)]*?)\)/g,
        /\{"([^"]*?)"\}/g,
        /\{([^}]*?)\}/g,
        /\|"([^"]*?)"\|/g,
        /\|([^|]*?)\|/g,
        /"([^"]*?)"/g
      ];
      for (var p = 0; p < bracketPatterns.length; p++) {
        var rx = bracketPatterns[p];
        var m;
        rx.lastIndex = 0;
        while ((m = rx.exec(line)) !== null) {
          var extracted = _normalizeText(m[1]);
          if (extracted === normSearch) {
            bracketMatches.push({
              lineNumber: i + 1,
              startColumn: m.index + 1,
              endColumn: m.index + m[0].length + 1
            });
          }
        }
      }
      var trimmed = line.trim();
      if (_normalizeText(trimmed) === normSearch) {
        var leadingSpaces = line.length - line.replace(/^\s+/, "").length;
        wholeLineMatches.push({
          lineNumber: i + 1,
          startColumn: leadingSpaces + 1,
          endColumn: line.length + 1
        });
      }
    }
    if (bracketMatches.length === 1 || (bracketMatches.length > 1 && !contextHint)) {
      console.log("[BRIDGE-SEL] MATCH (bracket) line " + bracketMatches[0].lineNumber);
      return bracketMatches[0];
    }
    if (bracketMatches.length > 1) {
      console.log("[BRIDGE-SEL] " + bracketMatches.length + " bracket matches, disambiguating");
      return _pickBestMatch(bracketMatches, lines, contextHint);
    }
    if (wholeLineMatches.length === 1 || (wholeLineMatches.length > 1 && !contextHint)) {
      console.log("[BRIDGE-SEL] MATCH (whole-line) line " + wholeLineMatches[0].lineNumber);
      return wholeLineMatches[0];
    }
    if (wholeLineMatches.length > 1) {
      console.log("[BRIDGE-SEL] " + wholeLineMatches.length + " whole-line matches, disambiguating");
      return _pickBestMatch(wholeLineMatches, lines, contextHint);
    }
    var subMatches = [];
    for (var i = 0; i < lines.length; i++) {
      var idx = lines[i].indexOf(normSearch);
      if (idx !== -1) {
        subMatches.push({ lineNumber: i + 1, startColumn: idx + 1, endColumn: idx + normSearch.length + 1 });
      }
    }
    if (subMatches.length === 0) {
      var lower = normSearch.toLowerCase();
      for (var i = 0; i < lines.length; i++) {
        var idx = lines[i].toLowerCase().indexOf(lower);
        if (idx !== -1) {
          subMatches.push({ lineNumber: i + 1, startColumn: idx + 1, endColumn: idx + normSearch.length + 1 });
        }
      }
      if (subMatches.length > 0) console.log("[BRIDGE-SEL] " + subMatches.length + " case-insensitive match(es) for '" + normSearch + "'");
    }
    if (subMatches.length === 0) {
      console.log("[BRIDGE-SEL] NO MATCH found for '" + normSearch + "'");
      return null;
    }
    if (subMatches.length === 1 || !contextHint) {
      console.log("[BRIDGE-SEL] MATCH (substring) line " + subMatches[0].lineNumber + ": '" + normSearch + "'" + (subMatches.length > 1 ? " (" + subMatches.length + " candidates, no hint)" : ""));
      return subMatches[0];
    }
    return _pickBestMatch(subMatches, lines, contextHint);
  }

  function _handleSvgTextClick(textContent, contextHint) {
    console.log("[BRIDGE-SEL] Click handler fired, raw text: '" + textContent + "', hint: '" + (contextHint || "") + "'");
    var code = _readEditorCode();
    if (!code) { console.log("[BRIDGE-SEL] _readEditorCode returned empty"); return; }
    console.log("[BRIDGE-SEL] Code length: " + code.length);
    var match = _findTextInCode(code, textContent, contextHint);
    if (!match) { console.log("[BRIDGE-SEL] No match found, aborting"); return; }
    console.log("[BRIDGE-SEL] Match: line=" + match.lineNumber + " col=" + match.startColumn + "-" + match.endColumn);
    var editor = _getMonacoEditor();
    if (!editor) { console.log("[BRIDGE-SEL] Monaco editor not found, aborting"); return; }
    console.log("[BRIDGE-SEL] Editor found, applying selection...");
    try {
      var sel = {
        startLineNumber: match.lineNumber,
        startColumn: match.startColumn,
        endLineNumber: match.lineNumber,
        endColumn: match.endColumn
      };
      editor.setSelection(sel);
      editor.revealRangeInCenter(sel);
      editor.focus();
      console.log("[BRIDGE-SEL] Selection applied successfully");
    } catch(ex) { console.log("[BRIDGE-SEL] Error applying selection:", ex); }
  }

  var _svgTextSelectors = [
    "text.messageText",
    "text.actor tspan",
    "tspan.text-inner-tspan",
    "text.packetLabel",
    "text.packetTitle",
    ".legend text",
    "text.pieTitleText",
    ".quadrant text",
    ".data-point text",
    ".labels .label text",
    ".title text",
    "text.radarAxisLabel",
    "text.radarTitle",
    "text.radarLegendText",
    ".cluster-label .nodeLabel p",
    ".label.name .nodeLabel p",
    ".label.attribute-type .nodeLabel p",
    ".label.attribute-name .nodeLabel p",
    ".label-group .nodeLabel p",
    ".members-group .nodeLabel p",
    ".methods-group .nodeLabel p",
    ".branchLabel text tspan",
    "text.commit-label",
    "text.taskText",
    "text.sectionTitle tspan",
    "text.titleText",
    "g.person-man text tspan",
    "tspan[alignment-baseline='mathematical']",
    "g.node-labels text",
    "g.timeline-node tspan",
    "text.treemapSectionLabel",
    "text.treemapLabel",
    "text.legend tspan",
    "g.chart-title text"
  ];

  function _attachClickHandlers() {
    var container = document.querySelector("#container svg");
    if (!container) { console.log("[BRIDGE-SEL] _attachClickHandlers: no #container svg"); return; }
    var bound = 0;

    var erTypeGroups = container.querySelectorAll("g.label.attribute-type");
    for (var t = 0; t < erTypeGroups.length; t++) {
      var typeG = erTypeGroups[t];
      var typeP = typeG.querySelector(".nodeLabel p");
      if (!typeP) continue;
      var nameG = typeG.nextElementSibling;
      while (nameG && !nameG.classList.contains("attribute-name")) {
        nameG = nameG.nextElementSibling;
      }
      if (!nameG) continue;
      var nameP = nameG.querySelector(".nodeLabel p");
      if (!nameP) continue;
      var typeText = (typeP.textContent || "").trim();
      var nameText = (nameP.textContent || "").trim();
      if (!typeText || !nameText) continue;
      var combined = typeText + " " + nameText;
      var hint = _getContextHint(typeP);
      var pair = [typeP, nameP];
      for (var e = 0; e < pair.length; e++) {
        if (pair[e].dataset && pair[e].dataset.liveWysiwygClickBound) continue;
        if (pair[e].dataset) pair[e].dataset.liveWysiwygClickBound = "1";
        else pair[e].setAttribute("data-live-wysiwyg-click-bound", "1");
        pair[e].style.cursor = "pointer";
        pair[e].addEventListener("click", (function(combinedText, ctxHint) {
          return function(ev) {
            ev.stopPropagation();
            _handleSvgTextClick(combinedText, ctxHint);
          };
        })(combined, hint));
        bound++;
      }
    }

    var htmlEls = container.querySelectorAll(
      "g.node .nodeLabel p, g.edgeLabel .edgeLabel p, g.cluster-label .nodeLabel p, div.journey-section > div.label, div.task > div.label, .zenuml label.name, .zenuml label.condition, .zenuml label.interface, .zenuml div.title.text-skin-title, .zenuml span.text-skin-lifeline-group-name, .zenuml .message > .name"
    );
    for (var i = 0; i < htmlEls.length; i++) {
      var el = htmlEls[i];
      if (el.dataset && el.dataset.liveWysiwygClickBound) continue;
      if (el.dataset) el.dataset.liveWysiwygClickBound = "1";
      else el.setAttribute("data-live-wysiwyg-click-bound", "1");
      el.style.cursor = "pointer";
      el.addEventListener("click", (function(textEl) {
        return function(e) {
          e.stopPropagation();
          _handleSvgTextClick(textEl.innerHTML, _getContextHint(textEl));
        };
      })(el));
      bound++;
    }

    var svgEls = container.querySelectorAll(_svgTextSelectors.join(", "));
    for (var j = 0; j < svgEls.length; j++) {
      var svgEl = svgEls[j];
      if (svgEl.getAttribute("data-live-wysiwyg-click-bound")) continue;
      var txt = (svgEl.textContent || "").trim();
      if (!txt) continue;
      svgEl.setAttribute("data-live-wysiwyg-click-bound", "1");
      svgEl.style.cursor = "pointer";
      svgEl.addEventListener("click", (function(textEl) {
        return function(e) {
          e.stopPropagation();
          _handleSvgTextClick(textEl.textContent, _getContextHint(textEl));
        };
      })(svgEl));
      bound++;
    }

    var zenSel = ".zenuml label.name, .zenuml label.condition, .zenuml label.interface, .zenuml div.title.text-skin-title, .zenuml span.text-skin-lifeline-group-name, .zenuml .message > .name, .zenuml .fragment .header .collapsible-header > label";
    var zenEls = document.querySelectorAll(zenSel);
    for (var z = 0; z < zenEls.length; z++) {
      var ze = zenEls[z];
      if (ze.dataset && ze.dataset.liveWysiwygClickBound) continue;
      ze.dataset.liveWysiwygClickBound = "1";
      ze.style.cursor = "pointer";
      ze.style.pointerEvents = "auto";
      ze.addEventListener("click", (function(textEl) {
        return function(e) {
          e.stopPropagation();
          _handleSvgTextClick(textEl.textContent, "");
        };
      })(ze));
      bound++;
    }

    console.log("[BRIDGE-SEL] Bound click handlers on " + bound + " new elements (" + htmlEls.length + " html + " + svgEls.length + " svg + " + zenEls.length + " zenuml candidates)");
  }

  function _svgHasContent(svg) {
    return svg && (svg.querySelector("g.node") || svg.querySelector("text") || svg.querySelector(".root") || svg.querySelector("foreignObject"));
  }

  function _onSvgLoaded() {
    console.log("[BRIDGE-SEL] SVG loaded, attaching click handlers");
    _attachClickHandlers();
    var container = document.querySelector("#container");
    if (container) {
      var observer = new MutationObserver(function() {
        var svg = container.querySelector("svg");
        if (_svgHasContent(svg)) {
          console.log("[BRIDGE-SEL] SVG mutation detected, re-attaching click handlers");
          _attachClickHandlers();
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }
  }

  function _monitorSvgLoad() {
    var reloadKey = "live-wysiwyg-reload-count";
    var reloadCount = 0;
    try { reloadCount = parseInt(sessionStorage.getItem(reloadKey), 10) || 0; } catch(e) {}
    var maxPolls = reloadCount < 3 ? 3 : 3 + (reloadCount - 2);
    var polls = 0;
    console.log("[BRIDGE-SEL] Starting SVG load monitor (attempt " + (reloadCount + 1) + ", timeout " + (maxPolls * 500) + "ms)");
    var timer = setInterval(function() {
      polls++;
      var svg = document.querySelector("#container svg");
      if (_svgHasContent(svg)) {
        console.log("[BRIDGE-SEL] SVG confirmed loaded after " + polls + " poll(s)");
        clearInterval(timer);
        try { sessionStorage.removeItem(reloadKey); } catch(e) {}
        _onSvgLoaded();
        return;
      }
      if (polls >= maxPolls) {
        console.log("[BRIDGE-SEL] SVG load timeout after " + maxPolls + " polls (attempt " + (reloadCount + 1) + "), reloading");
        clearInterval(timer);
        try { sessionStorage.setItem(reloadKey, String(reloadCount + 1)); } catch(e) {}
        window.location.reload();
      }
    }, 500);
  }

  _monitorSvgLoad();
})();
</script>'''

BRIDGE_SENTINEL = 'live-wysiwyg-mermaid-init'


def patch_html_bridge(path: Path) -> bool:
    """P1: Inject postMessage bridge script into HTML entry points."""
    text = path.read_text()
    if BRIDGE_SENTINEL in text:
        return False  # already patched
    text = text.replace('</head>', BRIDGE_SCRIPT + '</head>', 1)
    path.write_text(text)
    return True


def patch_html_remove_canonical(path: Path) -> bool:
    """P2: Remove canonical link to mermaid.ai."""
    text = path.read_text()
    new = re.sub(
        r'\s*<link\s+rel="canonical"\s+href="https://mermaid\.ai/[^"]*"\s*/?>',
        '', text
    )
    if new == text:
        return False
    path.write_text(new)
    return True


def patch_html_remove_manifest(path: Path) -> bool:
    """P3: Remove manifest link (PWA irrelevant in iframe)."""
    text = path.read_text()
    new = re.sub(
        r'\s*<link\s+rel="manifest"\s+href="[^"]*manifest\.json"\s*/?>',
        '', text
    )
    if new == text:
        return False
    path.write_text(new)
    return True


def patch_404_html(path: Path) -> bool:
    """P4: Fix 404.html to use relative paths and dynamic base (like other pages).

    The SvelteKit adapter-static generates 404.html with root-absolute paths
    (``/_app/...``) and ``base: ""``.  All other pages use relative paths
    (``./``-prefixed) and a dynamic base.  This patch brings 404.html in line.
    """
    text = path.read_text()
    if 'new URL(".", location)' in text:
        return False  # already patched

    # Change base from empty string to dynamic computation
    text = text.replace(
        'base: ""',
        'base: new URL(".", location).pathname.slice(0, -1)'
    )
    # Change root-absolute paths to relative in script imports
    text = text.replace(
        'import("/_app/',
        'import("./_app/'
    )
    # Change root-absolute paths to relative in modulepreload links
    text = text.replace(
        'href="/_app/',
        'href="./_app/'
    )
    # Change absolute asset refs to relative
    text = text.replace('href="/favicon.svg"', 'href="./favicon.svg"')
    text = text.replace('content="/favicon.svg"', 'content="./favicon.svg"')
    text = text.replace('href="/manifest.json"', 'href="./manifest.json"')

    path.write_text(text)
    return True


def patch_service_worker_layout(build_dir: Path) -> int:
    """P5: Remove service worker registration from layout JS (nodes/0.*.js).

    The layout component registers a service worker in onMount.  The compiled
    code looks like:
        "serviceWorker"in navigator&&navigator.serviceWorker.register(...)
            .then(function(Q){...}).catch(function(Q){...})
    After the register() sed replacement it becomes:
        "serviceWorker"in navigator&&Promise.resolve()
            .then(function(Q){...scope...}).catch(function(Q){...})
    We remove the entire conditional block to eliminate both the registration
    and the console error from the .then() handler receiving undefined.
    """
    count = 0
    nodes_dir = build_dir / '_app' / 'immutable' / 'nodes'
    if not nodes_dir.is_dir():
        return 0
    for js_file in nodes_dir.glob('0.*.js'):
        text = js_file.read_text()
        # Match the full service worker conditional block:
        #   "serviceWorker"in navigator&&<anything>.then(<fn>).catch(<fn>)
        # The pattern accounts for both original and partially-patched forms.
        new = re.sub(
            r'"serviceWorker"\s*in\s+navigator\s*&&\s*'
            r'(?:navigator\.serviceWorker\.register\([^)]*\)|Promise\.resolve\(\)|void 0)'
            r'(?:\.then\(function\([^)]*\)\{[^}]*\}(?:,function\([^)]*\)\{[^}]*\})?\))*'
            r'(?:\.catch\(function\([^)]*\)\{[^}]*\}(?:,function\([^)]*\)\{[^}]*\})?\))*',
            'void 0',
            text
        )
        if new != text:
            js_file.write_text(new)
            count += 1
    return count


def patch_service_worker_register_calls(build_dir: Path) -> int:
    """P6: Replace remaining navigator.serviceWorker.register() calls.

    Catches any register() calls not covered by P5 (e.g. in other chunks).
    Uses Promise.resolve() to preserve .then()/.catch() chains.
    """
    count = 0
    for js_file in build_dir.rglob('*.js'):
        text = js_file.read_text()
        new = text.replace(
            'navigator.serviceWorker.register(',
            'Promise.resolve(('
        )
        if new != text:
            js_file.write_text(new)
            count += 1
    return count


def patch_remove_service_worker_file(build_dir: Path) -> bool:
    """P7: Remove the service worker JS file if present."""
    sw = build_dir / 'service-worker.js'
    if sw.is_file():
        sw.unlink()
        return True
    return False


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <build-dir>', file=sys.stderr)
        sys.exit(1)

    build_dir = Path(sys.argv[1])
    if not build_dir.is_dir():
        print(f'Error: {build_dir} is not a directory', file=sys.stderr)
        sys.exit(1)

    results: list[str] = []

    # P1: Bridge script — inject into edit.html (primary) and index.html (fallback)
    for name in ('edit.html', 'index.html'):
        p = build_dir / name
        if p.is_file() and patch_html_bridge(p):
            results.append(f'P1: Injected bridge script into {name}')

    # P2: Remove canonical links
    for html_file in build_dir.glob('*.html'):
        if patch_html_remove_canonical(html_file):
            results.append(f'P2: Removed canonical link from {html_file.name}')

    # P3: Remove manifest links
    for html_file in build_dir.glob('*.html'):
        if patch_html_remove_manifest(html_file):
            results.append(f'P3: Removed manifest link from {html_file.name}')

    # P4: Fix 404.html
    p404 = build_dir / '404.html'
    if p404.is_file() and patch_404_html(p404):
        results.append('P4: Fixed 404.html base path and imports')

    # P5: Remove service worker registration block from layout
    n = patch_service_worker_layout(build_dir)
    if n:
        results.append(f'P5: Removed service worker registration from {n} layout file(s)')

    # P6: Replace remaining register() calls
    n = patch_service_worker_register_calls(build_dir)
    if n:
        results.append(f'P6: Replaced service worker register() in {n} file(s)')

    # P7: Remove service worker file
    if patch_remove_service_worker_file(build_dir):
        results.append('P7: Removed service-worker.js')

    # P8 is embedded inside the bridge script (P1) — the Event.prototype.preventDefault
    # monkey-patch for parent-controlled keyboard shortcuts.  No separate patch step needed;
    # it is applied whenever P1 injects the bridge.
    if results:
        results.append('P8: preventDefault override included in bridge script (part of P1)')

    if results:
        print(f'Applied {len(results)} patch(es):')
        for r in results:
            print(f'  {r}')
    else:
        print('No patches needed (already applied or no matching files).')


if __name__ == '__main__':
    main()
