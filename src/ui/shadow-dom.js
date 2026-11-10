/**
 * Controller DOM creation and management — UXP version (plain DOM, no Shadow DOM)
 *
 * Tracks upstream 0.11.1 ui/shadow-dom.js. Upstream builds each controller
 * inside an open shadow root on the <vsc-controller> host; the fork builds the
 * same element tree as light DOM inside a `.vsc-controller-inner` container
 * (the shadow-root stand-in) and styles it from one shared stylesheet whose
 * selectors are rooted at the host class for a (0, 3, 0) specificity floor.
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

const STYLE_ID = 'vsc-controller-style';

class ShadowDOMManager {
  /**
   * Inject the shared controller CSS into a document (once per document).
   * @param {Document} doc
   */
  static ensureCSS(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    // Layout properties carry !important because we live in the page's CSS
    // world (no shadow DOM in this UXP port). Hostile sites such as YouTube
    // have broad selectors like `[class] { display: block }` or
    // `flex-direction: column` rules that catch our class names. Without
    // !important on display/flex-direction/float/width the controller
    // collapses into a vertical column on those sites.
    // Every selector below is rooted at `.vsc-controller .vsc-controller-inner`
    // for a specificity floor of (0, 3, 0). That beats common userscript reskin
    // selectors like `.html5-video-player *` (0, 1, 1) and most attribute /
    // class-broad rules from VORAPIS V3, Tampermonkey UI patches, etc.
    // Sites that need to override us would have to use !important *and* match
    // our specific class chain — vanishingly rare.
    //
    // Opacity deliberately stays normal-priority, as in upstream: the inline
    // opacity on .vsc-ctrl then outranks the :hover / .dragging rules, so the
    // controller keeps the configured opacity exactly like upstream's.
    style.textContent =
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
      // Visibility precedence — upstream keys these on :host(...) state inside
      // the shadow stylesheet. The plain-DOM equivalent targets the inner
      // container (the shadow-root stand-in) from the host's classes and
      // data-vsc-visibility attribute. Equal specificity, so source order is
      // the precedence (docs/controller-visibility.md):
      //   automatic hide  <  explicit SHOW / flash  <  explicit HIDE / no source
      // The container — not .vsc-ctrl — carries them because .vsc-ctrl's
      // display is locked inline with !important (lockSize below), which no
      // stylesheet rule can override. .vsc-ctrl keeps its own inline opacity,
      // so restoring the container to opacity 1 renders the configured value.
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
        // top/left seeded inline by createShadowDOM / VideoController and
        // mutated inline by drag-handler.js — MUST NOT be !important here
        // (stylesheet !important outranks normal-priority inline styles and
        // would freeze the controller at 0,0).
        'top: 0; left: 0;' +
        'display: inline-block !important;' +
        'background: black !important; color: white !important;' +
        'border-radius: 6px !important; padding: 4px !important;' +
        'margin: 10px 10px 10px 15px !important;' +
        'cursor: -webkit-grab !important; cursor: grab !important;' +
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
      '.vsc-controller .vsc-controller-inner .vsc-ctrl.dragging {' +
        'cursor: -webkit-grabbing !important; opacity: 0.7;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-draggable {' +
        'display: inline-flex !important;' +
        'flex-direction: row !important;' +
        'align-items: center !important; justify-content: center !important;' +
        'cursor: -webkit-grab !important;' +
        'max-width: none !important;' +
        'text-align: center !important; vertical-align: middle !important;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-draggable:active {' +
        'cursor: -webkit-grabbing !important;' +
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
    // Insert first so the VSC host sheet inject.js adds (base + site rules)
    // and the user's custom CSS keep their later-wins cascade position.
    const parent = doc.head || doc.documentElement;
    parent.insertBefore(style, parent.firstChild);
  }

  /**
   * Remove the shared controller CSS (extension teardown).
   * @param {Document} doc
   */
  static removeCSS(doc) {
    const style = doc.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
  }

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
    this.ensureCSS(doc);

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
