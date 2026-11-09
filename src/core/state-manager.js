/**
 * Video Speed Controller State Manager
 * Tracks media elements for popup and keyboard commands.
 */

// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

window.VSC = window.VSC || {};

class VSCStateManager {
  constructor() {
    // Map of controllerId → controller instance
    this.controllers = new Map();

    if (window.VSC.logger) {
      window.VSC.logger.debug('VSCStateManager initialized');
    }
  }

  /**
   * Register a new controller
   * @param {VideoController} controller - Controller instance to register
   */
  registerController(controller) {
    if (!controller || !controller.controllerId) {
      if (window.VSC.logger) {
        window.VSC.logger.warn('Invalid controller registration attempt');
      }
      return;
    }

    // Store controller info for compatibility with tests
    const controllerInfo = {
      controller: controller,
      element: controller.video,
      tagName: controller.video ? controller.video.tagName : undefined,
      videoSrc: controller.video
        ? controller.video.src || controller.video.currentSrc
        : undefined,
      created: Date.now(),
    };

    this.controllers.set(controller.controllerId, controllerInfo);
    if (window.VSC.logger) {
      window.VSC.logger.debug(`Controller registered: ${controller.controllerId}`);
    }
  }

  /**
   * Unregister a controller
   * @param {string} controllerId - ID of controller to unregister
   */
  unregisterController(controllerId) {
    if (this.controllers.has(controllerId)) {
      this.controllers.delete(controllerId);
      if (window.VSC.logger) {
        window.VSC.logger.debug(`Controller unregistered: ${controllerId}`);
      }
    }
  }

  /**
   * Get all registered media elements
   * @returns {Array<HTMLMediaElement>} Array of media elements
   */
  getAllMediaElements() {
    const elements = [];

    // Clean up disconnected controllers while iterating
    for (const [id, info] of this.controllers) {
      const video = (info.controller && info.controller.video) || info.element;
      if (video && video.isConnected) {
        elements.push(video);
      } else {
        // Remove disconnected controller
        this.controllers.delete(id);
      }
    }

    return elements;
  }

  /**
   * Get a media element by controller ID
   * @param {string} controllerId - Controller ID
   * @returns {HTMLMediaElement|null} Media element or null
   */
  getMediaByControllerId(controllerId) {
    const info = this.controllers.get(controllerId);
    return (info && info.controller && info.controller.video) || (info && info.element) || null;
  }

  /**
   * Get the first available media element
   * @returns {HTMLMediaElement|null} First media element or null
   */
  getFirstMedia() {
    const elements = this.getAllMediaElements();
    return elements[0] || null;
  }

  /**
   * Check if any controllers are registered
   * @returns {boolean} True if controllers exist
   */
  hasControllers() {
    return this.controllers.size > 0;
  }

  /**
   * Compatibility method - same as unregisterController
   * @param {string} controllerId - ID of controller to remove
   */
  removeController(controllerId) {
    this.unregisterController(controllerId);
  }

  /**
   * Compatibility method - same as getAllMediaElements
   * @returns {Array<HTMLMediaElement>} Array of media elements
   */
  getControlledElements() {
    return this.getAllMediaElements();
  }
}

// Create singleton instance
window.VSC.StateManager = VSCStateManager;
window.VSC.stateManager = new VSCStateManager();

if (window.VSC.logger) {
  window.VSC.logger.info('State Manager module loaded');
}

})();
