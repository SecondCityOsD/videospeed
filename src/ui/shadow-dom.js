/**
 * Controller DOM creation and management — UXP version (plain DOM, no Shadow DOM)
 * Uses scoped CSS classes to avoid style conflicts with host pages.
 * Modular architecture using global variables.
 */

window.VSC = window.VSC || {};

class ShadowDOMManager {
  /**
   * Inject controller CSS into a document (once per document).
   */
  static ensureCSS(doc) {
    if (doc.getElementById('vsc-controller-style')) return;
    var style = doc.createElement('style');
    style.id = 'vsc-controller-style';
    style.type = 'text/css';
    style.textContent =
      '.vsc-controller-inner * {' +
        'line-height: 1.8em !important;' +
        'font-family: sans-serif !important;' +
        'font-size: 13px !important;' +
        'box-sizing: border-box !important;' +
      '}' +
      '.vsc-controller-inner .vsc-ctrl {' +
        'position: absolute !important;' +
        'top: 0 !important; left: 0 !important;' +
        'background: black !important; color: white !important;' +
        'border-radius: 6px !important; padding: 4px !important;' +
        'margin: 10px 10px 10px 15px !important;' +
        'cursor: default !important; z-index: 9999999 !important;' +
        'white-space: nowrap !important;' +
      '}' +
      '.vsc-controller-inner .vsc-ctrl:hover { opacity: 0.7 !important; }' +
      '.vsc-controller-inner .vsc-ctrl:hover > .vsc-draggable { margin-right: 0.8em !important; }' +
      '.vsc-controller-inner .vsc-controls { display: none !important; vertical-align: middle !important; }' +
      '.vsc-controller-inner .vsc-ctrl:hover .vsc-controls { display: inline-block !important; }' +
      '.vsc-controller-inner .vsc-ctrl.dragging { cursor: -webkit-grabbing !important; opacity: 0.7 !important; }' +
      '.vsc-controller-inner .vsc-ctrl.dragging .vsc-controls { display: inline-block !important; }' +
      '.vsc-controller-inner .vsc-draggable {' +
        'cursor: -webkit-grab !important; display: inline-flex !important;' +
        'align-items: center !important; justify-content: center !important;' +
        'width: 2.8em !important; height: 1.4em !important;' +
        'text-align: center !important; vertical-align: middle !important;' +
      '}' +
      '.vsc-controller-inner .vsc-draggable:active { cursor: -webkit-grabbing !important; }' +
      '.vsc-controller-inner .vsc-btn {' +
        'opacity: 1 !important; cursor: pointer !important;' +
        'color: black !important; background: white !important;' +
        'font-weight: normal !important; border-radius: 5px !important;' +
        'padding: 1px 5px 3px 5px !important;' +
        'font-size: inherit !important; line-height: inherit !important;' +
        'border: 0px solid white !important;' +
        'font-family: "Lucida Console", Monaco, monospace !important;' +
        'margin: 0px 2px 2px 2px !important;' +
        'transition: background 0.2s, color 0.2s !important;' +
      '}' +
      '.vsc-controller-inner .vsc-btn:focus { outline: 0 !important; }' +
      '.vsc-controller-inner .vsc-btn:hover { opacity: 1 !important; background: #2196f3 !important; color: #ffffff !important; }' +
      '.vsc-controller-inner .vsc-btn:active { background: #2196f3 !important; color: #ffffff !important; font-weight: bold !important; }' +
      '.vsc-controller-inner .vsc-btn.rw { opacity: 0.65 !important; }' +
      '.vsc-controller-inner .vsc-btn.hideButton { opacity: 0.65 !important; margin-left: 8px !important; margin-right: 2px !important; }';
    (doc.head || doc.documentElement).appendChild(style);
  }

  /**
   * Create controller DOM for a video element.
   * Returns a container element (replaces the old ShadowRoot return).
   * @param {HTMLElement} wrapper - Wrapper element (.vsc-controller)
   * @param {Object} options - Configuration options
   * @returns {HTMLElement} The inner container (queried like the old shadow root)
   */
  static createShadowDOM(wrapper, options) {
    options = options || {};
    var top = options.top || '0px';
    var left = options.left || '0px';
    var speed = options.speed || '1.00';
    var opacity = options.opacity || 0.3;
    var buttonSize = options.buttonSize || 14;

    var doc = wrapper.ownerDocument;
    this.ensureCSS(doc);

    // Inner container replaces shadow root
    var inner = doc.createElement('div');
    inner.className = 'vsc-controller-inner';
    wrapper.appendChild(inner);

    // Controller div
    var controller = doc.createElement('div');
    controller.className = 'vsc-ctrl';
    controller.style.cssText = 'top:' + top + '; left:' + left + '; opacity:' + opacity + ';';

    // Draggable speed indicator
    var draggable = doc.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'vsc-draggable';
    draggable.style.cssText = 'font-size: ' + buttonSize + 'px;';
    draggable.textContent = speed;
    controller.appendChild(draggable);

    // Controls span
    var controls = doc.createElement('span');
    controls.className = 'vsc-controls';
    controls.style.cssText = 'font-size: ' + buttonSize + 'px; line-height: ' + buttonSize + 'px;';

    // Buttons
    var buttons = [
      { action: 'rewind',  text: '\u00AB', cls: 'rw' },
      { action: 'slower',  text: '\u2212', cls: '' },
      { action: 'faster',  text: '+',      cls: '' },
      { action: 'advance', text: '\u00BB', cls: 'rw' },
      { action: 'display', text: '\u00D7', cls: 'hideButton' }
    ];

    buttons.forEach(function(btnConfig) {
      var button = doc.createElement('button');
      button.setAttribute('data-action', btnConfig.action);
      button.className = 'vsc-btn' + (btnConfig.cls ? ' ' + btnConfig.cls : '');
      button.textContent = btnConfig.text;
      controls.appendChild(button);
    });

    controller.appendChild(controls);
    inner.appendChild(controller);

    window.VSC.logger.debug('Controller DOM created (plain DOM fallback)');
    return inner;
  }

  static getController(container) {
    return container.querySelector('.vsc-ctrl');
  }

  static getControls(container) {
    return container.querySelector('.vsc-controls');
  }

  static getSpeedIndicator(container) {
    return container.querySelector('.vsc-draggable');
  }

  static getButtons(container) {
    return container.querySelectorAll('.vsc-btn');
  }

  static updateSpeedDisplay(container, speed) {
    var indicator = this.getSpeedIndicator(container);
    if (indicator) indicator.textContent = speed.toFixed(2);
  }

  static calculatePosition(video) {
    var rect = video.getBoundingClientRect();
    var offsetRect = video.offsetParent ? video.offsetParent.getBoundingClientRect() : null;
    var top = Math.max(rect.top - (offsetRect ? offsetRect.top : 0), 0) + 'px';
    var left = Math.max(rect.left - (offsetRect ? offsetRect.left : 0), 0) + 'px';
    return { top: top, left: left };
  }
}

window.VSC.ShadowDOMManager = ShadowDOMManager;
