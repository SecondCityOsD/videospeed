/**
 * Video Speed Controller — Main Content Script
 * UXP port with upstream 0.10.2 features
 */

class VideoSpeedExtension {
  constructor() {
    this.config = null;
    this.actionHandler = null;
    this.eventManager = null;
    this.mutationObserver = null;
    this.mediaObserver = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Required modules must all be present before we proceed — if any one
      // script tag failed to load (CSP, 404, parse error) we'd otherwise crash
      // deep inside a constructor.
      const required = [
        'VideoController', 'ActionHandler', 'EventManager', 'logger',
        'DomUtils', 'siteHandlerManager', 'VideoMutationObserver',
        'MediaElementObserver', 'Constants', 'videoSpeedConfig',
        'stateManager', 'DEFAULT_CONTROLLER_CSS', 'ShadowDOMManager'
      ];
      const missing = required.filter((name) => !window.VSC[name]);
      if (missing.length) {
        console.error('[VSC] Missing required modules — bailing out: ' + missing.join(', '));
        return;
      }

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

      this.deferDOMWork(document);
    } catch (error) {
      console.error('[VSC] Init failed: ' + error.message, error.stack);
      if (this.logger) {
        this.logger.error(`Failed to initialize Video Speed Controller: ${error.message}`);
        this.logger.error(`Error stack: ${error.stack}`);
      }
    }
  }

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

  deferExpensiveOperations(document) {
    const callback = () => {
      try {
        if (this.mutationObserver) {
          this.mutationObserver.start(document);
          this.logger.debug('Mutation observer started for document');
        }

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

  deferredMediaScan(document) {
    const performChunkedScan = () => {
      try {
        const lightMedia = this.mediaObserver.scanForMediaLight(document);

        lightMedia.forEach((media) => {
          this.onVideoFound(media, media.parentElement || media.parentNode);
        });

        this.logger.info(
          `Attached controllers to ${lightMedia.length} media elements (light scan)`
        );

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

  scheduleComprehensiveScan(document) {
    setTimeout(() => {
      try {
        const comprehensiveMedia = this.mediaObserver.scanAll(document);

        comprehensiveMedia.forEach((media) => {
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
    }, 1000);
  }

  deferDOMWork(document) {
    const doWork = () => {
      this.injectControllerCSS();
      this.setupCSSLiveUpdates();
      this.siteHandlerManager.initialize(document);

      this.eventManager = new this.EventManager(this.config, null);
      this.actionHandler = new this.ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler;

      this.setupObservers();

      this.initializeWhenReady(document, (doc) => {
        this.initializeDocument(doc);
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

  preprocessDomainCSS(css) {
    const hostname = location.hostname.replace(/^www\./, '');
    return css.replace(
      /:root\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g,
      (match, domain, selector, body) => (domain === hostname ? `${selector.trim()} {${body}}` : '')
    );
  }

  // Pale Moon / UXP doesn't implement Constructable Stylesheets
  // (new CSSStyleSheet + document.adoptedStyleSheets). Use a <style> tag
  // instead — same result, supported everywhere.
  _appendStyle(css, id) {
    const styleEl = document.createElement('style');
    if (id) styleEl.id = id;
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
        this.preprocessDomainCSS(window.VSC.DEFAULT_CONTROLLER_CSS),
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

  setupCSSLiveUpdates() {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      if (e.detail?.customCSS?.newValue === undefined || !this._controllerSheet) {
        return;
      }
      const customCSS = e.detail.customCSS.newValue || '';
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

  setupObservers() {
    this.mediaObserver = new this.MediaElementObserver(this.config, this.siteHandlerManager);

    this.mutationObserver = new this.VideoMutationObserver(
      this.config,
      (video, parent) => this.onVideoFound(video, parent),
      (video) => this.onVideoRemoved(video),
      this.mediaObserver,
      () => {
        // document.write replacement — fully tear down and start over.
        this.teardown();
        this.initialize();
      }
    );
  }

  onVideoFound(video, parent) {
    try {
      if (this.mediaObserver && !this.mediaObserver.isValidMediaElement(video)) {
        this.logger.debug('Video element is not valid for controller attachment');
        return;
      }

      if (video.vsc) {
        this.logger.debug('Video already has controller attached');
        return;
      }

      if (video.readyState < 2) {
        this.logger.debug(
          'Deferring controller until loadeddata (readyState=%d)',
          video.readyState
        );
        video.addEventListener('loadeddata', () => this.onVideoFound(video, parent), {
          once: true,
        });
        return;
      }

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

      if (window.VSC.stateManager && video.vsc) {
        window.VSC.stateManager.registerController(video.vsc);
      }
    } catch (error) {
      this.logger.error(`Failed to attach controller to video: ${error.message}`);
    }
  }

  teardown() {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Tearing down Video Speed Controller');

    const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];
    for (const video of videos) {
      if (video.vsc) {
        video.vsc.remove();
      }
    }

    if (this.mutationObserver) {
      this.mutationObserver.stop();
      this.mutationObserver = null;
    }

    if (this.eventManager) {
      this.eventManager.cleanup();
      this.eventManager = null;
    }

    if (this.siteHandlerManager) {
      this.siteHandlerManager.cleanup();
    }

    if (this._controllerSheet) {
      this._controllerSheet.remove();
      this._controllerSheet = null;
    }
    if (this._customSheet) {
      this._customSheet.remove();
      this._customSheet = null;
    }

    this.actionHandler = null;
    this.mediaObserver = null;
    this.initialized = false;
    window.VSC.initialized = false;
  }

  onVideoRemoved(video) {
    try {
      if (video.vsc) {
        this.logger.debug('Removing controller from video element');
        if (window.VSC.stateManager && video.vsc.controllerId) {
          window.VSC.stateManager.unregisterController(video.vsc.controllerId);
        }
        video.vsc.remove();
      }
    } catch (error) {
      this.logger.error(`Failed to remove video controller: ${error.message}`);
    }
  }
}

(function () {
  // Single-flight guard: hoisted to the top so a second injection on the same
  // document (SPA push-state, document.write) doesn't double-register
  // VSC_MESSAGE listeners or run initialize() twice in parallel.
  if (window.VSC_controller) {
    return;
  }

  const extension = new VideoSpeedExtension();
  window.VSC_controller = extension;

  document.documentElement.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
            const targetSpeed = Math.min(Math.max(message.payload.speed, MIN), MAX);
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed);
              } else {
                video.playbackRate = targetSpeed;
              }
            });

            window.VSC.logger?.debug(
              `Set speed to ${targetSpeed} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.ADJUST_SPEED:
          if (message.payload && typeof message.payload.delta === 'number') {
            const delta = message.payload.delta;
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, delta, { relative: true });
              } else {
                const { MIN: sMin, MAX: sMax } = window.VSC.Constants.SPEED_LIMITS;
                const newSpeed = Math.min(Math.max(video.playbackRate + delta, sMin), sMax);
                video.playbackRate = newSpeed;
              }
            });

            window.VSC.logger?.debug(
              `Adjusted speed by ${delta} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.RESET_SPEED:
          videos.forEach((video) => {
            if (video.vsc) {
              extension.actionHandler.resetSpeed(video, 1.0);
            } else {
              video.playbackRate = 1.0;
            }
          });

          window.VSC.logger?.debug(`Reset speed on ${videos.length} media elements`);
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
          if (extension.actionHandler) {
            extension.actionHandler.runAction('display', null, null);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TEARDOWN:
          extension.teardown();
          break;

        case window.VSC.Constants.MESSAGE_TYPES.REINIT:
          extension.initialize();
          break;
      }
    }
  });

  // Single-flight guard was hoisted to the top of this IIFE; just kick off init.
  extension.initialize().catch((error) => {
    console.error('[VSC] Extension initialization failed:', error.message);
    if (window.VSC.logger) {
      window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
    }
  });
})();