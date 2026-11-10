/**
 * Video Controller class for managing individual video elements
 *
 */

// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

window.VSC = window.VSC || {};

class VideoController {
  constructor(target, parent, config, actionHandler, shouldStartHidden = false) {
    // Return existing controller if already attached
    if (target.vsc) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.config = config;
    this.actionHandler = actionHandler;
    // Lifecycle decisions come from the document coordinator, which shares
    // desired authority while keeping conflict state keyed by media element.
    // Standalone construction only uses lifecycle reads, so a local fallback
    // remains safe for controller-only tests.
    this.arbitration =
      (actionHandler && actionHandler.eventManager && actionHandler.eventManager.arbitration) ||
      new window.VSC.SpeedArbitration(config, null);
    this.controlsManager = new window.VSC.ControlsManager(actionHandler, config);
    this.shouldStartHidden = shouldStartHidden;

    // Generate unique controller ID for badge tracking
    this.controllerId = this.generateControllerId(target);

    // Transient reset memory (not persisted, instance-specific)
    this.speedBeforeReset = null;
    this.positionBeforeJump = null;

    // Attach controller to video element first (needed for adjustSpeed)
    target.vsc = this;

    // Register with state manager immediately after controller is attached
    if (window.VSC.stateManager) {
      window.VSC.stateManager.registerController(this);
    } else {
      window.VSC.logger.error('StateManager not available during VideoController initialization');
    }

    // Initialize speed
    this.initializeSpeed();

    // Create UI
    this.div = this.initializeControls();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up mutation observer for src changes
    this.setupMutationObserver();

    window.VSC.logger.info('VideoController initialized for video element');

    // UXP: lifecycle event for the chrome overlay's toolbar badge.
    this.dispatchControllerEvent('VSC_CONTROLLER_CREATED', {
      controllerId: this.controllerId,
      videoSrc: this.video.currentSrc || this.video.src,
      tagName: this.video.tagName,
    });
  }

  /**
   * Initialize video speed based on settings.
   *
   * Lifecycle writes execute WRITE + SYNC_UI only — never PERSIST (cell 6,
   * persistence purity I2): re-asserting existing authority must not
   * refresh it or leak an initialization value into storage.
   * @private
   */
  initializeSpeed() {
    // Defer until metadata is loaded — setting playbackRate before the player
    // has initialized can race with the site's own init sequence. Recompute
    // the target at execution time because another player may claim a newer
    // shared authority while this media is still loading.
    if (this.video.readyState < 1) {
      window.VSC.logger.debug('Deferring initializeSpeed until loadedmetadata');
      this.handleLoadedMetadata = () => {
        this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
        this.handleLoadedMetadata = null;
        this.applyLifecycleSpeed('loadedmetadata');
      };
      this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
      return;
    }

    this.applyLifecycleSpeed('initializeSpeed');
  }

  /**
   * Execute a lifecycle write only while this controller remains attached.
   * @param {string} eventType
   * @private
   */
  applyLifecycleSpeed(eventType) {
    if (this.video.vsc !== this || !this.actionHandler) {
      return;
    }

    // Mark the (re)initialization moment before deciding whether to write:
    // sites commonly answer this phase with their own playbackRate = 1.0,
    // which must not read as a user's menu choice even when no restore was
    // needed (classifier MEDIA_INIT_GRACE_MS).
    if (eventType === 'initializeSpeed' || eventType === 'loadedmetadata') {
      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeMediaInit(this.video, performance.now());
      }
    }

    const targetSpeed = this.arbitration.lifecycleTarget(this.video);
    if (targetSpeed === null) {
      window.VSC.logger.debug(
        `${eventType}: no authoritative target, leaving playbackRate=${this.video.playbackRate}`
      );
      return;
    }
    if (targetSpeed === this.video.playbackRate) {
      return;
    }

    window.VSC.logger.info(`${eventType}: restoring speed to ${targetSpeed}`);
    this.actionHandler.writeRate(this.video, targetSpeed);
    this.actionHandler.syncIndicator(this.video, targetSpeed);
  }

  /**
   * Initialize video controller UI
   * @returns {HTMLElement} Controller wrapper element
   * @private
   */
  initializeControls() {
    window.VSC.logger.debug('initializeControls Begin');

    const document = this.video.ownerDocument;
    const speed = window.VSC.Constants.formatSpeed(this.video.playbackRate);

    window.VSC.logger.debug(`Speed variable set to: ${speed}`);

    // Create custom element wrapper to avoid CSS conflicts
    const wrapper = document.createElement('vsc-controller');

    // Apply all CSS classes at once to prevent race condition flash
    const cssClasses = ['vsc-controller'];

    // Only hide controller if video has no source AND is not ready/functional
    // This prevents hiding controllers for live streams or dynamically loaded videos
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      cssClasses.push('vsc-nosource');
    }

    if (this.config.settings.startHidden || this.shouldStartHidden) {
      cssClasses.push('vsc-hidden');
      window.VSC.logger.debug('Starting controller hidden');
    }
    // When startHidden=false, use natural visibility (no special class needed)

    // Apply all classes at once to prevent visible flash
    wrapper.className = cssClasses.join(' ');

    // IMPORTANT: Wrapper gets z-index ONLY — no position, no top, no left.
    // Position is controlled by inject.css (default: absolute; site overrides: relative).
    // Adding inline position here would defeat CSS site overrides via specificity.
    wrapper.style.cssText = 'z-index: 9999999 !important;';

    // Create shadow DOM with placeholder position (set after insertion)
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      top: '0px',
      left: '0px',
      speed: speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // Insert into DOM FIRST — position calculation needs the wrapper in the DOM
    this.insertIntoDOM(document, wrapper);

    // THEN compute position based on actual DOM state.
    // If a CSS override sets the wrapper to position:relative (e.g. YouTube, Netflix),
    // the inner controller stays at (0,0) and the CSS nudge handles placement.
    // Otherwise (wrapper is absolute), compute coordinates for generic sites.
    // UXP: a host re-parented to <body> by the transformed-ancestor escape
    // (insertIntoDOM) is already pinned to the video's viewport rect, so the
    // inner controller stays at 0,0 there or it would be offset twice.
    const computedPosition = getComputedStyle(wrapper).position;
    if (computedPosition !== 'relative' && !this._viewportUpdate) {
      const position = window.VSC.ShadowDOMManager.calculatePosition(this.video);
      const innerController = window.VSC.ShadowDOMManager.getController(shadow);
      innerController.style.top = position.top;
      innerController.style.left = position.left;
    }

    window.VSC.logger.debug('initializeControls End');
    return wrapper;
  }

  /**
   * Insert controller into DOM with site-specific positioning
   * @param {Document} document - Document object
   * @param {HTMLElement} wrapper - Wrapper element to insert
   * @private
   */
  insertIntoDOM(document, wrapper) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    // Get site-specific positioning information
    const positioning = window.VSC.siteHandlerManager.getControllerPosition(
      this.parent,
      this.video
    );

    // UXP: VORAPIS-V3 / hostile-userscript escape hatch.
    //
    // If any ancestor of the planned insertion point has a CSS `transform`
    // (other than `none`) or a non-default `zoom`, our absolutely-positioned
    // controller is rendered inside that transformed subtree and visually
    // scaled to match. No CSS rule applied to the child can override this —
    // transform composes onto descendants by definition. The only way out is
    // to insert outside the transformed subtree entirely. We re-parent to
    // document.body and switch to fixed positioning with viewport-relative
    // coordinates computed from the video's getBoundingClientRect.
    if (this._hasTransformedAncestor(positioning.insertionPoint, document)) {
      window.VSC.logger.warn(
        'Transformed ancestor detected — re-parenting controller to document.body'
      );
      document.body.appendChild(fragment);
      this._setupViewportTracking(wrapper);
      return;
    }

    switch (positioning.insertionMethod) {
      case 'beforeParent':
        positioning.insertionPoint.parentElement.insertBefore(fragment, positioning.insertionPoint);
        break;

      case 'afterParent':
        positioning.insertionPoint.parentElement.insertBefore(
          fragment,
          positioning.insertionPoint.nextSibling
        );
        break;

      case 'firstChild':
      default:
        positioning.insertionPoint.insertBefore(fragment, positioning.insertionPoint.firstChild);
        break;
    }

    window.VSC.logger.debug(`Controller inserted using ${positioning.insertionMethod} method`);
  }

  /**
   * Walk up from an element checking each ancestor's computed style for
   * a non-default `transform` or `zoom`. Returns true if any is found.
   * Stops at document.documentElement.
   * @private
   */
  _hasTransformedAncestor(el, doc) {
    let node = el;
    const root = doc.documentElement;
    while (node && node !== root) {
      let style;
      try {
        style = node.ownerDocument.defaultView.getComputedStyle(node);
      } catch (e) {
        return false;
      }
      if (style.transform && style.transform !== 'none') {
        return true;
      }
      // `zoom` is non-standard but widely shipped. Computed value is the
      // resolved number or 'normal'.
      if (style.zoom && style.zoom !== '1' && style.zoom !== 'normal') {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Switch the wrapper to viewport-relative positioning and keep it pinned
   * to the video's on-screen rect via getBoundingClientRect updates on
   * scroll/resize/ResizeObserver tick + a 500 ms interval as a safety net
   * for animated ancestor transforms.
   *
   * Takes the wrapper explicitly: this runs from insertIntoDOM() while
   * initializeControls() is still building the controller, before the
   * constructor has assigned this.div (reading this.div here made the whole
   * escape a silent no-op).
   *
   * Tracked timers/observers are stored on `this` so `remove()` can clean
   * them up.
   * @param {HTMLElement} wrapper - Controller wrapper just inserted into <body>
   * @private
   */
  _setupViewportTracking(wrapper) {
    if (!wrapper) return;

    // position:fixed escapes ancestor `transform` only if no ancestor of the
    // fixed element has transform/filter/perspective — by inserting into
    // document.body we've ensured that.
    wrapper.style.setProperty('position', 'fixed', 'important');

    // Start at the viewport origin; update() pins it to the video below.
    wrapper.style.setProperty('top', '0px', 'important');
    wrapper.style.setProperty('left', '0px', 'important');

    const update = () => {
      try {
        if (!this.video || !this.video.isConnected) return;
        const rect = this.video.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        wrapper.style.setProperty('top', rect.top + 'px', 'important');
        wrapper.style.setProperty('left', rect.left + 'px', 'important');
      } catch (e) {
        // video may have been removed; let remove() clean up later
      }
    };

    // rAF-coalesced wrapper for the high-frequency listeners (scroll, resize,
    // ResizeObserver): at most one getBoundingClientRect + style write per
    // frame instead of one per event, so fast scrolling can't thrash layout.
    let rafPending = false;
    const scheduleUpdate = () => {
      if (rafPending) return;
      rafPending = true;
      const run = () => {
        rafPending = false;
        update();
      };
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(run);
      } else {
        window.setTimeout(run, 16);
      }
    };

    update();

    // The listeners are added with scheduleUpdate; remove() removes the same
    // reference, so this must stay scheduleUpdate (not update).
    this._viewportUpdate = scheduleUpdate;

    // scroll: use capture so we catch any scrollable ancestor's scroll too
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);

    if (typeof window.ResizeObserver === 'function') {
      try {
        this._resizeObserver = new window.ResizeObserver(scheduleUpdate);
        this._resizeObserver.observe(this.video);
      } catch (e) {
        // ResizeObserver not available on this Pale Moon build
      }
    }

    // Fullscreen escape. When the site fullscreens its player container, a
    // controller parented to <body> sits OUTSIDE the fullscreened subtree and
    // becomes invisible — exactly when the user wants speed control. On
    // fullscreenchange, move the wrapper into the fullscreen element, and back
    // to <body> on exit. (Goanna exposes both prefixed and unprefixed APIs.)
    const onFsChange = () => {
      try {
        const fsEl = document.fullscreenElement || document.mozFullScreenElement || null;
        if (fsEl && wrapper.parentNode !== fsEl) {
          fsEl.appendChild(wrapper);
        } else if (!fsEl && wrapper.parentNode !== document.body) {
          document.body.appendChild(wrapper);
        }
        update();
      } catch (e) {
        // ignored
      }
    };
    this._fsChange = onFsChange;
    document.addEventListener('fullscreenchange', onFsChange, true);
    document.addEventListener('mozfullscreenchange', onFsChange, true);

    // Fallback poll — covers animated transforms and ancestor mutations the
    // observer/scroll listeners don't catch. 500 ms is unnoticeable and the
    // work is cheap (a getBoundingClientRect plus two style writes).
    this._viewportPoll = setInterval(update, 500);

    window.VSC.logger.debug('Controller using viewport tracking (transformed-ancestor escape)');
  }

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      this.applyLifecycleSpeed(event.type);
    };

    // Bind event handlers. Seek evidence is recorded before the readyState
    // restore guard so initialization-time seeks can explain a 1.0 reset.
    this.handlePlay = mediaEventAction.bind(this);
    this.handleSeekEvidence = (event) => {
      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeSeek(this.video, event.timeStamp);
      }
    };
    this.handleSeek = (event) => {
      this.handleSeekEvidence(event);
      if (event.target.readyState < 2) {
        return;
      }
      mediaEventAction.call(this, event);
    };
    this.handleMediaInit = (event) => {
      this.arbitration.clearEchoTransaction(this.video);
      if (this.arbitration.classifier) {
        this.arbitration.classifier.observeMediaInit(this.video, event.timeStamp);
      }
    };

    // `seeking` covers resets during an active seek; `seeked` refreshes the
    // evidence window after slow seeks while retaining its lifecycle restore.
    // `loadstart` marks a resource boundary on a reused element; ordinary MSE
    // representation switches need not emit it.
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeking', this.handleSeekEvidence);
    this.video.addEventListener('seeked', this.handleSeek);
    this.video.addEventListener('loadstart', this.handleMediaInit);

    window.VSC.logger.debug('Added media event handlers: play, seeking, seeked, loadstart');
  }

  /**
   * Set up mutation observer for src attribute changes
   * @private
   */
  setupMutationObserver() {
    this.targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')
        ) {
          window.VSC.logger.debug('Mutation of A/V element detected');
          const controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add('vsc-nosource');
          } else {
            controller.classList.remove('vsc-nosource');
          }
        }
      });
    });

    this.targetObserver.observe(this.video, {
      attributeFilter: ['src', 'currentSrc'],
    });
  }

  /**
   * Remove controller and clean up
   */
  remove() {
    window.VSC.logger.debug('Removing VideoController');

    // A detached controller must not be retained or mutated by a pending
    // visibility flash callback after its media/controller lifecycle ends.
    if (this.div && this.div.flashTimer !== undefined) {
      clearTimeout(this.div.flashTimer);
      this.div.flashTimer = undefined;
    }

    // UXP: tear down viewport tracking if the transformed-ancestor escape
    // activated it.
    if (this._viewportUpdate) {
      window.removeEventListener('scroll', this._viewportUpdate, true);
      window.removeEventListener('resize', this._viewportUpdate);
      this._viewportUpdate = null;
    }
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (e) { /* ignored */ }
      this._resizeObserver = null;
    }
    if (this._viewportPoll) {
      clearInterval(this._viewportPoll);
      this._viewportPoll = null;
    }
    if (this._fsChange) {
      document.removeEventListener('fullscreenchange', this._fsChange, true);
      document.removeEventListener('mozfullscreenchange', this._fsChange, true);
      this._fsChange = null;
    }

    // Remove DOM element
    if (this.div && this.div.parentNode) {
      this.div.remove();
    }

    // Remove event listeners
    if (this.handlePlay) {
      this.video.removeEventListener('play', this.handlePlay);
      this.handlePlay = null;
    }
    if (this.handleSeek) {
      this.video.removeEventListener('seeked', this.handleSeek);
      this.handleSeek = null;
    }
    if (this.handleSeekEvidence) {
      this.video.removeEventListener('seeking', this.handleSeekEvidence);
      this.handleSeekEvidence = null;
    }
    if (this.handleMediaInit) {
      this.video.removeEventListener('loadstart', this.handleMediaInit);
      this.handleMediaInit = null;
    }
    if (this.handleLoadedMetadata) {
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.handleLoadedMetadata = null;
    }

    // Disconnect mutation observer
    if (this.targetObserver) {
      this.targetObserver.disconnect();
    }

    // Remove from state manager
    if (window.VSC.stateManager) {
      window.VSC.stateManager.removeController(this.controllerId);
    }

    // Release per-media conflict/timer/echo state before detaching the
    // controller reference that EventManager uses to identify controlled media.
    const arbitration =
      this.actionHandler &&
      this.actionHandler.eventManager &&
      this.actionHandler.eventManager.arbitration;
    if (arbitration) {
      arbitration.release(this.video);
    }

    // Remove reference from video element
    delete this.video.vsc;

    window.VSC.logger.debug('VideoController removed successfully');

    // UXP: lifecycle event for the chrome overlay's toolbar badge.
    this.dispatchControllerEvent('VSC_CONTROLLER_REMOVED', {
      controllerId: this.controllerId,
      videoSrc: this.video.currentSrc || this.video.src,
      tagName: this.video.tagName,
    });
  }

  /**
   * Generate unique controller ID for badge tracking
   * @param {HTMLElement} target - Video/audio element
   * @returns {string} Unique controller ID
   * @private
   */
  generateControllerId(target) {
    const timestamp = Date.now();
    const src = target.currentSrc || target.src || 'no-src';
    const tagName = target.tagName.toLowerCase();

    // Create a simple hash from src for uniqueness
    const srcHash = src.split('').reduce((hash, char) => {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      return hash & hash; // Convert to 32-bit integer
    }, 0);

    const random = Math.floor(Math.random() * 1000);
    return `${tagName}-${Math.abs(srcHash)}-${timestamp}-${random}`;
  }

  /**
   * Check if the video element is currently visible
   * @returns {boolean} True if video is visible
   */
  isVideoVisible() {
    // Check if video is still connected to DOM
    if (!this.video.isConnected) {
      return false;
    }

    // Check computed style for visibility
    const style = window.getComputedStyle(this.video);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Check if video has reasonable dimensions
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update controller visibility based on video visibility
   * Called when video visibility changes
   */
  updateVisibility() {
    const isVisible = this.isVideoVisible();
    const isCurrentlyHidden = this.div.classList.contains('vsc-hidden');

    // Special handling for audio elements - don't hide controllers for functional audio
    if (this.video.tagName === 'AUDIO') {
      // Preserve startHidden; otherwise audio support controls automatic visibility.
      if (!this.config.settings.audioBoolean && !isCurrentlyHidden) {
        this.div.classList.add('vsc-hidden');
        window.VSC.logger.debug('Hiding audio controller - audio support disabled');
      } else if (
        this.config.settings.audioBoolean &&
        isCurrentlyHidden &&
        !this.config.settings.startHidden
      ) {
        // Keep the automatic layer current beneath any explicit override.
        this.div.classList.remove('vsc-hidden');
        window.VSC.logger.debug('Showing audio controller - audio support enabled');
      }
      return;
    }

    // Original logic for video elements
    if (isVisible && isCurrentlyHidden && !this.config.settings.startHidden) {
      // Keep automatic visibility current beneath any explicit override.
      this.div.classList.remove('vsc-hidden');
      window.VSC.logger.debug('Showing controller - video became visible');
    } else if (!isVisible && !isCurrentlyHidden) {
      // Video became invisible and controller is visible
      this.div.classList.add('vsc-hidden');
      window.VSC.logger.debug('Hiding controller - video became invisible');
    }
  }

  /**
   * UXP: dispatch controller lifecycle events for the toolbar badge.
   * @param {string} eventType - VSC_CONTROLLER_CREATED or VSC_CONTROLLER_REMOVED
   * @param {Object} detail - Event detail data
   * @private
   */
  dispatchControllerEvent(eventType, detail) {
    try {
      const event = new CustomEvent(eventType, { detail, bubbles: true });
      // Dispatch on documentElement so the chrome overlay (single-process Pale Moon)
      // can catch it via gBrowser.addEventListener with wantsUntrusted=true.
      document.documentElement.dispatchEvent(event);
      window.VSC.logger.debug(
        `Dispatched ${eventType} event for controller ${detail.controllerId}`
      );
    } catch (error) {
      window.VSC.logger.error(`Failed to dispatch ${eventType} event:`, error);
    }
  }
}

// Create singleton instance
window.VSC.VideoController = VideoController;

// Global variables available for both browser and testing

})();
