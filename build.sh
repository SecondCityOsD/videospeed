#!/bin/bash
# Build Video Speed Controller UXP extension (Linux / macOS)
#
#   ./build.sh            # writes videospeed-uxp-<version>.xpi here
#   ./build.sh <dir>      # writes it into <dir> instead
#
# Packages install.rdf, chrome.manifest, LICENSE and the whole chrome/,
# defaults/ and src/ trees (minus OS/editor droppings), after checking that
# the page-script list in chrome/content/overlay.js (_contentScripts) matches
# the .js files under src/ exactly. Same rules as build-xpi.ps1.
set -euo pipefail

# Always run from the script's directory so relative paths resolve regardless
# of where the user invokes the script from.
OUT_DIR=$(cd "${1:-$(dirname "$0")}" && pwd)
cd "$(dirname "$0")"

BASENAME="videospeed-uxp"
VERSION=$(grep 'em:version' install.rdf | sed 's/.*>\(.*\)<.*/\1/')
if [ -z "${VERSION}" ]; then
  echo "Could not parse em:version from install.rdf" >&2
  exit 1
fi
XPI_PATH="${OUT_DIR}/${BASENAME}-${VERSION}.xpi"

echo "Building ${XPI_PATH}..."

for f in install.rdf chrome.manifest LICENSE; do
  [ -f "$f" ] || { echo "Missing required file: $f" >&2; exit 1; }
done
for d in chrome defaults src; do
  [ -d "$d" ] || { echo "Missing required directory: $d" >&2; exit 1; }
done

# Dotfiles and OS/editor droppings never belong in a release.
list_tree() {
  find "$@" -type f ! -name '.*' ! -name 'Thumbs.db' ! -name 'desktop.ini' \
    ! -name '*~' ! -name '*.swp' ! -name '*.orig' ! -name '*.rej' ! -name '*.bak'
}

# --- Verify overlay.js's page-script list against src/ ----------------------
# `|| true`: an empty match is reported below, not by pipefail.
listed=$(sed -n '/_contentScripts: *\[/,/^ *\],/p' chrome/content/overlay.js |
  grep -o '"[^"]*\.js"' | tr -d '"' | sed 's|^|src/|' || true)
shipped=$(list_tree src | grep '\.js$' | LC_ALL=C sort || true)

problems=$(
  printf '%s\n' "$listed" | LC_ALL=C sort | uniq -d | sed 's|^|listed twice in overlay.js: |'
  LC_ALL=C comm -23 <(printf '%s\n' "$listed" | LC_ALL=C sort -u) <(printf '%s\n' "$shipped") |
    sed 's|^|listed in overlay.js but missing from src/: |'
  LC_ALL=C comm -13 <(printf '%s\n' "$listed" | LC_ALL=C sort -u) <(printf '%s\n' "$shipped") |
    sed 's|^|present in src/ but not loaded by overlay.js: |'
)
if [ -z "${listed}" ]; then
  problems="could not locate the _contentScripts list in chrome/content/overlay.js"
fi
if [ -n "${problems}" ]; then
  echo "Page-script list does not match src/:" >&2
  printf '%s\n' "${problems}" | sed 's/^/  /' >&2
  exit 1
fi

# --- Write the XPI ----------------------------------------------------------
rm -f "${XPI_PATH}"
# Sorted names for a deterministic entry order; -X drops OS-specific extra
# attributes so builds from different machines match.
{ printf '%s\n' install.rdf chrome.manifest LICENSE; list_tree chrome defaults src; } |
  LC_ALL=C sort | zip -9 -X -q "${XPI_PATH}" -@

echo "Built: ${XPI_PATH} ($(du -h "${XPI_PATH}" | cut -f1); $(printf '%s\n' "$listed" | wc -l | tr -d ' ') page scripts match overlay.js)"
