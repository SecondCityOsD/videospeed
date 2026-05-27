/**
 * Site handler factory and manager
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class SiteHandlerManager {
  constructor() {
    this.currentHandler = null;
    // Lazy-initialized: this file is loaded before the individual handler
    // scripts, so reading window.VSC.*Handler in the constructor yields
    // undefined. Build the list on first use, after all scripts are in scope.
    this._availableHandlers = null;
  }

  _getAvailableHandlers() {
    if (this._availableHandlers === null) {
      this._availableHandlers = [
        window.VSC.NetflixHandler,
        window.VSC.YouTubeHandler,
        window.VSC.FacebookHandler,
        window.VSC.AmazonHandler,
        window.VSC.AppleHandler,
        window.VSC.DailymotionHandler,
      ].filter((h) => typeof h === 'function');
    }
    return this._availableHandlers;
  }

  /**
   * Get the appropriate handler for the current site
   * @returns {BaseSiteHandler} Site handler instance
   */
  getCurrentHandler() {
    if (!this.currentHandler) {
      this.currentHandler = this.detectHandler();
    }
    return this.currentHandler;
  }

  /**
   * Detect which handler to use for the current site
   * @returns {BaseSiteHandler} Site handler instance
   * @private
   */
  detectHandler() {
    for (const HandlerClass of this._getAvailableHandlers()) {
      if (HandlerClass.matches()) {
        window.VSC.logger.info(`Using ${HandlerClass.name} for ${location.hostname}`);
        return new HandlerClass();
      }
    }

    window.VSC.logger.debug(`Using BaseSiteHandler for ${location.hostname}`);
    return new window.VSC.BaseSiteHandler();
  }

  /**
   * Initialize the current site handler
   * @param {Document} document - Document object
   */
  initialize(document) {
    const handler = this.getCurrentHandler();
    handler.initialize(document);
  }

  /**
   * Get controller positioning for current site
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, video) {
    const handler = this.getCurrentHandler();
    return handler.getControllerPosition(parent, video);
  }

  /**
   * Handle seeking for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    const handler = this.getCurrentHandler();
    return handler.handleSeek(video, seekSeconds);
  }

  /**
   * Apply a speed change via the current site handler.
   * @param {HTMLMediaElement} video
   * @param {number} speed
   * @returns {boolean}
   */
  handleSpeedChange(video, speed) {
    const handler = this.getCurrentHandler();
    return handler.handleSpeedChange(video, speed);
  }

  /**
   * Check if a video should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    // Muted, looping, no-controls <video> is almost always a GIF replacement
    // (Telegram stickers, Imgur GIFs, hero-image looping clips). Attaching
    // a controller pollutes feeds with no benefit. Upstream 0.10.2 check.
    if (
      video &&
      video.tagName === 'VIDEO' &&
      video.loop &&
      video.muted &&
      !video.controls
    ) {
      return true;
    }

    const handler = this.getCurrentHandler();
    return handler.shouldIgnoreVideo(video);
  }

  /**
   * Get video container selectors for current site
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    const handler = this.getCurrentHandler();
    return handler.getVideoContainerSelectors();
  }

  /**
   * Detect special videos for current site
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    const handler = this.getCurrentHandler();
    return handler.detectSpecialVideos(document);
  }

  /**
   * Cleanup current handler
   */
  cleanup() {
    if (this.currentHandler) {
      this.currentHandler.cleanup();
      this.currentHandler = null;
    }
  }

  /**
   * Force refresh of current handler (useful for SPA navigation)
   */
  refresh() {
    this.cleanup();
    this.currentHandler = null;
  }
}

// Create singleton instance
window.VSC.siteHandlerManager = new SiteHandlerManager();
