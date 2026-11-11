/**
 * Drag functionality for video controller
 * Uses pointer events for unified mouse + touch support
 */

// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

window.VSC = window.VSC || {};

class DragHandler {
  /**
   * Handle dragging of video controller via pointer events
   * @param {HTMLVideoElement} video - Video element
   * @param {PointerEvent|MouseEvent} e - Pointer/mouse event
   */
  static handleDrag(video, e) {
    const controller = video.vsc.div;
    // UXP: plain-DOM controller — getRoot() stands in for shadowRoot.
    const shadowController = window.VSC.ShadowDOMManager.getController(
      window.VSC.ShadowDOMManager.getRoot(controller)
    );
    const doc = controller.ownerDocument;

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const initialXY = [e.clientX, e.clientY];
    const initialControllerXY = [
      parseInt(shadowController.style.left) || 0,
      parseInt(shadowController.style.top) || 0,
    ];

    const draggable = e.target;

    // Capture pointer so all move/up events route here regardless of position
    if (e.pointerId !== undefined) {
      draggable.setPointerCapture(e.pointerId);
    }

    const onMove = (ev) => {
      const dx = ev.clientX - initialXY[0];
      const dy = ev.clientY - initialXY[1];
      shadowController.style.left = `${initialControllerXY[0] + dx}px`;
      shadowController.style.top = `${initialControllerXY[1] + dy}px`;
    };

    const onEnd = () => {
      draggable.removeEventListener('pointermove', onMove);
      draggable.removeEventListener('pointerup', onEnd);
      draggable.removeEventListener('pointercancel', onEnd);
      // Mouse fallbacks (UXP: on the document — see below)
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onEnd, true);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');

      window.VSC.logger.debug('Drag operation completed');
    };

    if (e.pointerId !== undefined) {
      draggable.addEventListener('pointermove', onMove);
      draggable.addEventListener('pointerup', onEnd);
      draggable.addEventListener('pointercancel', onEnd);
    } else {
      // UXP: the normal path — controls.js starts drags from mousedown.
      // Mouse events have no setPointerCapture equivalent, so listen on the
      // document in the capture phase: the drag keeps tracking when the
      // cursor outruns the small badge, and a mouseup anywhere ends it.
      doc.addEventListener('mousemove', onMove, true);
      doc.addEventListener('mouseup', onEnd, true);
    }

    window.VSC.logger.debug('Drag operation started');
  }
}

// Create singleton instance
window.VSC.DragHandler = DragHandler;

})();
