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

  BOOL_KEYS: ["enabled", "rememberSpeed", "exclusiveKeys", "audioBoolean", "startHidden"],
  INT_KEYS: ["controllerButtonSize", "logLevel", "schemaVersion"],
  CHAR_KEYS: ["lastSpeed", "controllerOpacity", "customCSS", "blacklist", "keyBindings", "siteRules"],
  JSON_KEYS: ["keyBindings", "siteRules"],
  FLOAT_KEYS: ["lastSpeed", "controllerOpacity"],

  // Keys upstream's background.js#migrateConfig removes on install/update.
  DEPRECATED_KEYS: [
    // Removed in v0.9.x
    "speeds",
    "version",
    // Replaced by smarter fight-back defaults in event-manager.js
    "forceLastSavedSpeed",
    // Migrated to keyBindings array in v0.6.x
    "resetSpeed",
    "speedStep",
    "fastSpeed",
    "rewindTime",
    "advanceTime",
    "resetKeyCode",
    "slowerKeyCode",
    "fasterKeyCode",
    "rewindKeyCode",
    "advanceKeyCode",
    "fastKeyCode",
    "displayKeyCode",
  ],

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

    // Float prefs are strings. "null" is a stored null — chrome.storage keeps
    // nulls, and an imported settings file can carry one (an exported
    // lastSpeed is null while rememberSpeed is off). Upstream's load() reads
    // both keys through Number(), so null and 0 pass through unchanged; only
    // unparseable text falls back to the default.
    var floatDefaults = { lastSpeed: 1.0, controllerOpacity: 0.3 };
    this.FLOAT_KEYS.forEach(function(key) {
      var value = parseFloat(settings[key]);
      settings[key] = (settings[key] === "null") ? null
        : isNaN(value) ? floatDefaults[key] : value;
    });

    // Parse JSON fields. Heal legacy double-encoded values: a prior
    // content-save bug pre-stringified objects before VSCPrefs.set re-encoded
    // them, so keyBindings could be stored as JSON.stringify(JSON.stringify(x)).
    // A single parse then yields a string — parse once more to recover it.
    // An empty siteRules pref means "absent" (null), as an unset key does in
    // upstream's storage: the legacy blacklist is consulted only then.
    this.JSON_KEYS.forEach(function(key) {
      if (key === "siteRules" && !settings[key]) {
        settings[key] = null;
        return;
      }
      try {
        var parsed = JSON.parse(settings[key]);
        if (typeof parsed === "string") {
          parsed = JSON.parse(parsed);
        }
        settings[key] = parsed;
      } catch(e) {
        settings[key] = (key === "siteRules") ? null : [];
      }
    });

    return settings;
  },

  /** Every settings key that has a pref. */
  get KEYS() {
    return this.BOOL_KEYS.concat(this.INT_KEYS, this.CHAR_KEYS);
  },

  /**
   * The settings as chrome.storage would hold them: only keys with a user
   * value, parsed as getAll() parses them. An untouched pref is absent, as an
   * unset key is in upstream's storage, so callers fill in their own defaults
   * (the options page's chrome-storage.js shim).
   */
  getStored: function() {
    var b = this.branch;
    var all = this.getAll();
    var stored = {};
    this.KEYS.forEach(function(key) {
      if (b.prefHasUserValue(key)) {
        stored[key] = all[key];
      }
    });
    return stored;
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
   * Drop a user value so the pref falls back to its default.
   */
  reset: function(key) {
    if (this.branch.prefHasUserValue(key)) {
      this.branch.clearUserPref(key);
    }
  },

  /**
   * Drop every user value on the branch — settings, deprecated keys and
   * anything else — as chrome.storage.sync.clear() empties upstream's storage.
   */
  resetAll: function() {
    var self = this;
    this.branch.getChildList("", {}).forEach(function(key) {
      self.reset(key);
    });
  },

  _migrated: false,

  /**
   * Storage migrations, once per application session. Upstream runs the same
   * steps from background.js on install/update (migrateConfig,
   * migrateKeyBindingsV2) and from settings.load() (blacklist → siteRules).
   */
  migrate: function() {
    if (this._migrated) return;
    this._migrated = true;

    var self = this;
    this.DEPRECATED_KEYS.forEach(function(key) {
      try { self.reset(key); } catch(e) {}
    });

    try {
      this.migrateBlacklist();
    } catch(e) {
      Cu.reportError("VSC: blacklist migration failed: " + e);
    }
    try {
      this.migrateKeyBindingsV2();
    } catch(e) {
      Cu.reportError("VSC: key binding migration failed: " + e);
    }
  },

  /**
   * Legacy blacklist → siteRules (one-shot). Only a blacklist the user
   * customized is migrated; an untouched one leaves the default siteRules in
   * place. The blacklist itself is kept, as upstream keeps it.
   */
  migrateBlacklist: function() {
    var b = this.branch;
    if (b.prefHasUserValue("siteRules") || !b.prefHasUserValue("blacklist")) return;
    var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
    var rules = b.getCharPref("blacklist")
      .split("\n")
      .map(function(line) { return line.replace(regStrip, ""); })
      .filter(Boolean)
      .map(function(pattern) { return { pattern: pattern, enabled: false, speed: null }; });
    this.set("siteRules", rules);
  },

  /**
   * Key-binding schema v2: keyCode integers → event.code strings. A port of
   * upstream background.js#migrateKeyBindingsV2, reading the same keyboard
   * maps from the shipped src/utils/key-maps.js:
   *   1. predefined bindings — hardcoded map, zero ambiguity
   *   2. custom bindings — KEYCODE_TO_CODE best-effort lookup
   *   3. unmappable keyCodes — code: null (already broken, user re-records)
   *   4. every predefined action exists
   * Idempotent; one write per key.
   */
  migrateKeyBindingsV2: function() {
    var settings = this.getAll();
    var bindings = settings.keyBindings;

    // No bindings stored → fresh install; the page uses v2 defaults directly.
    if (!Array.isArray(bindings) || bindings.length === 0) return;

    var allHaveCode = bindings.every(function(binding) { return binding.code !== undefined; });
    if (settings.schemaVersion === 2 && allHaveCode) return;

    var scope = { window: {} };
    Services.scriptloader.loadSubScript("resource://videospeed/utils/key-maps.js", scope, "UTF-8");
    var maps = scope.window.VSC;

    var migrated = bindings.map(function(binding) {
      if (binding.code !== undefined) return binding;
      var legacyKey = binding.key;
      if (binding.predefined && maps.PREDEFINED_CODE_MAP[legacyKey]) {
        var mapped = maps.PREDEFINED_CODE_MAP[legacyKey];
        return Object.assign({}, binding,
          { code: mapped.code, keyCode: legacyKey, displayKey: mapped.displayKey });
      }
      var code = maps.KEYCODE_TO_CODE[legacyKey];
      if (code) {
        return Object.assign({}, binding,
          { code: code, keyCode: legacyKey, displayKey: maps.displayKeyFromCode(code) });
      }
      return Object.assign({}, binding, { code: null, keyCode: legacyKey, displayKey: "" });
    });

    var existing = migrated.map(function(binding) { return binding.action; });
    maps.PREDEFINED_ACTIONS.forEach(function(action) {
      if (existing.indexOf(action) === -1) {
        migrated.push(Object.assign({ action: action }, maps.DEFAULT_BINDINGS[action],
          { predefined: true }));
      }
    });

    this.set("keyBindings", migrated);
    this.set("schemaVersion", 2);
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
