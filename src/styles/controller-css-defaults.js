/**
 * Default controller CSS.
 *
 * In the upstream Chrome MV3 extension this layer carries shadow-DOM
 * styling (`.vsc-speedIndicator`, `.vsc-draghandle`, etc.). The UXP port
 * uses plain DOM with different class names — those rules don't match our
 * elements, and the un-`!important` `.vsc-controls`/`.vsc-btn` rules in
 * the original got beaten by hostile host-page CSS (notably YouTube's
 * broad `[class] { display: block }` style selectors).
 *
 * Everything load/layout-related now lives in src/ui/shadow-dom.js with
 * `!important`. This file keeps only:
 *   - the outer `.vsc-controller` wrapper rules (positioning, visibility,
 *     pointer-events) that don't conflict, and
 *   - the visibility states (`.vsc-hidden`, `.vsc-show`, `.vsc-nosource`)
 *     that video-controller.js toggles via classList.
 *
 * The string is still exposed as `window.VSC.DEFAULT_CONTROLLER_CSS` so
 * inject.js's `injectControllerCSS()` keeps working without changes.
 */

const DEFAULT_CONTROLLER_CSS = `
.vsc-controller {
  position: absolute !important;
  z-index: 2147483647 !important;
  pointer-events: auto !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  /* Many hostile sites apply white-space: pre-line on ancestors; reset it
     so it doesn't render unintended whitespace around the controller. */
  white-space: normal !important;
  /* Disable text selection while interacting with the controller. */
  user-select: none !important;
  -moz-user-select: none !important;
}

.vsc-controller > * {
  pointer-events: auto !important;
}

.vsc-controller.vsc-hidden {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
}

.vsc-controller.vsc-nosource {
  display: none !important;
}

.vsc-controller.vsc-manual:not(.vsc-hidden) {
  visibility: visible !important;
  opacity: 1 !important;
}

/* Site-specific positioning fixes — these are scoped to host-page class
   names that exist OUTSIDE our controller wrapper, so they don't conflict
   with the bulletproof inner CSS in shadow-dom.js. */

/* YouTube — shift down when info bar is hidden / autohide is active */
.ytp-hide-info-bar .vsc-controller {
  position: relative !important;
  top: 10px !important;
}

.ytp-autohide .vsc-controller {
  visibility: hidden !important;
  opacity: 0 !important;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.ytp-autohide .vsc-controller.vsc-show {
  visibility: visible !important;
  opacity: 1 !important;
}

/* YouTube embedded player */
.html5-video-player:not(.ytp-hide-info-bar) .vsc-controller {
  position: relative !important;
  top: 60px !important;
}

/* Netflix */
#netflix-player:not(.player-cinema-mode) .vsc-controller {
  position: relative !important;
  top: 85px !important;
}

/* Facebook */
#facebook .vsc-controller {
  position: relative !important;
  top: 40px !important;
}

/* Amazon Prime Video full-screen */
.dv-player-fullscreen .vsc-controller {
  height: 0 !important;
}
`;

window.VSC = window.VSC || {};
window.VSC.DEFAULT_CONTROLLER_CSS = DEFAULT_CONTROLLER_CSS;
