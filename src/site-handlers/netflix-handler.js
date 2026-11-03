/**
 * Netflix-specific handler
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class NetflixHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to Netflix
   * @returns {boolean} True if on Netflix
   */
  static matches() {
    return location.hostname === 'www.netflix.com';
  }

  /**
   * Get Netflix-specific controller positioning
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    // Insert before parent to bypass Netflix's overlay
    return {
      insertionPoint: parent.parentElement,
      insertionMethod: 'beforeParent',
      targetParent: parent.parentElement,
    };
  }

  /**
   * Handle Netflix-specific seeking using their API
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    // The fork's scripts run in the PAGE world, so we can call Netflix's
    // internal player API directly. Upstream MV3 needs a postMessage bridge to
    // an injected page script (scripts/netflix.js) only because its content
    // script is isolated; here there is no isolation, so that bridge — which
    // in this fork was never injected, silently breaking Netflix seeking — is
    // unnecessary. Fall back to currentTime if the API isn't reachable.
    try {
      var netflix = window.netflix;
      var api =
        netflix &&
        netflix.appContext &&
        netflix.appContext.state.playerApp.getAPI().videoPlayer;
      if (api) {
        var sessionId = api.getAllPlayerSessionIds()[0];
        var currentMs = api.getCurrentTimeBySessionId(sessionId);
        api.getVideoPlayerBySessionId(sessionId).seek(currentMs + seekSeconds * 1000);
        window.VSC.logger.debug(`Netflix seek via player API: ${seekSeconds}s`);
        return true;
      }
    } catch (error) {
      window.VSC.logger.warn(`Netflix player-API seek failed, falling back: ${error.message}`);
    }

    try {
      video.currentTime += seekSeconds;
      return true;
    } catch (e) {
      window.VSC.logger.error(`Netflix fallback seek failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Initialize Netflix-specific functionality
   * @param {Document} document - Document object
   */
  initialize(document) {
    super.initialize(document);

    // No script injection needed: handleSeek calls Netflix's player API
    // directly from the shared page world.
    window.VSC.logger.debug('Netflix handler initialized');
  }

  /**
   * Check if video should be ignored on Netflix
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    // Ignore preview videos or thumbnails
    return (
      video.classList.contains('preview-video') ||
      (video.parentElement &&
        video.parentElement.classList.contains('billboard-row'))
    );
  }

  /**
   * Get Netflix-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['.watch-video', '.nfp-container', '#netflix-player'];
  }
}

// Create singleton instance
window.VSC.NetflixHandler = NetflixHandler;
