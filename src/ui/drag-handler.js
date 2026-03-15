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

    var parentElement = window.VSC.DomUtils.findVideoParent(controller);

    video.classList.add('vcs-dragging');
    innerCtrl.classList.add('dragging');

    var initialMouseXY = [e.clientX, e.clientY];
    var initialControllerXY = [
      parseInt(innerCtrl.style.left) || 0,
      parseInt(innerCtrl.style.top) || 0
    ];

    var startDragging = function(e) {
      var dx = e.clientX - initialMouseXY[0];
      var dy = e.clientY - initialMouseXY[1];
      innerCtrl.style.left = (initialControllerXY[0] + dx) + 'px';
      innerCtrl.style.top = (initialControllerXY[1] + dy) + 'px';
    };

    var stopDragging = function() {
      parentElement.removeEventListener('mousemove', startDragging);
      parentElement.removeEventListener('mouseup', stopDragging);
      parentElement.removeEventListener('mouseleave', stopDragging);
      innerCtrl.classList.remove('dragging');
      video.classList.remove('vcs-dragging');
      window.VSC.logger.debug('Drag operation completed');
    };

    parentElement.addEventListener('mouseup', stopDragging);
    parentElement.addEventListener('mouseleave', stopDragging);
    parentElement.addEventListener('mousemove', startDragging);

    window.VSC.logger.debug('Drag operation started');
  }
}

window.VSC.DragHandler = DragHandler;
