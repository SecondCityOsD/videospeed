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
    // EVERY layout property below carries !important because we live in the
    // page's CSS world (no shadow DOM in this UXP port). Hostile sites such
    // as YouTube have broad selectors like `[class] { display: block }` or
    // `flex-direction: column` rules that catch our class names. Without
    // !important on display/flex-direction/float/width the controller
    // collapses into a vertical column on those sites.
    // Every selector below is rooted at `.vsc-controller .vsc-controller-inner`
    // for a specificity floor of (0, 3, 0). That beats common userscript reskin
    // selectors like `.html5-video-player *` (0, 1, 1) and most attribute /
    // class-broad rules from VORAPIS V3, Tampermonkey UI patches, etc.
    // Sites that need to override us would have to use !important *and* match
    // our specific class chain — vanishingly rare.
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
        // (Ancestor transforms still affect us — that needs a different fix,
        //  see notes in PORT-NOTES.md.)
        'transform: none !important;' +
        'zoom: 1 !important;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-ctrl {' +
        'position: absolute !important;' +
        // top/left seeded inline by shadow-dom.js, mutated inline by
        // drag-handler.js — MUST NOT be !important here (stylesheet
        // !important outranks normal-priority inline styles and would
        // freeze the controller at 0,0).
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
        'font-size: 13px !important; line-height: 18px !important;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-ctrl:hover {' +
        'opacity: 0.7 !important;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-ctrl:hover > .vsc-draggable {' +
        'margin-right: 8px !important;' +
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
        'cursor: -webkit-grabbing !important; opacity: 0.7 !important;' +
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-draggable {' +
        'display: inline-flex !important;' +
        'flex-direction: row !important;' +
        'align-items: center !important; justify-content: center !important;' +
        'cursor: -webkit-grab !important;' +
        'width: 40px !important; height: 20px !important;' +
        'min-width: 40px !important; max-width: none !important;' +
        'font-size: 13px !important; line-height: 20px !important;' +
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
        'font-size: 13px !important; line-height: 18px !important;' +
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
      '}' +
      '.vsc-controller .vsc-controller-inner .vsc-btn.hideButton {' +
        'opacity: 0.65 !important; margin-left: 8px !important; margin-right: 2px !important;' +
      '}';
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

    // lockSize() applies JS-inline !important rules. This is the ultimate
    // cascade weapon: JS-applied inline !important outranks every author
    // stylesheet rule, including userscript reskins that set !important on
    // our class chain via injected CSS. Used here to hold the controller's
    // critical sizing properties against hostile sites like VORAPIS V3 on
    // YouTube which otherwise shrinks the controller to ~5px.
    var lockSize = function(el, props) {
      for (var p in props) {
        if (Object.prototype.hasOwnProperty.call(props, p)) {
          el.style.setProperty(p, props[p], 'important');
        }
      }
    };

    // Inner container replaces shadow root
    var inner = doc.createElement('div');
    inner.className = 'vsc-controller-inner';
    wrapper.appendChild(inner);

    // Controller div \u2014 base font-size/line-height locked inline because
    // children that inherit (or use em) all anchor to this value.
    var controller = doc.createElement('div');
    controller.className = 'vsc-ctrl';
    controller.style.cssText = 'top:' + top + '; left:' + left + '; opacity:' + opacity + ';';
    lockSize(controller, {
      'font-size': '13px',
      'line-height': '18px',
      'display': 'inline-block',
    });

    // Draggable speed indicator
    var draggable = doc.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'vsc-draggable';
    draggable.textContent = speed;
    lockSize(draggable, {
      'font-size': '13px',
      'line-height': '20px',
      'width': '40px',
      'height': '20px',
      'display': 'inline-flex',
    });
    controller.appendChild(draggable);

    // Controls span \u2014 display is NOT locked here because it toggles between
    // none/inline-flex on hover via the stylesheet.
    var controls = doc.createElement('span');
    controls.className = 'vsc-controls';
    lockSize(controls, {
      'font-size': '13px',
      'line-height': '18px',
    });

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
      lockSize(button, {
        'font-size': '13px',
        'line-height': '18px',
        'padding': '1px 5px 3px 5px',
        'display': 'inline-block',
      });
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
    if (!indicator) return;
    // Route through Constants.formatSpeed so any future format tweak (e.g.
    // dropping trailing zero) applies everywhere automatically.
    var fmt = window.VSC.Constants && window.VSC.Constants.formatSpeed;
    indicator.textContent = fmt ? fmt(speed) : speed.toFixed(2);
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
