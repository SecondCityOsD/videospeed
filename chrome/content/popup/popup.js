/**
 * Video Speed Controller — Popup (XUL, UXP/chrome context)
 * Has direct access to Components and XPCOM.
 */

Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

/**
 * Get the main browser window.
 */
function getMainWindow() {
  var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Components.interfaces.nsIWindowMediator);
  return wm.getMostRecentWindow("navigator:browser");
}

/**
 * Send a message to the active tab's content script via the message manager.
 */
function sendToContent(messageName, data) {
  var mainWindow = getMainWindow();
  if (mainWindow && mainWindow.gBrowser) {
    mainWindow.gBrowser.selectedBrowser.messageManager
      .sendAsyncMessage(messageName, data || {});
  }
}

window.addEventListener("load", function() {
  loadSettingsAndInitialize();

  // Settings button — open options in a new tab
  document.getElementById("config").addEventListener("command", function() {
    var mainWindow = getMainWindow();
    if (mainWindow && mainWindow.gBrowser) {
      mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(
        "chrome://videospeed/content/options/options.xul"
      );
    }
    // Close the popup panel
    var panel = getMainWindow().document.getElementById("videospeed-panel");
    if (panel) panel.hidePopup();
  });

  // Power button toggle
  document.getElementById("disable").addEventListener("command", function() {
    var isCurrentlyEnabled = this.getAttribute("disabled-state") !== "true";
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Initialize enabled state
  var enabled = true;
  try { enabled = VSCPrefs.branch.getBoolPref("enabled"); } catch(e) {}
  toggleEnabledUI(enabled);

  function toggleEnabled(enabled, callback) {
    VSCPrefs.set("enabled", enabled);
    toggleEnabledUI(enabled);
    if (callback) callback(enabled);
  }

  function toggleEnabledUI(enabled) {
    var disableBtn = document.getElementById("disable");
    if (enabled) {
      disableBtn.removeAttribute("disabled-state");
    } else {
      disableBtn.setAttribute("disabled-state", "true");
    }
    disableBtn.setAttribute("tooltiptext",
      enabled ? "Disable Extension" : "Enable Extension");

    // Update toolbar icon in main window
    var mainWindow = getMainWindow();
    if (mainWindow) {
      var button = mainWindow.document.getElementById("videospeed-button");
      if (button) {
        if (enabled) {
          button.removeAttribute("status");
        } else {
          button.setAttribute("status", "disabled");
        }
      }
    }
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage((enabled ? "Enabled" : "Disabled") + ". Reload page.");
  }

  function setStatusMessage(str) {
    var status = document.getElementById("status");
    status.hidden = false;
    status.setAttribute("value", str);
  }

  function loadSettingsAndInitialize() {
    var settings = VSCPrefs.getAll();

    var slowerStep = 0.1;
    var fasterStep = 0.1;
    var resetSpeed = 1.0;

    if (settings.keyBindings && Array.isArray(settings.keyBindings)) {
      var slowerBinding = settings.keyBindings.find(function(kb) {
        return kb.action === "slower";
      });
      var fasterBinding = settings.keyBindings.find(function(kb) {
        return kb.action === "faster";
      });
      var fastBinding = settings.keyBindings.find(function(kb) {
        return kb.action === "fast";
      });

      if (slowerBinding && typeof slowerBinding.value === "number") {
        slowerStep = slowerBinding.value;
      }
      if (fasterBinding && typeof fasterBinding.value === "number") {
        fasterStep = fasterBinding.value;
      }
      if (fastBinding && typeof fastBinding.value === "number") {
        resetSpeed = fastBinding.value;
      }
    }

    updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed);
    initializeSpeedControls();
  }

  function updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed) {
    var decreaseBtn = document.getElementById("speed-decrease");
    if (decreaseBtn) {
      decreaseBtn.setAttribute("delta", -slowerStep);
      decreaseBtn.setAttribute("label", "-" + slowerStep);
    }

    var increaseBtn = document.getElementById("speed-increase");
    if (increaseBtn) {
      increaseBtn.setAttribute("delta", fasterStep);
      increaseBtn.setAttribute("label", "+" + fasterStep);
    }

    var resetBtn = document.getElementById("speed-reset");
    if (resetBtn) {
      resetBtn.setAttribute("label", resetSpeed.toString());
    }
  }

  function initializeSpeedControls() {
    document.getElementById("speed-decrease").addEventListener("command", function() {
      var delta = parseFloat(this.getAttribute("delta"));
      sendToContent("VSC:AdjustSpeed", { delta: delta });
    });

    document.getElementById("speed-increase").addEventListener("command", function() {
      var delta = parseFloat(this.getAttribute("delta"));
      sendToContent("VSC:AdjustSpeed", { delta: delta });
    });

    document.getElementById("speed-reset").addEventListener("command", function() {
      var preferredSpeed = parseFloat(this.getAttribute("label"));
      sendToContent("VSC:SetSpeed", { speed: preferredSpeed });
    });

    var presetBtns = document.querySelectorAll(".preset-btn");
    Array.prototype.forEach.call(presetBtns, function(btn) {
      btn.addEventListener("command", function() {
        var speed = parseFloat(this.getAttribute("speed"));
        sendToContent("VSC:SetSpeed", { speed: speed });
      });
    });
  }
});
