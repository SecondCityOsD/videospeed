// Regenerate or check the fork's ported src/ modules from upstream sources.
//
// Every module ported from upstream is recorded below as: upstream file +
// exact-match edits + an IIFE wrap (see CLAUDE.md, "Every src/** module is
// wrapped in a strict-mode IIFE"). That makes each UXP adaptation explicit:
//
//   node tools/port-upstream.mjs            # check: regenerate in memory and
//                                           # fail if any fork file differs
//   node tools/port-upstream.mjs --write    # rewrite the fork files
//   node tools/port-upstream.mjs --upstream ../videospeed-0.12.0/src
//                                           # dry-run against a newer upstream
//   node tools/port-upstream.mjs core/arbiter.js   # limit to some files
//
// Every edit's `from` text must occur exactly once in the upstream file, so on
// the next upstream upgrade the failures are that file's porting to-do list.
// Default upstream tree: ../videospeed-0.11.1/src next to this repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IIFE_OPEN = `// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

`;
const IIFE_CLOSE = `
})();
`;
const DEFAULT_ANCHOR = 'window.VSC = window.VSC || {};';

// ---------------------------------------------------------------------------
// Registry: upstream-relative path → { anchor?, edits: [[from, to], ...] }
// ---------------------------------------------------------------------------
const PORTS = {
  'core/arbiter.js': {
    edits: [
      ['    warQuiet: warQuiet ?? true,', '    warQuiet: (warQuiet != null) ? warQuiet : true,'],
      [
        '    rearmBudget: rearmBudget ?? DEFAULT_REARM_BUDGET,',
        '    rearmBudget: (rearmBudget != null) ? rearmBudget : DEFAULT_REARM_BUDGET,',
      ],
      [
        '  const maxFight = options.maxFight ?? DEFAULT_MAX_FIGHT;',
        '  const maxFight = (options.maxFight != null) ? options.maxFight : DEFAULT_MAX_FIGHT;',
      ],
    ],
  },

  'core/controller-visibility.js': {
    edits: [
      [
        `class ControllerVisibility {
  static OVERRIDES = Object.freeze({
    AUTO: 'auto',
    SHOW: 'show',
    HIDE: 'hide',
  });

  static FLASH = Object.freeze({
    NONE: 'none',
    TIMED_ARMED: 'timed-armed',
    TIMED_DUE: 'timed-due',
    PERSISTENT: 'persistent',
  });

  static MEDIA_TYPES = Object.freeze({
    VIDEO: 'video',
    AUDIO: 'audio',
  });

  static EVENTS = Object.freeze({
    TOGGLE: 'TOGGLE',
    FLASH_REQUEST: 'FLASH_REQUEST',
    TIMER_TICK: 'TIMER_TICK',
    FLASH_EXPIRE: 'FLASH_EXPIRE',
    AUTOMATIC_HIDE: 'AUTOMATIC_HIDE',
    AUTOMATIC_SHOW: 'AUTOMATIC_SHOW',
    SET_SITE_AUTOHIDE: 'SET_SITE_AUTOHIDE',
    SET_SOURCE_AVAILABLE: 'SET_SOURCE_AVAILABLE',
    SET_HOST_HIDDEN: 'SET_HOST_HIDDEN',
    SET_START_HIDDEN: 'SET_START_HIDDEN',
    RELEASE: 'RELEASE',
  });

`,
        `class ControllerVisibility {
`,
      ],
      [
        `  static allowsFlash(input) {
    return (
      input?.attached !== false &&
      !input?.startHidden &&
      this.normalizeOverride(input?.override) !== this.OVERRIDES.HIDE
    );
  }`,
        `  static allowsFlash(input) {
    const value = (input != null) ? input : {};
    return (
      value.attached !== false &&
      !value.startHidden &&
      this.normalizeOverride(value.override) !== this.OVERRIDES.HIDE
    );
  }`,
      ],
      [
        `window.VSC.ControllerVisibility = ControllerVisibility;`,
        `// UXP: static class fields are below the Pale Moon syntax floor.
ControllerVisibility.OVERRIDES = Object.freeze({
  AUTO: 'auto',
  SHOW: 'show',
  HIDE: 'hide',
});

ControllerVisibility.FLASH = Object.freeze({
  NONE: 'none',
  TIMED_ARMED: 'timed-armed',
  TIMED_DUE: 'timed-due',
  PERSISTENT: 'persistent',
});

ControllerVisibility.MEDIA_TYPES = Object.freeze({
  VIDEO: 'video',
  AUDIO: 'audio',
});

ControllerVisibility.EVENTS = Object.freeze({
  TOGGLE: 'TOGGLE',
  FLASH_REQUEST: 'FLASH_REQUEST',
  TIMER_TICK: 'TIMER_TICK',
  FLASH_EXPIRE: 'FLASH_EXPIRE',
  AUTOMATIC_HIDE: 'AUTOMATIC_HIDE',
  AUTOMATIC_SHOW: 'AUTOMATIC_SHOW',
  SET_SITE_AUTOHIDE: 'SET_SITE_AUTOHIDE',
  SET_SOURCE_AVAILABLE: 'SET_SOURCE_AVAILABLE',
  SET_HOST_HIDDEN: 'SET_HOST_HIDDEN',
  SET_START_HIDDEN: 'SET_START_HIDDEN',
  RELEASE: 'RELEASE',
});

window.VSC.ControllerVisibility = ControllerVisibility;`,
      ],
    ],
  },

  'core/intent-classifier.js': {
    edits: [
      [
        '    this.minRate = options.minRate ?? 0.07; // SPEED_LIMITS.MIN',
        '    this.minRate = (options.minRate != null) ? options.minRate : 0.07; // SPEED_LIMITS.MIN',
      ],
      [
        '      this.spaceHoldMedia ||= this.soleActivePointerMedia();',
        `      if (!this.spaceHoldMedia) {
        this.spaceHoldMedia = this.soleActivePointerMedia();
      }`,
      ],
      ['    const media = entry?.media || null;', '    const media = (entry && entry.media) || null;'],
      [
        '      this.activePointersByMedia.get(entry.media)?.delete(pointerId);',
        `      const ledger = this.activePointersByMedia.get(entry.media);
      if (ledger) {
        ledger.delete(pointerId);
      }`,
      ],
      [
        '        this.activePointersByMedia.get(entry.media)?.clear();',
        `        const ledger = this.activePointersByMedia.get(entry.media);
        if (ledger) {
          ledger.clear();
        }`,
      ],
      ['    if (scoped?.size) {', '    if (scoped && scoped.size) {'],
      [
        '      const downAt = this.pointerOwners.get(id)?.downAt ?? 0;',
        `      const owner = this.pointerOwners.get(id);
      const downAt = (owner && owner.downAt != null) ? owner.downAt : 0;`,
      ],
      [
        `    if (
      (this.activePointersByMedia.get(media)?.size ?? 0) > 0 ||`,
        `    const scoped = this.activePointersByMedia.get(media);
    if (
      (scoped ? scoped.size : 0) > 0 ||`,
      ],
      [
        `      if (!this.isStaleUnresolvedPress(this.pointerOwners.get(id)?.downAt ?? 0, timeStamp)) {`,
        `      const owner = this.pointerOwners.get(id);
      const downAt = (owner && owner.downAt != null) ? owner.downAt : 0;
      if (!this.isStaleUnresolvedPress(downAt, timeStamp)) {`,
      ],
      [
        `      window.VSC.logger?.debug(
        \`Hold-rate \${ctx.rate} without hold evidence: \` +
          \`scoped=\${ctx.media ? (this.activePointersByMedia.get(ctx.media)?.size ?? 0) : 'n/a'} \` +
          \`unresolved=\${this.activePointerIds.size} owners=\${this.pointerOwners.size} \` +
          \`space=\${this.spaceHoldActive}\`
      );`,
        `      if (window.VSC.logger) {
        const scoped = ctx.media ? this.activePointersByMedia.get(ctx.media) : null;
        window.VSC.logger.debug(
          \`Hold-rate \${ctx.rate} without hold evidence: \` +
            \`scoped=\${ctx.media ? (scoped ? scoped.size : 0) : 'n/a'} \` +
            \`unresolved=\${this.activePointerIds.size} owners=\${this.pointerOwners.size} \` +
            \`space=\${this.spaceHoldActive}\`
        );
      }`,
      ],
    ],
  },

  'core/speed-arbitration.js': {
    edits: [
      [
        `    this.eventManager = eventManager;
    this.classifier = new window.VSC.IntentClassifier({`,
        `    this.eventManager = eventManager;
    const siteHandlerManager = window.VSC.siteHandlerManager;
    const siteRules =
      siteHandlerManager != null && siteHandlerManager.getClassifierRules != null
        ? siteHandlerManager.getClassifierRules()
        : undefined;
    this.classifier = new window.VSC.IntentClassifier({`,
      ],
      [
        '        ...(window.VSC.siteHandlerManager?.getClassifierRules?.() || {}),',
        '        ...(siteRules || {}),',
      ],
      [
        '        Number.isFinite(transaction.sourceEvent?.eventPhase) &&',
        `        transaction.sourceEvent != null &&
        Number.isFinite(transaction.sourceEvent.eventPhase) &&`,
      ],
      [
        '        temporaryOverride: conflict?.temporaryOverride ?? false,',
        `        temporaryOverride:
          (conflict && conflict.temporaryOverride != null) ? conflict.temporaryOverride : false,`,
      ],
      [
        '    if (!conflict?.temporaryOverride || this.temporaryReleaseTimers.get(video)) {',
        '    if (!(conflict && conflict.temporaryOverride) || this.temporaryReleaseTimers.get(video)) {',
      ],
      [
        `    if (write) {
      window.VSC.logger.info(
        \`Restoring shared speed \${write.speed} after temporary native override\`
      );
      this.eventManager?.actionHandler?.writeRate(video, write.speed);
      event?.stopImmediatePropagation();
    }
    if (sync) {
      this.eventManager?.actionHandler?.syncIndicator(video, sync.speed);
    }`,
        `    const actionHandler = this.eventManager && this.eventManager.actionHandler;
    if (write) {
      window.VSC.logger.info(
        \`Restoring shared speed \${write.speed} after temporary native override\`
      );
      if (actionHandler) {
        actionHandler.writeRate(video, write.speed);
      }
      if (event) {
        event.stopImmediatePropagation();
      }
    }
    if (sync && actionHandler) {
      actionHandler.syncIndicator(video, sync.speed);
    }`,
      ],
      [
        `    const rawRate = video.playbackRate;
    const { state, conflict } = this.stateFor(video);
    if (suppressRetryEcho) {`,
        `    const rawRate = video.playbackRate;
    const { state, conflict } = this.stateFor(video);
    const actionHandler = this.eventManager && this.eventManager.actionHandler;
    if (suppressRetryEcho) {`,
      ],
      [
        '        this.eventManager?.actionHandler?.syncIndicator(video, sync.speed);',
        `        if (actionHandler) {
          actionHandler.syncIndicator(video, sync.speed);
        }`,
      ],
      [
        '      this.eventManager?.actionHandler?.syncIndicator(video, adopted);',
        `      if (actionHandler) {
        actionHandler.syncIndicator(video, adopted);
      }`,
      ],
      [
        `      this.eventManager?.actionHandler?.writeRate(video, state.desired, {
        suppressEchoPropagation: suppressRetryEcho,
      });`,
        `      if (actionHandler) {
        actionHandler.writeRate(video, state.desired, {
          suppressEchoPropagation: suppressRetryEcho,
        });
      }`,
      ],
      [
        '    this.eventManager?.actionHandler?.syncIndicator(video, rawRate);',
        `    if (actionHandler) {
      actionHandler.syncIndicator(video, rawRate);
    }`,
      ],
    ],
  },

  'utils/logger.js': {
    edits: [['      if (video.vsc?.controllerId) {', '      if (video.vsc && video.vsc.controllerId) {']],
  },

  'utils/key-maps.js': {
    // Upstream is a pure ES module with no window.VSC line; wrap after the
    // file header instead.
    anchor: `/**
 * Hardcoded mapping for the 9 predefined bindings.`,
    edits: [
      [
        ' * Pure ES module exports — no window/DOM dependencies.',
        ` * UXP: a classic script — the bindings are published on window.VSC at the
 * end of this file instead of being exported as ES module bindings.`,
      ],
      ['export const PREDEFINED_CODE_MAP', 'const PREDEFINED_CODE_MAP'],
      ['export const KEYCODE_TO_CODE', 'const KEYCODE_TO_CODE'],
      ['export function displayKeyFromCode', 'function displayKeyFromCode'],
      ['export const PREDEFINED_ACTIONS', 'const PREDEFINED_ACTIONS'],
      ['export const DEFAULT_BINDINGS', 'const DEFAULT_BINDINGS'],
      [
        `export const BLACKLISTED_CODES = new Set([`,
        `const BLACKLISTED_CODES = new Set([`,
      ],
      [
        `  'ScrollLock',
]);`,
        `  'ScrollLock',
]);

// UXP: stands in for upstream's ES module exports (constants.js reads these).
window.VSC = window.VSC || {};
window.VSC.PREDEFINED_CODE_MAP = PREDEFINED_CODE_MAP;
window.VSC.KEYCODE_TO_CODE = KEYCODE_TO_CODE;
window.VSC.displayKeyFromCode = displayKeyFromCode;
window.VSC.PREDEFINED_ACTIONS = PREDEFINED_ACTIONS;
window.VSC.DEFAULT_BINDINGS = DEFAULT_BINDINGS;
window.VSC.BLACKLISTED_CODES = BLACKLISTED_CODES;`,
      ],
    ],
  },

  'utils/constants.js': {
    edits: [
      [
        `// Keyboard identity maps — shared with background.js (service worker context).
// esbuild inlines these into each bundle at build time.
import {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  BLACKLISTED_CODES,
  DEFAULT_BINDINGS,
} from './key-maps.js';
import { DEFAULT_CONTROLLER_CSS } from '../styles/controller-css-defaults.js';

`,
        '',
      ],
      [
        `window.VSC.Constants = {};
`,
        `window.VSC.Constants = {};

// UXP: upstream imports these from key-maps.js and controller-css-defaults.js;
// the fork's classic scripts publish them on window.VSC, and overlay.js loads
// both files before this one (the bundle's import evaluation order).
const {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  BLACKLISTED_CODES,
  DEFAULT_BINDINGS,
  DEFAULT_CONTROLLER_CSS,
} = window.VSC;

// UXP: guarded requestIdleCallback stand-in for engines without it;
// mutation-observer.js calls it unguarded.
if (typeof window.requestIdleCallback === 'undefined') {
  window.requestIdleCallback = function(cb, opts) {
    return setTimeout(cb, (opts && opts.timeout) ? Math.min(opts.timeout, 50) : 1);
  };
  window.cancelIdleCallback = function(id) { clearTimeout(id); };
}
`,
      ],
    ],
  },
};

// ---------------------------------------------------------------------------

/**
 * Apply one registry entry to upstream text. Returns { text, problems }.
 */
function generate(rel, upstreamText) {
  const { anchor = DEFAULT_ANCHOR, edits } = PORTS[rel];
  const problems = [];
  let text = upstreamText.replace(/\r\n/g, '\n');
  for (const [from, to] of edits) {
    const count = text.split(from).length - 1;
    if (count !== 1) {
      problems.push(`edit expected exactly 1 match, found ${count}:\n      ${from.split('\n')[0]}`);
      continue;
    }
    text = text.replace(from, () => to);
  }
  const at = text.indexOf(anchor);
  if (at === -1 || text.indexOf(anchor, at + 1) !== -1) {
    problems.push(`IIFE anchor must occur exactly once: ${anchor}`);
  } else {
    text = text.slice(0, at) + IIFE_OPEN + text.slice(at).replace(/\n*$/, '\n') + IIFE_CLOSE;
  }
  return { text, problems };
}

function main(argv) {
  let write = false;
  let upstream = path.resolve(repoRoot, '..', 'videospeed-0.11.1', 'src');
  const only = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') write = true;
    else if (argv[i] === '--upstream') upstream = path.resolve(argv[++i]);
    else only.push(argv[i].replace(/\\/g, '/').replace(/^src\//, ''));
  }
  const unknown = only.filter((rel) => !PORTS[rel]);
  if (unknown.length) {
    console.error(`Not in the port registry: ${unknown.join(', ')}`);
    return 2;
  }

  let failures = 0;
  for (const rel of only.length ? only : Object.keys(PORTS)) {
    const forkPath = path.join(repoRoot, 'src', rel);
    const { text, problems } = generate(rel, fs.readFileSync(path.join(upstream, rel), 'utf8'));
    if (problems.length) {
      failures++;
      console.error(`FAIL ${rel}\n    ${problems.join('\n    ')}`);
      continue;
    }
    if (write) {
      fs.writeFileSync(forkPath, text);
      console.log(`wrote ${rel}`);
      continue;
    }
    const current = fs.existsSync(forkPath)
      ? fs.readFileSync(forkPath, 'utf8').replace(/\r\n/g, '\n')
      : null;
    if (current === text) {
      console.log(`ok   ${rel}`);
    } else {
      failures++;
      console.error(
        `DIFF ${rel}: fork file ${current === null ? 'is missing' : 'differs from upstream + registered edits'}`
      );
    }
  }
  return failures ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
