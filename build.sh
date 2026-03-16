#!/bin/bash
# Build Video Speed Controller UXP extension
set -e

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
  src/utils/ \
  src/core/ \
  src/observers/ \
  src/site-handlers/ \
  src/ui/shadow-dom.js \
  src/ui/controls.js \
  src/ui/drag-handler.js \
  src/content/ \
  src/styles/inject.css \
  src/assets/icons/ \
  LICENSE \
  -x "*.git*" "*.DS_Store"

echo "Built: ${XPI_NAME} ($(du -h "${XPI_NAME}" | cut -f1))"

# Check if update.rdf version matches install.rdf version
UPDATE_VERSION=$(grep 'em:version' update.rdf | head -1 | sed 's/.*>\(.*\)<.*/\1/')
if [ "$VERSION" != "$UPDATE_VERSION" ]; then
  echo ""
  echo "WARNING: update.rdf version ($UPDATE_VERSION) does not match install.rdf version ($VERSION)"
  echo "Remember to update update.rdf before pushing!"
fi
