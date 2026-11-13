/**
 * Controller DOM creation and management — UXP version (plain DOM, no Shadow DOM)
 *
 * Tracks upstream 0.11.1 ui/shadow-dom.js. Upstream builds each controller
 * inside an open shadow root on the <vsc-controller> host; the fork builds the
 * same element tree as light DOM inside a `.vsc-controller-inner` container
 * (the shadow-root stand-in). Its CSS (CONTROLLER_CSS in
 * styles/controller-css-defaults.js, selectors rooted at the host class for a
 * (0, 3, 0) specificity floor) is not added from here: overlay.js loads it
 * into the document as an author sheet the page cannot remove.
 *
 * Element mapping (upstream → fork):
 *   shadow root          → div.vsc-controller-inner   (getRoot)
 *   #controller          → div.vsc-ctrl               (getController)
 *   #controls            → span.vsc-controls          (getControls)
 *   .draggable           → span.vsc-draggable         (getSpeedIndicator)
 *   button               → button.vsc-btn             (getButtons)
 */

// Wrapped like every src/ module: keeps ShadowDOMManager out of the page's
// global lexical scope (see CLAUDE.md).
(function () {
'use strict';

window.VSC = window.VSC || {};

class ShadowDOMManager {
  /**
   * Create the controller DOM for a video element.
   * @param {HTMLElement} wrapper - <vsc-controller> host
   * @param {Object} options - Configuration options
   * @returns {HTMLElement} The inner container (the shadow-root stand-in)
   */
  static createShadowDOM(wrapper, options) {
    const { top = '0px', left = '0px', speed = '1.00', opacity = 0.3, buttonSize = 14 } =
      options || {};

    const doc = wrapper.ownerDocument;

    // lockSize() applies JS-inline !important rules. This is the ultimate
    // cascade weapon: JS-applied inline !important outranks every author
    // stylesheet rule, including userscript reskins that set !important on
    // our class chain via injected CSS. Used here to hold the controller's
    // critical sizing properties against hostile sites like VORAPIS V3 on
    // YouTube which otherwise shrinks the controller to ~5px. Sizes follow
    // upstream (font in px from buttonSize, the rest in em); em is safe
    // because every element that uses it locks its own font-size here.
    const lockSize = (el, props) => {
      for (const p in props) {
        if (Object.prototype.hasOwnProperty.call(props, p)) {
          el.style.setProperty(p, props[p], 'important');
        }
      }
    };

    // Inner container replaces the shadow root
    const inner = doc.createElement('div');
    inner.className = 'vsc-controller-inner';
    wrapper.appendChild(inner);

    // Controller div — base font-size/line-height locked inline because
    // children that inherit (or use em) all anchor to this value.
    const controller = doc.createElement('div');
    controller.className = 'vsc-ctrl';
    controller.style.cssText = `top:${top}; left:${left}; opacity:${opacity};`;
    lockSize(controller, {
      'font-size': '13px',
      'line-height': '1.8em',
      display: 'inline-block',
    });

    // Draggable speed indicator
    const draggable = doc.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'vsc-draggable';
    draggable.textContent = speed;
    lockSize(draggable, {
      'font-size': `${buttonSize}px`,
      'line-height': '1.8em',
      width: '2.8em',
      height: '1.4em',
      display: 'inline-flex',
    });
    controller.appendChild(draggable);

    // Controls span — display is NOT locked here because it toggles between
    // none/inline-flex on hover via the stylesheet.
    const controls = doc.createElement('span');
    controls.className = 'vsc-controls';
    lockSize(controls, {
      'font-size': `${buttonSize}px`,
      'line-height': `${buttonSize}px`,
    });

    // Buttons (upstream's four; size inherits from the controls span)
    const buttons = [
      { action: 'rewind', text: '«', cls: 'rw' },
      { action: 'slower', text: '−', cls: '' },
      { action: 'faster', text: '+', cls: '' },
      { action: 'advance', text: '»', cls: 'rw' },
    ];

    buttons.forEach((btnConfig) => {
      const button = doc.createElement('button');
      button.setAttribute('data-action', btnConfig.action);
      button.className = 'vsc-btn' + (btnConfig.cls ? ' ' + btnConfig.cls : '');
      button.textContent = btnConfig.text;
      lockSize(button, {
        'font-size': 'inherit',
        'line-height': 'inherit',
        padding: '1px 5px 3px 5px',
        display: 'inline-block',
      });
      controls.appendChild(button);
    });

    controller.appendChild(controls);
    inner.appendChild(controller);

    window.VSC.logger.debug('Controller DOM created (plain DOM)');
    return inner;
  }

  /**
   * Stand-in for upstream's `host.shadowRoot`.
   * @param {HTMLElement} host - <vsc-controller> host
   * @returns {HTMLElement|null} The inner container
   */
  static getRoot(host) {
    return host ? host.querySelector('.vsc-controller-inner') : null;
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
    const indicator = this.getSpeedIndicator(container);
    if (indicator) {
      indicator.textContent = window.VSC.Constants.formatSpeed(speed);
    }
  }

  /**
   * Calculate position for controller based on video element
   * @param {HTMLVideoElement} video - Video element
   * @returns {Object} Position object with top and left properties
   */
  static calculatePosition(video) {
    const rect = video.getBoundingClientRect();

    // getBoundingClientRect is relative to the viewport; style coordinates
    // are relative to offsetParent, so we adjust for that here. offsetParent
    // can be null if the video has `display: none` or is not yet in the DOM.
    const offsetRect = video.offsetParent ? video.offsetParent.getBoundingClientRect() : null;
    const top = `${Math.max(rect.top - ((offsetRect && offsetRect.top) || 0), 0)}px`;
    const left = `${Math.max(rect.left - ((offsetRect && offsetRect.left) || 0), 0)}px`;

    return { top, left };
  }
}

window.VSC.ShadowDOMManager = ShadowDOMManager;

})();
