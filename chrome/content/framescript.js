"use strict";

/**
 * Frame script for Video Speed Controller.
 * Runs in each tab's content process. Has Components access.
 * Injects content scripts into web pages and bridges messages
 * between page context and chrome (overlay.js).
 */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://videospeed/modules/VSCPrefs.jsm");

const RESOURCE_BASE = "resource://videospeed/";

/**
 * Ordered list of scripts to inject into the page.
 * Same order as the original Chrome injector.js.
 */
const INJECT_SCRIPTS = [
  "utils/constants.js",
  "utils/logger.js",
  "utils/debug-helper.js",
  "utils/dom-utils.js",
  "utils/event-manager.js",
  "core/storage-manager.js",
  "core/settings.js",
  "observers/media-observer.js",
  "observers/mutation-observer.js",
  "core/action-handler.js",
  "core/video-controller.js",
  "ui/controls.js",
  "ui/drag-handler.js",
  "ui/shadow-dom.js",
  "site-handlers/base-handler.js",
  "site-handlers/netflix-handler.js",
  "site-handlers/youtube-handler.js",
  "site-handlers/facebook-handler.js",
  "site-handlers/amazon-handler.js",
  "site-handlers/apple-handler.js",
  "site-handlers/index.js",
  "content/inject.js"
];

/**
 * Inject a <script> tag into the page.
 */
function injectScript(doc, relativePath) {
  return new Promise(function(resolve, reject) {
    var script = doc.createElement("script");
    script.src = RESOURCE_BASE + relativePath;
    script.onload = function() { resolve(); };
    script.onerror = function() {
      Cu.reportError("VSC: Failed to inject " + relativePath);
      reject(new Error("Failed to inject " + relativePath));
    };
    (doc.head || doc.documentElement).appendChild(script);
  });
}

/**
 * Inject the extension's CSS into the page.
 */
function injectCSS(doc) {
  var link = doc.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = RESOURCE_BASE + "styles/inject.css";
  (doc.head || doc.documentElement).appendChild(link);
}

/**
 * Read settings from prefs and dispatch them into the page context.
 */
function injectSettings(win) {
  try {
    var settings = VSCPrefs.getAll();
    var event = new win.CustomEvent("VSC_USER_SETTINGS", {
      detail: Cu.cloneInto(settings, win)
    });
    win.dispatchEvent(event);
  } catch(e) {
    Cu.reportError("VSC: Failed to inject settings: " + e);
  }
}

/**
 * Listen for save requests from the page and write to prefs.
 */
function setupSaveListener(win) {
  win.addEventListener("VSC_SAVE_SETTINGS", function(event) {
    try {
      var data = Cu.waiveXrays(event.detail);
      // Convert to a plain object
      var obj = {};
      for (var key in data) {
        obj[key] = data[key];
      }
      VSCPrefs.setMultiple(obj);
    } catch(e) {
      Cu.reportError("VSC: Failed to save settings: " + e);
    }
  }, false, true); // wantsUntrusted = true to receive page-dispatched events
}

/**
 * Listen for controller lifecycle events and forward to chrome.
 */
function setupControllerBridge(win) {
  win.addEventListener("VSC_CONTROLLER_CREATED", function(event) {
    try {
      var detail = Cu.waiveXrays(event.detail) || {};
      sendAsyncMessage("VSC:ControllerCreated", {
        controllerId: detail.controllerId || "default"
      });
    } catch(e) { /* ignore */ }
  }, false, true);

  win.addEventListener("VSC_CONTROLLER_REMOVED", function(event) {
    try {
      var detail = Cu.waiveXrays(event.detail) || {};
      sendAsyncMessage("VSC:ControllerRemoved", {
        controllerId: detail.controllerId || "default"
      });
    } catch(e) { /* ignore */ }
  }, false, true);
}

/**
 * Listen for messages from chrome (popup) and forward to page context.
 */
function setupChromeBridge(win) {
  addMessageListener("VSC:SetSpeed", function(msg) {
    try {
      var event = new win.CustomEvent("VSC_MESSAGE", {
        detail: Cu.cloneInto({
          type: "VSC_SET_SPEED",
          payload: msg.data
        }, win)
      });
      win.dispatchEvent(event);
    } catch(e) { /* page gone */ }
  });

  addMessageListener("VSC:AdjustSpeed", function(msg) {
    try {
      var event = new win.CustomEvent("VSC_MESSAGE", {
        detail: Cu.cloneInto({
          type: "VSC_ADJUST_SPEED",
          payload: msg.data
        }, win)
      });
      win.dispatchEvent(event);
    } catch(e) { /* page gone */ }
  });

  addMessageListener("VSC:ResetSpeed", function(msg) {
    try {
      var event = new win.CustomEvent("VSC_MESSAGE", {
        detail: Cu.cloneInto({
          type: "VSC_RESET_SPEED",
          payload: {}
        }, win)
      });
      win.dispatchEvent(event);
    } catch(e) { /* page gone */ }
  });

  addMessageListener("VSC:ToggleDisplay", function(msg) {
    try {
      var event = new win.CustomEvent("VSC_MESSAGE", {
        detail: Cu.cloneInto({
          type: "VSC_TOGGLE_DISPLAY",
          payload: {}
        }, win)
      });
      win.dispatchEvent(event);
    } catch(e) { /* page gone */ }
  });
}

/**
 * Inject site-specific scripts based on hostname.
 */
function injectSiteSpecificScripts(doc) {
  try {
    var hostname = doc.location.hostname;
    if (hostname === "www.netflix.com") {
      injectScript(doc, "site-handlers/scripts/netflix.js");
    }
  } catch(e) {
    Cu.reportError("VSC: Failed to inject site-specific scripts: " + e);
  }
}

/**
 * Main injection entry point for a document.
 */
function injectIntoDocument(event) {
  var doc = event.target;
  // Only inject into HTML documents
  if (!(doc instanceof Ci.nsIDOMHTMLDocument)) return;

  var win = doc.defaultView;
  if (!win) return;

  // Skip about:, chrome:, resource: pages
  var scheme = doc.location.protocol;
  if (scheme === "about:" || scheme === "chrome:" || scheme === "resource:") {
    return;
  }

  // Check if extension is enabled
  try {
    if (!VSCPrefs.branch.getBoolPref("enabled")) return;
  } catch(e) { /* default to enabled */ }

  // Inject CSS
  injectCSS(doc);

  // Set up message bridges
  setupSaveListener(win);
  setupControllerBridge(win);
  setupChromeBridge(win);

  // Inject all scripts in order, then inject settings
  var chain = Promise.resolve();
  INJECT_SCRIPTS.forEach(function(path) {
    chain = chain.then(function() {
      return injectScript(doc, path);
    });
  });

  chain.then(function() {
    // Inject site-specific scripts
    injectSiteSpecificScripts(doc);
    // Inject user settings into page context
    injectSettings(win);
  }).catch(function(err) {
    Cu.reportError("VSC: Module injection failed: " + err);
  });
}

// Listen for DOMContentLoaded in all frames (including iframes)
addEventListener("DOMContentLoaded", injectIntoDocument, false);
