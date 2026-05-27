/**
 * Video Speed Controller — Popup (XUL, UXP/chrome context)
 * Updated for 0.10.2 features
 */

Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

function getMainWindow() {
  var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Components.interfaces.nsIWindowMediator);
  return wm.getMostRecentWindow("navigator:browser");
}

function sendToContent(messageName, data) {
  var mainWindow = getMainWindow();
  if (mainWindow && mainWindow.gBrowser) {
    var browser = mainWindow.gBrowser.selectedBrowser;
    if (browser && browser.contentDocument) {
      browser.contentDocument.documentElement.dispatchEvent(
        new CustomEvent('VSC_MESSAGE', { detail: data })
      );
    }
  }
}

window.addEventListener("load", function() {
  loadSettingsAndInitialize();

  document.getElementById("config").addEventListener("command", function() {
    var mainWindow = getMainWindow();
    if (mainWindow && mainWindow.gBrowser) {
      mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(
        "chrome://videospeed/content/options/options.xul"
      );
    }
    var panel = getMainWindow().document.getElementById("videospeed-panel");
    if (panel) panel.hidePopup();
  });

  document.getElementById("disable").addEventListener("command", function() {
    var isCurrentlyEnabled = this.getAttribute("disabled-state") !== "true";
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

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
    // VSCPrefs.getAll() already parses JSON_KEYS (keyBindings, speeds) into
    // their structured form, so we just read `bindings` as an array.
    var settings = VSCPrefs.getAll();
    var bindings = Array.isArray(settings.keyBindings) ? settings.keyBindings : [];

    function valueFor(action, fallback) {
      var match = bindings.find(function(kb) { return kb.action === action; });
      return (match && typeof match.value === 'number') ? match.value : fallback;
    }

    updateSpeedControlsUI(
      valueFor('slower', 0.1),
      valueFor('faster', 0.1),
      valueFor('fast', 1.0)
    );
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
      sendToContent("VSC_MESSAGE", { type: "VSC_ADJUST_SPEED", payload: { delta: delta } });
    });

    document.getElementById("speed-increase").addEventListener("command", function() {
      var delta = parseFloat(this.getAttribute("delta"));
      sendToContent("VSC_MESSAGE", { type: "VSC_ADJUST_SPEED", payload: { delta: delta } });
    });

    document.getElementById("speed-reset").addEventListener("command", function() {
      var preferredSpeed = parseFloat(this.getAttribute("label"));
      sendToContent("VSC_MESSAGE", { type: "VSC_SET_SPEED", payload: { speed: preferredSpeed } });
    });

    var presetBtns = document.querySelectorAll(".preset-btn");
    Array.prototype.forEach.call(presetBtns, function(btn) {
      btn.addEventListener("command", function() {
        var speed = parseFloat(this.getAttribute("speed"));
        sendToContent("VSC_MESSAGE", { type: "VSC_SET_SPEED", payload: { speed: speed } });
      });
    });
  }
});