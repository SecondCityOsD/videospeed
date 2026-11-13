/**
 * chrome.storage for the options page (UXP).
 *
 * Upstream's options page reaches chrome.storage.sync through core/
 * storage-manager.js and core/settings.js, which the fork loads unchanged.
 * This shim gives them the parts of that API they use, over the extension
 * prefs (chrome/modules/VSCPrefs.jsm), with chrome.storage's semantics:
 *
 *   get(keys, cb)     Only stored keys: a pref with a user value. An absent
 *                     key takes the caller's default, as in Chrome, and
 *                     results are fresh copies (Chrome serializes them).
 *   set(items, cb)    One pref per key. Undefined values are skipped (Chrome
 *                     drops them when serializing). Keys without a pref are
 *                     ignored: upstream writes a few that nothing reads back
 *                     (DEFAULT_SETTINGS.defaultLogLevel, an imported file's
 *                     computed siteDefaultSpeed).
 *   remove(keys, cb)  Drop user values, so prefs fall back to
 *   clear(cb)         defaults/preferences/prefs.js — upstream's
 *                     DEFAULT_SETTINGS.
 *   onChanged         One {key: {oldValue, newValue}} event per storage call;
 *                     other writers' changes (another window, a page
 *                     remembering its speed) are batched per task.
 *
 * Callbacks run asynchronously; a failed call sets chrome.runtime.lastError
 * while its callback runs. Not emulated: chrome.storage.sync's quotas, a
 * Chrome sync limit (the page keeps its own 8 KB guard on custom CSS).
 *
 * options.xul loads this before storage-manager.js, which picks its backend
 * (chrome.storage or the page bridge) when it loads.
 */
(function () {
'use strict';

const modules = {};
Components.utils.import('chrome://videospeed-modules/content/VSCPrefs.jsm', modules);
const VSCPrefs = modules.VSCPrefs;
const PREF_KEYS = new Set(VSCPrefs.KEYS);

const clone = (value) => JSON.parse(JSON.stringify(value));

const runtime = { lastError: undefined };

/**
 * Run a storage operation now and its callback asynchronously, as Chrome
 * does, with runtime.lastError set only while a failed call's callback runs.
 * The call's pref changes become one onChanged event.
 */
function run(callback, operation) {
  let result;
  let error = null;
  try {
    result = operation();
  } catch (e) {
    error = e;
  }
  closeBatch();
  Promise.resolve().then(() => {
    if (error) {
      runtime.lastError = { message: String((error && error.message) || error) };
    }
    try {
      if (callback) {
        callback(result);
      }
    } finally {
      runtime.lastError = undefined;
    }
  });
}

function get(keys, callback) {
  run(callback, () => {
    const stored = VSCPrefs.getStored();
    if (keys === null || keys === undefined) {
      return clone(stored);
    }
    const result = {};
    if (typeof keys === 'string' || Array.isArray(keys)) {
      for (const key of [].concat(keys)) {
        if (key in stored) {
          result[key] = stored[key];
        }
      }
    } else {
      for (const key of Object.keys(keys)) {
        result[key] = key in stored ? stored[key] : keys[key];
      }
    }
    return clone(result);
  });
}

function set(items, callback) {
  run(callback, () => {
    for (const key of Object.keys(items)) {
      if (items[key] !== undefined && PREF_KEYS.has(key)) {
        VSCPrefs.set(key, items[key]);
      }
    }
  });
}

function remove(keys, callback) {
  run(callback, () => {
    for (const key of [].concat(keys)) {
      VSCPrefs.reset(key);
    }
  });
}

function clear(callback) {
  run(callback, () => VSCPrefs.resetAll());
}

// --- onChanged -------------------------------------------------------------
// Pref observers fire once per pref, synchronously. Chrome fires one event per
// storage call, so each call of this shim closes a batch as it returns; writes
// from elsewhere (another window, a page remembering its speed) are batched
// per task. A batch compares each key with the last reported state, so a
// burst that ends where it started reports nothing.

const listeners = [];
let observer = null;
let reported = null; // stored values as of the last batch
let pending = null; // keys changed since then

function onPrefChanged(key) {
  if (!PREF_KEYS.has(key)) {
    return;
  }
  if (!pending) {
    pending = new Set();
    Promise.resolve().then(closeBatch);
  }
  pending.add(key);
}

/** Turn the pending keys into one onChanged event, delivered asynchronously. */
function closeBatch() {
  if (!pending) {
    return;
  }
  const stored = VSCPrefs.getStored();
  const changes = {};
  for (const key of pending) {
    const had = key in reported;
    const has = key in stored;
    if (had === has && JSON.stringify(reported[key]) === JSON.stringify(stored[key])) {
      continue;
    }
    changes[key] = {};
    if (had) {
      changes[key].oldValue = reported[key];
    }
    if (has) {
      changes[key].newValue = stored[key];
    }
  }
  pending = null;
  reported = stored;
  if (Object.keys(changes).length === 0) {
    return;
  }
  Promise.resolve().then(() => {
    for (const listener of listeners.slice()) {
      try {
        listener(clone(changes), 'sync');
      } catch (e) {
        console.error('VSC options: storage listener failed:', e);
      }
    }
  });
}

const onChanged = {
  addListener(listener) {
    if (!observer) {
      reported = VSCPrefs.getStored();
      observer = VSCPrefs.addObserver(onPrefChanged);
    }
    listeners.push(listener);
  },
};

window.addEventListener('unload', () => {
  if (observer) {
    VSCPrefs.removeObserver(observer);
    observer = null;
  }
  listeners.length = 0;
});

window.chrome = {
  storage: { sync: { get, set, remove, clear }, onChanged },
  runtime,
};

})();
