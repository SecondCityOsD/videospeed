"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://videospeed/modules/VSCPrefs.jsm");

var VideoSpeedOverlay = {

  // Track active controllers per browser (tab)
  _tabControllers: new WeakMap(),

  /**
   * Initialize the overlay — called once when the browser window loads.
   */
  init: function() {
    // Load frame script into all current and future tabs
    window.messageManager.loadFrameScript(
      "chrome://videospeed/content/framescript.js", true
    );

    // Listen for messages from frame scripts
    window.messageManager.addMessageListener(
      "VSC:ControllerCreated", this
    );
    window.messageManager.addMessageListener(
      "VSC:ControllerRemoved", this
    );

    // Listen for tab events
    gBrowser.tabContainer.addEventListener("TabClose", this, false);
    gBrowser.tabContainer.addEventListener("TabSelect", this, false);

    // Set initial icon state
    this.updateIcon(false);
  },

  /**
   * Cleanup — called when the browser window unloads.
   */
  uninit: function() {
    window.messageManager.removeMessageListener(
      "VSC:ControllerCreated", this
    );
    window.messageManager.removeMessageListener(
      "VSC:ControllerRemoved", this
    );

    gBrowser.tabContainer.removeEventListener("TabClose", this, false);
    gBrowser.tabContainer.removeEventListener("TabSelect", this, false);

    // Remove frame script from future tabs
    window.messageManager.removeDelayedFrameScript(
      "chrome://videospeed/content/framescript.js"
    );
  },

  /**
   * Unified event/message handler.
   */
  handleEvent: function(event) {
    switch (event.type) {
      case "TabClose":
        this._onTabClose(event);
        break;
      case "TabSelect":
        this._onTabSelect(event);
        break;
    }
  },

  receiveMessage: function(message) {
    var browser = message.target;
    switch (message.name) {
      case "VSC:ControllerCreated":
        this._onControllerCreated(browser, message.data);
        break;
      case "VSC:ControllerRemoved":
        this._onControllerRemoved(browser, message.data);
        break;
    }
  },

  // --- Controller tracking ---

  _getControllerSet: function(browser) {
    var set = this._tabControllers.get(browser);
    if (!set) {
      set = new Set();
      this._tabControllers.set(browser, set);
    }
    return set;
  },

  _onControllerCreated: function(browser, data) {
    var set = this._getControllerSet(browser);
    set.add(data.controllerId || "default");
    // Update icon if this is the active tab
    if (browser === gBrowser.selectedBrowser) {
      this.updateIcon(true);
    }
  },

  _onControllerRemoved: function(browser, data) {
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

  // --- Icon ---

  updateIcon: function(active) {
    var button = document.getElementById("videospeed-button");
    if (button) {
      var suffix = active ? "" : "_disabled";
      button.image = "chrome://videospeed/skin/icon19" + suffix + ".png";
    }
  },

  // --- Popup panel ---

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
    // Notify popup frame that it's visible (so it can refresh state)
    var frame = document.getElementById("videospeed-popup-frame");
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage({ type: "VSC_PANEL_SHOWN" }, "*");
      } catch(e) { /* iframe not ready */ }
    }
  },

  onPanelHidden: function() {
    // nothing to do
  },

  /**
   * Send a message to the content script in the active tab.
   */
  sendToActiveTab: function(messageName, data) {
    var browser = gBrowser.selectedBrowser;
    browser.messageManager.sendAsyncMessage(messageName, data);
  },

  /**
   * Open the options page in a new tab.
   */
  openOptions: function() {
    gBrowser.selectedTab = gBrowser.addTab(
      "chrome://videospeed/content/options/options.html"
    );
  }
};

// Initialize on window load
window.addEventListener("load", function() {
  VideoSpeedOverlay.init();
}, false);

window.addEventListener("unload", function() {
  VideoSpeedOverlay.uninit();
}, false);
