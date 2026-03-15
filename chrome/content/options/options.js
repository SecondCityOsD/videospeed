/**
 * Video Speed Controller — Options page (XUL, UXP/chrome context)
 * Has direct access to Components and XPCOM.
 */

Components.utils.import("chrome://videospeed-modules/content/VSCPrefs.jsm");

var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

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

/**
 * Walk up the DOM to find an ancestor (or self) with a given class.
 * Needed because XUL textbox events may target anonymous inner elements.
 */
function findAncestorWithClass(el, className) {
  while (el && el !== document) {
    if (el.classList && el.classList.contains(className)) return el;
    el = el.parentNode;
  }
  return null;
}

function recordKeyPress(e) {
  var target = findAncestorWithClass(e.target, "customKey") || e.target;
  if (
    (e.keyCode >= 48 && e.keyCode <= 57) ||
    (e.keyCode >= 65 && e.keyCode <= 90) ||
    keyCodeAliases[e.keyCode]
  ) {
    target.value = keyCodeAliases[e.keyCode] || String.fromCharCode(e.keyCode);
    target.keyCode = e.keyCode;
    e.preventDefault();
    e.stopPropagation();
  } else if (e.keyCode === 8) {
    target.value = "";
  } else if (e.keyCode === 27) {
    target.value = "null";
    target.keyCode = null;
  }
}

function inputFilterNumbersOnly(e) {
  var target = findAncestorWithClass(e.target, "customValue") || e.target;
  var char = String.fromCharCode(e.keyCode);
  if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(target.value + char)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function inputFocus(e) {
  var target = findAncestorWithClass(e.target, "customKey") || e.target;
  target.value = "";
}

function inputBlur(e) {
  var target = findAncestorWithClass(e.target, "customKey") || e.target;
  target.value = keyCodeAliases[target.keyCode] || String.fromCharCode(target.keyCode);
}

function updateCustomShortcutInputText(inputItem, keyCode) {
  inputItem.value = keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
  inputItem.keyCode = keyCode;
}

function add_shortcut() {
  var hbox = document.createElementNS(XUL_NS, "hbox");
  hbox.setAttribute("class", "customs shortcut-row");
  hbox.setAttribute("align", "center");

  // Action menulist
  var menulist = document.createElementNS(XUL_NS, "menulist");
  menulist.setAttribute("class", "customDo");
  var menupopup = document.createElementNS(XUL_NS, "menupopup");
  var actions = [
    { label: "Decrease speed", value: "slower" },
    { label: "Increase speed", value: "faster" },
    { label: "Rewind", value: "rewind" },
    { label: "Advance", value: "advance" },
    { label: "Reset speed", value: "reset" },
    { label: "Preferred speed", value: "fast" },
    { label: "Mute", value: "muted" },
    { label: "Decrease volume", value: "softer" },
    { label: "Increase volume", value: "louder" },
    { label: "Pause", value: "pause" },
    { label: "Set marker", value: "mark" },
    { label: "Jump to marker", value: "jump" },
    { label: "Show/hide controller", value: "display" }
  ];
  actions.forEach(function(a) {
    var item = document.createElementNS(XUL_NS, "menuitem");
    item.setAttribute("label", a.label);
    item.setAttribute("value", a.value);
    menupopup.appendChild(item);
  });
  menulist.appendChild(menupopup);
  hbox.appendChild(menulist);

  // Key textbox
  var keyBox = document.createElementNS(XUL_NS, "textbox");
  keyBox.setAttribute("class", "customKey");
  keyBox.setAttribute("placeholder", "press a key");
  keyBox.setAttribute("size", "8");
  hbox.appendChild(keyBox);

  // Value textbox
  var valBox = document.createElementNS(XUL_NS, "textbox");
  valBox.setAttribute("class", "customValue");
  valBox.setAttribute("placeholder", "value (0.10)");
  valBox.setAttribute("size", "8");
  hbox.appendChild(valBox);

  // Force menulist (hidden by default)
  var forceList = document.createElementNS(XUL_NS, "menulist");
  forceList.setAttribute("class", "customForce");
  forceList.hidden = true;
  var forcePop = document.createElementNS(XUL_NS, "menupopup");
  [
    { label: "Do not disable website key bindings", value: "false" },
    { label: "Disable website key bindings", value: "true" }
  ].forEach(function(a) {
    var item = document.createElementNS(XUL_NS, "menuitem");
    item.setAttribute("label", a.label);
    item.setAttribute("value", a.value);
    forcePop.appendChild(item);
  });
  forceList.appendChild(forcePop);
  hbox.appendChild(forceList);

  // Remove button
  var removeBtn = document.createElementNS(XUL_NS, "button");
  removeBtn.setAttribute("class", "removeParent");
  removeBtn.setAttribute("label", "X");
  hbox.appendChild(removeBtn);

  document.getElementById("shortcut-rows").appendChild(hbox);
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
        status.setAttribute("value",
          'Error: Invalid blacklist regex: "' + match + '". Unable to save.');
        valid = false;
      }
    }
  });
  return valid;
}

function save_options() {
  if (validate() === false) return;

  keyBindings = [];
  var customs = document.querySelectorAll(".customs");
  Array.prototype.forEach.call(customs, function(item) {
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
  status.setAttribute("value", "Options saved");
  setTimeout(function() { status.setAttribute("value", ""); }, 1000);
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
      var dom = document.querySelector("#shortcut-rows > .customs:last-child");
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

  // Remove dynamically-added shortcuts before restoring
  var removes = document.querySelectorAll(".removeParent");
  Array.prototype.forEach.call(removes, function(button) {
    button.parentNode.parentNode.removeChild(button.parentNode);
  });

  restore_options();

  var status = document.getElementById("status");
  status.setAttribute("value", "Default options restored");
  setTimeout(function() { status.setAttribute("value", ""); }, 1000);
}

function show_experimental() {
  var button = document.getElementById("experimental");

  // Show the customForce selects in shortcut rows
  var forceElements = document.querySelectorAll(".customForce");
  Array.prototype.forEach.call(forceElements, function(item) {
    item.hidden = false;
  });

  // Show the advanced settings container
  var advanced = document.getElementById("advanced-settings");
  if (advanced) advanced.hidden = false;

  button.setAttribute("label", "Advanced features enabled");
  button.disabled = true;
}

window.addEventListener("load", function() {
  restore_options();

  document.getElementById("save").addEventListener("command", save_options);
  document.getElementById("add").addEventListener("command", add_shortcut);
  document.getElementById("restore").addEventListener("command", restore_defaults);
  document.getElementById("experimental").addEventListener("command", show_experimental);

  function openInTab(url) {
    var mainWindow = Components.classes["@mozilla.org/appshell/window-mediator;1"]
      .getService(Components.interfaces.nsIWindowMediator)
      .getMostRecentWindow("navigator:browser");
    if (mainWindow && mainWindow.gBrowser) {
      mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(url);
    }
  }

  document.getElementById("about").addEventListener("command", function() {
    openInTab("https://github.com/SecondCityOsD/videospeed");
  });

  document.getElementById("feedback").addEventListener("command", function() {
    openInTab("https://github.com/SecondCityOsD/videospeed/issues");
  });

  // Event delegation for dynamic shortcut rows
  document.addEventListener("keypress", function(event) {
    var target = findAncestorWithClass(event.target, "customValue");
    if (target) {
      var char = String.fromCharCode(event.keyCode);
      if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(target.value + char)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  });

  document.addEventListener("focus", function(event) {
    var target = findAncestorWithClass(event.target, "customKey");
    if (target) target.value = "";
  }, true);

  document.addEventListener("blur", function(event) {
    var target = findAncestorWithClass(event.target, "customKey");
    if (target) {
      target.value = keyCodeAliases[target.keyCode] || String.fromCharCode(target.keyCode);
    }
  }, true);

  document.addEventListener("keydown", function(event) {
    var target = findAncestorWithClass(event.target, "customKey");
    if (target) {
      recordKeyPress({
        target: target,
        keyCode: event.keyCode,
        preventDefault: function() { event.preventDefault(); },
        stopPropagation: function() { event.stopPropagation(); }
      });
    }
  });

  document.addEventListener("command", function(event) {
    // Remove button clicked
    if (event.target.classList && event.target.classList.contains("removeParent")) {
      event.target.parentNode.parentNode.removeChild(event.target.parentNode);
      return;
    }

    // Action menulist changed — enable/disable value input
    var menulist = findAncestorWithClass(event.target, "customDo");
    if (menulist) {
      var row = findAncestorWithClass(menulist, "customs");
      if (row) {
        var valueBox = row.querySelector(".customValue");
        if (customActionsNoValues.indexOf(menulist.value) !== -1) {
          valueBox.disabled = true;
          valueBox.value = 0;
        } else {
          valueBox.disabled = false;
        }
      }
    }
  });
});
