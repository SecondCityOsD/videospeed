// UXP: the fork loads every module as its own classic <script> in page scope;
// upstream gets one esbuild IIFE around the whole bundle. This wrapper keeps
// top-level bindings out of the page's global lexical scope, where a site
// script declaring the same name would throw a redeclaration SyntaxError.
(function () {
'use strict';

window.addEventListener(
  'message',
  (event) => {
    if (
      event.origin !== 'https://www.netflix.com' ||
      event.data.action !== 'videospeed-seek' ||
      !event.data.seekMs
    ) {
      return;
    }
    const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const playerSessionId = videoPlayer.getAllPlayerSessionIds()[0];
    const currentTime = videoPlayer.getCurrentTimeBySessionId(playerSessionId);
    videoPlayer.getVideoPlayerBySessionId(playerSessionId).seek(currentTime + event.data.seekMs);
  },
  false
);

})();
