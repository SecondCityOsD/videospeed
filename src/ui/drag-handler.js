/**
 * Drag functionality for video controller — UXP version (plain DOM)
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class DragHandler {
  /**
   * Handle dragging of video controller.
   * @param {HTMLVideoElement} video - Video element
   * @param {MouseEvent} e - Mouse event
   */
  static handleDrag(video, e) {
    var controller = video.vsc.div;
    // Plain DOM: .vsc-ctrl is inside .vsc-controller-inner inside wrapper
    var innerCtrl = controller.querySelector('.vsc-ctrl');
    var doc = controller.ownerDocument;

    video.classList.add('vcs-dragging');
    innerCtrl.classList.add('dragging');

    var initialMouseXY = [e.clientX, e.clientY];
    var initialControllerXY = [
      parseInt(innerCtrl.style.left) || 0,
      parseInt(innerCtrl.style.top) || 0
    ];

    // Document-level listeners (capture phase) so the drag keeps working
    // when the cursor leaves the video container or moves over iframes.
    // No mouseleave handler — only mouseup ends the drag.
    var onMove = function(ev) {
      var dx = ev.clientX - initialMouseXY[0];
      var dy = ev.clientY - initialMouseXY[1];
      innerCtrl.style.left = (initialControllerXY[0] + dx) + 'px';
      innerCtrl.style.top = (initialControllerXY[1] + dy) + 'px';
      ev.preventDefault();
    };

    var onEnd = function() {
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onEnd, true);
      innerCtrl.classList.remove('dragging');
      video.classList.remove('vcs-dragging');
      window.VSC.logger.debug('Drag operation completed');
    };

    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseup', onEnd, true);

    window.VSC.logger.debug('Drag operation started');
  }
}

window.VSC.DragHandler = DragHandler;
