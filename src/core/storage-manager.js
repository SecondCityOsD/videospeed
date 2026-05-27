/**
 * Storage management — UXP version
 * Uses VSCPrefs (XPCOM) in chrome context, injected settings in page context.
 */

window.VSC = window.VSC || {};

class StorageManager {
  static _injectedSettings = null;
  static _listenerSetup = false;

  static onError(callback) {
    this.errorCallback = callback;
  }

  static _setupSettingsListener() {
    if (typeof window !== 'undefined' && !this._listenerSetup) {
      // Pick up the synchronous settings blob the overlay seeds before any
      // module script runs. Avoids a race against the VSC_USER_SETTINGS event.
      if (window.VSC_initial_settings) {
        this._injectedSettings = window.VSC_initial_settings;
      }

      document.documentElement.addEventListener('VSC_USER_SETTINGS', (event) => {
        window.VSC.logger.debug('Received user settings from chrome overlay');
        this._injectedSettings = event.detail;
      });

      // VSC_SETTINGS_READY was part of an MV3 ISOLATED↔MAIN bridge; in the
      // single-process UXP port the chrome overlay seeds settings directly,
      // so no bridge response is ever fired — listener removed.

      this._listenerSetup = true;
    }
  }

  static async get(defaults = {}) {
    this._setupSettingsListener();

    if (this._injectedSettings) {
      window.VSC.logger.debug('Using injected user settings');
      return { ...defaults, ...this._injectedSettings };
    }

    return defaults;
  }

  static async set(data) {
    window.VSC.logger.debug('Sending save request to chrome overlay');

    // Dispatch on documentElement with bubbles so the chrome-side listener
    // (gBrowser.addEventListener) can catch it via DOM bubble-up.
    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_SAVE_SETTINGS', {
        detail: data,
        bubbles: true,
      })
    );

    this._injectedSettings = { ...this._injectedSettings, ...data };

    return Promise.resolve();
  }

  static async remove(keys) {
    return Promise.resolve();
  }

  static async clear() {
    this._injectedSettings = {};
    return Promise.resolve();
  }

  static onChanged(callback) {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      const changes = e.detail;
      for (const [key, change] of Object.entries(changes)) {
        if (change.newValue !== undefined) {
          this._injectedSettings = this._injectedSettings || {};
          this._injectedSettings[key] = change.newValue;
        }
      }
      callback(changes);
    });
  }
}

window.VSC.StorageManager = StorageManager;
