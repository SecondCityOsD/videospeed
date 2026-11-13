/**
 * Video Speed Controller — Popup (XUL, UXP/chrome context)
 * Tracks upstream 0.11.1 src/ui/popup/popup.js.
 */

Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

function getMainWindow() {
  var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Components.interfaces.nsIWindowMediator);
  return wm.getMostRecentWindow("navigator:browser");
}

// Deliver a popup command through the chrome-side bridges of the selected
// tab: every frame VSC is active in, as upstream's chrome.tabs.sendMessage
// reaches every frame's bridge.
function sendToContent(message) {
  var mainWindow = getMainWindow();
  if (!mainWindow || !mainWindow.VideoSpeedOverlay) return;
  try {
    mainWindow.VideoSpeedOverlay.sendToSelectedTab(message);
  } catch (e) {
    Components.utils.reportError('VSC popup: sendToContent failed: ' + e);
  }
}

window.addEventListener("load", function() {
  initializeSpeedControls();

  document.getElementById("config").addEventListener("command", function() {
    // Upstream: chrome.runtime.openOptionsPage() with options_ui.open_in_tab —
    // focuses the options tab when one is already open.
    var mainWindow = getMainWindow();
    if (mainWindow && mainWindow.switchToTabHavingURI) {
      mainWindow.switchToTabHavingURI("chrome://videospeed/content/options/options.xul", true);
    }
    var panel = getMainWindow().document.getElementById("videospeed-panel");
    if (panel) panel.hidePopup();
  });

  document.getElementById("disable").addEventListener("command", function() {
    var isCurrentlyEnabled = this.getAttribute("disabled-state") !== "true";
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Upstream's popup is a fresh page on every opening. The panel keeps this
  // document, so the overlay announces each opening (onPanelShown) and the
  // popup re-reads what upstream's would: shortcut values, the enabled state,
  // and no leftover status line.
  window.addEventListener("message", function(event) {
    if (event.data && event.data.type === "VSC_PANEL_SHOWN") {
      refresh();
    }
  });
  refresh();

  function refresh() {
    loadSettings();
    var enabled = true;
    try { enabled = VSCPrefs.branch.getBoolPref("enabled"); } catch(e) {}
    toggleEnabledUI(enabled);
    var status = document.getElementById("status");
    status.hidden = true;
    status.setAttribute("value", "");
    fitFrame();
  }

  // The panel's <iframe> starts at a guessed size (overlay.xul). Fit its
  // height to the content, which varies with fonts and DPI, so the panel ends
  // right below the buttons. Only while laid out, i.e. the panel is open.
  function fitFrame() {
    var frame = window.frameElement;
    var height = document.getElementById("popup-container").getBoundingClientRect().height;
    if (frame && height > 0) {
      frame.style.height = Math.ceil(height) + "px";
    }
  }

  // The toolbar icon follows the pref through the overlay's observer.
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
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage((enabled ? "Enabled" : "Disabled") + ". Reload page.");
  }

  function setStatusMessage(str) {
    var status = document.getElementById("status");
    status.hidden = false;
    status.setAttribute("value", str);
  }

  // Step and preferred-speed labels from the stored key bindings, with
  // upstream's fallbacks while none are stored.
  function loadSettings() {
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
      sendToContent({ type: "VSC_ADJUST_SPEED", payload: { delta: delta } });
    });

    document.getElementById("speed-increase").addEventListener("command", function() {
      var delta = parseFloat(this.getAttribute("delta"));
      sendToContent({ type: "VSC_ADJUST_SPEED", payload: { delta: delta } });
    });

    document.getElementById("speed-reset").addEventListener("command", function() {
      var preferredSpeed = parseFloat(this.getAttribute("label"));
      sendToContent({ type: "VSC_SET_SPEED", payload: { speed: preferredSpeed } });
    });

    var presetBtns = document.querySelectorAll(".preset-btn");
    Array.prototype.forEach.call(presetBtns, function(btn) {
      btn.addEventListener("command", function() {
        var speed = parseFloat(this.getAttribute("speed"));
        sendToContent({ type: "VSC_SET_SPEED", payload: { speed: speed } });
      });
    });
  }
});
