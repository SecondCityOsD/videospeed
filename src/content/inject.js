/**
 * Video Speed Controller — Main Content Script
 */

// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

class VideoSpeedExtension {
  constructor() {
    this.config = null;
    this.actionHandler = null;
    this.eventManager = null;
    this.mutationObserver = null;
    this.mediaObserver = null;
    // Deferred loadeddata listeners need explicit teardown. A listener held by
    // a still-connected unready media element can otherwise revive a
    // controller after extension teardown has released its dependencies.
    this.deferredMediaListeners = new Map();
    this.acceptingMedia = true;
    this.initialized = false;
  }

  /**
   * Initialize the extension
   */
  async initialize() {
    try {
      // UXP: every module is its own <script> tag, so one can fail to load
      // (CSP, 404, parse error) while the rest run. Bail out cleanly instead
      // of crashing deep inside a constructor.
      const required = [
        'VideoController', 'ActionHandler', 'EventManager', 'logger',
        'DomUtils', 'siteHandlerManager', 'VideoMutationObserver',
        'MediaElementObserver', 'Constants', 'videoSpeedConfig',
        'stateManager', 'DEFAULT_CONTROLLER_CSS', 'ShadowDOMManager',
        'ControlsManager', 'DragHandler', 'SpeedArbiter', 'IntentClassifier',
        'SpeedArbitration', 'ControllerVisibility',
      ];
      const missing = required.filter((name) => !window.VSC[name]);
      if (missing.length) {
        console.error('[VSC] Missing required modules — bailing out: ' + missing.join(', '));
        return;
      }

      // Access global modules
      this.VideoController = window.VSC.VideoController;
      this.ActionHandler = window.VSC.ActionHandler;
      this.EventManager = window.VSC.EventManager;
      this.logger = window.VSC.logger;
      this.initializeWhenReady = window.VSC.DomUtils.initializeWhenReady;
      this.siteHandlerManager = window.VSC.siteHandlerManager;
      this.VideoMutationObserver = window.VSC.VideoMutationObserver;
      this.MediaElementObserver = window.VSC.MediaElementObserver;
      this.MESSAGE_TYPES = window.VSC.Constants.MESSAGE_TYPES;

      this.logger.info('Video Speed Controller starting...');

      this.config = window.VSC.videoSpeedConfig;
      await this.config.load();

      if (this.config.settings._abort) {
        this.logger.debug('Extension disabled on this site — aborting init');
        return;
      }

      // Defer DOM work so page frameworks finish init before we mutate.
      this.deferDOMWork(document);
    } catch (error) {
      // UXP: also report to the console — the logger buffers until settings
      // load, so an early failure would otherwise never be printed (and
      // this.logger is unset if the failure came before it was assigned).
      console.error('[VSC] Init failed: ' + error.message, error.stack);
      if (this.logger) {
        this.logger.error(`Failed to initialize Video Speed Controller: ${error.message}`);
        this.logger.error(`Error stack: ${error.stack}`);
      }
    }
  }

  /**
   * Initialize for a specific document
   * @param {Document} document - Document to initialize
   */
  initializeDocument(document) {
    try {
      if (window.VSC.initialized) {
        return;
      }

      window.VSC.initialized = true;
      this.eventManager.setupEventListeners(document);

      this.deferExpensiveOperations(document);
      this.logger.debug('Document initialization completed');
    } catch (error) {
      this.logger.error(`Failed to initialize document: ${error.message}`);
    }
  }

  /**
   * Defer expensive operations to avoid blocking page load
   * @param {Document} document - Document to defer operations for
   */
  deferExpensiveOperations(document) {
    const callback = () => {
      try {
        if (!this.acceptingMedia) {
          return;
        }

        // Start mutation observer — catches dynamically added media elements
        if (this.mutationObserver) {
          this.mutationObserver.start(document);
          this.logger.debug('Mutation observer started for document');
        }

        // Defer media scanning to avoid blocking page load
        this.deferredMediaScan(document);
      } catch (error) {
        this.logger.error(`Failed to complete deferred operations: ${error.message}`);
      }
    };

    if (window.requestIdleCallback) {
      requestIdleCallback(callback);
    } else {
      setTimeout(callback, 100);
    }
  }

  /**
   * Perform media scanning in a non-blocking way
   * @param {Document} document - Document to scan
   */
  deferredMediaScan(document) {
    // Split media scanning into smaller chunks to avoid blocking
    const performChunkedScan = () => {
      try {
        if (!this.acceptingMedia) {
          return;
        }

        // Use a lighter initial scan - avoid expensive shadow DOM traversal initially
        const lightMedia = this.mediaObserver.scanForMediaLight(document);

        lightMedia.forEach((media) => {
          this.onVideoFound(media, media.parentElement || media.parentNode);
        });

        this.logger.info(
          `Attached controllers to ${lightMedia.length} media elements (light scan)`
        );

        // Schedule comprehensive scan for later if needed
        if (lightMedia.length === 0) {
          this.scheduleComprehensiveScan(document);
        }
      } catch (error) {
        this.logger.error(`Failed to scan media elements: ${error.message}`);
      }
    };

    if (window.requestIdleCallback) {
      requestIdleCallback(performChunkedScan);
    } else {
      setTimeout(performChunkedScan, 200);
    }
  }

  /**
   * Schedule a comprehensive scan if the light scan didn't find anything
   * @param {Document} document - Document to scan comprehensively
   */
  scheduleComprehensiveScan(document) {
    // Only do comprehensive scan if we didn't find any media with light scan
    setTimeout(() => {
      try {
        if (!this.acceptingMedia) {
          return;
        }

        const comprehensiveMedia = this.mediaObserver.scanAll(document);

        comprehensiveMedia.forEach((media) => {
          // Skip if already has controller
          if (!media.vsc) {
            this.onVideoFound(media, media.parentElement || media.parentNode);
          }
        });

        this.logger.info(
          `Comprehensive scan found ${comprehensiveMedia.length} additional media elements`
        );
      } catch (error) {
        this.logger.error(`Failed comprehensive media scan: ${error.message}`);
      }
    }, 1000); // Wait 1 second before comprehensive scan
  }

  /**
   * Defer DOM work via requestIdleCallback to yield to site frameworks
   * before injecting CSS, controllers, and observers.
   */
  deferDOMWork(document) {
    const doWork = () => {
      // Disable can arrive after settings load but before this idle callback.
      // Never let queued startup work resurrect a torn-down extension.
      if (!this.acceptingMedia) {
        return;
      }

      this.injectControllerCSS();
      this.setupCSSLiveUpdates();
      this.siteHandlerManager.initialize(document);

      this.eventManager = new this.EventManager(this.config, null);
      this.actionHandler = new this.ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler;

      this.setupObservers();

      this.initializeWhenReady(document, (doc) => {
        if (this.acceptingMedia) {
          this.initializeDocument(doc);
        }
      });

      this.logger.info('Video Speed Controller initialized successfully');
      this.initialized = true;
    };

    if (window.requestIdleCallback) {
      requestIdleCallback(doWork);
    } else {
      setTimeout(doWork, 0);
    }
  }

  /**
   * Resolve domain-based CSS selectors for a hostname.
   * Matching domains: selector stripped (rule applies unconditionally).
   * Non-matching: entire rule removed. Stripping (vs neutering with a dead
   * selector) ensures perf-sensitive selectors like [style*=...] inside
   * non-matching rules never reach the browser's style invalidation engine.
   * @param {string} css - CSS containing domain marker selectors
   * @param {string} [hostname] - Hostname to resolve; defaults to the document host
   * @returns {string} CSS containing only matching and unscoped rules
   */
  preprocessDomainCSS(css, hostname = location.hostname) {
    const normalizedHostname = hostname.replace(/^www\./, '');

    // Contract: the marker appears ONCE, on the FIRST selector, and scopes
    // the ENTIRE rule (all following selectors stay bare). Do not repeat the
    // marker on later selectors — it would survive preprocessing as a
    // dead selector and re-introduce the [style*=...] invalidation hazard
    // the wrapping exists to remove (#1501).
    return css.replace(
      /:root\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g,
      (match, domain, selector, body) =>
        domain === normalizedHostname ? `${selector.trim()} {${body}}` : ''
    );
  }

  /**
   * UXP: Pale Moon has no Constructable Stylesheets (new CSSStyleSheet /
   * document.adoptedStyleSheets), so controller CSS goes in <style> elements.
   * Same two-sheet split as upstream: _controllerSheet (built-in defaults,
   * domain-preprocessed, never changes at runtime) and _customSheet (user
   * additions, injected raw, live-updatable).
   * @param {string} css
   * @param {string} [id]
   * @returns {HTMLStyleElement}
   * @private
   */
  _appendStyle(css, id) {
    const styleEl = document.createElement('style');
    if (id) {
      styleEl.id = id;
    }
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  }

  injectControllerCSS() {
    try {
      if (this._controllerSheet) {
        return;
      }
      this._controllerSheet = this._appendStyle(
        this.preprocessDomainCSS(window.VSC.Constants.DEFAULT_CONTROLLER_CSS),
        'vsc-controller-defaults'
      );

      const customCSS = this.config.settings.customCSS || '';
      if (customCSS) {
        this._customSheet = this._appendStyle(customCSS, 'vsc-controller-custom');
      }
    } catch (error) {
      this.logger.error(`Failed to inject controller CSS: ${error.message}`);
    }
  }

  /** Live-update the user's custom CSS when options are saved. */
  setupCSSLiveUpdates() {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      const cssChange = e.detail && e.detail.customCSS;
      if (!cssChange || cssChange.newValue === undefined || !this._controllerSheet) {
        return;
      }
      const customCSS = cssChange.newValue || '';
      if (customCSS) {
        if (!this._customSheet) {
          this._customSheet = this._appendStyle(customCSS, 'vsc-controller-custom');
        } else {
          this._customSheet.textContent = customCSS;
        }
      } else if (this._customSheet) {
        this._customSheet.remove();
        this._customSheet = null;
      }
    });
  }

  /**
   * Set up observers for DOM changes and video detection
   */
  setupObservers() {
    // Media element observer
    this.mediaObserver = new this.MediaElementObserver(this.config, this.siteHandlerManager);

    // Mutation observer for dynamic content
    this.mutationObserver = new this.VideoMutationObserver(
      this.config,
      (video, parent) => this.onVideoFound(video, parent),
      (video) => this.onVideoRemoved(video),
      this.mediaObserver
    );
  }

  /**
   * Handle newly found video element
   * @param {HTMLMediaElement} video - Video element
   * @param {HTMLElement} parent - Parent element
   */
  onVideoFound(video, parent) {
    try {
      if (!this.acceptingMedia) {
        this.logger.debug('Skipping media attachment after extension teardown');
        return;
      }

      if (this.mediaObserver && !this.mediaObserver.isValidMediaElement(video)) {
        this.logger.debug('Video element is not valid for controller attachment');
        return;
      }

      if (video.vsc) {
        this.logger.debug('Video already has controller attached');
        return;
      }

      // Defer until readyState >= HAVE_CURRENT_DATA — inserting a controller
      // too early can trigger the site's internal MutationObservers.
      if (video.readyState < 2) {
        if (this.deferredMediaListeners.has(video)) {
          return;
        }
        this.logger.debug(
          'Deferring controller until loadeddata (readyState=%d)',
          video.readyState
        );
        const listener = () => {
          this.deferredMediaListeners.delete(video);
          this.onVideoFound(video, parent);
        };
        this.deferredMediaListeners.set(video, listener);
        video.addEventListener('loadeddata', listener, { once: true });
        return;
      }

      this.clearDeferredMediaListener(video);

      // Check if controller should start hidden based on video visibility/size
      const shouldStartHidden = this.mediaObserver
        ? this.mediaObserver.shouldStartHidden(video)
        : false;

      this.logger.debug(
        'Attaching controller to new video element',
        shouldStartHidden ? '(starting hidden)' : ''
      );
      video.vsc = new this.VideoController(
        video,
        parent,
        this.config,
        this.actionHandler,
        shouldStartHidden
      );
    } catch (error) {
      this.logger.error(`Failed to attach controller to video: ${error.message}`);
    }
  }

  /**
   * Remove one pending loadeddata listener without retaining its media key.
   * @param {HTMLMediaElement} video
   * @private
   */
  clearDeferredMediaListener(video) {
    const listener = this.deferredMediaListeners.get(video);
    if (!listener) {
      return;
    }
    video.removeEventListener('loadeddata', listener);
    this.deferredMediaListeners.delete(video);
  }

  /** Remove all pending media listeners during teardown. @private */
  clearDeferredMediaListeners() {
    for (const [video, listener] of this.deferredMediaListeners) {
      video.removeEventListener('loadeddata', listener);
    }
    this.deferredMediaListeners.clear();
  }

  /**
   * Tear down the extension: remove all controllers, stop observers, clean up listeners.
   * Counterpart to initialize() — leaves the page as if VSC was never active.
   */
  teardown() {
    // Invalidate queued startup/media callbacks even when initialization has
    // not yet reached the point where there are resources to clean up.
    this.acceptingMedia = false;
    this.clearDeferredMediaListeners();

    if (!this.initialized) {
      return;
    }

    this.logger.info('Tearing down Video Speed Controller');

    // Remove all controllers from tracked media elements
    const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];
    for (const video of videos) {
      if (video.vsc) {
        video.vsc.remove();
      }
    }

    // Stop observing DOM for new videos
    if (this.mutationObserver) {
      this.mutationObserver.stop();
      this.mutationObserver = null;
    }

    // Remove keyboard/ratechange listeners
    if (this.eventManager) {
      this.eventManager.cleanup();
      this.eventManager = null;
    }

    // Clean up site-specific handlers
    if (this.siteHandlerManager) {
      this.siteHandlerManager.cleanup();
    }

    // Remove controller CSS (both default and custom sheets). UXP: these are
    // <style> elements, not adopted stylesheets.
    if (this._controllerSheet) {
      this._controllerSheet.remove();
    }
    if (this._customSheet) {
      this._customSheet.remove();
    }
    this._controllerSheet = null;
    this._customSheet = null;

    this.actionHandler = null;
    this.mediaObserver = null;
    this.initialized = false;
    window.VSC.initialized = false;
  }

  /**
   * Handle removed video element
   * @param {HTMLMediaElement} video - Video element
   */
  onVideoRemoved(video) {
    try {
      this.clearDeferredMediaListener(video);
      if (video.vsc) {
        this.logger.debug('Removing controller from video element');
        video.vsc.remove();
      }
    } catch (error) {
      this.logger.error(`Failed to remove video controller: ${error.message}`);
    }
  }
}

(function () {
  // UXP: single-flight guard hoisted to the top. Upstream registers its
  // VSC_MESSAGE listener first, then skips only an already-initialized
  // instance; a second injection into the same document must neither
  // double-register listeners nor run initialize() twice in parallel.
  if (window.VSC_controller) {
    return;
  }

  const extension = new VideoSpeedExtension();
  window.VSC_controller = extension;

  // UXP: SPA-navigation safety net.
  //
  // YouTube, Twitter, Vimeo, etc. swap videos via history.pushState — no
  // DOMContentLoaded refires, and the mutation observer doesn't always catch
  // the new <video> (racing rebuilds, lazy media loaders, aggressive
  // userscript reskins like VORAPIS V3).
  //
  // We share the page's JS world, so instead of polling location.href on a
  // permanent 1 s interval (which ran on EVERY page forever, even pages with
  // no media), hook the History API plus popstate/hashchange. On any URL
  // change we wait 500 ms for the SPA to settle, then rescan and attach
  // controllers to any video that doesn't already have one.
  let __vscLastUrl = location.href;
  const __vscRescan = () => {
    if (location.href === __vscLastUrl) {
      return;
    }
    __vscLastUrl = location.href;
    if (window.VSC && window.VSC.logger) {
      window.VSC.logger.debug('SPA navigation detected — re-scanning for media');
    }
    setTimeout(() => {
      try {
        if (!extension.mediaObserver) return;
        const media = extension.mediaObserver.scanForMedia(document);
        media.forEach((m) => {
          if (!m.vsc) {
            extension.onVideoFound(m, m.parentElement || m.parentNode);
          }
        });
      } catch (e) {
        if (window.VSC && window.VSC.logger) {
          window.VSC.logger.error('SPA-nav rescan failed: ' + e.message);
        }
      }
    }, 500);
  };

  // Wrap pushState/replaceState so programmatic navigations notify us. The
  // __vscWrapped guard prevents double-wrapping if another script (or a second
  // injection) also wraps them.
  const __vscWrapHistory = (method) => {
    try {
      const orig = history[method];
      if (typeof orig !== 'function' || orig.__vscWrapped) {
        return;
      }
      const wrapped = function () {
        const ret = orig.apply(this, arguments);
        try {
          __vscRescan();
        } catch (e) {
          /* ignored */
        }
        return ret;
      };
      wrapped.__vscWrapped = true;
      history[method] = wrapped;
    } catch (e) {
      // history not writable on this page — popstate/hashchange still cover
      // back/forward and hash navigations.
    }
  };
  __vscWrapHistory('pushState');
  __vscWrapHistory('replaceState');
  window.addEventListener('popstate', __vscRescan);
  window.addEventListener('hashchange', __vscRescan);

  // Lifecycle commands from bridge (popup, background, storage changes)
  document.documentElement.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    // Handle namespaced VSC message types
    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      // Use state manager for complete media element discovery (includes shadow DOM)
      const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
            const targetSpeed = Math.min(Math.max(message.payload.speed, MIN), MAX);
            const authorityBatch = extension.actionHandler.createAuthorityBatch();
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed, { authorityBatch });
              } else {
                // Uncontrolled video (no vsc controller): outside the
                // arbitration domain, direct write is the only channel.
                // eslint-disable-next-line no-restricted-syntax
                video.playbackRate = targetSpeed;
              }
            });

            // Log the successful operation
            if (window.VSC.logger) {
              window.VSC.logger.debug(
                `Set speed to ${targetSpeed} on ${videos.length} media elements`
              );
            }
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.ADJUST_SPEED:
          if (message.payload && typeof message.payload.delta === 'number') {
            const delta = message.payload.delta;
            const authorityBatch = extension.actionHandler.createAuthorityBatch();
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, delta, {
                  relative: true,
                  authorityBatch,
                });
              } else {
                // Fallback for videos without controller
                const { MIN: sMin, MAX: sMax } = window.VSC.Constants.SPEED_LIMITS;
                const newSpeed = Math.min(Math.max(video.playbackRate + delta, sMin), sMax);
                // eslint-disable-next-line no-restricted-syntax -- uncontrolled video, outside arbitration domain
                video.playbackRate = newSpeed;
              }
            });

            if (window.VSC.logger) {
              window.VSC.logger.debug(
                `Adjusted speed by ${delta} on ${videos.length} media elements`
              );
            }
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.RESET_SPEED: {
          const authorityBatch = extension.actionHandler.createAuthorityBatch();
          videos.forEach((video) => {
            if (video.vsc) {
              extension.actionHandler.resetSpeed(video, 1.0, undefined, { authorityBatch });
            } else {
              // eslint-disable-next-line no-restricted-syntax -- uncontrolled video, outside arbitration domain
              video.playbackRate = 1.0;
            }
          });

          if (window.VSC.logger) {
            window.VSC.logger.debug(`Reset speed on ${videos.length} media elements`);
          }
          break;
        }

        case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
          if (extension.actionHandler) {
            extension.actionHandler.runAction('display', null, null);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TEARDOWN:
          extension.teardown();
          break;
      }
    }
  });

  // Auto-initialize (the double-injection guard and the VSC_controller export
  // moved to the top of this function — see above).
  extension.initialize().catch((error) => {
    // UXP: console too — see initialize().
    console.error('[VSC] Extension initialization failed:', error.message);
    window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
  });
})();

})();
