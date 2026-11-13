"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

/**
 * Chrome-side half of the extension: the UXP counterpart of upstream 0.11.1's
 * background.js (toolbar icon, settings migration) and
 * entries/content-bridge.js (the per-document settings bridge).
 *
 * For every http/https/file document (in every frame) that is not disabled,
 * a bridge object is registered and the page scripts are injected. The page
 * half (src/core/storage-manager.js) then talks to that bridge exactly as it
 * talks to upstream's ISOLATED-world bridge — CustomEvents on the document
 * element:
 *   VSC_REQUEST_SETTINGS  page → chrome   answered with VSC_SETTINGS_READY
 *                                         ({settings, hostname} or {abort})
 *   VSC_WRITE_STORAGE     page → chrome   only lastSpeed, clamped
 *   VSC_STORAGE_CHANGED   chrome → page   live pref changes
 *   VSC_MESSAGE           chrome → page   popup commands and VSC_TEARDOWN
 *
 * UXP differences from upstream's bridge:
 *   - Trust decisions run before injection: a disabled document gets no page
 *     scripts at all (upstream injects and the bridge aborts).
 *   - Site rules are resolved here and never reach the page; the page gets an
 *     already-matched `siteDefaultSpeed` instead of the raw `siteRules`.
 *   - The bridge registry is a chrome-side WeakMap, invisible to the page.
 *   - The controller CSS is attached here, as author sheets the page cannot
 *     touch (see "Controller sheets") — upstream's manifest CSS and adopted
 *     stylesheets are out of the page's reach, too.
 */
var VideoSpeedOverlay = {

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

  // Upstream manifest content_scripts.exclude_matches: never injected.
  _EXCLUDED_URL: /^https:\/\/(hangouts|meet)\.google\.com\//,

  // Page → chrome write validation (constants.js SPEED_LIMITS).
  _SPEED_MIN: 0.07,
  _SPEED_MAX: 16,

  // Content document → bridge state. Weak: a navigated-away document and its
  // bridge are collected together. Doubles as the double-injection guard.
  _bridges: new WeakMap(),

  init: function() {
    this._ensureToolbarButton();

    // Upstream runs its storage migrations from background.js on install and
    // update; VSCPrefs runs them once per application session.
    VSCPrefs.migrate();

    // Inject into every content document (all frames) as soon as its DOM is
    // ready.
    gBrowser.addEventListener("DOMContentLoaded", this, false);

    // Live settings: relay every extensions.videospeed.* change to the
    // bridges of already-open documents.
    this._prefObserver = VSCPrefs.addObserver(this._onPrefChanged.bind(this));

    this.updateIcon(this._readSettings().enabled !== false);
  },

  uninit: function() {
    gBrowser.removeEventListener("DOMContentLoaded", this, false);
    if (this._prefObserver) {
      VSCPrefs.removeObserver(this._prefObserver);
      this._prefObserver = null;
    }
  },

  handleEvent: function(event) {
    if (event.type === "DOMContentLoaded") {
      this._onContentReady(event);
    }
  },

  _readSettings: function() {
    try {
      return VSCPrefs.getAll();
    } catch(e) {
      Components.utils.reportError("VSC: reading settings failed: " + e);
      return {};
    }
  },

  // --- Site rules (ES5 port of upstream src/utils/site-pattern.js) ---------

  // Compile a site-rule / blacklist pattern into a RegExp. Supports:
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

  // First rule whose pattern matches `href`, or null (upstream matchSiteRule).
  _matchSiteRule: function(rules, href) {
    if (!rules || !rules.length) return null;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var rx = this._compilePattern((rule && rule.pattern) || "");
      if (rx && rx.test(href)) return rule;
    }
    return null;
  },

  // Upstream's bridge: the legacy newline-separated blacklist is consulted
  // only before migration has created siteRules; otherwise the first
  // matching site rule decides, and `enabled: false` disables the site.
  _isSiteDisabled: function(settings, href) {
    if (!settings.siteRules && settings.blacklist) {
      var lines = String(settings.blacklist).split("\n");
      var legacy = [];
      for (var i = 0; i < lines.length; i++) {
        legacy.push({ pattern: lines[i] });
      }
      if (this._matchSiteRule(legacy, href)) return true;
    }
    var match = this._matchSiteRule(settings.siteRules, href);
    return !!(match && match.enabled === false);
  },

  // The matching rule's speed — the page's initial authority (settings.js).
  _siteRuleSpeed: function(settings, href) {
    var match = this._matchSiteRule(settings.siteRules, href);
    return (match && match.speed !== null && match.speed !== undefined) ? match.speed : null;
  },

  // --- Injection ---------------------------------------------------------

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
    if (!doc || doc.nodeType !== doc.DOCUMENT_NODE || !doc.location) return;
    var win = doc.defaultView;
    var root = doc.documentElement;
    if (!win || !root) return;

    // One injection per document *version*. document.open()/write() gives the
    // document a new root and fires DOMContentLoaded again; Gecko also gives
    // it a fresh window (Chrome keeps the old one, so upstream's scripts
    // survive), which takes the injected scripts with it — inject again, as
    // the 0.10.2 port did. A document disabled while open stays reload-only.
    var previous = this._bridges.get(doc);
    if (previous) {
      if (previous.root === root || previous.disabledForDocument) return;
      previous.active = false;
      this._removeSheets(previous);
      this._bridges.delete(doc);
    }

    // Upstream content_scripts.matches: http, https and file only (about:
    // frames fail closed there; here they are simply never injected).
    var scheme = doc.location.protocol;
    if (scheme !== "http:" && scheme !== "https:" && scheme !== "file:") return;
    var href = doc.location.href;
    if (this._EXCLUDED_URL.test(href)) return;

    // Where upstream's bridge would answer {abort}, inject nothing at all:
    // the page world never sees window.VSC or the user's site rules.
    var settings = this._readSettings();
    if (settings.enabled === false || this._isSiteDisabled(settings, href)) return;

    // `root` is the element both sides talk on for this document's life, even
    // if the page later swaps in another <html> (upstream's bridge and page
    // scripts capture document.documentElement once, too).
    var bridge = { doc: doc, win: win, root: root, active: false, disabledForDocument: false };
    this._bridges.set(doc, bridge);
    this._attachBridge(bridge);
    this._injectScripts(doc);
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
        script.onerror = function() {
          Components.utils.reportError("VSC: failed to load " + basePath + scriptPath);
        };
        head.appendChild(script);
      } catch(e) {
        Components.utils.reportError("VSC: Failed to inject " + scriptPath + ": " + e);
      }
    });
  },

  // --- Bridge ------------------------------------------------------------

  _attachBridge: function(bridge) {
    var self = this;
    var root = bridge.root;
    // wantsUntrusted: page-dispatched CustomEvents are untrusted.
    var onRequest = function() {
      root.removeEventListener("VSC_REQUEST_SETTINGS", onRequest, false);
      self._answerSettingsRequest(bridge);
    };
    root.addEventListener("VSC_REQUEST_SETTINGS", onRequest, false, true);
    root.addEventListener("VSC_WRITE_STORAGE", function(event) {
      self._onWriteStorage(bridge, event);
    }, false, true);
  },

  _dispatch: function(bridge, type, detail) {
    try {
      var evt = new bridge.win.CustomEvent(type, {
        detail: Components.utils.cloneInto(detail, bridge.win),
      });
      bridge.root.dispatchEvent(evt);
    } catch(e) {
      // The document went away (dead object) — nothing to deliver to.
    }
  },

  _answerSettingsRequest: function(bridge) {
    var settings = this._readSettings();
    var href = bridge.doc.location.href;
    if (bridge.disabledForDocument || settings.enabled === false ||
        this._isSiteDisabled(settings, href)) {
      this._dispatch(bridge, "VSC_SETTINGS_READY", { abort: true });
      return;
    }

    // Upstream sends chrome.storage.sync.get(null) — stored keys only; the
    // page fills the rest from DEFAULT_SETTINGS (storage-manager.js). It
    // strips `enabled` and the legacy `blacklist`; the fork also strips
    // `siteRules` (privacy) and sends the resolved rule speed instead.
    var stored = VSCPrefs.getStored();
    var publicSettings = {};
    for (var key in stored) {
      if (key === "enabled" || key === "blacklist" || key === "siteRules") continue;
      publicSettings[key] = stored[key];
    }
    var speed = this._siteRuleSpeed(settings, href);
    if (speed !== null) {
      publicSettings.siteDefaultSpeed = speed;
    }

    bridge.active = true;
    // Upstream's initialize() injects the controller CSS once settings load.
    this._loadSheets(bridge, settings);
    this._dispatch(bridge, "VSC_SETTINGS_READY", {
      settings: publicSettings,
      hostname: bridge.doc.location.hostname.replace(/^www\./, ""),
    });
  },

  // Only lastSpeed can cross from the page into extension storage.
  _onWriteStorage: function(bridge, event) {
    if (!bridge.active) return;
    var data = event.detail;
    if (!data || typeof data !== "object") return;
    var speed = data.lastSpeed;
    if (typeof speed === "number" && isFinite(speed)) {
      VSCPrefs.set("lastSpeed", Math.min(Math.max(speed, this._SPEED_MIN), this._SPEED_MAX));
    }
  },

  // --- Controller sheets -------------------------------------------------
  // Upstream's CSS is out of the page's reach: manifest CSS and adopted
  // stylesheets are not DOM nodes. The UXP counterpart is an author sheet
  // attached to the document through nsIDOMWindowUtils (as Firefox's own
  // WebExtensions did for content-script CSS): not a DOM node either, so a
  // page cannot remove, block or disable it — the VORAPIS V3 YouTube layout
  // sweeps every <style> — and page CSP does not govern it. The text comes
  // from the extension's own src/styles/controller-css-defaults.js and the
  // user's customCSS pref, never from anything the page sends.

  _cssBuilders: null,

  _css: function() {
    if (!this._cssBuilders) {
      var scope = { window: {} };
      Services.scriptloader.loadSubScript(
        "resource://videospeed/styles/controller-css-defaults.js", scope, "UTF-8");
      this._cssBuilders = scope.window.VSC;
    }
    return this._cssBuilders;
  },

  _windowUtils: function(bridge) {
    return bridge.win.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                     .getInterface(Components.interfaces.nsIDOMWindowUtils);
  },

  _addSheet: function(bridge, css) {
    var uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    try {
      var utils = this._windowUtils(bridge);
      utils.loadSheetUsingURIString(uri, utils.AUTHOR_SHEET);
      return uri;
    } catch(e) {
      Components.utils.reportError("VSC: could not attach the controller CSS: " + e);
      return null;
    }
  },

  _removeSheet: function(bridge, uri) {
    if (!uri) return;
    try {
      var utils = this._windowUtils(bridge);
      utils.removeSheetUsingURIString(uri, utils.AUTHOR_SHEET);
    } catch(e) {
      // The document went away, and its sheets with it.
    }
  },

  // Upstream injectControllerCSS(): the controller sheet (inner controller
  // CSS + host and site rules for this host), then the user's custom sheet.
  _loadSheets: function(bridge, settings) {
    if (bridge.sheets) return;
    bridge.sheets = {
      controller: this._addSheet(bridge,
        this._css().controllerSheetCSS(bridge.doc.location.hostname)),
      custom: null,
    };
    this._setCustomSheet(bridge, settings.customCSS);
  },

  // Upstream setupCSSLiveUpdates(): replace the custom sheet. A newly loaded
  // sheet comes after the controller sheet, keeping the cascade order.
  _setCustomSheet: function(bridge, customCSS) {
    if (!bridge.sheets) return;
    this._removeSheet(bridge, bridge.sheets.custom);
    bridge.sheets.custom = null;
    var css = this._css().customSheetCSS(customCSS);
    if (css) {
      bridge.sheets.custom = this._addSheet(bridge, css);
    }
  },

  _removeSheets: function(bridge) {
    if (!bridge.sheets) return;
    this._removeSheet(bridge, bridge.sheets.controller);
    this._removeSheet(bridge, bridge.sheets.custom);
    bridge.sheets = null;
  },

  // Call `callback(bridge)` for every bridged document in `win` and all of
  // its descendant frames.
  _forEachBridgeIn: function(win, callback) {
    if (!win) return;
    try {
      var bridge = this._bridges.get(win.document);
      if (bridge) callback(bridge);
      for (var i = 0; i < win.frames.length; i++) {
        this._forEachBridgeIn(win.frames[i], callback);
      }
    } catch(e) {
      // Frame navigated away mid-walk (dead object).
    }
  },

  _forEachBridge: function(callback) {
    var browsers = gBrowser ? gBrowser.browsers : [];
    for (var i = 0; i < browsers.length; i++) {
      this._forEachBridgeIn(browsers[i].contentWindow, callback);
    }
  },

  _onPrefChanged: function(prefKey) {
    var self = this;
    var settings = this._readSettings();

    if (prefKey === "enabled") {
      var enabled = settings.enabled !== false;
      this.updateIcon(enabled);
      this._forEachBridge(function(bridge) {
        // Any disabled state makes this document reload-only from here on
        // (#1527); a disable also tears down what is already running.
        bridge.disabledForDocument = true;
        if (!enabled) {
          bridge.active = false;
          self._dispatch(bridge, "VSC_MESSAGE", { type: "VSC_TEARDOWN" });
          self._removeSheets(bridge);
        }
      });
      return;
    }

    // Never relayed: the legacy blacklist (upstream) and the raw site rules
    // (UXP privacy). Keys outside the settings schema have nothing to relay.
    if (prefKey === "blacklist" || prefKey === "siteRules" || !(prefKey in settings)) return;

    // Upstream's setupCSSLiveUpdates(), done here with the sheets.
    if (prefKey === "customCSS") {
      this._forEachBridge(function(bridge) {
        if (bridge.active) {
          self._setCustomSheet(bridge, settings.customCSS);
        }
      });
    }

    var changes = {};
    changes[prefKey] = { newValue: settings[prefKey] };
    this._forEachBridge(function(bridge) {
      if (bridge.active) {
        self._dispatch(bridge, "VSC_STORAGE_CHANGED", changes);
      }
    });
  },

  // Popup commands reach every active bridge in the selected tab, in every
  // frame (upstream: chrome.tabs.sendMessage → all frames' bridges).
  sendToSelectedTab: function(message) {
    var self = this;
    this._forEachBridgeIn(gBrowser.selectedBrowser.contentWindow, function(bridge) {
      if (bridge.active) {
        self._dispatch(bridge, "VSC_MESSAGE", message);
      }
    });
  },

  // --- Toolbar -----------------------------------------------------------

  // As upstream's background.js: the icon reflects only whether the
  // extension is enabled.
  updateIcon: function(enabled) {
    var button = document.getElementById("videospeed-button");
    if (button) {
      if (enabled) {
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
