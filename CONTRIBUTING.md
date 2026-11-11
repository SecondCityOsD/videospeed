# Contributing

Contributions to the Pale Moon / Basilisk port are welcome. Changes to the
extension's behavior usually belong upstream first, in
[igrigorik/videospeed](https://github.com/igrigorik/videospeed); this port
follows upstream releases.

1. Fork <https://github.com/SecondCityOsD/videospeed>, clone it, and check out
   the matching upstream release next to it as `../videospeed-0.11.1`.
2. Make your change. Files generated from upstream (everything under `src/`
   except `ui/shadow-dom.js` and `styles/controller-css-defaults.js`, and the
   settings page in `chrome/content/options/` except `chrome-storage.js`) are
   changed through `tools/port-upstream.mjs`, not by hand:
   `node tools/port-upstream.mjs --write`, then `node tools/port-upstream.mjs`
   must report no differences.
3. Keep `src/` and the settings page within Pale Moon's JavaScript support: no
   `?.`, `??`, `??=`/`||=`/`&&=`, static class fields or `catch {}`.
4. Run the checks described in `tools/upstream-tests/sync.mjs` and the scripts
   next to it, then build with `build.sh` or `build-xpi.ps1`.
5. Test the XPI in Pale Moon (Add-ons Manager → gear menu → **Install Add-on
   From File…**, then restart) and open a pull request describing the change.
