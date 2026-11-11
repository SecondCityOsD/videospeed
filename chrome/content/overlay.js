"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

var VideoSpeedOverlay = {

  _tabControllers: new WeakMap(),
  _settings: null,

  // Page-context scripts to inject in order on every content document.
  // Paths are relative to `resource://videospeed/`, which chrome.manifest
  // already aliases to `src/` — do NOT prefix entries with "src/".
  // This list is the single source of truth for shipped page scripts:
  // build-xpi.ps1 / build.sh refuse to build unless it matches the .js files
  // under src/ exactly (no missing entries, no unlisted files).
  // Order mirrors upstream 0.11.1's src/entries/inject-entry.js, minus files
  // the fork does not ship: utils/site-pattern.js (site rules are resolved in
  // chrome) and ui/vsc-controller-element.js (a comment-only file).
  _contentScripts: [
    // constants.js reads both of these from window.VSC (upstream imports
    // them, so the bundle evaluates them first too).
    "utils/key-maps.js",
    "styles/controller-css-defaults.js",
    "utils/constants.js",
    "utils/logger.js",
    "utils/debug-helper.js",
    "utils/dom-utils.js",
    // Speed-arbitration decision core + intent classifier + adapter, and the
    // controller-visibility policy. Must precede event-manager.js and
    // video-controller.js, which construct the adapter.
    "core/arbiter.js",
    "core/intent-classifier.js",
    "core/speed-arbitration.js",
    "core/controller-visibility.js",
    "utils/event-manager.js",
    "core/storage-manager.js",
    "core/settings.js",
    "core/state-manager.js",
    "observers/media-observer.js",
    "observers/mutation-observer.js",
    "core/action-handler.js",
    "core/video-controller.js",
    "ui/controls.js",
    "ui/drag-handler.js",
    "ui/shadow-dom.js",
    // Every handler before index.js: SiteHandlerManager lists them eagerly.
    "site-handlers/base-handler.js",
    "site-handlers/netflix-handler.js",
    "site-handlers/youtube-handler.js",
    "site-handlers/facebook-handler.js",
    "site-handlers/amazon-handler.js",
    "site-handlers/apple-handler.js",
    "site-handlers/dailymotion-handler.js",
    "site-handlers/frame-handler.js",
    "site-handlers/index.js",
    // Netflix's page-world seek bridge (NetflixHandler posts to it).
    "site-handlers/scripts/netflix.js",
    "content/inject.js"
  ],

  init: function() {
    this._ensureToolbarButton();
    this._loadSettings();

    // Inject into every content document as soon as the DOM is ready.
    gBrowser.addEventListener("DOMContentLoaded", this, false);

    // Listen for VSC_* events bubbling from content. wantsUntrusted=true is
    // required because CustomEvents fired by page scripts are untrusted.
    gBrowser.addEventListener("VSC_CONTROLLER_CREATED", this, false, true);
    gBrowser.addEventListener("VSC_CONTROLLER_REMOVED", this, false, true);
    gBrowser.addEventListener("VSC_SAVE_SETTINGS", this, false, true);

    gBrowser.tabContainer.addEventListener("TabClose", this, false);
    gBrowser.tabContainer.addEventListener("TabSelect", this, false);

    // Live settings: any extensions.videospeed.* pref change → broadcast to
    // every open content document so already-open tabs see new values
    // immediately, without needing a reload.
    this._prefObserver = VSCPrefs.addObserver(this._onPrefChanged.bind(this));

    this.updateIcon(false);
  },

  uninit: function() {
    gBrowser.removeEventListener("DOMContentLoaded", this, false);
    gBrowser.removeEventListener("VSC_CONTROLLER_CREATED", this, false, true);
    gBrowser.removeEventListener("VSC_CONTROLLER_REMOVED", this, false, true);
    gBrowser.removeEventListener("VSC_SAVE_SETTINGS", this, false, true);
    gBrowser.tabContainer.removeEventListener("TabClose", this, false);
    gBrowser.tabContainer.removeEventListener("TabSelect", this, false);

    if (this._prefObserver) {
      VSCPrefs.removeObserver(this._prefObserver);
      this._prefObserver = null;
    }
  },

  _onPrefChanged: function(prefKey) {
    // Refresh our in-memory snapshot so new tabs and re-injections see the
    // new value too.
    this._loadSettings();

    if (!gBrowser) return;

    var newValue = (this._settings && this._settings[prefKey] !== undefined)
        ? this._settings[prefKey] : null;
    var changes = {};
    changes[prefKey] = { newValue: newValue };

    var browsers = gBrowser.browsers;
    for (var i = 0; i < browsers.length; i++) {
      var win = browsers[i].contentWindow;
      var doc = browsers[i].contentDocument;
      if (!win || !doc || !doc.documentElement) continue;
      try {
        var clonedChanges = Components.utils.cloneInto(changes, win);
        var evt = new win.CustomEvent('VSC_STORAGE_CHANGED', {
          detail: clonedChanges,
          bubbles: true,
        });
        doc.documentElement.dispatchEvent(evt);
      } catch(e) {
        // Tab may not have a content document yet, or it's a chrome:// tab.
      }
    }
  },

  handleEvent: function(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        this._onContentReady(event);
        break;
      case "VSC_CONTROLLER_CREATED":
        this._onControllerCreated(event);
        break;
      case "VSC_CONTROLLER_REMOVED":
        this._onControllerRemoved(event);
        break;
      case "VSC_SAVE_SETTINGS":
        this._onSaveSettings(event);
        break;
      case "TabClose":
        this._onTabClose(event);
        break;
      case "TabSelect":
        this._onTabSelect(event);
        break;
    }
  },

  _loadSettings: function() {
    // VSCPrefs.getAll() dispatches getBoolPref/getIntPref/getCharPref by key
    // class and parses the JSON keys. The previous hand-rolled reader called
    // getStringPref on EVERY key, which threw a type mismatch on the bool/int
    // prefs (enabled, rememberSpeed, audioBoolean, startHidden,
    // controllerButtonSize, logLevel) and silently swallowed them — so those
    // six settings never reached content and the controller always used
    // defaults. Always seed from getAll().
    try {
      this._settings = VSCPrefs.getAll();
    } catch(e) {
      Components.utils.reportError("VSC: _loadSettings failed: " + e);
      this._settings = {};
    }
  },

  // --- Privileged site-matching helpers (ES5; ported from src/utils/site-pattern.js) ---

  // Compile a blacklist / siteRule pattern string into a RegExp. Supports:
  //   /regex/flags  → regex literal
  //   domain.tld    → domain-boundary match  (^|.|//)domain\.tld(/|:|$)
  //   anything else → escaped substring match
  _compilePattern: function(raw) {
    var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
    var regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;
    var pattern = String(raw == null ? "" : raw).replace(regStrip, "");
    if (!pattern.length) return null;

    if (pattern.charAt(0) === "/") {
      try {
        var parts = pattern.split("/");
        if (parts.length < 3) return null;
        var hasFlags = regEndsWithFlags.test(pattern);
        var flags = hasFlags ? parts.pop() : "";
        var regex = parts.slice(1, hasFlags ? undefined : -1).join("/");
        if (!regex) return null;
        return new RegExp(regex, flags);
      } catch(e) {
        return null;
      }
    }

    var escaped = pattern.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
    var looksLikeDomain = pattern.indexOf(".") !== -1 && pattern.indexOf("/") === -1;
    if (looksLikeDomain) {
      return new RegExp("(^|\\.|//)" + escaped + "(\\/|:|$)");
    }
    return new RegExp(escaped);
  },

  // True if `href` matches any line of the user's newline-separated blacklist
  // pref (the list the options page edits).
  _isUrlBlacklisted: function(href) {
    var bl = this._settings && this._settings.blacklist;
    if (!bl) return false;
    var lines = String(bl).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var rx = this._compilePattern(lines[i]);
      if (rx && rx.test(href)) return true;
    }
    return false;
  },

  // Per-site default speed from siteRules (first rule whose pattern matches
  // and carries a numeric speed). Returns null when none applies. Drives the
  // per-domain-speed feature; safe to call regardless of whether it's used.
  _siteDefaultSpeed: function(href) {
    var rules = this._settings && this._settings.siteRules;
    if (!rules || !rules.length) return null;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule) continue;
      var rx = this._compilePattern(rule.pattern || "");
      if (rx && rx.test(href) && rule.speed !== null && rule.speed !== undefined) {
        return rule.speed;
      }
    }
    return null;
  },

  _ensureToolbarButton: function() {
    var prefBranch = Services.prefs.getBranch("extensions.videospeed.");
    var tbVersion = 2;
    try {
      if (prefBranch.getIntPref("toolbarbuttonVersion") >= tbVersion) {
        return;
      }
    } catch(e) {}

    prefBranch.setIntPref("toolbarbuttonVersion", tbVersion);

    var navbar = document.getElementById("nav-bar");
    if (!navbar) return;

    var newSet = navbar.currentSet + ",videospeed-button";
    navbar.currentSet = newSet;
    navbar.setAttribute("currentset", newSet);
    document.persist("nav-bar", "currentset");
  },

  _onContentReady: function(event) {
    var doc = event.originalTarget;
    if (!doc || doc.nodeType !== doc.DOCUMENT_NODE) return;
    if (!doc.location) return;

    var scheme = doc.location.protocol;
    if (scheme !== "http:" && scheme !== "https:" &&
        scheme !== "file:"  && scheme !== "ftp:") {
      return;
    }

    // Guard against double-injection (DOMContentLoaded may fire for sub-frames
    // we already processed when their parent fired).
    var root = doc.documentElement;
    if (!root || root.hasAttribute("data-vsc-injected")) return;

    // Refresh from prefs in case settings changed in the options page since
    // the chrome window opened.
    this._loadSettings();

    // Privileged trust decisions live HERE, in the chrome layer — never in
    // page scope where a hostile page could read or tamper with them:
    //   - global disable (the popup / options "enabled" toggle)
    //   - per-site blacklist (the `blacklist` pref the options page edits)
    // A disabled or blacklisted document gets NO injection at all: the page
    // world never sees window.VSC, the user's blacklist never leaks into it,
    // and those pages stay strictly cheaper (zero extra script parse).
    var href = doc.location.href;
    if (this._settings.enabled === false || this._isUrlBlacklisted(href)) {
      return;
    }

    root.setAttribute("data-vsc-injected", "1");

    // SPA navigations leave the same <browser> element but the controllers
    // are gone — make sure our per-browser tracking set isn't stuck thinking
    // there are still controllers from the previous page.
    var browser = this._getBrowserForDocument(doc);
    if (browser) {
      this._tabControllers.delete(browser);
      if (browser === gBrowser.selectedBrowser) {
        this.updateIcon(false);
      }
    }

    this._injectInitialSettings(doc, this._siteDefaultSpeed(href));
    this._injectScripts(doc);
  },

  _injectInitialSettings: function(doc, siteDefaultSpeed) {
    try {
      // Build a SANITIZED copy of settings for page scope. The blacklist and
      // siteRules are browsing-interest signals / trust data — they are
      // resolved in the chrome layer (see _onContentReady) and must NOT be
      // exposed to page JS (any tracker or userscript shares this world).
      var safe = {};
      var src = this._settings || {};
      for (var k in src) {
        if (k === "blacklist" || k === "siteRules") continue;
        safe[k] = src[k];
      }
      if (siteDefaultSpeed !== null && siteDefaultSpeed !== undefined) {
        safe.siteDefaultSpeed = siteDefaultSpeed;
      }

      var script = doc.createElement("script");
      script.type = "application/javascript";
      // Synchronously seed content scope with the user's settings so that
      // storage-manager.js can read them on first access without waiting
      // for any cross-context event.
      script.textContent =
        "window.VSC_initial_settings = " + JSON.stringify(safe) + ";";
      (doc.head || doc.documentElement).appendChild(script);
    } catch(e) {
      Components.utils.reportError("VSC: Failed to inject initial settings: " + e);
    }
  },

  _injectScripts: function(doc) {
    var basePath = "resource://videospeed/";
    var head = doc.head || doc.documentElement;
    if (!head) return;

    this._contentScripts.forEach(function(scriptPath) {
      try {
        var script = doc.createElement("script");
        script.src = basePath + scriptPath;
        script.type = "application/javascript";
        script.async = false; // preserve execution order across all scripts
        // Surface load failures (404, CSP block, parse error) to Browser Console.
        script.onerror = function(ev) {
          Components.utils.reportError(
            "VSC: failed to load " + scriptPath + " (resource://" + scriptPath + ")"
          );
        };
        head.appendChild(script);
      } catch(e) {
        Components.utils.reportError("VSC: Failed to inject " + scriptPath + ": " + e);
      }
    });
  },

  _onSaveSettings: function(event) {
    try {
      var data = event.detail;
      if (!data) return;
      for (var key in data) {
        // SECURITY: this listener fires for UNTRUSTED page-dispatched events
        // (registered with wantsUntrusted=true). Only allow writes to keys in
        // our known pref schema, so a hostile page can't disable the
        // extension, wipe the blacklist, or pollute the pref store with
        // arbitrary keys.
        if (!VSCPrefs.isValidKey(key)) {
          Components.utils.reportError(
            "VSC: ignoring settings write for unknown key: " + key);
          continue;
        }
        // Pass the RAW value. VSCPrefs.set() encodes per key class — JSON keys
        // (keyBindings/siteRules/speeds) get exactly one JSON.stringify. The
        // old code pre-stringified objects here, so those keys were
        // double-encoded and failed to parse back.
        VSCPrefs.set(key, data[key]);
      }
      // Keep our in-memory snapshot in sync for the next injection.
      this._loadSettings();
    } catch(e) {
      Components.utils.reportError("VSC: Failed to save settings: " + e);
    }
  },

  _getBrowserForDocument: function(doc) {
    if (!gBrowser || !doc) return null;
    var browsers = gBrowser.browsers;
    for (var i = 0; i < browsers.length; i++) {
      if (browsers[i].contentDocument === doc) {
        return browsers[i];
      }
    }
    return null;
  },

  _getControllerSet: function(browser) {
    var set = this._tabControllers.get(browser);
    if (!set) {
      set = new Set();
      this._tabControllers.set(browser, set);
    }
    return set;
  },

  _onControllerCreated: function(event) {
    var doc = event.target.ownerDocument || event.target;
    var browser = this._getBrowserForDocument(doc);
    if (!browser) return;
    var data = event.detail || {};
    var set = this._getControllerSet(browser);
    set.add(data.controllerId || "default");
    if (browser === gBrowser.selectedBrowser) {
      this.updateIcon(true);
    }
  },

  _onControllerRemoved: function(event) {
    var doc = event.target.ownerDocument || event.target;
    var browser = this._getBrowserForDocument(doc);
    if (!browser) return;
    var data = event.detail || {};
    var set = this._getControllerSet(browser);
    set.delete(data.controllerId || "default");
    if (browser === gBrowser.selectedBrowser) {
      this.updateIcon(set.size > 0);
    }
    if (set.size === 0) {
      this._tabControllers.delete(browser);
    }
  },

  _onTabClose: function(event) {
    var browser = gBrowser.getBrowserForTab(event.target);
    this._tabControllers.delete(browser);
  },

  _onTabSelect: function() {
    var browser = gBrowser.selectedBrowser;
    var set = this._tabControllers.get(browser);
    this.updateIcon(set && set.size > 0);
  },

  updateIcon: function(active) {
    var button = document.getElementById("videospeed-button");
    if (button) {
      if (active) {
        button.removeAttribute("status");
      } else {
        button.setAttribute("status", "disabled");
      }
    }
  },

  togglePanel: function(event) {
    var panel = document.getElementById("videospeed-panel");
    var button = document.getElementById("videospeed-button");
    if (panel.state === "open") {
      panel.hidePopup();
    } else {
      panel.openPopup(button, "after_start", 0, 0, false, false);
    }
  },

  onPanelShown: function() {
    var frame = document.getElementById("videospeed-popup-frame");
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage({ type: "VSC_PANEL_SHOWN" }, "*");
      } catch(e) {}
    }
  },

  onPanelHidden: function() {}
};

window.addEventListener("load", function() {
  VideoSpeedOverlay.init();
}, false);

window.addEventListener("unload", function() {
  VideoSpeedOverlay.uninit();
}, false);
