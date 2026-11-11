// Simulated XPCOM for the chrome-side tests (bridge.mjs, options.mjs): the
// extension's pref branch with libpref's default/user semantics and
// observers, Services.scriptloader, and the Components.utils members the fork
// uses — with the real chrome/modules/VSCPrefs.jsm loaded on top.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot } from './lib.mjs';

/** defaults/preferences/prefs.js as { key: value } (branch prefix dropped). */
export function readDefaults() {
  const defaults = {};
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'defaults/preferences/prefs.js'), 'utf8'), {
    pref: (name, value) => {
      defaults[name.replace('extensions.videospeed.', '')] = value;
    },
  });
  return defaults;
}

/**
 * The pref branch over the prefs.js defaults plus `userPrefs` (user values as
 * typed JS values). Like libpref (pref_HashPref / PREF_ClearUserPref):
 * writing a pref's default value clears its user value; writing the wrong
 * type to a pref that has a default throws; observers hear every effective
 * change, including a cleared user value.
 */
export function makePrefs(userPrefs = {}) {
  const defaults = readDefaults();
  const user = new Map(Object.entries(userPrefs));
  const observers = [];
  const errors = [];
  const notify = (key) => observers.slice().forEach((o) => o.observe(null, 'nsPref:changed', key));
  const value = (key) => {
    if (user.has(key)) return user.get(key);
    if (key in defaults) return defaults[key];
    throw new Error(`NS_ERROR_UNEXPECTED: no pref ${key}`);
  };
  const typed = (type) => (key) => {
    const v = value(key);
    if (typeof v !== type) throw new Error(`NS_ERROR_UNEXPECTED: ${key} is not ${type}`);
    return v;
  };
  const write = (key, v) => {
    if (key in defaults) {
      if (typeof defaults[key] !== typeof v) {
        throw new Error(`NS_ERROR_UNEXPECTED: ${key} is a ${typeof defaults[key]} pref`);
      }
      if (defaults[key] === v) {
        if (user.delete(key)) notify(key);
        return;
      }
    }
    if (user.has(key) && user.get(key) === v) return;
    user.set(key, v);
    notify(key);
  };
  const branch = {
    getBoolPref: typed('boolean'),
    getIntPref: typed('number'),
    getCharPref: typed('string'),
    setBoolPref: (k, v) => write(k, !!v),
    setIntPref: (k, v) => write(k, v | 0),
    setCharPref: (k, v) => write(k, String(v)),
    prefHasUserValue: (k) => user.has(k),
    clearUserPref: (k) => {
      if (user.delete(k)) notify(k);
    },
    getChildList: (start) =>
      [...new Set([...Object.keys(defaults), ...user.keys()])].filter((k) => k.startsWith(start)),
    addObserver: (prefix, o) => observers.push(o),
    removeObserver: (prefix, o) => {
      const at = observers.indexOf(o);
      if (at !== -1) observers.splice(at, 1);
    },
  };
  const Services = {
    prefs: { getBranch: () => branch },
    scriptloader: {
      loadSubScript(url, scope) {
        const rel = url.replace('resource://videospeed/', '');
        vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8'), scope);
      },
    },
  };
  const utils = {
    import() {},
    reportError: (e) => errors.push(String(e)),
    cloneInto: (obj, win) => win.JSON.parse(JSON.stringify(obj)),
  };
  const Components = { classes: {}, interfaces: {}, utils };

  const jsm = { Components, Services };
  vm.createContext(jsm);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'chrome/modules/VSCPrefs.jsm'), 'utf8'), jsm);
  return { VSCPrefs: jsm.VSCPrefs, Components, Services, utils, branch, user, errors, observers, defaults };
}
