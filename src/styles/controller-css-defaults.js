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
 *
 * Inner-controller layout and the visibility precedence (upstream's shadow
 * CSS) live in ui/shadow-dom.js.
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

window.VSC = window.VSC || {};
window.VSC.DEFAULT_CONTROLLER_CSS = DEFAULT_CONTROLLER_CSS;

})();
