/**
 * Dailymotion site handler — backport from upstream 0.10.2.
 *
 * Dailymotion nests <video> inside `.video_view`, but the native controls
 * live as a sibling under `.player` (`.vod_mouse_keyboard`). If we attach
 * the controller next to the video element it gets buried by the native
 * overlay's z-index. Insert it as the first child of `.player` instead so
 * it stacks above the native controls.
 */

window.VSC = window.VSC || {};

class DailymotionHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return location.hostname.includes('dailymotion.com');
  }

  getControllerPosition(parent, _video) {
    // parent = `.video_view`; ascend to `.player` so the controller becomes
    // a sibling of `.vod_mouse_keyboard` (native controls) and stacks above.
    const playerContainer = parent.parentElement;
    return {
      insertionPoint: playerContainer || parent,
      insertionMethod: 'firstChild',
      targetParent: playerContainer || parent,
    };
  }
}

window.VSC.DailymotionHandler = DailymotionHandler;
