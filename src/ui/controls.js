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
    this.setupClickPrevention(container);
  }

  setupDragHandler(container) {
    var draggable = container.querySelector('.vsc-draggable');
    var self = this;

    draggable.addEventListener(
      'mousedown',
      function(e) {
        self.actionHandler.runAction(e.target.dataset['action'], false, e);
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
    var controller = container.querySelector('.vsc-ctrl');

    controller.addEventListener(
      'wheel',
      function(event) {
        event.preventDefault();
        var delta = Math.sign(event.deltaY);
        var step = 0.1;
        var newSpeed = video.playbackRate + (delta < 0 ? step : -step);
        newSpeed = Math.min(
          Math.max(newSpeed, window.VSC.Constants.SPEED_LIMITS.MIN),
          window.VSC.Constants.SPEED_LIMITS.MAX
        );
        video.playbackRate = newSpeed;

        var speedIndicator = container.querySelector('.vsc-draggable');
        if (speedIndicator) {
          speedIndicator.textContent = newSpeed.toFixed(2);
        }
        window.VSC.logger.debug('Wheel control: speed changed to ' + newSpeed.toFixed(2));
      },
      { passive: false }
    );
  }

  setupClickPrevention(container) {
    var controller = container.querySelector('.vsc-ctrl');
    controller.addEventListener('click', function(e) { e.stopPropagation(); }, false);
    controller.addEventListener('mousedown', function(e) { e.stopPropagation(); }, false);
  }
}

window.VSC.ControlsManager = ControlsManager;
