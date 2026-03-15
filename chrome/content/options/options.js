/**
 * Video Speed Controller — Options page (UXP/chrome context)
 * Has direct access to Components and XPCOM.
 */

Components.utils.import("chrome://videospeed/modules/VSCPrefs.jsm");

var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tcDefaults = {
  speed: 1.0,
  displayKeyCode: 86,
  rememberSpeed: false,
  audioBoolean: true,
  startHidden: false,
  forceLastSavedSpeed: false,
  enabled: true,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  logLevel: 3,
  keyBindings: [
    { action: "display", key: 86, value: 0, force: false, predefined: true },
    { action: "slower", key: 83, value: 0.1, force: false, predefined: true },
    { action: "faster", key: 68, value: 0.1, force: false, predefined: true },
    { action: "rewind", key: 90, value: 10, force: false, predefined: true },
    { action: "advance", key: 88, value: 10, force: false, predefined: true },
    { action: "reset", key: 82, value: 1, force: false, predefined: true },
    { action: "fast", key: 71, value: 1.8, force: false, predefined: true },
    { action: "mark", key: 77, value: 0, force: false, predefined: true },
    { action: "jump", key: 74, value: 0, force: false, predefined: true }
  ],
  blacklist: "www.instagram.com\nx.com\nimgur.com\nteams.microsoft.com"
};

var keyBindings = [];

var keyCodeAliases = {
  0: "null", null: "null", undefined: "null",
  32: "Space", 37: "Left", 38: "Up", 39: "Right", 40: "Down",
  96: "Num 0", 97: "Num 1", 98: "Num 2", 99: "Num 3",
  100: "Num 4", 101: "Num 5", 102: "Num 6", 103: "Num 7",
  104: "Num 8", 105: "Num 9", 106: "Num *", 107: "Num +",
  109: "Num -", 110: "Num .", 111: "Num /",
  112: "F1", 113: "F2", 114: "F3", 115: "F4",
  116: "F5", 117: "F6", 118: "F7", 119: "F8",
  120: "F9", 121: "F10", 122: "F11", 123: "F12",
  186: ";", 188: "<", 189: "-", 187: "+",
  190: ">", 191: "/", 192: "~", 219: "[",
  220: "\\", 221: "]", 222: "'"
};

var customActionsNoValues = ["pause", "muted", "mark", "jump", "display"];

function recordKeyPress(e) {
  if (
    (e.keyCode >= 48 && e.keyCode <= 57) ||
    (e.keyCode >= 65 && e.keyCode <= 90) ||
    keyCodeAliases[e.keyCode]
  ) {
    e.target.value = keyCodeAliases[e.keyCode] || String.fromCharCode(e.keyCode);
    e.target.keyCode = e.keyCode;
    e.preventDefault();
    e.stopPropagation();
  } else if (e.keyCode === 8) {
    e.target.value = "";
  } else if (e.keyCode === 27) {
    e.target.value = "null";
    e.target.keyCode = null;
  }
}

function inputFilterNumbersOnly(e) {
  var char = String.fromCharCode(e.keyCode);
  if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(e.target.value + char)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function inputFocus(e) { e.target.value = ""; }

function inputBlur(e) {
  e.target.value = keyCodeAliases[e.target.keyCode] || String.fromCharCode(e.target.keyCode);
}

function updateCustomShortcutInputText(inputItem, keyCode) {
  inputItem.value = keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
  inputItem.keyCode = keyCode;
}

function add_shortcut() {
  var html =
    '<select class="customDo">' +
    '<option value="slower">Decrease speed</option>' +
    '<option value="faster">Increase speed</option>' +
    '<option value="rewind">Rewind</option>' +
    '<option value="advance">Advance</option>' +
    '<option value="reset">Reset speed</option>' +
    '<option value="fast">Preferred speed</option>' +
    '<option value="muted">Mute</option>' +
    '<option value="softer">Decrease volume</option>' +
    '<option value="louder">Increase volume</option>' +
    '<option value="pause">Pause</option>' +
    '<option value="mark">Set marker</option>' +
    '<option value="jump">Jump to marker</option>' +
    '<option value="display">Show/hide controller</option>' +
    '</select>' +
    '<input class="customKey" type="text" placeholder="press a key"/>' +
    '<input class="customValue" type="text" placeholder="value (0.10)"/>' +
    '<select class="customForce">' +
    '<option value="false">Do not disable website key bindings</option>' +
    '<option value="true">Disable website key bindings</option>' +
    '</select>' +
    '<button class="removeParent">X</button>';
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(
    div,
    customs_element.children[customs_element.childElementCount - 1]
  );
}

function createKeyBindings(item) {
  var action = item.querySelector(".customDo").value;
  var key = item.querySelector(".customKey").keyCode;
  var value = Number(item.querySelector(".customValue").value);
  var force = item.querySelector(".customForce").value;
  var predefined = !!item.id;
  keyBindings.push({
    action: action, key: key, value: value, force: force, predefined: predefined
  });
}

function validate() {
  var valid = true;
  var status = document.getElementById("status");
  var blacklist = document.getElementById("blacklist");

  blacklist.value.split("\n").forEach(function(match) {
    match = match.replace(regStrip, "");
    if (match.startsWith("/")) {
      try {
        var parts = match.split("/");
        if (parts.length < 3) throw "invalid regex";
        var flags = parts.pop();
        var regex = parts.slice(1).join("/");
        new RegExp(regex, flags);
      } catch(err) {
        status.textContent = 'Error: Invalid blacklist regex: "' + match + '". Unable to save.';
        valid = false;
      }
    }
  });
  return valid;
}

function save_options() {
  if (validate() === false) return;

  keyBindings = [];
  Array.from(document.querySelectorAll(".customs")).forEach(function(item) {
    createKeyBindings(item);
  });

  VSCPrefs.setMultiple({
    rememberSpeed: document.getElementById("rememberSpeed").checked,
    forceLastSavedSpeed: document.getElementById("forceLastSavedSpeed").checked,
    audioBoolean: document.getElementById("audioBoolean").checked,
    enabled: document.getElementById("enabled").checked,
    startHidden: document.getElementById("startHidden").checked,
    controllerOpacity: document.getElementById("controllerOpacity").value,
    controllerButtonSize: document.getElementById("controllerButtonSize").value,
    logLevel: document.getElementById("logLevel").value,
    keyBindings: keyBindings,
    blacklist: document.getElementById("blacklist").value.replace(regStrip, "")
  });

  var status = document.getElementById("status");
  status.textContent = "Options saved";
  setTimeout(function() { status.textContent = ""; }, 1000);
}

function restore_options() {
  var storage = VSCPrefs.getAll();

  document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
  document.getElementById("forceLastSavedSpeed").checked = storage.forceLastSavedSpeed;
  document.getElementById("audioBoolean").checked = storage.audioBoolean;
  document.getElementById("enabled").checked = storage.enabled;
  document.getElementById("startHidden").checked = storage.startHidden;
  document.getElementById("controllerOpacity").value = storage.controllerOpacity;
  document.getElementById("controllerButtonSize").value = storage.controllerButtonSize;
  document.getElementById("logLevel").value = storage.logLevel;
  document.getElementById("blacklist").value = storage.blacklist;

  var bindings = storage.keyBindings || [];
  if (!bindings.some(function(x) { return x.action === "display"; })) {
    bindings.push({
      action: "display", key: storage.displayKeyCode || 86,
      value: 0, force: false, predefined: true
    });
  }

  for (var i = 0; i < bindings.length; i++) {
    var item = bindings[i];
    if (item.predefined) {
      if (item.action === "display" && typeof item.key === "undefined") {
        item.key = storage.displayKeyCode || tcDefaults.displayKeyCode;
      }
      if (customActionsNoValues.indexOf(item.action) !== -1) {
        document.querySelector("#" + item.action + " .customValue").disabled = true;
      }
      updateCustomShortcutInputText(
        document.querySelector("#" + item.action + " .customKey"),
        item.key
      );
      document.querySelector("#" + item.action + " .customValue").value = item.value;
      document.querySelector("#" + item.action + " .customForce").value = item.force;
    } else {
      add_shortcut();
      var dom = document.querySelector(".customs:last-of-type");
      dom.querySelector(".customDo").value = item.action;
      if (customActionsNoValues.indexOf(item.action) !== -1) {
        dom.querySelector(".customValue").disabled = true;
      }
      updateCustomShortcutInputText(dom.querySelector(".customKey"), item.key);
      dom.querySelector(".customValue").value = item.value;
      dom.querySelector(".customForce").value = item.force;
    }
  }
}

function restore_defaults() {
  VSCPrefs.setMultiple({
    rememberSpeed: tcDefaults.rememberSpeed,
    forceLastSavedSpeed: tcDefaults.forceLastSavedSpeed,
    audioBoolean: tcDefaults.audioBoolean,
    enabled: tcDefaults.enabled,
    startHidden: tcDefaults.startHidden,
    controllerOpacity: tcDefaults.controllerOpacity,
    controllerButtonSize: tcDefaults.controllerButtonSize,
    logLevel: tcDefaults.logLevel,
    keyBindings: tcDefaults.keyBindings,
    blacklist: tcDefaults.blacklist
  });
  restore_options();
  document.querySelectorAll(".removeParent").forEach(function(button) {
    button.click();
  });
  var status = document.getElementById("status");
  status.textContent = "Default options restored";
  setTimeout(function() { status.textContent = ""; }, 1000);
}

function show_experimental() {
  var forceElements = document.querySelectorAll(".customForce");
  var button = document.getElementById("experimental");
  if (forceElements.length > 0) {
    forceElements.forEach(function(item) {
      item.style.display = "inline-block";
    });
    button.textContent = "Experimental features enabled";
    button.disabled = true;
  }
}

document.addEventListener("DOMContentLoaded", function() {
  restore_options();

  document.getElementById("save").addEventListener("click", save_options);
  document.getElementById("add").addEventListener("click", add_shortcut);
  document.getElementById("restore").addEventListener("click", restore_defaults);
  document.getElementById("experimental").addEventListener("click", show_experimental);

  document.getElementById("about").addEventListener("click", function() {
    var mainWindow = Components.classes["@mozilla.org/appshell/window-mediator;1"]
      .getService(Components.interfaces.nsIWindowMediator)
      .getMostRecentWindow("navigator:browser");
    if (mainWindow && mainWindow.gBrowser) {
      mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(
        "https://github.com/igrigorik/videospeed"
      );
    }
  });

  function eventCaller(event, className, funcName) {
    if (!event.target.classList.contains(className)) return;
    funcName(event);
  }

  document.addEventListener("keypress", function(event) {
    eventCaller(event, "customValue", inputFilterNumbersOnly);
  });
  document.addEventListener("focus", function(event) {
    eventCaller(event, "customKey", inputFocus);
  }, true);
  document.addEventListener("blur", function(event) {
    eventCaller(event, "customKey", inputBlur);
  }, true);
  document.addEventListener("keydown", function(event) {
    eventCaller(event, "customKey", recordKeyPress);
  });
  document.addEventListener("click", function(event) {
    eventCaller(event, "removeParent", function() {
      event.target.parentNode.remove();
    });
  });
  document.addEventListener("change", function(event) {
    eventCaller(event, "customDo", function() {
      if (customActionsNoValues.indexOf(event.target.value) !== -1) {
        event.target.nextElementSibling.nextElementSibling.disabled = true;
        event.target.nextElementSibling.nextElementSibling.value = 0;
      } else {
        event.target.nextElementSibling.nextElementSibling.disabled = false;
      }
    });
  });
});
