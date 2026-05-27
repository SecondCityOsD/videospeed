/**
 * Control button interactions and event handling — UXP version (plain DOM)
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class ControlsManager {
  constructor(actionHandler, config) {
    this.actionHandler = actionHandler;
    this.config = config;
  }

  /**
   * Set up control button event listeners.
   * @param {HTMLElement} container - The controller inner container
   * @param {HTMLVideoElement} video - Associated video element
   */
  setupControlEvents(container, video) {
    this.setupDragHandler(container);
    this.setupButtonHandlers(container);
    this.setupWheelHandler(container, video);
    this.setupDoubleClickReset(container);
    this.setupClickPrevention(container);
  }

  setupDragHandler(container) {
    // Match the upstream behaviour: the whole controller body is a drag
    // handle, not just the speed pill. Buttons keep their own handlers
    // because the target check short-circuits before runAction('drag').
    var ctrl = container.querySelector('.vsc-ctrl');
    var self = this;

    ctrl.addEventListener(
      'mousedown',
      function(e) {
        // Let the button click handler own its own events.
        if (e.target.closest && e.target.closest('.vsc-btn')) {
          return;
        }
        self.actionHandler.runAction('drag', false, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }

  setupButtonHandlers(container) {
    var self = this;
    container.querySelectorAll('.vsc-btn').forEach(function(button) {
      button.addEventListener(
        'click',
        function(e) {
          self.actionHandler.runAction(
            e.target.dataset['action'],
            self.config.getKeyBinding(e.target.dataset['action']),
            e
          );
          e.stopPropagation();
        },
        true
      );

      button.addEventListener(
        'touchstart',
        function(e) { e.stopPropagation(); },
        true
      );
    });
  }

  setupWheelHandler(container, video) {
    var self = this;
    var controller = container.querySelector('.vsc-ctrl');
    if (!controller) return;

    // Upstream 0.10.2 ergonomics, ported:
    //   - hover-dwell gate (300 ms) so scrolling a feed past the controller
    //     doesn't unintentionally change playback rate
    //   - touchpad-style scrolls (DOM_DELTA_PIXEL with tiny deltaY) are ignored
    //     so two-finger scroll gestures don't fire dozens of speed changes
    //   - speed change goes through actionHandler.adjustSpeed so the
    //     site-handler / fight-detection / event pipeline runs
    var HOVER_DWELL_MS = 300;
    var TOUCHPAD_THRESHOLD = 50;
    var hoverStart = 0;

    controller.addEventListener('mouseenter', function(e) {
      hoverStart = e.timeStamp;
    });

    controller.addEventListener(
      'wheel',
      function(event) {
        if (event.timeStamp - hoverStart < HOVER_DWELL_MS) {
          window.VSC.logger.debug('Wheel ignored: hover dwell threshold not met');
          return;
        }
        if (event.deltaMode === event.DOM_DELTA_PIXEL &&
            Math.abs(event.deltaY) < TOUCHPAD_THRESHOLD) {
          window.VSC.logger.debug(
            'Touchpad scroll detected (deltaY=' + event.deltaY + ') - ignoring'
          );
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        var step = 0.1;
        var delta = event.deltaY < 0 ? step : -step;
        self.actionHandler.adjustSpeed(video, delta, { relative: true });
      },
      { passive: false }
    );
  }

  setupDoubleClickReset(container) {
    var self = this;
    var controller = container.querySelector('.vsc-ctrl');
    if (!controller) return;

    controller.addEventListener(
      'dblclick',
      function(e) {
        // Buttons own their own click semantics; never reset on a button dblclick.
        if (e.target.closest && e.target.closest('.vsc-btn')) return;

        var resetTarget = self.config.getKeyBinding('reset') || 1.0;
        self.actionHandler.runAction('reset', resetTarget, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }

  setupClickPrevention(container) {
    var controller = container.querySelector('.vsc-ctrl');
    controller.addEventListener('click', function(e) { e.stopPropagation(); }, false);
    controller.addEventListener('mousedown', function(e) { e.stopPropagation(); }, false);
  }
}

window.VSC.ControlsManager = ControlsManager;
