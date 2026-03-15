/**
 * Storage management — UXP version
 * In the UXP port, page scripts never have direct pref access.
 * Settings are injected by the frame script via VSC_USER_SETTINGS event,
 * and saves are sent back via VSC_SAVE_SETTINGS event.
 * Modular architecture using global variables.
 */

window.VSC = window.VSC || {};

class StorageManager {
  // Cache for user settings injected from frame script
  static _injectedSettings = null;

  // Listen for injected settings from frame script
  static _setupSettingsListener() {
    if (typeof window !== 'undefined' && !this._listenerSetup) {
      window.addEventListener('VSC_USER_SETTINGS', (event) => {
        window.VSC.logger.debug('Received user settings from frame script');
        this._injectedSettings = event.detail;
      });
      this._listenerSetup = true;
    }
  }

  /**
   * Get settings (always from injected settings in UXP).
   * @param {Object} defaults - Default values
   * @returns {Promise<Object>} Storage data
   */
  static async get(defaults = {}) {
    this._setupSettingsListener();

    if (this._injectedSettings) {
      window.VSC.logger.debug('Using injected user settings');
      return Promise.resolve({ ...defaults, ...this._injectedSettings });
    } else {
      window.VSC.logger.debug('No injected settings yet, using defaults');
      return Promise.resolve(defaults);
    }
  }

  /**
   * Wait for injected settings to become available.
   * @param {Object} defaults - Default values
   * @returns {Promise<Object>} Settings when available
   */
  static async waitForInjectedSettings(defaults = {}) {
    this._setupSettingsListener();

    if (this._injectedSettings) {
      window.VSC.logger.debug('Using available injected settings');
      return Promise.resolve({ ...defaults, ...this._injectedSettings });
    }

    return new Promise((resolve) => {
      const checkSettings = () => {
        if (this._injectedSettings) {
          window.VSC.logger.debug('Injected settings now available');
          resolve({ ...defaults, ...this._injectedSettings });
        } else {
          setTimeout(checkSettings, 10);
        }
      };
      checkSettings();
    });
  }

  /**
   * Save settings by dispatching event to frame script.
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  static async set(data) {
    window.VSC.logger.debug('Sending save request to frame script');

    window.dispatchEvent(
      new CustomEvent('VSC_SAVE_SETTINGS', {
        detail: data,
      })
    );

    // Update local cache
    this._injectedSettings = { ...this._injectedSettings, ...data };

    return Promise.resolve();
  }

  /**
   * Remove is a no-op in the UXP injected context.
   */
  static async remove(keys) {
    return Promise.resolve();
  }

  /**
   * Clear is a no-op in the UXP injected context.
   */
  static async clear() {
    return Promise.resolve();
  }

  /**
   * onChanged is a no-op — pref changes come via re-injection.
   */
  static onChanged(callback) {
    // Not implemented in UXP page context
  }
}

window.VSC.StorageManager = StorageManager;
