/**
 * Event management system for Video Speed Controller
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.listeners = new Map();
    this.coolDown = false;
    this.timer = null;

    // Event deduplication to prevent duplicate key processing
    this.lastKeyEventSignature = null;
  }

  /**
   * Set up all event listeners
   * @param {Document} document - Document to attach events to
   */
  setupEventListeners(document) {
    this.setupKeyboardShortcuts(document);
    this.setupRateChangeListener(document);
  }

  /**
   * Set up keyboard shortcuts
   * @param {Document} document - Document to attach events to
   */
  setupKeyboardShortcuts(document) {
    const docs = [document];

    // If we're in a same-origin iframe, also listen on the top document so
    // shortcuts fire when focus is outside our frame. Cross-origin top is
    // unreachable — we don't even attempt to record a listener we can't clean up.
    try {
      if (window.VSC.DomUtils.inIframe()) {
        // Touching window.top.document throws SecurityError when cross-origin.
        const topDoc = window.top.document;
        if (topDoc && topDoc !== document) {
          docs.push(topDoc);
        }
      }
    } catch (e) {
      window.VSC.logger.debug('Cannot reach top document (cross-origin) — skipping');
    }

    docs.forEach((doc) => {
      try {
        const keydownHandler = (event) => this.handleKeydown(event);
        doc.addEventListener('keydown', keydownHandler, true);

        if (!this.listeners.has(doc)) {
          this.listeners.set(doc, []);
        }
        this.listeners.get(doc).push({
          type: 'keydown',
          handler: keydownHandler,
          useCapture: true,
        });
      } catch (e) {
        window.VSC.logger.debug(`Could not attach keydown listener: ${e.message}`);
      }
    });
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  handleKeydown(event) {
    const keyCode = event.keyCode;

    window.VSC.logger.verbose(`Processing keydown event: ${keyCode}`);

    // Event deduplication - prevent same key event from being processed multiple times
    const eventSignature = `${keyCode}_${event.timeStamp}_${event.type}`;

    if (this.lastKeyEventSignature === eventSignature) {
      return;
    }

    this.lastKeyEventSignature = eventSignature;

    // Ignore if following modifier is active
    if (this.hasActiveModifier(event)) {
      window.VSC.logger.debug(`Keydown event ignored due to active modifier: ${keyCode}`);
      return;
    }

    // Ignore keydown event if typing in an input box
    if (this.isTypingContext(event.target)) {
      return false;
    }

    // Ignore keydown event if no controllers are currently tracked.
    if (!window.VSC.stateManager || !window.VSC.stateManager.hasControllers()) {
      return false;
    }

    // Find matching key binding
    const keyBinding = this.config.settings.keyBindings.find((item) => item.key === keyCode);

    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value, event);

      if (keyBinding.force === 'true') {
        // Disable website's key bindings
        event.preventDefault();
        event.stopPropagation();
      }
    } else {
      window.VSC.logger.verbose(`No key binding found for keyCode: ${keyCode}`);
    }

    return false;
  }

  /**
   * Check if any modifier keys are active
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {boolean} True if modifiers are active
   * @private
   */
  hasActiveModifier(event) {
    return (
      !event.getModifierState ||
      event.getModifierState('Alt') ||
      event.getModifierState('Control') ||
      event.getModifierState('Fn') ||
      event.getModifierState('Meta') ||
      event.getModifierState('Hyper') ||
      event.getModifierState('OS')
    );
  }

  /**
   * Check if user is typing in an input context
   * @param {Element} target - Event target
   * @returns {boolean} True if typing context
   * @private
   */
  isTypingContext(target) {
    return (
      target.nodeName === 'INPUT' || target.nodeName === 'TEXTAREA' || target.isContentEditable
    );
  }

  /**
   * Set up rate change event listener
   * @param {Document} document - Document to attach events to
   */
  setupRateChangeListener(document) {
    const rateChangeHandler = (event) => this.handleRateChange(event);
    document.addEventListener('ratechange', rateChangeHandler, true);

    // Store reference for cleanup
    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners.get(document).push({
      type: 'ratechange',
      handler: rateChangeHandler,
      useCapture: true,
    });
  }

  /**
   * Handle rate change events
   * @param {Event} event - Rate change event
   * @private
   */
  handleRateChange(event) {
    // Plain DOM in UXP — composedPath isn't useful here; the target IS the media element.
    const video = event.target;
    if (!video || !video.vsc) return;

    const isFromVSC = event.detail && event.detail.origin === 'videoSpeed';
    const userSpeed = this.config.settings.lastSpeed;
    const fightWindowActive = !!this.coolDown;

    // Fight detection (upstream 0.10.2 backport): if the site dispatches a
    // ratechange that diverges from our last requested speed within the
    // post-action window, the site is overriding our value (YouTube quality
    // switches, ad transitions, Netflix DRM re-init, etc.). Force it back.
    if (
      !isFromVSC &&
      fightWindowActive &&
      userSpeed != null &&
      Math.abs(video.playbackRate - userSpeed) > 0.05
    ) {
      window.VSC.logger.warn(
        `Site fight detected: ${video.playbackRate.toFixed(2)} → forcing ${userSpeed}`
      );
      video.playbackRate = userSpeed;
      event.stopImmediatePropagation();
      return;
    }

    // Inside the cooldown but matching: this is the browser's native echo of
    // our own change (or a benign external event matching our target).
    // Suppress propagation so the page's own listeners don't double-react.
    if (fightWindowActive) {
      event.stopImmediatePropagation();
    }

    this.updateSpeedFromEvent(video);
  }

  /**
   * Update speed indicators and storage when rate changes
   * @param {HTMLMediaElement} video - Video element
   * @private
   */
  updateSpeedFromEvent(video) {
    // Check if video has a controller attached
    if (!video.vsc) {
      return;
    }

    const speedIndicator = video.vsc.speedIndicator;
    const speed = Number(video.playbackRate.toFixed(2));

    window.VSC.logger.info(`Playback rate changed to ${speed}`);

    // Update controller display
    if (speedIndicator) {
      speedIndicator.textContent = speed.toFixed(2);
    }

    // Update in-memory lastSpeed and let Settings handle the debounced persist
    // (avoids racing the StorageManager dispatch path).
    this.config.settings.lastSpeed = speed;
    if (this.config.settings.rememberSpeed) {
      this.config.save({ lastSpeed: speed });
    }

    // Show controller briefly if hidden
    this.actionHandler.runAction('blink', null, null);
  }

  /**
   * Start cooldown period to prevent event spam
   */
  refreshCoolDown() {
    if (this.coolDown) {
      clearTimeout(this.coolDown);
    }
    // 3 seconds — covers most "site fights" (YouTube quality switches,
    // Netflix DRM re-init, Prime Video ad transitions). Longer-window
    // recovery (e.g. pause → switch quality 30s later) goes through the
    // play/seeked listener in video-controller.js, which re-applies
    // lastSpeed unconditionally.
    this.coolDown = setTimeout(() => {
      this.coolDown = false;
    }, 3000);
  }

  /**
   * Show controller temporarily
   * @param {Element} controller - Controller element
   */
  showController(controller) {
    window.VSC.logger.info('Showing controller');
    controller.classList.add('vcs-show');

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      controller.classList.remove('vcs-show');
      this.timer = null;
      window.VSC.logger.debug('Hiding controller');
    }, 2000);
  }

  /**
   * Clean up all event listeners
   */
  cleanup() {
    this.listeners.forEach((eventList, doc) => {
      eventList.forEach(({ type, handler, useCapture }) => {
        try {
          doc.removeEventListener(type, handler, useCapture);
        } catch (e) {
          window.VSC.logger.warn(`Failed to remove event listener: ${e.message}`);
        }
      });
    });

    this.listeners.clear();

    if (this.coolDown) {
      clearTimeout(this.coolDown);
      this.coolDown = false;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// Create singleton instance
window.VSC.EventManager = EventManager;
