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
// An edit is either [from, to] (replace that exact text) or
// { from, through, to } (replace the span from the start of `from` to the end
// of `through`, each matching exactly once — for whole blocks whose body would
// be error-prone to transcribe) or { every, to, count } (replace every
// occurrence of `every`, which must occur exactly `count` times — for a
// repeated idiom). Edits apply in order, each to the result of the previous.
// Default upstream tree: ../videospeed-0.11.1/src next to this repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAGE_WRAP_NOTE = `// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.`;
const OPTIONS_WRAP_NOTE = `// UXP: upstream bundles the options page into one esbuild IIFE; the fork loads
// its modules as separate classic <script>s. This wrapper keeps top-level
// bindings out of the shared global scope, where two files declaring the same
// name (row-renderer's createRow and options.js's copy of it) would collide.`;
const iifeOpen = (note) => `${note}
(function () {
'use strict';

`;
const IIFE_CLOSE = `
})();
`;
const DEFAULT_ANCHOR = 'window.VSC = window.VSC || {};';

// ---------------------------------------------------------------------------
// Registry: upstream-relative path → { anchor?, edits: [edit, ...], dest?, wrap? }
//   dest — fork path relative to the repository root (default: src/<path>)
//   wrap — false for files that get no IIFE (HTML, CSS)
//   wrapNote — the comment above the IIFE (default: PAGE_WRAP_NOTE)
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

  'core/settings.js': {
    edits: [
      {
        from: '        // Match current URL against site rules to derive per-site default speed.',
        through:
          '              `Site rule matched: pattern="${matched.pattern}", speed=${matched.speed}`\n            );\n          }\n        }',
        to: `        // UXP: site rules are matched in the privileged chrome layer
        // (overlay.js): disabled sites are never injected and the page world
        // never receives the raw rules (privacy) — here siteRules is just the
        // default. Instead of upstream's matchSiteRule() call, the chrome side
        // seeds an already-matched \`siteDefaultSpeed\`. (In the options page,
        // which reads real storage, siteRules above is the user's.)
        // Reset first: without this, siteDefaultSpeed is sticky across load()
        // calls — invisible in production (fresh process per page load) but a
        // real leak in any long-lived context, and load() below would seed
        // lastSpeed from a stale rule.
        this.settings.siteDefaultSpeed = null;
        if (typeof storage.siteDefaultSpeed === 'number') {
          this.settings.siteDefaultSpeed = storage.siteDefaultSpeed;
          window.VSC.logger.info(\`Site rule matched: speed=\${storage.siteDefaultSpeed}\`);
        }`,
      },
      [
        "        this.settings.customCSS = storage.customCSS ?? '';",
        "        this.settings.customCSS = (storage.customCSS != null) ? storage.customCSS : '';",
      ],
    ],
  },

  'utils/event-manager.js': {
    edits: [
      [
        `    try {
      if (window.VSC.inIframe()) {
        docs.push(window.top.document);
      }
    } catch {
      // Cross-origin iframe - ignore
    }`,
        `    try {
      // UXP: upstream calls window.VSC.inIframe(), which dom-utils never
      // defines (the helper is DomUtils.inIframe), so the TypeError lands in
      // this catch and same-origin frames silently lose top-document
      // shortcuts. Call the real helper.
      if (window.VSC.DomUtils.inIframe()) {
        docs.push(window.top.document);
      }
    } catch (e) {
      // Cross-origin iframe - ignore
    }`,
      ],
      [
        '        const bKey = b.keyCode ?? b.key;',
        '        const bKey = (b.keyCode != null) ? b.keyCode : b.key;',
      ],
      [
        '        return (b.keyCode ?? b.key) === keyCode;',
        '        return ((b.keyCode != null) ? b.keyCode : b.key) === keyCode;',
      ],
      [
        `  setupUserGestureListener(document) {
    const clickHandler = (event) => {`,
        `  setupUserGestureListener(document) {
    // UXP: the controller is plain DOM, so match the \`.vsc-controller\`
    // wrapper class where upstream tests for its \`<vsc-controller>\` tag.
    const isOwnController = (target) =>
      !!(target && target.closest && target.closest('.vsc-controller'));
    const clickHandler = (event) => {`,
      ],
      [
        `      // Skip clicks on our own controller (shadow host retargeted at boundary)
      if (event.target?.closest?.('vsc-controller')) {`,
        `      // Skip clicks on our own controller (shadow host retargeted at boundary)
      if (isOwnController(event.target)) {`,
      ],
      [
        "      if (event.target?.closest?.('vsc-controller')) {",
        '      if (isOwnController(event.target)) {',
      ],
      [
        '    const resolved = window.VSC.siteHandlerManager?.resolveGestureMedia?.(event, mediaElements);',
        `    const siteHandlerManager = window.VSC.siteHandlerManager;
    const resolved =
      siteHandlerManager != null && siteHandlerManager.resolveGestureMedia != null
        ? siteHandlerManager.resolveGestureMedia(event, mediaElements)
        : undefined;`,
      ],
    ],
  },

  'core/action-handler.js': {
    edits: [
      [
        '      targetController = e.target.getRootNode().host;',
        `      // UXP: the controller is plain DOM — there is no shadow root to climb
      // out of, so find the owning \`.vsc-controller\` wrapper directly. Like
      // upstream's getRootNode().host, tolerate non-Element targets (a key
      // event dispatched at the document has no closest()).
      const target = e.target;
      targetController =
        target && typeof target.closest === 'function' ? target.closest('.vsc-controller') : null;`,
      ],
      ['      const controller = v.vsc?.div;', '      const controller = v.vsc && v.vsc.div;'],
      ['    const controller = video.vsc?.div;', '    const controller = video.vsc && video.vsc.div;'],
      [
        `    const innerController = controller.shadowRoot
      ? window.VSC.ShadowDOMManager.getController(controller.shadowRoot)
      : null;`,
        `    // UXP: plain-DOM controller — ShadowDOMManager.getRoot() stands in for
    // the host's shadowRoot.
    const root = window.VSC.ShadowDOMManager.getRoot(controller);
    const innerController = root ? window.VSC.ShadowDOMManager.getController(root) : null;`,
      ],
      [
        '    if (this.eventManager?.arbitration) {',
        '    if (this.eventManager && this.eventManager.arbitration) {',
      ],
      [
        '    if (video.playbackRate !== numericSpeed && this.eventManager?.arbitration) {',
        `    if (
      video.playbackRate !== numericSpeed &&
      this.eventManager &&
      this.eventManager.arbitration
    ) {`,
      ],
      [
        '    const speedIndicator = video.vsc?.speedIndicator;',
        '    const speedIndicator = video.vsc && video.vsc.speedIndicator;',
      ],
      ['    if (video.vsc?.div) {', '    if (video.vsc && video.vsc.div) {'],
    ],
  },

  'core/video-controller.js': {
    edits: [
      [
        '      this.arbitration.classifier?.observeMediaInit(this.video, performance.now());',
        `      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeMediaInit(this.video, performance.now());
      }`,
      ],
      [
        `    const computedPosition = getComputedStyle(wrapper).position;
    if (computedPosition !== 'relative') {`,
        `    // UXP: a host re-parented to <body> by the transformed-ancestor escape
    // (insertIntoDOM) is already pinned to the video's viewport rect, so the
    // inner controller stays at 0,0 there or it would be offset twice.
    const computedPosition = getComputedStyle(wrapper).position;
    if (computedPosition !== 'relative' && !this._viewportUpdate) {`,
      ],
      [
        `      this.video
    );

    switch (positioning.insertionMethod) {`,
        `      this.video
    );

    // UXP: VORAPIS-V3 / hostile-userscript escape hatch.
    //
    // If any ancestor of the planned insertion point has a CSS \`transform\`
    // (other than \`none\`) or a non-default \`zoom\`, our absolutely-positioned
    // controller is rendered inside that transformed subtree and visually
    // scaled to match. No CSS rule applied to the child can override this —
    // transform composes onto descendants by definition. The only way out is
    // to insert outside the transformed subtree entirely. We re-parent to
    // document.body and switch to fixed positioning with viewport-relative
    // coordinates computed from the video's getBoundingClientRect.
    if (this._hasTransformedAncestor(positioning.insertionPoint, document)) {
      window.VSC.logger.warn(
        'Transformed ancestor detected — re-parenting controller to document.body'
      );
      document.body.appendChild(fragment);
      this._setupViewportTracking(wrapper);
      return;
    }

    switch (positioning.insertionMethod) {`,
      ],
      [
        `  /**
   * Set up event handlers for media events`,
        `  /**
   * Walk up from an element checking each ancestor's computed style for
   * a non-default \`transform\` or \`zoom\`. Returns true if any is found.
   * Stops at document.documentElement.
   * @private
   */
  _hasTransformedAncestor(el, doc) {
    let node = el;
    const root = doc.documentElement;
    while (node && node !== root) {
      let style;
      try {
        style = node.ownerDocument.defaultView.getComputedStyle(node);
      } catch (e) {
        return false;
      }
      if (style.transform && style.transform !== 'none') {
        return true;
      }
      // \`zoom\` is non-standard but widely shipped. Computed value is the
      // resolved number or 'normal'.
      if (style.zoom && style.zoom !== '1' && style.zoom !== 'normal') {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Switch the wrapper to viewport-relative positioning and keep it pinned
   * to the video's on-screen rect via getBoundingClientRect updates on
   * scroll/resize/ResizeObserver tick + a 500 ms interval as a safety net
   * for animated ancestor transforms.
   *
   * Takes the wrapper explicitly: this runs from insertIntoDOM() while
   * initializeControls() is still building the controller, before the
   * constructor has assigned this.div (reading this.div here made the whole
   * escape a silent no-op).
   *
   * Tracked timers/observers are stored on \`this\` so \`remove()\` can clean
   * them up.
   * @param {HTMLElement} wrapper - Controller wrapper just inserted into <body>
   * @private
   */
  _setupViewportTracking(wrapper) {
    if (!wrapper) return;

    // position:fixed escapes ancestor \`transform\` only if no ancestor of the
    // fixed element has transform/filter/perspective — by inserting into
    // document.body we've ensured that.
    wrapper.style.setProperty('position', 'fixed', 'important');

    // Start at the viewport origin; update() pins it to the video below.
    wrapper.style.setProperty('top', '0px', 'important');
    wrapper.style.setProperty('left', '0px', 'important');

    const update = () => {
      try {
        if (!this.video || !this.video.isConnected) return;
        const rect = this.video.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        wrapper.style.setProperty('top', rect.top + 'px', 'important');
        wrapper.style.setProperty('left', rect.left + 'px', 'important');
      } catch (e) {
        // video may have been removed; let remove() clean up later
      }
    };

    // rAF-coalesced wrapper for the high-frequency listeners (scroll, resize,
    // ResizeObserver): at most one getBoundingClientRect + style write per
    // frame instead of one per event, so fast scrolling can't thrash layout.
    let rafPending = false;
    const scheduleUpdate = () => {
      if (rafPending) return;
      rafPending = true;
      const run = () => {
        rafPending = false;
        update();
      };
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(run);
      } else {
        window.setTimeout(run, 16);
      }
    };

    update();

    // The listeners are added with scheduleUpdate; remove() removes the same
    // reference, so this must stay scheduleUpdate (not update).
    this._viewportUpdate = scheduleUpdate;

    // scroll: use capture so we catch any scrollable ancestor's scroll too
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);

    if (typeof window.ResizeObserver === 'function') {
      try {
        this._resizeObserver = new window.ResizeObserver(scheduleUpdate);
        this._resizeObserver.observe(this.video);
      } catch (e) {
        // ResizeObserver not available on this Pale Moon build
      }
    }

    // Fullscreen escape. When the site fullscreens its player container, a
    // controller parented to <body> sits OUTSIDE the fullscreened subtree and
    // becomes invisible — exactly when the user wants speed control. On
    // fullscreenchange, move the wrapper into the fullscreen element, and back
    // to <body> on exit. (Goanna exposes both prefixed and unprefixed APIs.)
    const onFsChange = () => {
      try {
        const fsEl = document.fullscreenElement || document.mozFullScreenElement || null;
        if (fsEl && wrapper.parentNode !== fsEl) {
          fsEl.appendChild(wrapper);
        } else if (!fsEl && wrapper.parentNode !== document.body) {
          document.body.appendChild(wrapper);
        }
        update();
      } catch (e) {
        // ignored
      }
    };
    this._fsChange = onFsChange;
    document.addEventListener('fullscreenchange', onFsChange, true);
    document.addEventListener('mozfullscreenchange', onFsChange, true);

    // Fallback poll — covers animated transforms and ancestor mutations the
    // observer/scroll listeners don't catch. 500 ms is unnoticeable and the
    // work is cheap (a getBoundingClientRect plus two style writes).
    this._viewportPoll = setInterval(update, 500);

    window.VSC.logger.debug('Controller using viewport tracking (transformed-ancestor escape)');
  }

  /**
   * Set up event handlers for media events`,
      ],
      [
        '      this.arbitration.classifier?.observeSeek(this.video, event.timeStamp);',
        `      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeSeek(this.video, event.timeStamp);
      }`,
      ],
      [
        '      this.arbitration.classifier?.observeMediaInit(this.video, event.timeStamp);',
        `      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeMediaInit(this.video, event.timeStamp);
      }`,
      ],
      [
        '    if (this.div?.flashTimer !== undefined) {',
        '    if (this.div && this.div.flashTimer !== undefined) {',
      ],
      [
        `    // Remove DOM element
    if (this.div && this.div.parentNode) {`,
        `    // UXP: tear down viewport tracking if the transformed-ancestor escape
    // activated it.
    if (this._viewportUpdate) {
      window.removeEventListener('scroll', this._viewportUpdate, true);
      window.removeEventListener('resize', this._viewportUpdate);
      this._viewportUpdate = null;
    }
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (e) { /* ignored */ }
      this._resizeObserver = null;
    }
    if (this._viewportPoll) {
      clearInterval(this._viewportPoll);
      this._viewportPoll = null;
    }
    if (this._fsChange) {
      document.removeEventListener('fullscreenchange', this._fsChange, true);
      document.removeEventListener('mozfullscreenchange', this._fsChange, true);
      this._fsChange = null;
    }

    // Remove DOM element
    if (this.div && this.div.parentNode) {`,
      ],
      [
        '    this.actionHandler?.eventManager?.arbitration?.release(this.video);',
        `    const arbitration =
      this.actionHandler &&
      this.actionHandler.eventManager &&
      this.actionHandler.eventManager.arbitration;
    if (arbitration) {
      arbitration.release(this.video);
    }`,
      ],
    ],
  },

  'core/state-manager.js': {
    edits: [
      [
        "    window.VSC.logger?.debug('VSCStateManager initialized');",
        `    if (window.VSC.logger) {
      window.VSC.logger.debug('VSCStateManager initialized');
    }`,
      ],
      [
        "      window.VSC.logger?.warn('Invalid controller registration attempt');",
        `      if (window.VSC.logger) {
        window.VSC.logger.warn('Invalid controller registration attempt');
      }`,
      ],
      [
        '      tagName: controller.video?.tagName,',
        '      tagName: controller.video ? controller.video.tagName : undefined,',
      ],
      [
        '      videoSrc: controller.video?.src || controller.video?.currentSrc,',
        `      videoSrc: controller.video
        ? controller.video.src || controller.video.currentSrc
        : undefined,`,
      ],
      [
        '    window.VSC.logger?.debug(`Controller registered: ${controller.controllerId}`);',
        `    if (window.VSC.logger) {
      window.VSC.logger.debug(\`Controller registered: \${controller.controllerId}\`);
    }`,
      ],
      [
        '      window.VSC.logger?.debug(`Controller unregistered: ${controllerId}`);',
        `      if (window.VSC.logger) {
        window.VSC.logger.debug(\`Controller unregistered: \${controllerId}\`);
      }`,
      ],
      [
        '      const video = info.controller?.video || info.element;',
        '      const video = (info.controller && info.controller.video) || info.element;',
      ],
      [
        '    return info?.controller?.video || info?.element || null;',
        '    return (info && info.controller && info.controller.video) || (info && info.element) || null;',
      ],
      [
        "window.VSC.logger?.info('State Manager module loaded');",
        `if (window.VSC.logger) {
  window.VSC.logger.info('State Manager module loaded');
}`,
      ],
    ],
  },

  'content/inject.js': {
    // Upstream has no window.VSC line; wrap after the file header.
    anchor: 'class VideoSpeedExtension {',
    edits: [
      [
        `  async initialize() {
    try {
      // Access global modules`,
        `  async initialize() {
    try {
      // UXP: every module is its own <script> tag, so one can fail to load
      // (CSP, 404, parse error) while the rest run. Bail out cleanly instead
      // of crashing deep inside a constructor.
      const required = [
        'VideoController', 'ActionHandler', 'EventManager', 'logger',
        'DomUtils', 'siteHandlerManager', 'VideoMutationObserver',
        'MediaElementObserver', 'Constants', 'videoSpeedConfig',
        'stateManager', 'DEFAULT_CONTROLLER_CSS', 'ShadowDOMManager',
        'ControlsManager', 'DragHandler', 'SpeedArbiter', 'IntentClassifier',
        'SpeedArbitration', 'ControllerVisibility',
      ];
      const missing = required.filter((name) => !window.VSC[name]);
      if (missing.length) {
        console.error('[VSC] Missing required modules — bailing out: ' + missing.join(', '));
        return;
      }

      // Access global modules`,
      ],
      [
        `      this.logger.error(\`Failed to initialize Video Speed Controller: \${error.message}\`);
      this.logger.error(\`Error stack: \${error.stack}\`);`,
        `      // UXP: also report to the console — the logger buffers until settings
      // load, so an early failure would otherwise never be printed (and
      // this.logger is unset if the failure came before it was assigned).
      console.error('[VSC] Init failed: ' + error.message, error.stack);
      if (this.logger) {
        this.logger.error(\`Failed to initialize Video Speed Controller: \${error.message}\`);
        this.logger.error(\`Error stack: \${error.stack}\`);
      }`,
      ],
      {
        from: '  /**\n   * Inject controller CSS via adoptedStyleSheets',
        through: '        this._customSheet = null;\n      }\n    });\n  }',
        to: `  /**
   * UXP: Pale Moon has no Constructable Stylesheets (new CSSStyleSheet /
   * document.adoptedStyleSheets), so controller CSS goes in <style> elements.
   * Same two-sheet split as upstream: _controllerSheet (built-in defaults,
   * domain-preprocessed, never changes at runtime) and _customSheet (user
   * additions, injected raw, live-updatable). @import rules are removed:
   * replaceSync() drops them, a <style> element would load them.
   * @param {string} css
   * @param {string} [id]
   * @returns {HTMLStyleElement}
   * @private
   */
  _appendStyle(css, id) {
    const styleEl = document.createElement('style');
    if (id) {
      styleEl.id = id;
    }
    styleEl.textContent = window.VSC.stripCSSImports(css);
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  }

  injectControllerCSS() {
    try {
      if (this._controllerSheet) {
        return;
      }
      this._controllerSheet = this._appendStyle(
        this.preprocessDomainCSS(window.VSC.Constants.DEFAULT_CONTROLLER_CSS),
        'vsc-controller-defaults'
      );

      const customCSS = this.config.settings.customCSS || '';
      if (customCSS) {
        this._customSheet = this._appendStyle(customCSS, 'vsc-controller-custom');
      }
    } catch (error) {
      this.logger.error(\`Failed to inject controller CSS: \${error.message}\`);
    }
  }

  /** Live-update the user's custom CSS when options are saved. */
  setupCSSLiveUpdates() {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      const cssChange = e.detail && e.detail.customCSS;
      if (!cssChange || cssChange.newValue === undefined || !this._controllerSheet) {
        return;
      }
      const customCSS = cssChange.newValue || '';
      if (customCSS) {
        if (!this._customSheet) {
          this._customSheet = this._appendStyle(customCSS, 'vsc-controller-custom');
        } else {
          this._customSheet.textContent = window.VSC.stripCSSImports(customCSS);
        }
      } else if (this._customSheet) {
        this._customSheet.remove();
        this._customSheet = null;
      }
    });
  }`,
      },
      [
        `    // Remove adopted controller CSS (both default and custom sheets)
    if (document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s) => s !== this._controllerSheet && s !== this._customSheet
      );
    }`,
        `    // Remove controller CSS (both default and custom sheets). UXP: these are
    // <style> elements, not adopted stylesheets.
    if (this._controllerSheet) {
      this._controllerSheet.remove();
    }
    if (this._customSheet) {
      this._customSheet.remove();
    }
    // UXP: also the shared stylesheet ShadowDOMManager adds in place of
    // per-controller shadow styles (upstream's leave with each shadow root).
    window.VSC.ShadowDOMManager.removeCSS(document);`,
      ],
      [
        `(function () {
  const extension = new VideoSpeedExtension();
`,
        `(function () {
  // UXP: single-flight guard hoisted to the top. Upstream registers its
  // VSC_MESSAGE listener first, then skips only an already-initialized
  // instance; a second injection into the same document must neither
  // double-register listeners nor run initialize() twice in parallel.
  if (window.VSC_controller) {
    return;
  }

  const extension = new VideoSpeedExtension();
  window.VSC_controller = extension;

  // UXP: SPA-navigation safety net.
  //
  // YouTube, Twitter, Vimeo, etc. swap videos via history.pushState — no
  // DOMContentLoaded refires, and the mutation observer doesn't always catch
  // the new <video> (racing rebuilds, lazy media loaders, aggressive
  // userscript reskins like VORAPIS V3).
  //
  // We share the page's JS world, so instead of polling location.href on a
  // permanent 1 s interval (which ran on EVERY page forever, even pages with
  // no media), hook the History API plus popstate/hashchange. On any URL
  // change we wait 500 ms for the SPA to settle, then rescan and attach
  // controllers to any video that doesn't already have one.
  let __vscLastUrl = location.href;
  const __vscRescan = () => {
    if (location.href === __vscLastUrl) {
      return;
    }
    __vscLastUrl = location.href;
    if (window.VSC && window.VSC.logger) {
      window.VSC.logger.debug('SPA navigation detected — re-scanning for media');
    }
    setTimeout(() => {
      try {
        if (!extension.mediaObserver) return;
        const media = extension.mediaObserver.scanForMedia(document);
        media.forEach((m) => {
          if (!m.vsc) {
            extension.onVideoFound(m, m.parentElement || m.parentNode);
          }
        });
      } catch (e) {
        if (window.VSC && window.VSC.logger) {
          window.VSC.logger.error('SPA-nav rescan failed: ' + e.message);
        }
      }
    }, 500);
  };

  // Wrap pushState/replaceState so programmatic navigations notify us. The
  // __vscWrapped guard prevents double-wrapping if another script (or a second
  // injection) also wraps them.
  const __vscWrapHistory = (method) => {
    try {
      const orig = history[method];
      if (typeof orig !== 'function' || orig.__vscWrapped) {
        return;
      }
      const wrapped = function () {
        const ret = orig.apply(this, arguments);
        try {
          __vscRescan();
        } catch (e) {
          /* ignored */
        }
        return ret;
      };
      wrapped.__vscWrapped = true;
      history[method] = wrapped;
    } catch (e) {
      // history not writable on this page — popstate/hashchange still cover
      // back/forward and hash navigations.
    }
  };
  __vscWrapHistory('pushState');
  __vscWrapHistory('replaceState');
  window.addEventListener('popstate', __vscRescan);
  window.addEventListener('hashchange', __vscRescan);
`,
      ],
      [
        `            window.VSC.logger?.debug(
              \`Set speed to \${targetSpeed} on \${videos.length} media elements\`
            );`,
        `            if (window.VSC.logger) {
              window.VSC.logger.debug(
                \`Set speed to \${targetSpeed} on \${videos.length} media elements\`
              );
            }`,
      ],
      [
        `            window.VSC.logger?.debug(
              \`Adjusted speed by \${delta} on \${videos.length} media elements\`
            );`,
        `            if (window.VSC.logger) {
              window.VSC.logger.debug(
                \`Adjusted speed by \${delta} on \${videos.length} media elements\`
              );
            }`,
      ],
      [
        '          window.VSC.logger?.debug(`Reset speed on ${videos.length} media elements`);',
        `          if (window.VSC.logger) {
            window.VSC.logger.debug(\`Reset speed on \${videos.length} media elements\`);
          }`,
      ],
      [
        `  // Prevent double injection
  if (window.VSC_controller && window.VSC_controller.initialized) {
    window.VSC.logger?.info('VSC already initialized, skipping re-injection');
    return;
  }

  // Auto-initialize
  extension.initialize().catch((error) => {
    window.VSC.logger.error(\`Extension initialization failed: \${error.message}\`);
  });

  // Export only what's needed with consistent VSC_ prefix
  window.VSC_controller = extension; // The initialized instance
})();`,
        `  // Auto-initialize (the double-injection guard and the VSC_controller export
  // moved to the top of this function — see above).
  extension.initialize().catch((error) => {
    // UXP: console too — see initialize().
    console.error('[VSC] Extension initialization failed:', error.message);
    window.VSC.logger.error(\`Extension initialization failed: \${error.message}\`);
  });
})();`,
      ],
    ],
  },

  // --- Site handlers ---------------------------------------------------------
  'site-handlers/base-handler.js': { edits: [] },
  'site-handlers/amazon-handler.js': { edits: [] },
  'site-handlers/apple-handler.js': { edits: [] },
  'site-handlers/dailymotion-handler.js': { edits: [] },
  'site-handlers/facebook-handler.js': { edits: [] },
  'site-handlers/frame-handler.js': { edits: [] },
  // Upstream's eager handler list: overlay.js loads every handler first.
  'site-handlers/index.js': { edits: [] },
  // Netflix seeks through this page-world bridge, exactly as upstream bundles
  // it into its inject script (the 0.10.2-era fork never loaded it).
  'site-handlers/scripts/netflix.js': { anchor: 'window.addEventListener(', edits: [] },

  'site-handlers/netflix-handler.js': {
    edits: [
      [
        "      video.parentElement?.classList.contains('billboard-row')",
        "      (video.parentElement && video.parentElement.classList.contains('billboard-row'))",
      ],
    ],
  },

  'site-handlers/youtube-handler.js': {
    edits: [
      [
        "      document.body?.querySelector(':scope > #player-controls')",
        "      document.body && document.body.querySelector(':scope > #player-controls')",
      ],
      [
        `    const player =
      video.closest?.('.html5-video-player') ||
      video.closest?.('#movie_player') ||
      video.closest?.('.ytp-player-content');`,
        `    const closest = (selector) =>
      typeof video.closest === 'function' ? video.closest(selector) : undefined;
    const player =
      closest('.html5-video-player') || closest('#movie_player') || closest('.ytp-player-content');`,
      ],
      [
        '      path.some((node) => node === container || (node?.nodeType && container.contains(node)));',
        `      path.some(
        (node) => node === container || (node != null && node.nodeType && container.contains(node))
      );`,
      ],
      [
        '    const embeddedControls = Array.from(player.parentElement?.children || []).find(',
        `    const siblings = (player.parentElement && player.parentElement.children) || [];
    const embeddedControls = Array.from(siblings).find(`,
      ],
      [
        "      video.parentElement?.classList.contains('ytp-ad-player-overlay')",
        "      (video.parentElement && video.parentElement.classList.contains('ytp-ad-player-overlay'))",
      ],
      [
        `        } catch {
          // Cross-origin iframe, ignore`,
        `        } catch (err) {
          // Cross-origin iframe, ignore`,
      ],
    ],
  },

  // --- Controller UI ---------------------------------------------------------
  'ui/controls.js': {
    edits: [
      [
        "    const draggable = shadow.querySelector('.draggable');",
        `    // UXP: the fork's plain-DOM element names live behind ShadowDOMManager.
    const draggable = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);`,
      ],
      [
        `    // Pointer-based drag (unified mouse + touch)
    draggable.addEventListener(
      'pointerdown',`,
        `    // UXP: mousedown, not pointerdown — Goanna builds may ship without pointer
    // events, so a pointerdown listener might never fire. DragHandler then
    // tracks the mouse drag on the document (see drag-handler.js).
    draggable.addEventListener(
      'mousedown',`,
      ],
      [
        `  setupWheelHandler(shadow, video) {
    const controller = shadow.querySelector('#controller');`,
        `  setupWheelHandler(shadow, video) {
    const controller = window.VSC.ShadowDOMManager.getController(shadow);`,
      ],
      [
        `  setupClickPrevention(shadow) {
    const controller = shadow.querySelector('#controller');`,
        `  setupClickPrevention(shadow) {
    const controller = window.VSC.ShadowDOMManager.getController(shadow);`,
      ],
    ],
  },

  'ui/drag-handler.js': {
    edits: [
      [
        "    const shadowController = controller.shadowRoot.querySelector('#controller');",
        `    // UXP: plain-DOM controller — getRoot() stands in for shadowRoot.
    const shadowController = window.VSC.ShadowDOMManager.getController(
      window.VSC.ShadowDOMManager.getRoot(controller)
    );
    const doc = controller.ownerDocument;`,
      ],
      [
        `      // Mouse fallbacks
      draggable.removeEventListener('mousemove', onMove);
      draggable.removeEventListener('mouseup', onEnd);`,
        `      // Mouse fallbacks (UXP: on the document — see below)
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onEnd, true);`,
      ],
      [
        `      // Fallback for environments without pointer events
      draggable.addEventListener('mousemove', onMove);
      draggable.addEventListener('mouseup', onEnd);`,
        `      // UXP: the normal path — controls.js starts drags from mousedown.
      // Mouse events have no setPointerCapture equivalent, so listen on the
      // document in the capture phase: the drag keeps tracking when the
      // cursor outruns the small badge, and a mouseup anywhere ends it.
      doc.addEventListener('mousemove', onMove, true);
      doc.addEventListener('mouseup', onEnd, true);`,
      ],
    ],
  },

  // --- Observers and utilities -----------------------------------------------
  'observers/media-observer.js': { edits: [] },

  'observers/mutation-observer.js': {
    edits: [
      [
        '    this.shadowObservers = new Set();',
        `    // UXP: Map shadowRoot -> MutationObserver so stop() can disconnect them
    // (upstream keeps only the roots, leaving their observers running after
    // teardown).
    this.shadowObservers = new Map();`,
      ],
      [
        '    if (!added && document.body?.contains(node)) {',
        '    if (!added && document.body && document.body.contains(node)) {',
      ],
      [
        '    this.shadowObservers.add(shadowRoot);',
        '    this.shadowObservers.set(shadowRoot, shadowObserver);',
      ],
      [
        `    // Clean up shadow observers
    this.shadowObservers.forEach((_shadowRoot) => {
      // Note: We can't access the observer directly, but disconnecting the main
      // observer should handle most cases. Shadow observers will be garbage collected.
    });`,
        `    // Clean up shadow observers. UXP: disconnect each one — an observer on a
    // live shadow root is not collected while that root exists.
    this.shadowObservers.forEach((observer) => {
      observer.disconnect();
    });`,
      ],
    ],
  },

  'utils/dom-utils.js': {
    edits: [['  } catch {', '  } catch (e) {']],
  },

  'utils/debug-helper.js': {
    edits: [
      [
        '      if (window.VSC.MediaElementObserver && window.VSC_controller?.mediaObserver) {',
        `      if (
        window.VSC.MediaElementObserver &&
        window.VSC_controller &&
        window.VSC_controller.mediaObserver
      ) {`,
      ],
      [
        "      const innerController = controller.shadowRoot?.querySelector('#controller');",
        `      // UXP: plain-DOM controller — getRoot() stands in for shadowRoot.
      const root = window.VSC.ShadowDOMManager.getRoot(controller);
      const innerController = root ? window.VSC.ShadowDOMManager.getController(root) : null;`,
      ],
      [
        `        // Dispatch the same event that content script would dispatch
        window.dispatchEvent(`,
        `        // Dispatch the same event that content script would dispatch.
        // UXP: on documentElement, where inject.js listens — upstream
        // dispatches on window, which that listener never sees.
        document.documentElement.dispatchEvent(`,
      ],
    ],
  },

  // Page half of the settings bridge; the chrome half is overlay.js (the
  // counterpart of upstream's entries/content-bridge.js).
  'core/storage-manager.js': {
    edits: [
      [
        `  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
`,
        `  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;

  // UXP: stands in for upstream's \`window.VSC.logger?.<level>?.(message)\`.
  const log = (level, message) => {
    const logger = window.VSC.logger;
    if (logger != null && logger[level] != null) {
      logger[level](message);
    }
  };
`,
      ],
      { every: 'window.VSC.logger?.debug?.(', to: "log('debug', ", count: 4 },
      { every: 'window.VSC.logger?.error?.(', to: "log('error', ", count: 5 },
      { every: 'window.VSC.logger?.warn?.(', to: "log('warn', ", count: 3 },
      [
        `  class StorageManager {
    static errorCallback = null;
`,
        `  class StorageManager {
`,
      ],
      [
        '  window.VSC.StorageManager = StorageManager;',
        `  // UXP: static class fields are below the Pale Moon syntax floor.
  StorageManager.errorCallback = null;

  window.VSC.StorageManager = StorageManager;`,
      ],
    ],
  },

  // --- Options page: upstream's HTML page, served as chrome-privileged HTML --
  // (chrome://videospeed/content/options/options.html). Its chrome.storage
  // calls reach the prefs through chrome/content/options/chrome-storage.js.
  'ui/options/options.html': {
    dest: 'chrome/content/options/options.html',
    wrap: false,
    edits: [
      [
        `    <title>Video Speed Controller: Options</title>
    <link rel="stylesheet" href="options.css" />
    <script src="options.js"></script>`,
        `    <meta charset="utf-8" />
    <title>Video Speed Controller: Options</title>
    <link rel="stylesheet" href="options.css" />
    <!-- UXP: upstream bundles these into one options.js. Load order matters:
         chrome-storage.js (the chrome.storage shim) must precede
         storage-manager.js, which picks its backend when it loads. -->
    <script src="resource://videospeed/utils/key-maps.js"></script>
    <script src="resource://videospeed/styles/controller-css-defaults.js"></script>
    <script src="resource://videospeed/utils/constants.js"></script>
    <script src="resource://videospeed/utils/logger.js"></script>
    <script src="chrome-storage.js"></script>
    <script src="resource://videospeed/core/storage-manager.js"></script>
    <script src="resource://videospeed/core/settings.js"></script>
    <script src="row-renderer.js"></script>
    <script src="options.js"></script>`,
      ],
      [
        '<img src="../../assets/icons/icon48.png"',
        '<img src="chrome://videospeed/skin/icon48.png"',
      ],
      // UXP: classes stand in for the static `.row:has(#…)` selectors (see
      // options.css), which Goanna without :has() would drop.
      [
        `        <div class="row">
          <label
            >Site rules<br />`,
        `        <div class="row row-site-rules">
          <label
            >Site rules<br />`,
      ],
      [
        `        <div class="row">
          <label for="controllerCSS"`,
        `        <div class="row row-css">
          <label for="controllerCSS"`,
      ],
      [
        '<li><a href="#faq-local">Local files / Incognito</a></li>',
        '<li><a href="#faq-local">Local files / Private windows</a></li>',
      ],
      {
        // UXP: upstream's answer is Chrome-specific (chrome://extensions).
        from: '          <h4 id="faq-local">',
        through: `          </ul>

          <h4 id="faq-disable">`,
        to: `          <h4 id="faq-local">
            Do the speed controls work for local videos and in private windows?
          </h4>
          <p>
            Yes. In Pale Moon and Basilisk the extension runs on local files (e.g. File &gt; Open
            File) and in private windows without any extra permissions.
          </p>

          <h4 id="faq-disable">`,
      },
      [
        // UXP: upstream's text contradicts its own settings.load() and
        // speed-resolution tests — a matching site rule wins at page load.
        `            When <code>rememberSpeed</code> is <strong>on</strong>, the last speed you set is stored
            and persists across sessions. This stored speed <strong>takes precedence</strong> over
            site rule defaults. To let a site rule win again, either turn off
            <code>rememberSpeed</code> or manually reset to 1x.`,
        `            When <code>rememberSpeed</code> is <strong>on</strong>, the last speed you set is stored
            and persists across sessions. On a site with a matching rule, the rule's speed is still
            the starting speed; a speed you choose there takes over for the rest of the page and is
            remembered for sites without a rule.`,
      ],
    ],
  },

  'ui/options/options.css': {
    dest: 'chrome/content/options/options.css',
    wrap: false,
    edits: [
      // UXP: the static rows carry classes instead (options.html); Goanna
      // without :has() would drop these rules and lay the editors out beside
      // their labels. The dynamic `.row.customs:has(...)` rules stay and
      // degrade to a slightly wider shortcut row.
      { every: '.row:has(#site-rules-container)', to: '.row.row-site-rules', count: 2 },
      { every: '.row:has(#controllerCSS)', to: '.row.row-css', count: 2 },
      // UXP: Goanna knows only the prefixed property; without it a <select>
      // shows the native arrow on top of upstream's SVG one.
      { every: '  appearance: none;\n', to: '  -moz-appearance: none;\n  appearance: none;\n', count: 2 },
      // UXP: :-moz-focusring is Goanna's :focus-visible. Separate rules, since
      // an engine missing either pseudo-class drops the whole rule.
      [
        `.header-tab:focus-visible {
  color: var(--md-on-surface);
}
`,
        `.header-tab:focus-visible {
  color: var(--md-on-surface);
}

.header-tab:-moz-focusring {
  color: var(--md-on-surface);
}
`,
      ],
      [
        `.removeParent:focus-visible,
button:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}
`,
        `.removeParent:focus-visible,
button:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}

.removeParent:-moz-focusring,
button:-moz-focusring {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}
`,
      ],
    ],
  },

  'ui/options/row-renderer.js': {
    dest: 'chrome/content/options/row-renderer.js',
    wrapNote: OPTIONS_WRAP_NOTE,
    anchor: `/**
 * Create a DOM row element from a column spec and optional initial data.`,
    edits: [
      ['export function createRow(', 'function createRow('],
      [
        '      el.checked = data[col.key] ?? col.default ?? false;',
        `      el.checked =
        data[col.key] != null ? data[col.key] : col.default != null ? col.default : false;`,
      ],
      [
        '      const val = data[col.key] ?? col.default;',
        '      const val = (data[col.key] != null) ? data[col.key] : col.default;',
      ],
      [
        `  return row;
}`,
        `  return row;
}

// UXP: stands in for upstream's ES module export (options.js reads it).
window.VSC = window.VSC || {};
window.VSC.createRow = createRow;`,
      ],
    ],
  },

  'ui/options/options.js': {
    dest: 'chrome/content/options/options.js',
    wrapNote: OPTIONS_WRAP_NOTE,
    edits: [
      {
        from: '// Core utilities and constants - must load first',
        through: "import { createRow } from './row-renderer.js';",
        to: `// UXP: options.html loads the modules upstream bundles here as <script>
// tags, before this file: key-maps, controller-css-defaults, constants,
// logger, chrome-storage (the chrome.storage shim over the prefs),
// storage-manager, settings and row-renderer.`,
      },
      [
        'let keyBindings = [];',
        `// UXP: row-renderer.js publishes createRow on window.VSC.
const { createRow } = window.VSC;

let keyBindings = [];`,
      ],
      { every: '} catch {', to: '} catch (e) {', count: 3 },
      [
        '  const kc = binding.keyCode ?? binding.key;',
        '  const kc = (binding.keyCode != null) ? binding.keyCode : binding.key;',
      ],
      [
        '    : layoutMap?.get(e.code) || window.VSC.Constants.displayKeyFromCode(e.code) || e.key;',
        `    : (layoutMap && layoutMap.get(e.code)) ||
      window.VSC.Constants.displayKeyFromCode(e.code) ||
      e.key;`,
      ],
      [
        '  input.keyCode = binding.keyCode ?? binding.key;',
        '  input.keyCode = (binding.keyCode != null) ? binding.keyCode : binding.key;',
      ],
      ['    return s ?? null;', '    return (s != null) ? s : null;'],
      [
        "    document.getElementById('controllerCSS').value = storage.customCSS ?? '';",
        `    document.getElementById('controllerCSS').value =
      (storage.customCSS != null) ? storage.customCSS : '';`,
      ],
      [
        `  const dropped = [];
  const probe = new CSSStyleSheet();
  for (const block of blocks) {
    try {
      probe.replaceSync(block);`,
        `  const dropped = [];
  for (const block of blocks) {
    try {
      const probe = parseStyleSheet(block);`,
      ],
      [
        `    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);`,
        '    const sheet = parseStyleSheet(css);',
      ],
      [
        'function validateControllerCSS(css) {',
        `// UXP: Pale Moon has no Constructable Stylesheets (new CSSStyleSheet() /
// replaceSync()). Parse through an inert <style media="not all"> instead and
// return a snapshot with the \`cssRules\` the validator reads. Like
// replaceSync(), drop @import rules first — this privileged page must not
// fetch them either.
function parseStyleSheet(css) {
  const style = document.createElement('style');
  style.media = 'not all';
  style.textContent = window.VSC.stripCSSImports(css);
  document.head.appendChild(style);
  const cssRules = Array.from(style.sheet.cssRules);
  style.remove();
  return { cssRules };
}

function validateControllerCSS(css) {`,
      ],
      ['    const text = await file.text();', '    const text = await readFileText(file);'],
      [
        `/**
 * Import settings from a JSON file. Validates structure before applying.
 */`,
        `// UXP: Blob.text() is newer than some Goanna builds; FileReader reads the
// same text everywhere.
function readFileText(file) {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Import settings from a JSON file. Validates structure before applying.
 */`,
      ],
      // UXP: the fork's repository (install.rdf homepageURL).
      [
        "    window.open('https://github.com/igrigorik/videospeed');",
        "    window.open('https://github.com/SecondCityOsD/videospeed');",
      ],
      [
        "    window.open('https://github.com/igrigorik/videospeed/issues');",
        "    window.open('https://github.com/SecondCityOsD/videospeed/issues');",
      ],
      [
        `  document.addEventListener('beforeinput', (event) => {
    eventCaller(event, 'customValue', inputFilterNumbersOnly);
  });`,
        `  document.addEventListener('beforeinput', (event) => {
    eventCaller(event, 'customValue', inputFilterNumbersOnly);
  });
  // UXP: Goanna builds without the beforeinput event get the same filter from
  // keypress (typed characters) and paste.
  if (!('onbeforeinput' in document.documentElement)) {
    const filterInput = (event, inputType, data) => {
      eventCaller(
        { target: event.target, inputType, data, preventDefault: () => event.preventDefault() },
        'customValue',
        inputFilterNumbersOnly
      );
    };
    document.addEventListener('keypress', (event) => {
      // Shortcuts (Ctrl+V, Alt+menu keys) insert nothing; AltGr reports
      // Ctrl+Alt and does type a character.
      if (event.charCode && !event.metaKey && event.ctrlKey === event.altKey) {
        filterInput(event, 'insertText', String.fromCharCode(event.charCode));
      }
    });
    document.addEventListener('paste', (event) => {
      if (event.clipboardData) {
        filterInput(event, 'insertFromPaste', event.clipboardData.getData('text/plain'));
      }
    });
  }`,
      ],
    ],
  },
};

// ---------------------------------------------------------------------------
// Fork-native files: rewritten for UXP instead of generated from upstream,
// because upstream's version is built on something Pale Moon lacks. Listed so
// the inventory is complete; on every upgrade, review each one by hand against
// the upstream file(s) it tracks.
// ---------------------------------------------------------------------------
const NATIVE = {
  'ui/shadow-dom.js': 'upstream ui/shadow-dom.js (plain-DOM controller instead of a shadow root)',
  'styles/controller-css-defaults.js':
    'upstream styles/inject.css + styles/controller-css-defaults.js (no manifest CSS; :has() lists split; stripCSSImports for <style>)',
};

// ---------------------------------------------------------------------------

/**
 * Apply one registry entry to upstream text. Returns { text, problems }.
 */
function generate(rel, upstreamText) {
  const { anchor = DEFAULT_ANCHOR, edits, wrap = true, wrapNote = PAGE_WRAP_NOTE } = PORTS[rel];
  const problems = [];
  let text = upstreamText.replace(/\r\n/g, '\n');
  const countOf = (needle) => text.split(needle).length - 1;
  for (const edit of edits) {
    if (!Array.isArray(edit) && edit.every !== undefined) {
      const found = countOf(edit.every);
      if (found !== edit.count) {
        problems.push(
          `edit expected exactly ${edit.count} matches, found ${found}:\n      ${edit.every.split('\n')[0]}`
        );
        continue;
      }
      text = text.split(edit.every).join(edit.to);
      continue;
    }
    const { from, through, to } = Array.isArray(edit) ? { from: edit[0], to: edit[1] } : edit;
    const markers = through === undefined ? [from] : [from, through];
    const bad = markers.filter((marker) => countOf(marker) !== 1);
    if (bad.length) {
      for (const marker of bad) {
        problems.push(
          `edit expected exactly 1 match, found ${countOf(marker)}:\n      ${marker.split('\n')[0]}`
        );
      }
      continue;
    }
    const start = text.indexOf(from);
    const end = through === undefined ? start + from.length : text.indexOf(through) + through.length;
    if (end < start + from.length) {
      problems.push(`range edit: 'through' precedes 'from':\n      ${from.split('\n')[0]}`);
      continue;
    }
    text = text.slice(0, start) + to + text.slice(end);
  }
  if (!wrap) {
    return { text, problems };
  }
  const at = text.indexOf(anchor);
  if (at === -1 || text.indexOf(anchor, at + 1) !== -1) {
    problems.push(`IIFE anchor must occur exactly once: ${anchor}`);
  } else {
    text = text.slice(0, at) + iifeOpen(wrapNote) + text.slice(at).replace(/\n*$/, '\n') + IIFE_CLOSE;
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
    const forkPath = path.join(repoRoot, PORTS[rel].dest || path.join('src', rel));
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

  // Full runs also account for every other src/ file: fork-native ones must
  // exist, and the rest are reported as still on their pre-upgrade code.
  if (!only.length) {
    for (const [rel, tracks] of Object.entries(NATIVE)) {
      if (fs.existsSync(path.join(repoRoot, 'src', rel))) {
        console.log(`native ${rel} — tracks ${tracks}`);
      } else {
        failures++;
        console.error(`MISSING native ${rel}`);
      }
    }
    const unported = fs
      .readdirSync(path.join(repoRoot, 'src'), { recursive: true })
      .map((rel) => rel.replace(/\\/g, '/'))
      .filter((rel) => rel.endsWith('.js') && !PORTS[rel] && !NATIVE[rel])
      .sort();
    if (unported.length) {
      console.log(`not yet ported (${unported.length}): ${unported.join(', ')}`);
    }
  }
  return failures ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
