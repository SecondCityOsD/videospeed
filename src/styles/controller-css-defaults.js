/**
 * Default controller CSS — UXP port of upstream 0.11.1's two host layers:
 *
 *   1. src/styles/inject.css — the base `vsc-controller` host rules plus a few
 *      page fixes, which Chrome loads from the manifest before any script.
 *      The fork has no manifest CSS, so they lead this string: inject.js
 *      injects it as the first VSC sheet, giving the same cascade order
 *      (base < site overrides < the user's custom CSS).
 *   2. src/styles/controller-css-defaults.js — site-specific overrides.
 *      Domain selectors use :root[style*='--vsc-domain: "DOMAIN"'] syntax; at
 *      injection, inject.js#preprocessDomainCSS strips the marker for the
 *      current host and drops rules for every other host. No CSS variable is
 *      actually set on :root. The marker appears ONCE, on the FIRST selector,
 *      and scopes the whole rule (#1501).
 *
 * The controller host is the same unregistered `<vsc-controller>` element
 * upstream uses (plus the `.vsc-controller` class the fork's own selectors
 * key on), so upstream's selectors apply verbatim.
 *
 * UXP adaptations:
 *   - Upstream groups plain selectors with `:has()` ones in a single selector
 *     list. An engine without :has() drops an entire rule when any selector in
 *     its list is invalid, which on Pale Moon would silently discard every
 *     YouTube placement rule. Each :has() alternative is split into its own,
 *     identically domain-scoped rule: the plain selectors always apply and the
 *     :has() variants still work wherever the engine supports them.
 *   - The base host rule adds -moz-user-select and keeps the fork's cosmetic
 *     hardening (background/border/padding/pointer-events) against hostile
 *     page CSS. Position, offsets, display, visibility and opacity stay
 *     normal-priority as upstream, so site overrides, the visibility layer
 *     and the user's custom CSS can still change them.
 *   - stripCSSImports() (below): upstream applies CSS through
 *     CSSStyleSheet#replaceSync(), which drops @import rules.
 *
 * Also here: CONTROLLER_CSS, the inner-controller layout and visibility
 * precedence (upstream's shadow-root stylesheet), and the builders for the two
 * sheets overlay.js loads into a page (controllerSheetCSS, customSheetCSS).
 * Upstream's CSS is out of the page's reach — manifest CSS and adopted
 * stylesheets are not DOM nodes — so the fork does not put it in <style>
 * elements either: overlay.js attaches these as author sheets
 * (nsIDOMWindowUtils.loadSheetUsingURIString), which a page cannot remove,
 * block or disable (the VORAPIS V3 YouTube layout sweeps every <style>), and
 * which page CSP does not govern. overlay.js loads this file into a sandbox
 * to build them; the page loads it for DEFAULT_CONTROLLER_CSS.
 */

// Wrapped like every src/ module: keeps DEFAULT_CONTROLLER_CSS out of the
// page's global lexical scope (see CLAUDE.md).
(function () {
'use strict';

const DEFAULT_CONTROLLER_CSS = `/* === Base host rules (upstream inject.css) === */

vsc-controller {
  /* Out of normal flow by default; site overrides change to relative. */
  position: absolute;
  /* Pin host origin so flex/grid static-positioning cannot center it. */
  top: 0;
  left: 0;
  visibility: visible;
  opacity: 1;
  display: block;
  width: auto !important;
  height: auto !important;
  white-space: normal;
  user-select: none;
  -moz-user-select: none;
  pointer-events: auto !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}

/* shift YT 3D controller down */
/* e.g. https://www.youtube.com/watch?v=erftYPflJzQ */
.ytp-webgl-spherical-control {
  top: 60px !important;
}

.ytp-fullscreen .ytp-webgl-spherical-control {
  top: 100px !important;
}

/* disable Vimeo video overlay */
div.video-wrapper + div.target {
  height: 0;
}

/* Fix black overlay on Kickstarter */
div.video-player.has_played.vertically_center:before,
div.legacy-video-player.has_played.vertically_center:before {
  content: none !important;
}

/* === Domain-based rules (stable — hostname only) === */

/* Facebook */
:root[style*='--vsc-domain: "facebook.com"'] vsc-controller {
  position: relative;
  top: 40px;
}

/* Google Photos — inline preview */
:root[style*='--vsc-domain: "photos.google.com"'] vsc-controller {
  position: relative;
  top: 35px;
}

/* Google Photos — full-screen view */
:root[style*='--vsc-domain: "photos.google.com"'] #player .house-brand vsc-controller {
  top: 50px;
}

/* Netflix */
:root[style*='--vsc-domain: "netflix.com"'] vsc-controller {
  position: relative;
  top: 85px;
}

/* Google Drive — shift native controls overlay down to expose video */
:root[style*='--vsc-domain: "drive.google.com"'] section[role="tabpanel"][aria-label="Video Player"] {
  top: 80px;
}

/* ChatGPT */
:root[style*='--vsc-domain: "chatgpt.com"'] vsc-controller {
  position: relative;
  top: 0px;
  left: 35px;
}

/* === DOM-contextual rules (may break if site changes HTML structure) === */

/* YouTube autohide — style the light-DOM host instead of relying on the
   deprecated Chromium-only :host-context() shadow selector. Explicit SHOW
   and temporary feedback stop matching this rule; HIDE and no-source remain
   final in the inner cascade. Domain wrapping prevents unrelated sites from
   paying for or accidentally matching the YouTube-owned ancestor class. */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-autohide vsc-controller:not([data-vsc-visibility="show"]):not(.vsc-show) {
  visibility: hidden !important;
  opacity: 0 !important;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .ytp-autohide vsc-controller:not([data-vsc-visibility="show"]):not(.vsc-show) {
  visibility: hidden !important;
  opacity: 0 !important;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* YouTube — controller can be inside .html5-video-player (main site via
   youtube-handler) or a sibling of it (edge cases). Both selectors needed;
   :has(> ...) handles the sibling case DOM-order-independently. Domain-
   wrapped so the :has() probe never evaluates off-YouTube (#1501); the
   duplicate blocks cover youtube-nocookie.com, the privacy-enhanced embed
   host serving the identical player. UXP: the :has() alternative is its own
   rule (see header). */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-hide-info-bar > vsc-controller {
  position: relative;
  top: 10px;
}

:root[style*='--vsc-domain: "youtube.com"'] :has(> .ytp-hide-info-bar) > vsc-controller {
  position: relative;
  top: 10px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .ytp-hide-info-bar > vsc-controller {
  position: relative;
  top: 10px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] :has(> .ytp-hide-info-bar) > vsc-controller {
  position: relative;
  top: 10px;
}

/* YouTube Shorts — the native 48px play/volume row occupies the regular
   top-left controller position. Keep the controller below that row without
   moving it into the Shorts controls on the right. */
:root[style*='--vsc-domain: "youtube.com"'] #shorts-player > vsc-controller {
  position: relative;
  top: 60px;
}

/* YouTube — shifts below paid promotion overlay when visible.
   Domain-wrapped so preprocessDomainCSS strips it on non-YouTube pages:
   [style*=...] forces global style invalidation on every style mutation,
   causing multi-second hangs on heavy pages (Gemini, etc). (#1501)
   Both selectors need :has(), so the list stays as upstream wrote it. */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-hide-info-bar:has(.ytp-paid-content-overlay-link:not([style*="display: none"])) > vsc-controller,
:has(> .ytp-hide-info-bar .ytp-paid-content-overlay-link:not([style*="display: none"])) > vsc-controller {
  top: 40px;
}

/* YouTube embedded player — title-bar clearance across all insertion
   generations: inside the player (classic), promoted to #player (older
   #player-controls sibling layout), and body-anchored (2026 ytm layout,
   where youtube-handler escapes the #movie_player stacking context and the
   never-cleared ytp-autohide coupling). position:relative keeps the
   deterministic 0,0 inner placeholder (VideoController skips rect math for
   relative hosts). Domain-wrapped so the :has()/#player probes never
   evaluate off-YouTube (#1501); previously the bare #player rule applied a
   60px offset on ANY site with a #player container. The duplicate blocks
   cover youtube-nocookie.com privacy-enhanced embeds. UXP: plain and :has()
   selectors are split into separate rules (see header). */
:root[style*='--vsc-domain: "youtube.com"'] .html5-video-player:not(.ytp-hide-info-bar) > vsc-controller,
#player > vsc-controller {
  position: relative;
  top: 60px;
}

:root[style*='--vsc-domain: "youtube.com"'] :has(> .html5-video-player:not(.ytp-hide-info-bar)) > vsc-controller,
body:has(> #player-controls) > vsc-controller {
  position: relative;
  top: 60px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .html5-video-player:not(.ytp-hide-info-bar) > vsc-controller,
#player > vsc-controller {
  position: relative;
  top: 60px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] :has(> .html5-video-player:not(.ytp-hide-info-bar)) > vsc-controller,
body:has(> #player-controls) > vsc-controller {
  position: relative;
  top: 60px;
}

/* OpenAI — prevent black overlay */
.Shared-Video-player > vsc-controller {
  height: 0 !important;
}

/* Amazon Prime Video — prevent black overlay */
.dv-player-fullscreen vsc-controller {
  height: 0 !important;
}

/* Google Drive YouTube embed — no info bar, override embedded player offset.
   UXP: upstream writes ':root:root[style*=…]' to bump specificity, but
   preprocessDomainCSS matches only the second ':root[…]' and leaves the first
   glued to the result (':rootvsc-controller', an invalid selector), so the
   rule never applied. On this host every youtube.com rule is already stripped,
   so the marker alone is enough. */
:root[style*='--vsc-domain: "youtube.googleapis.com"'] vsc-controller {
  position: relative;
  top: 0px;
}`;

// CSS escapes inside an at-keyword name (`@\69mport` is `@import`).
const AT_NAME = /(?:[-\w]|[^\x00-\x7f]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f0-9a-fA-F]))*/y;
const ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/g;

function decodeEscapes(name) {
  return name.replace(ESCAPE, (_, hex, ch) => {
    if (hex === undefined) {
      return ch;
    }
    const cp = parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
      ? '�'
      : String.fromCodePoint(cp);
  });
}

/** Index just past the string token that opens at `i` (a bad string ends at a newline). */
function skipString(css, i) {
  const quote = css[i];
  for (i++; i < css.length; i++) {
    const c = css[i];
    if (c === quote) {
      return i + 1;
    }
    if (c === '\n' || c === '\r' || c === '\f') {
      return i;
    }
    if (c === '\\') {
      i++;
    }
  }
  return i;
}

/**
 * Index just past the `;` ending the at-rule statement whose prelude starts at
 * `i`, or -1 when a `{` comes first (not a statement). Unquoted url() may hold
 * `;`, so parentheses nest; an unterminated statement runs to the end.
 */
function statementEnd(css, i) {
  let parens = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = skipString(css, i);
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? css.length : close + 2;
      continue;
    }
    if (c === '(') {
      parens++;
    } else if (c === ')') {
      parens = Math.max(0, parens - 1);
    } else if (parens === 0 && c === '{') {
      return -1;
    } else if (parens === 0 && c === ';') {
      return i + 1;
    }
    i++;
  }
  return css.length;
}

/**
 * Remove every top-level @import statement from a style sheet's text.
 *
 * UXP: upstream applies the controller CSS and the user's custom CSS through
 * CSSStyleSheet#replaceSync(), which drops @import rules — they never load.
 * The fork has to use <style> elements, which would fetch them (from the page,
 * or from the privileged options page while it validates). Removing them gives
 * replaceSync()'s result. @import inside a block is invalid CSS no engine
 * loads, so only top level is scanned; strings and comments are skipped so
 * their braces and `@` signs don't count.
 * @param {string} css
 * @returns {string}
 */
function stripCSSImports(css) {
  let out = '';
  let copied = 0;
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = skipString(css, i);
    } else if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? css.length : close + 2;
    } else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (c === '@' && depth === 0) {
      AT_NAME.lastIndex = i + 1;
      const name = AT_NAME.exec(css)[0];
      const end =
        decodeEscapes(name).toLowerCase() === 'import' ? statementEnd(css, i + 1 + name.length) : -1;
      if (end === -1) {
        i += 1 + name.length;
      } else {
        out += css.slice(copied, i);
        copied = end;
        i = end;
      }
    } else {
      i++;
    }
  }
  return copied === 0 ? css : out + css.slice(copied);
}

/**
 * Inner-controller CSS — upstream's shadow-root stylesheet, as plain-DOM rules.
 *
 * Layout properties carry !important because the controller lives in the
 * page's CSS world (no shadow DOM in this port). Hostile sites such as YouTube
 * have broad selectors like `[class] { display: block }` or
 * `flex-direction: column` rules that catch our class names; without
 * !important on display/flex-direction/float/width the controller collapses
 * into a vertical column there. Every selector is rooted at
 * `.vsc-controller .vsc-controller-inner` for a specificity floor of (0, 3, 0),
 * which beats common userscript reskin selectors like `.html5-video-player *`
 * (0, 1, 1) and most attribute/class-broad rules (VORAPIS V3, Tampermonkey UI
 * patches). Sites that need to override us would have to use !important *and*
 * match our class chain.
 *
 * Opacity deliberately stays normal-priority, as in upstream: the inline
 * opacity on .vsc-ctrl then outranks the :hover / .dragging rules, so the
 * controller keeps the configured opacity exactly like upstream's.
 */
const CONTROLLER_CSS =
  '.vsc-controller .vsc-controller-inner,' +
  '.vsc-controller .vsc-controller-inner * {' +
    'line-height: 1.8em !important;' +
    'font-family: sans-serif !important;' +
    'font-size: 13px !important;' +
    'box-sizing: border-box !important;' +
    'float: none !important;' +
    'clear: none !important;' +
    'vertical-align: middle !important;' +
    // Neutralize page-applied transforms / zoom on our own subtree.
    // (Ancestor transforms are escaped by VideoController's
    // transformed-ancestor re-parenting.)
    'transform: none !important;' +
    'zoom: 1 !important;' +
  '}' +
  // Visibility precedence — upstream keys these on :host(...) state inside the
  // shadow stylesheet. The plain-DOM equivalent targets the inner container
  // (the shadow-root stand-in) from the host's classes and data-vsc-visibility
  // attribute. Equal specificity, so source order is the precedence
  // (docs/controller-visibility.md):
  //   automatic hide  <  explicit SHOW / flash  <  explicit HIDE / no source
  // The container — not .vsc-ctrl — carries them because .vsc-ctrl's display
  // is locked inline with !important (shadow-dom.js lockSize), which no
  // stylesheet rule can override. .vsc-ctrl keeps its own inline opacity, so
  // restoring the container to opacity 1 renders the configured value.
  '.vsc-controller.vsc-hidden > .vsc-controller-inner {' +
    'display: none !important; visibility: hidden !important; opacity: 0 !important;' +
  '}' +
  '.vsc-controller[data-vsc-visibility="show"] > .vsc-controller-inner,' +
  '.vsc-controller.vsc-show > .vsc-controller-inner {' +
    'display: block !important; visibility: visible !important; opacity: 1 !important;' +
  '}' +
  '.vsc-controller[data-vsc-visibility="hide"] > .vsc-controller-inner,' +
  '.vsc-controller.vsc-nosource > .vsc-controller-inner {' +
    'display: none !important; visibility: hidden !important; opacity: 0 !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-ctrl {' +
    'position: absolute !important;' +
    // top/left seeded inline by createShadowDOM / VideoController and mutated
    // inline by drag-handler.js — MUST NOT be !important here (stylesheet
    // !important outranks normal-priority inline styles and would freeze the
    // controller at 0,0).
    'top: 0; left: 0;' +
    'display: inline-block !important;' +
    'background: black !important; color: white !important;' +
    'border-radius: 6px !important; padding: 4px !important;' +
    'margin: 10px 10px 10px 15px !important;' +
    // Only the speed badge is a drag handle (upstream 0.11).
    'cursor: default !important;' +
    'z-index: 9999999 !important;' +
    'white-space: nowrap !important;' +
    'width: auto !important; max-width: none !important;' +
    'height: auto !important; max-height: none !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-ctrl:hover {' +
    'opacity: 0.7;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-ctrl:hover > .vsc-draggable {' +
    'margin-right: 0.8em !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-controls {' +
    'display: none !important;' +
    'flex-direction: row !important;' +
    'align-items: center !important;' +
    'vertical-align: middle !important;' +
    'width: auto !important; height: auto !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-ctrl:hover .vsc-controls,' +
  '.vsc-controller .vsc-controller-inner .vsc-ctrl.dragging .vsc-controls {' +
    'display: inline-flex !important;' +
    'flex-direction: row !important;' +
    'align-items: center !important;' +
  '}' +
  // Unprefixed grab/grabbing follow each -webkit- value: Goanna may not accept
  // the WebKit keywords, and the last valid declaration wins.
  '.vsc-controller .vsc-controller-inner .vsc-ctrl.dragging {' +
    'cursor: -webkit-grabbing !important; cursor: grabbing !important; opacity: 0.7;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-draggable {' +
    'display: inline-flex !important;' +
    'flex-direction: row !important;' +
    'align-items: center !important; justify-content: center !important;' +
    'cursor: -webkit-grab !important; cursor: grab !important;' +
    'max-width: none !important;' +
    'text-align: center !important; vertical-align: middle !important;' +
    'touch-action: none !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-draggable:active {' +
    'cursor: -webkit-grabbing !important; cursor: grabbing !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-btn {' +
    'display: inline-block !important;' +
    'flex: 0 0 auto !important;' +
    'opacity: 1 !important; cursor: pointer !important;' +
    'color: black !important; background: white !important;' +
    'font-weight: normal !important; border-radius: 5px !important;' +
    'padding: 1px 5px 3px 5px !important;' +
    'border: 0px solid white !important;' +
    'font-family: "Lucida Console", Monaco, monospace !important;' +
    'margin: 0px 2px 2px 2px !important;' +
    'transition: background 0.2s, color 0.2s !important;' +
    'width: auto !important; min-width: 0 !important;' +
    'height: auto !important; min-height: 0 !important;' +
    'text-align: center !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-btn:focus {' +
    'outline: 0 !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-btn:hover {' +
    'opacity: 1 !important; background: #2196f3 !important; color: #ffffff !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-btn:active {' +
    'background: #2196f3 !important; color: #ffffff !important; font-weight: bold !important;' +
  '}' +
  '.vsc-controller .vsc-controller-inner .vsc-btn.rw {' +
    'opacity: 0.65 !important;' +
  '}';

/**
 * Upstream content/inject.js#preprocessDomainCSS, verbatim: keep the rules
 * whose domain marker names this host (marker stripped), drop the others.
 * Copied because overlay.js builds the sheet without a page; smoke.mjs checks
 * it against upstream's method.
 * @param {string} css
 * @param {string} hostname
 * @returns {string}
 */
function preprocessDomainCSS(css, hostname) {
  const normalizedHostname = hostname.replace(/^www\./, '');
  return css.replace(
    /:root\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g,
    (match, domain, selector, body) =>
      domain === normalizedHostname ? `${selector.trim()} {${body}}` : ''
  );
}

/**
 * The controller sheet for a host: the inner-controller CSS, then upstream's
 * host + site rules for that host (upstream: shadow stylesheet, manifest
 * inject.css and the adopted defaults sheet), in that cascade order.
 * @param {string} hostname
 * @returns {string}
 */
function controllerSheetCSS(hostname) {
  return CONTROLLER_CSS + '\n' + preprocessDomainCSS(DEFAULT_CONTROLLER_CSS, hostname);
}

/**
 * The user's custom-CSS sheet (upstream: the adopted custom sheet, loaded
 * after the controller sheet). @import rules dropped, as replaceSync() does.
 * @param {string} customCSS
 * @returns {string}
 */
function customSheetCSS(customCSS) {
  return stripCSSImports(customCSS || '');
}

window.VSC = window.VSC || {};
window.VSC.DEFAULT_CONTROLLER_CSS = DEFAULT_CONTROLLER_CSS;
window.VSC.stripCSSImports = stripCSSImports;
window.VSC.controllerSheetCSS = controllerSheetCSS;
window.VSC.customSheetCSS = customSheetCSS;

})();
