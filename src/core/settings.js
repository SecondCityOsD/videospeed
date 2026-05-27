/**
 * Settings management for Video Speed Controller
 * UXP port with upstream 0.10.2 features
 */

window.VSC = window.VSC || {};

class VideoSpeedConfig {
  constructor() {
    this.settings = { ...window.VSC.Constants.DEFAULT_SETTINGS };
    this.pendingSave = null;
    this.saveTimer = null;
    this.SAVE_DELAY = 1000;
    this._loaded = false;
    this._lastWrittenSpeed = null;

    this._setupStorageListener();
  }

  _setupStorageListener() {
    try {
      window.VSC.StorageManager.onChanged((changes) => {
        for (const [key, change] of Object.entries(changes)) {
          if (!(key in this.settings) || change.newValue === undefined) {
            continue;
          }

          if (key === 'lastSpeed') {
            const isSelfEcho =
              this._lastWrittenSpeed !== null && change.newValue === this._lastWrittenSpeed;
            this._lastWrittenSpeed = null;
            if (isSelfEcho) {
              continue;
            }
          }

          this.settings[key] = change.newValue;

          if (key === 'lastSpeed' && this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.pendingSave = null;
          }

          window.VSC.logger.debug(`Settings updated from storage change: ${key}`);
        }
      });
    } catch (e) {
      window.VSC.logger.debug(`Could not set up storage change listener: ${e.message}`);
    }
  }

  async load() {
    try {
      const storage = await window.VSC.StorageManager.get({
        ...window.VSC.Constants.DEFAULT_SETTINGS,
        controllerCSS: null,
      });

      if (storage === null) {
        this.settings._abort = true;
        return;
      }

      this._loaded = true;

      this.settings.keyBindings = (
        storage.keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings
      ).map(VideoSpeedConfig.normalizeKeyBinding);

      if (!storage.keyBindings || storage.keyBindings.length === 0) {
        window.VSC.logger.info('First initialization - setting up default key bindings');
        this.settings.keyBindings = [...window.VSC.Constants.DEFAULT_SETTINGS.keyBindings];
        await this.save({ keyBindings: this.settings.keyBindings });
      }

      const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
      if (storage.blacklist !== null && storage.blacklist !== undefined && !storage.siteRules) {
        storage.siteRules = storage.blacklist
          .split('\n')
          .map((l) => l.replace(regStrip, ''))
          .filter(Boolean)
          .map((pattern) => ({ pattern, enabled: false, speed: null }));
        await this.save({ siteRules: storage.siteRules });
      }

      this.settings.siteRules =
        storage.siteRules || window.VSC.Constants.DEFAULT_SETTINGS.siteRules;

      if (window.VSC.matchSiteRule) {
        const matched = window.VSC.matchSiteRule(this.settings.siteRules, window.location.href);
        if (matched && matched.speed !== null && matched.speed !== undefined) {
          this.settings.siteDefaultSpeed = matched.speed;
          window.VSC.logger.info(
            `Site rule matched: pattern="${matched.pattern}", speed=${matched.speed}`
          );
        }
      }

      this.settings.rememberSpeed = Boolean(storage.rememberSpeed);

      if (this.settings.siteDefaultSpeed) {
        this.settings.lastSpeed = null;
      } else if (this.settings.rememberSpeed) {
        this.settings.lastSpeed = Number(storage.lastSpeed) || null;
      } else {
        this.settings.lastSpeed = null;
      }
      this.settings.exclusiveKeys = Boolean(storage.exclusiveKeys);
      this.settings.audioBoolean = Boolean(storage.audioBoolean);
      this.settings.startHidden = Boolean(storage.startHidden);
      this.settings.controllerOpacity = Number(storage.controllerOpacity);
      this.settings.controllerButtonSize = Number(storage.controllerButtonSize);
      if (storage.controllerCSS !== null) {
        window.VSC.StorageManager.remove(['controllerCSS']);
      }
      this.settings.customCSS = storage.customCSS ?? '';
      this.settings.logLevel = Number(
        storage.logLevel || window.VSC.Constants.DEFAULT_SETTINGS.logLevel
      );

      window.VSC.logger.setVerbosity(this.settings.logLevel);

      window.VSC.logger.info('Settings loaded successfully');
      return this.settings;
    } catch (error) {
      window.VSC.logger.error(`Failed to load settings: ${error.message}`);
      return window.VSC.Constants.DEFAULT_SETTINGS;
    }
  }

  async save(newSettings = {}) {
    const keys = Object.keys(newSettings);
    if (keys.length === 0) {
      return true;
    }

    if (!this._loaded) {
      window.VSC.logger.error(
        'save() called before load() — refusing to overwrite user data with defaults'
      );
      return false;
    }

    this.settings = { ...this.settings, ...newSettings };

    if (keys.length === 1 && keys[0] === 'lastSpeed') {
      this.pendingSave = newSettings.lastSpeed;

      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }

      this.saveTimer = setTimeout(async () => {
        const speedToSave = this.pendingSave;
        this.pendingSave = null;
        this.saveTimer = null;

        this._lastWrittenSpeed = speedToSave;
        try {
          await window.VSC.StorageManager.set({ lastSpeed: speedToSave });
          window.VSC.logger.info('Debounced speed setting saved successfully');
        } catch (error) {
          this._lastWrittenSpeed = null;
          window.VSC.logger.error(`Failed to persist speed: ${error.message}`);
        }
      }, this.SAVE_DELAY);

      return true;
    }

    try {
      await window.VSC.StorageManager.set(newSettings);
    } catch (error) {
      window.VSC.logger.error(`Failed to save settings: ${error.message}`);
      return false;
    }

    if (newSettings.logLevel !== undefined) {
      window.VSC.logger.setVerbosity(this.settings.logLevel);
    }

    window.VSC.logger.info('Settings saved successfully');
    return true;
  }

  getKeyBinding(action, property = 'value') {
    try {
      const binding = this.settings.keyBindings.find((item) => item.action === action);
      return binding ? binding[property] : false;
    } catch (e) {
      window.VSC.logger.error(`Failed to get key binding for ${action}: ${e.message}`);
      return false;
    }
  }

  setKeyBinding(action, value) {
    try {
      const binding = this.settings.keyBindings.find((item) => item.action === action);
      if (!binding) {
        window.VSC.logger.warn(`No key binding found for action: ${action}`);
        return;
      }

      if (['reset', 'fast', 'slower', 'faster'].includes(action)) {
        if (typeof value !== 'number' || isNaN(value)) {
          window.VSC.logger.warn(`Invalid numeric value for ${action}: ${value}`);
          return;
        }
      }

      binding.value = value;
      window.VSC.logger.debug(`Updated key binding ${action} to ${value}`);
    } catch (e) {
      window.VSC.logger.error(`Failed to set key binding for ${action}: ${e.message}`);
    }
  }

  static normalizeKeyBinding(binding) {
    if (!binding || !binding.modifiers) {
      return binding;
    }
    const m = binding.modifiers;
    const normalized = {
      shift: Boolean(m.shift),
      ctrl: Boolean(m.ctrl),
      alt: Boolean(m.alt),
      meta: Boolean(m.meta),
    };
    const result = { ...binding };
    if (normalized.shift || normalized.ctrl || normalized.alt || normalized.meta) {
      result.modifiers = normalized;
    } else {
      delete result.modifiers;
    }
    return result;
  }
}

window.VSC.videoSpeedConfig = new VideoSpeedConfig();
window.VSC.VideoSpeedConfig = VideoSpeedConfig;