/**
 * Control button interactions and event handling
 */

// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

window.VSC = window.VSC || {};

class ControlsManager {
  constructor(actionHandler, config) {
    this.actionHandler = actionHandler;
    this.config = config;
  }

  /**
   * Set up control button event listeners
   * @param {ShadowRoot} shadow - Shadow root containing controls
   * @param {HTMLVideoElement} video - Associated video element
   */
  setupControlEvents(shadow, video) {
    this.setupDragHandler(shadow);
    this.setupButtonHandlers(shadow);
    this.setupWheelHandler(shadow, video);
    this.setupClickPrevention(shadow);
  }

  /**
   * Set up drag and double-click-to-reset handlers for speed indicator
   * Uses pointer events for unified mouse + touch support
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupDragHandler(shadow) {
    // UXP: the fork's plain-DOM element names live behind ShadowDOMManager.
    const draggable = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // UXP: mousedown, not pointerdown — Goanna builds may ship without pointer
    // events, so a pointerdown listener might never fire. DragHandler then
    // tracks the mouse drag on the document (see drag-handler.js).
    draggable.addEventListener(
      'mousedown',
      (e) => {
        this.actionHandler.runAction(e.target.dataset['action'], false, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );

    // Double-click / double-tap to reset speed
    draggable.addEventListener(
      'dblclick',
      (e) => {
        const resetTarget = this.config.getKeyBinding('reset') || 1.0;
        this.actionHandler.runAction('reset', resetTarget, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }

  /**
   * Set up button click handlers
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupButtonHandlers(shadow) {
    shadow.querySelectorAll('button').forEach((button) => {
      // Click handler
      button.addEventListener(
        'click',
        (e) => {
          this.actionHandler.runAction(
            e.target.dataset['action'],
            this.config.getKeyBinding(e.target.dataset['action']),
            e
          );
          e.stopPropagation();
        },
        true
      );

      // Touch handler to prevent conflicts
      button.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        true
      );
    });
  }

  /**
   * Set up mouse wheel handler for speed control with touchpad filtering
   *
   * Cross-browser wheel event behavior:
   * - Chrome/Safari/Edge: ALL devices use DOM_DELTA_PIXEL (mouse wheels ~100px, touchpads ~1-15px)
   * - Firefox: Mouse wheels use DOM_DELTA_LINE, touchpads use DOM_DELTA_PIXEL
   *
   * Detection strategy: Use magnitude threshold in DOM_DELTA_PIXEL mode to distinguish
   * mouse wheels (±100px typical) from touchpads (±1-15px typical). Threshold of 50px
   * provides safety margin based on empirical browser testing.
   *
   * @param {ShadowRoot} shadow - Shadow root
   * @param {HTMLVideoElement} video - Video element
   * @private
   */
  setupWheelHandler(shadow, video) {
    const controller = window.VSC.ShadowDOMManager.getController(shadow);

    // Hover dwell gate: only allow wheel events after the cursor has rested on the
    // controller for HOVER_DWELL_MS. This prevents accidental speed changes when
    // scrolling through feed-based sites (Twitter, Reddit) where the cursor briefly
    // passes over the controller. See #1352.
    const HOVER_DWELL_MS = 300;
    let hoverStart = 0;

    controller.addEventListener('mouseenter', (e) => {
      hoverStart = e.timeStamp;
    });

    controller.addEventListener('mouseleave', () => {
      hoverStart = 0;
    });

    controller.addEventListener(
      'wheel',
      (event) => {
        // Browsers expose trackpad pinch and Ctrl+wheel zoom as ctrl-modified wheel events.
        // Leave them untouched so browser zoom never becomes playback-speed intent.
        if (event.ctrlKey) {
          window.VSC.logger.debug('Browser zoom gesture ignored');
          return;
        }

        // Reject wheel events before hover dwell threshold is met
        if (event.timeStamp - hoverStart < HOVER_DWELL_MS) {
          window.VSC.logger.debug('Wheel ignored: hover dwell threshold not met');
          return;
        }

        // Detect and filter touchpad events to prevent interference during page scrolling
        if (event.deltaMode === event.DOM_DELTA_PIXEL) {
          // Chrome/Safari/Edge: Use magnitude to distinguish mouse wheel (>50px) from touchpad (<50px)
          const TOUCHPAD_THRESHOLD = 50;
          if (Math.abs(event.deltaY) < TOUCHPAD_THRESHOLD) {
            window.VSC.logger.debug(
              `Touchpad scroll detected (deltaY: ${event.deltaY}) - ignoring`
            );
            return;
          }
        }
        // Firefox: DOM_DELTA_LINE events are typically legitimate mouse wheels, allow them

        event.preventDefault();

        const delta = Math.sign(event.deltaY);
        const step = 0.1;
        const speedDelta = delta < 0 ? step : -step;

        this.actionHandler.adjustSpeed(video, speedDelta, { relative: true });

        window.VSC.logger.debug(
          `Wheel control: adjusting speed by ${speedDelta} (deltaMode: ${event.deltaMode}, deltaY: ${event.deltaY})`
        );
      },
      { passive: false }
    );
  }

  /**
   * Set up click prevention for controller container
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupClickPrevention(shadow) {
    const controller = window.VSC.ShadowDOMManager.getController(shadow);

    // Prevent clicks from bubbling up to page
    controller.addEventListener('click', (e) => e.stopPropagation(), false);
    controller.addEventListener('mousedown', (e) => e.stopPropagation(), false);
  }
}

// Create singleton instance
window.VSC.ControlsManager = ControlsManager;

})();
