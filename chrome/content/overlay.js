"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

var VideoSpeedOverlay = {

  _tabControllers: new WeakMap(),
  _settings: null,

  // Page-context scripts to inject in order on every content document.
  // Paths are relative to `resource://videospeed/`, which chrome.manifest
  // already aliases to `src/` — do NOT prefix entries with "src/".
  _contentScripts: [
    "utils/key-maps.js",
    "utils/constants.js",
    "utils/logger.js",
    "utils/dom-utils.js",
    "utils/event-manager.js",
    "utils/debug-helper.js",
    "core/state-manager.js",
    "core/storage-manager.js",
    "core/settings.js",
    "core/action-handler.js",
    "core/video-controller.js",
    "observers/media-observer.js",
    "observers/mutation-observer.js",
    "site-handlers/base-handler.js",
    "site-handlers/index.js",
    "site-handlers/youtube-handler.js",
    "site-handlers/netflix-handler.js",
    "site-handlers/facebook-handler.js",
    "site-handlers/amazon-handler.js",
    "site-handlers/apple-handler.js",
    "site-handlers/dailymotion-handler.js",
    "ui/shadow-dom.js",
    "ui/controls.js",
    "ui/drag-handler.js",
    "styles/controller-css-defaults.js",
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
    var settingsData = {};
    var keys = ['enabled', 'lastSpeed', 'rememberSpeed', 'exclusiveKeys', 'audioBoolean',
               'startHidden', 'controllerOpacity', 'controllerButtonSize', 'customCSS',
               'keyBindings', 'siteRules', 'blacklist', 'logLevel'];

    keys.forEach(function(key) {
      try {
        var prefType = VSCPrefs.branch.getPrefType(key);
        if (prefType != 0) {
          var value = VSCPrefs.branch.getStringPref(key);
          if (key === 'keyBindings' || key === 'siteRules') {
            try { settingsData[key] = JSON.parse(value); } catch(e) { settingsData[key] = value; }
          } else {
            settingsData[key] = value;
          }
        }
      } catch(e) {}
    });

    this._settings = settingsData;
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

    // Refresh from prefs in case settings changed in the options page since
    // the chrome window opened.
    this._loadSettings();
    this._injectInitialSettings(doc);
    this._injectScripts(doc);
  },

  _injectInitialSettings: function(doc) {
    try {
      var script = doc.createElement("script");
      script.type = "application/javascript";
      // Synchronously seed content scope with the user's settings so that
      // storage-manager.js can read them on first access without waiting
      // for any cross-context event.
      script.textContent =
        "window.VSC_initial_settings = " +
        JSON.stringify(this._settings || {}) + ";";
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
        var value = data[key];
        if (typeof value === 'object' && value !== null) {
          VSCPrefs.set(key, JSON.stringify(value));
        } else {
          VSCPrefs.set(key, value);
        }
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
