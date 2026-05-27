"use strict";

var EXPORTED_SYMBOLS = ["VSCPrefs"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

var VSCPrefs = {
  BRANCH: "extensions.videospeed.",

  _branch: null,
  get branch() {
    if (!this._branch) {
      this._branch = Services.prefs.getBranch(this.BRANCH);
    }
    return this._branch;
  },

  BOOL_KEYS: ["enabled", "rememberSpeed", "forceLastSavedSpeed", "audioBoolean", "startHidden"],
  INT_KEYS: ["controllerButtonSize", "logLevel", "displayKeyCode"],
  CHAR_KEYS: ["lastSpeed", "controllerOpacity", "blacklist", "keyBindings", "speeds"],
  JSON_KEYS: ["keyBindings", "speeds"],
  FLOAT_KEYS: ["lastSpeed", "controllerOpacity"],

  /**
   * Read all prefs and return a settings object matching the format
   * that the content scripts expect.
   */
  getAll: function() {
    var b = this.branch;
    var settings = {};

    this.BOOL_KEYS.forEach(function(key) {
      try { settings[key] = b.getBoolPref(key); }
      catch(e) { settings[key] = true; }
    });

    this.INT_KEYS.forEach(function(key) {
      try { settings[key] = b.getIntPref(key); }
      catch(e) { settings[key] = 0; }
    });

    this.CHAR_KEYS.forEach(function(key) {
      try { settings[key] = b.getCharPref(key); }
      catch(e) { settings[key] = ""; }
    });

    // Convert float strings to numbers
    this.FLOAT_KEYS.forEach(function(key) {
      settings[key] = parseFloat(settings[key]) || 0;
    });
    // Ensure sane defaults for floats
    if (!settings.lastSpeed) settings.lastSpeed = 1.0;
    if (!settings.controllerOpacity) settings.controllerOpacity = 0.3;

    // Parse JSON fields
    this.JSON_KEYS.forEach(function(key) {
      try {
        settings[key] = JSON.parse(settings[key]);
      } catch(e) {
        settings[key] = (key === "speeds") ? {} : [];
      }
    });

    return settings;
  },

  /**
   * Set a single preference value.
   */
  set: function(key, value) {
    var b = this.branch;

    if (this.JSON_KEYS.indexOf(key) !== -1) {
      b.setCharPref(key, JSON.stringify(value));
    } else if (this.BOOL_KEYS.indexOf(key) !== -1) {
      b.setBoolPref(key, !!value);
    } else if (this.INT_KEYS.indexOf(key) !== -1) {
      b.setIntPref(key, parseInt(value, 10));
    } else {
      // CHAR_KEYS and anything else
      b.setCharPref(key, String(value));
    }
  },

  /**
   * Set multiple preferences at once.
   */
  setMultiple: function(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        this.set(key, obj[key]);
      }
    }
  },

  /**
   * Add a pref observer. Returns the observer object (needed for removal).
   */
  addObserver: function(callback) {
    var observer = {
      observe: function(subject, topic, data) {
        if (topic === "nsPref:changed") {
          callback(data);
        }
      }
    };
    this.branch.addObserver("", observer, false);
    return observer;
  },

  /**
   * Remove a pref observer.
   */
  removeObserver: function(observer) {
    try {
      this.branch.removeObserver("", observer);
    } catch(e) {
      // Already removed or branch gone
    }
  }
};
