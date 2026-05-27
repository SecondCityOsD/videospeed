#!/bin/bash
# Build Video Speed Controller UXP extension
set -e

# Always run from the script's directory so relative paths resolve regardless
# of where the user invokes the script from.
cd "$(dirname "$0")"

BASENAME="videospeed-uxp"
VERSION=$(grep 'em:version' install.rdf | sed 's/.*>\(.*\)<.*/\1/')
XPI_NAME="${BASENAME}-${VERSION}.xpi"

echo "Building ${XPI_NAME}..."

# Remove old xpi
rm -f "${XPI_NAME}"

# Create xpi (zip) with the correct structure
zip -r9 "${XPI_NAME}" \
  install.rdf \
  chrome.manifest \
  chrome/ \
  defaults/ \
  src/utils/constants.js \
  src/utils/key-maps.js \
  src/utils/logger.js \
  src/utils/dom-utils.js \
  src/utils/event-manager.js \
  src/utils/debug-helper.js \
  src/core/state-manager.js \
  src/core/storage-manager.js \
  src/core/settings.js \
  src/core/action-handler.js \
  src/core/video-controller.js \
  src/observers/media-observer.js \
  src/observers/mutation-observer.js \
  src/site-handlers/base-handler.js \
  src/site-handlers/index.js \
  src/site-handlers/youtube-handler.js \
  src/site-handlers/netflix-handler.js \
  src/site-handlers/facebook-handler.js \
  src/site-handlers/amazon-handler.js \
  src/site-handlers/apple-handler.js \
  src/site-handlers/dailymotion-handler.js \
  src/ui/shadow-dom.js \
  src/ui/controls.js \
  src/ui/drag-handler.js \
  src/content/inject.js \
  src/styles/controller-css-defaults.js \
  src/styles/inject.css \
  src/assets/icons/ \
  LICENSE \
  -x "*.git*" "*.DS_Store"

echo "Built: ${XPI_NAME} ($(du -h "${XPI_NAME}" | cut -f1))"