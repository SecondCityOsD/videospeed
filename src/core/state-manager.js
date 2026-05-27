/**
 * Video Speed Controller State Manager
 * Tracks media elements for popup and keyboard commands.
 */

window.VSC = window.VSC || {};

class VSCStateManager {
  constructor() {
    this.controllers = new Map();
    window.VSC.logger?.debug('VSCStateManager initialized');
  }

  registerController(controller) {
    if (!controller || !controller.controllerId) {
      window.VSC.logger?.warn('Invalid controller registration attempt');
      return;
    }

    const controllerInfo = {
      controller: controller,
      element: controller.video,
      tagName: controller.video?.tagName,
      videoSrc: controller.video?.src || controller.video?.currentSrc,
      created: Date.now()
    };

    this.controllers.set(controller.controllerId, controllerInfo);
    window.VSC.logger?.debug(`Controller registered: ${controller.controllerId}`);
  }

  unregisterController(controllerId) {
    if (this.controllers.has(controllerId)) {
      this.controllers.delete(controllerId);
      window.VSC.logger?.debug(`Controller unregistered: ${controllerId}`);
    }
  }

  getAllMediaElements() {
    const elements = [];

    for (const [id, info] of this.controllers) {
      const video = info.controller?.video || info.element;
      if (video && video.isConnected) {
        elements.push(video);
      } else {
        this.controllers.delete(id);
      }
    }

    return elements;
  }

  getMediaByControllerId(controllerId) {
    const info = this.controllers.get(controllerId);
    return info?.controller?.video || info?.element || null;
  }

  getFirstMedia() {
    const elements = this.getAllMediaElements();
    return elements[0] || null;
  }

  hasControllers() {
    return this.controllers.size > 0;
  }

  removeController(controllerId) {
    this.unregisterController(controllerId);
  }

  getControlledElements() {
    return this.getAllMediaElements();
  }
}

window.VSC.StateManager = VSCStateManager;
window.VSC.stateManager = new VSCStateManager();

window.VSC.logger?.info('State Manager module loaded');