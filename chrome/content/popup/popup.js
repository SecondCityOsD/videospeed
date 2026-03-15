/**
 * Video Speed Controller — Popup (UXP/chrome context)
 * Has direct access to Components and XPCOM.
 */

Components.utils.import("chrome://videospeed/modules/VSCPrefs.jsm");

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

document.addEventListener("DOMContentLoaded", function() {
  loadSettingsAndInitialize();

  // Settings button — open options in a new tab
  document.querySelector("#config").addEventListener("click", function() {
    var mainWindow = getMainWindow();
    if (mainWindow && mainWindow.gBrowser) {
      mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(
        "chrome://videospeed/content/options/options.html"
      );
    }
    // Close the popup panel
    var panel = getMainWindow().document.getElementById("videospeed-panel");
    if (panel) panel.hidePopup();
  });

  // Power button toggle
  document.querySelector("#disable").addEventListener("click", function() {
    var isCurrentlyEnabled = !this.classList.contains("disabled");
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
    var disableBtn = document.querySelector("#disable");
    disableBtn.classList.toggle("disabled", !enabled);
    disableBtn.title = enabled ? "Disable Extension" : "Enable Extension";

    // Update toolbar icon in main window
    var mainWindow = getMainWindow();
    if (mainWindow) {
      var button = mainWindow.document.getElementById("videospeed-button");
      if (button) {
        var suffix = enabled ? "_disabled" : "_disabled";
        // When disabled globally, always show gray; when enabled, let overlay.js manage it
        button.image = "chrome://videospeed/skin/icon19" +
          (enabled ? "" : "_disabled") + ".png";
      }
    }
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage((enabled ? "Enabled" : "Disabled") + ". Reload page.");
  }

  function setStatusMessage(str) {
    var status = document.querySelector("#status");
    status.classList.toggle("hide", false);
    status.innerText = str;
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
    initializeSpeedControls(slowerStep, fasterStep);
  }

  function updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed) {
    var decreaseBtn = document.querySelector("#speed-decrease");
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector("span").textContent = "-" + slowerStep;
    }

    var increaseBtn = document.querySelector("#speed-increase");
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector("span").textContent = "+" + fasterStep;
    }

    var resetBtn = document.querySelector("#speed-reset");
    if (resetBtn) {
      resetBtn.textContent = resetSpeed.toString();
    }
  }

  function initializeSpeedControls() {
    document.querySelector("#speed-decrease").addEventListener("click", function() {
      var delta = parseFloat(this.dataset.delta);
      sendToContent("VSC:AdjustSpeed", { delta: delta });
    });

    document.querySelector("#speed-increase").addEventListener("click", function() {
      var delta = parseFloat(this.dataset.delta);
      sendToContent("VSC:AdjustSpeed", { delta: delta });
    });

    document.querySelector("#speed-reset").addEventListener("click", function() {
      var preferredSpeed = parseFloat(this.textContent);
      sendToContent("VSC:SetSpeed", { speed: preferredSpeed });
    });

    document.querySelectorAll(".preset-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var speed = parseFloat(this.dataset.speed);
        sendToContent("VSC:SetSpeed", { speed: speed });
      });
    });
  }
});
