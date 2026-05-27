/**
 * Constants and default values for Video Speed Controller
 */

window.VSC = window.VSC || {};
window.VSC.Constants = {};

if (typeof window.requestIdleCallback === 'undefined') {
  window.requestIdleCallback = function(cb, opts) {
    return setTimeout(cb, (opts && opts.timeout) ? Math.min(opts.timeout, 50) : 1);
  };
  window.cancelIdleCallback = function(id) { clearTimeout(id); };
}

const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

window.VSC.Constants.regStrip = regStrip;
window.VSC.Constants.regEndsWithFlags = regEndsWithFlags;

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  lastSpeed: 1.0,
  enabled: true,
  rememberSpeed: false,
  exclusiveKeys: false,
  audioBoolean: true,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  customCSS: '',
  keyBindings: [
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, predefined: true },
    { action: 'faster', code: 'KeyD', key: 68, keyCode: 68, displayKey: 'd', value: 0.1, predefined: true },
    { action: 'rewind', code: 'KeyZ', key: 90, keyCode: 90, displayKey: 'z', value: 10, predefined: true },
    { action: 'advance', code: 'KeyX', key: 88, keyCode: 88, displayKey: 'x', value: 10, predefined: true },
    { action: 'reset', code: 'KeyR', key: 82, keyCode: 82, displayKey: 'r', value: 1.0, predefined: true },
    { action: 'fast', code: 'KeyG', key: 71, keyCode: 71, displayKey: 'g', value: 1.8, predefined: true },
    { action: 'display', code: 'KeyV', key: 86, keyCode: 86, displayKey: 'v', value: 0, predefined: true },
    { action: 'mark', code: 'KeyM', key: 77, keyCode: 77, displayKey: 'm', value: 0, predefined: true },
    { action: 'jump', code: 'KeyJ', key: 74, keyCode: 74, displayKey: 'j', value: 0, predefined: true },
  ],
  siteRules: [
    { pattern: 'www.instagram.com', enabled: false, speed: null },
    { pattern: 'imgur.com', enabled: false, speed: null },
    { pattern: 'teams.microsoft.com', enabled: false, speed: null },
    { pattern: 'meet.google.com', enabled: false, speed: null },
  ],
  blacklist: `www.instagram.com
imgur.com
teams.microsoft.com
meet.google.com`.replace(regStrip, ''),
  defaultLogLevel: 4,
  logLevel: 3,
};

window.VSC.Constants.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

const formatSpeed = (speed) => speed.toFixed(2);
window.VSC.Constants.formatSpeed = formatSpeed;

const LOG_LEVELS = {
  NONE: 1,
  ERROR: 2,
  WARNING: 3,
  INFO: 4,
  DEBUG: 5,
  VERBOSE: 6,
};

const MESSAGE_TYPES = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
  TEARDOWN: 'VSC_TEARDOWN',
  REINIT: 'VSC_REINIT',
};

const SPEED_LIMITS = {
  MIN: 0.07,
  MAX: 16,
};

const CONTROLLER_SIZE_LIMITS = {
  VIDEO_MIN_WIDTH: 40,
  VIDEO_MIN_HEIGHT: 40,
  AUDIO_MIN_WIDTH: 20,
  AUDIO_MIN_HEIGHT: 20,
};

const CUSTOM_ACTIONS_NO_VALUES = ['pause', 'muted', 'mark', 'jump', 'display'];

window.VSC.Constants.LOG_LEVELS = LOG_LEVELS;
window.VSC.Constants.MESSAGE_TYPES = MESSAGE_TYPES;
window.VSC.Constants.SPEED_LIMITS = SPEED_LIMITS;
window.VSC.Constants.CONTROLLER_SIZE_LIMITS = CONTROLLER_SIZE_LIMITS;
window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES = CUSTOM_ACTIONS_NO_VALUES;
window.VSC.Constants.PREDEFINED_CODE_MAP = window.VSC.PREDEFINED_CODE_MAP;
window.VSC.Constants.KEYCODE_TO_CODE = window.VSC.KEYCODE_TO_CODE;
window.VSC.Constants.displayKeyFromCode = window.VSC.displayKeyFromCode;
window.VSC.Constants.BLACKLISTED_CODES = window.VSC.BLACKLISTED_CODES;
window.VSC.Constants.PREDEFINED_ACTIONS = window.VSC.PREDEFINED_ACTIONS;