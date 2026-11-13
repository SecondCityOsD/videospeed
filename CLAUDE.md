# Video Speed Controller — Pale Moon / UXP Port

XUL overlay port of [igrigorik/videospeed](https://github.com/igrigorik/videospeed)
**0.11.1** (Chrome MV3) for Pale Moon / Basilisk. Goal: upstream's exact
behavior, every edge case, adapted only where UXP requires it.

- **Repo:** <https://github.com/SecondCityOsD/videospeed> (branch `main`)
- **Project root (Windows):** `D:\Vibe coding\videospeed-uxp0.11.1`
- **Upstream checkout:** `D:\Vibe coding\videospeed-0.11.1` (sibling folder;
  the tools read it as `../videospeed-0.11.1`)
- **Extension ID:** `videospeed-uxp@secondcityosd` — version in `install.rdf`
- **Targets:** Pale Moon 28.0–35.*, Basilisk 52.0–56.*. Single process (UXP
  has no e10s): no frame scripts, no message manager.
- Restart required to install/update (non-bootstrapped XUL overlay).

## Layout

```
install.rdf, chrome.manifest        # metadata; content/skin/resource registration
defaults/preferences/prefs.js       # pref defaults = upstream DEFAULT_SETTINGS
build-xpi.ps1, build.sh             # XPI builders (same rules)
chrome/
  content/overlay.xul, overlay.js   # toolbar button + panel; chrome-side bridge
  content/popup/                    # XUL toolbar panel (tracks upstream popup)
  content/options/                  # upstream's settings page as XUL (generated)
    chrome-storage.js               #   fork-native chrome.storage shim
  modules/VSCPrefs.jsm              # prefs: read/write/observe, migrations
  skin/classic/                     # icons, toolbar CSS
src/                                # page scripts (resource://videospeed/)
tools/
  port-upstream.mjs                 # upstream → fork generator + check
  diff-upstream.mjs                 # differential fuzz of the pure engines
  upstream-tests/                   # test harnesses (see Testing)
```

`src/` mirrors upstream's `src/` file for file, minus what the fork replaces:
`background.js` (→ `VSCPrefs.migrate()` + `overlay.js` icon), `entries/
content-bridge.js` (→ `overlay.js` bridge), `entries/inject-entry.js` (→
`overlay.js` `_contentScripts`, same order), `utils/site-pattern.js` and
`blacklist.js` (→ ES5 port in `overlay.js`), `ui/popup/` (→ XUL popup),
`ui/vsc-controller-element.js` (a comment only), `styles/inject.css` (folded
into `styles/controller-css-defaults.js`).

## How the code is produced

**Generated, never hand-edited:** every `src/**` file except the two
fork-native ones, plus `chrome/content/options/{options.xul,options.css,
options.js,row-renderer.js}`. `tools/port-upstream.mjs` holds a registry:
upstream path → exact-match edits (each asserted to match once, or `count`
times for `{every}`), optional `dest`, IIFE wrap (`wrap: false` for HTML/CSS,
`wrapNote` for the comment). Every adaptation is commented `UXP:` in the
output.

```sh
node tools/port-upstream.mjs            # check all: ok / native / differs
node tools/port-upstream.mjs --write    # regenerate (optionally list files)
```

**Fork-native:** `src/ui/shadow-dom.js` (plain-DOM controller instead of a
shadow root), `src/styles/controller-css-defaults.js` (upstream inject.css +
site CSS with `:has()` lists split, the inner controller CSS, `stripCSSImports()`
and the sheet builders overlay.js uses), everything in `chrome/` except the
generated options files.

To follow a new upstream release: point the tools at the new checkout, run the
check, fix each edit that no longer matches, regenerate, run all tests.

## Architecture

**Injection (`overlay.js`).** On every frame's `DOMContentLoaded` for
http/https/file documents (Meet/Hangouts excluded, as upstream's
`exclude_matches`; `about:` documents never — upstream's bridge aborts them):
read prefs; if `enabled` is false or a site rule disables the URL (first
matching rule decides; the legacy `blacklist` only while `siteRules` is
absent), inject nothing. Otherwise register a bridge (chrome-side `WeakMap`
doc → `{root, active, disabledForDocument}`) and append the page scripts as
`<script src="resource://videospeed/…">` with `async = false`. Both sides talk
on `bridge.root` (the `<html>` at injection) for the document's life, as
upstream's bridge and page scripts capture it once.

**Replaced documents.** `document.open()`/`write()` (e.g. the VORAPIS V3
YouTube layout, sling.com) gives the document a new root and a second
`DOMContentLoaded`; Gecko also gives it a new window, killing the injected
scripts (Chrome keeps the window, so upstream only warns). The overlay injects
again when `DOMContentLoaded` arrives with a new root, unless the document was
disabled while open. An in-place `<html>` swap without a new window keeps the
running scripts.

**Controller sheets.** Upstream's CSS is out of the page's reach (manifest CSS,
adopted stylesheets). The fork's counterpart: when a page goes active, the
overlay attaches author sheets through `nsIDOMWindowUtils.loadSheetUsingURIString`
(`data:` URIs; as Firefox's WebExtensions did for content-script CSS) — not
DOM nodes, so a page cannot remove, block or disable them (VORAPIS V3 sweeps
every `<style>` on YouTube, which left the controller unstyled and under the
video), and page CSP does not apply. Two sheets, in cascade order:
`controllerSheetCSS(hostname)` (inner controller CSS + upstream's host/site
rules run through a verbatim copy of `preprocessDomainCSS`) and
`customSheetCSS(customCSS pref)` (`@import` stripped), both from
`controller-css-defaults.js` loaded into a chrome sandbox — the text never comes
from the page. The custom sheet is swapped on pref change; both are removed on
disable and before a re-opened document is injected again. Page-side
`injectControllerCSS`/`setupCSSLiveUpdates` are no-ops; the page adds no
`<style>` at all.

**Settings bridge** — upstream's content-bridge protocol, CustomEvents on
`document.documentElement`, chrome listeners added with `wantsUntrusted`:

| Event | Direction | Notes |
|---|---|---|
| `VSC_REQUEST_SETTINGS` | page → chrome | answered once with `VSC_SETTINGS_READY` |
| `VSC_SETTINGS_READY` | chrome → page | `{settings, hostname}` or `{abort}`; `settings` = `VSCPrefs.getStored()` (stored keys only, like `storage.sync.get(null)`) minus `enabled`/`blacklist`/`siteRules`, plus the matched rule's `siteDefaultSpeed`; via `cloneInto` |
| `VSC_WRITE_STORAGE` | page → chrome | `lastSpeed` only, clamped 0.07–16 |
| `VSC_STORAGE_CHANGED` | chrome → page | pref observer relay (never `blacklist`/`siteRules`) |
| `VSC_MESSAGE` | chrome → page | popup commands; `VSC_TEARDOWN` on disable |

Any `enabled` change makes open documents reload-only; disabling tears them
down. Popup commands go to every active bridge in every frame of the selected
tab.

**Page scripts** run upstream's 0.11 engine unchanged: `SpeedArbiter` (pure
transitions), `IntentClassifier`, `SpeedArbitration` (echo tokens, authority
epochs, fight budget), `ControllerVisibility`. Contracts:
`../videospeed-0.11.1/docs/speed-arbitration.md` and
`controller-visibility.md`.

**Controller.** Upstream's unregistered `<vsc-controller class="vsc-controller">`
host, built as plain DOM (`shadow-dom.js`); `.vsc-controller-inner` stands in
for the shadow root and carries the visibility rules (the `data-vsc-visibility`
attribute), because `.vsc-ctrl`'s display is locked inline with `!important`.
Its CSS comes from the controller sheets above. Drag starts on the speed badge
only (mousedown + document capture).

**Settings page.** `chrome://videospeed/content/options/options.xul`, opened
in a tab (`em:optionsType` 3; the popup uses `switchToTabHavingURI`, like
`openOptionsPage()`), chrome-privileged. A XUL document generated from
upstream's `options.html`: upstream's markup as XHTML inside the XUL `window`,
in `#vsc-viewport` (scrolling viewport, canvas background, `medium` font,
selectable text) › `#vsc-html` › `#vsc-body`, which take upstream's `html` /
`body` rules — so it looks and behaves like the HTML page. In a XUL document
`document.createElement()` makes XUL elements and `document.body` is null:
the scripts use `createHTMLElement()` (row-renderer.js) and `pageBody()`;
`innerHTML` parses as XML (the CSS highlighter falls back to plain text).
Loads `resource://videospeed/` modules
plus `chrome-storage.js`, which gives upstream's unchanged storage-manager /
settings a `chrome.storage` over the prefs: `get` sees only user-set prefs,
absent keys take the caller's defaults, results are copies; keys without a pref
are ignored; `remove`/`clear` drop user values (`resetAll()`); one `onChanged`
event per call.

**Popup.** XUL `<panel>` with an `<iframe>` (`popup.xul`). The panel keeps the
document, so `overlay.onPanelShown` posts `VSC_PANEL_SHOWN` and the popup
re-reads labels and the enabled state each time (upstream's popup is a fresh
page). The overlay alone sets the toolbar icon.

## Conventions and gotchas

- **IIFE per module.** Each `src/**` file is its own classic script in page
  scope, so the generator wraps it in a strict-mode IIFE after the header
  comment (body not re-indented). Cross-module access only via `window.VSC.*`.
  Page globals must stay exactly upstream's: `VSC`, `VSC_controller`,
  `VSC_settings`, `vscDebugHelper` (`classic-load.mjs` enforces it).
- **Syntax floor** for `src/` and the options page (Pale Moon 28+): no `?.`,
  `??`, `??=`/`||=`/`&&=`, static class fields, `catch {}`, ES modules. Use
  `(x != null) ? x : y`. `chrome/**` hand-written code is ES5-style.
- **`:has()` selector lists** drop the whole rule on engines without `:has()`
  — split them (controller CSS) or use classes (options page).
- **No Constructable Stylesheets / adoptedStyleSheets / Shadow DOM** on UXP.
- **HTML inside a XUL window:** an HTML element laid out as a XUL box child
  grows to its full content height, so `overflow: auto` on it never scrolls.
  `options.xul`'s `#vsc-viewport` is `position: fixed` with all four edges at
  0 instead (and focused on load for keyboard scrolling).
- **Stylesheet `!important` beats normal inline styles**: the controller's
  `top`/`left` rules must not be `!important` (drag writes them inline).
- **Pref types:** read through `VSCPrefs.getAll()` / typed getters, never
  `getStringPref`. libpref clears a user value when it is set to the default.
- **`build-xpi.ps1`** writes forward-slash ZIP entries (.NET `ZipArchive`);
  `Compress-Archive` breaks chrome registration. Both builders fail unless
  `overlay.js` `_contentScripts` lists exactly the `.js` files under `src/`.
- **`core.autocrlf=true`** on this checkout; `.gitattributes` keeps `*.sh` LF.
  Scripts that parse repo files must accept `\r\n`.
- **Bash tool heredocs** turn `\\` into `\`: write text with backslashes via
  Edit/Write.

## Prefs (`extensions.videospeed.*`)

bool `enabled`, `rememberSpeed`, `exclusiveKeys`, `audioBoolean`,
`startHidden`; int `controllerButtonSize`, `logLevel`, `schemaVersion`,
`toolbarbuttonVersion` (overlay bookkeeping); char `lastSpeed`,
`controllerOpacity` (floats; `"null"` = stored null), `customCSS`, `blacklist`
(legacy), `keyBindings`, `siteRules` (JSON; empty `siteRules` = absent).
`VSCPrefs.migrate()` runs once per session: removes upstream's deprecated keys,
turns a user-set `blacklist` into disabled site rules, migrates v1 key bindings
to v2 (`event.code`) using `src/utils/key-maps.js`.

## Testing

No tsc/ESLint in this repo: verify with `node --check` (parse
`VSCPrefs.jsm` via `vm.Script`; node rejects the extension) and the harnesses
below. Run dir + `node_modules` live outside the repo (`VSC_TEST_RUN_DIR`,
default `%TEMP%\vsc-uxp-upstream-tests`); `sync.mjs` prints the pinned
`npm install` (vitest 4.1.10, jsdom 30.0.1, `--ignore-scripts`) if missing —
never install anything else without asking.

| Command | What |
|---|---|
| `node tools/upstream-tests/sync.mjs` then `npx vitest run --reporter=json --outputFile=x.json` in the run dir | upstream's suite on the fork; 455 pass / 15 by-design failures (chrome.* bridge, blacklist/site-pattern, real shadow DOM, adoptedStyleSheets and page-side CSS injection — the overlay attaches the sheets, upstream element names) |
| `node tools/upstream-tests/compare.mjs a.json b.json` | per-test fixes/regressions |
| `classic-load.mjs` | scripts as classic scripts in one window: load errors, global leaks |
| `smoke.mjs` | real boot on a playable video: shortcuts, R/G, V, popup messages, wheel, drag, teardown, custom CSS |
| `css-matrix.mjs` | 40 visibility states rendered vs `ControllerVisibility.isVisible()` |
| `bridge.mjs` | real `overlay.js` + `VSCPrefs.jsm` on simulated XPCOM (`xpcom.mjs`) |
| `options.mjs` | real settings page + shim + prefs |
| `popup.mjs` | real popup.xul/popup.js |
| `node tools/diff-upstream.mjs` | arbiter/classifier/arbitration/visibility vs upstream, seeded traces |

Mutation-test new checks (plant the bug, see the check fail). Build test XPIs
with `-OutDir` into a scratch folder.

## Release

1. Bump `em:version` in `install.rdf` and `update.rdf`; point both
   `updateLink`s in `update.rdf` at the new release asset. Add a
   `CHANGELOG.md` section — short, gorhill (uBlock Origin) style: "Fixes /
   changes", "Closed as fixed", "Commits history since last version".
2. Port check clean, all harnesses green, suite without regressions.
3. `.\build-xpi.ps1` → `videospeed-uxp-<version>.xpi` in the root (`*.xpi` is
   gitignored); older release XPIs stay untouched.
4. Commit on `main` as `SecondCityOsD <sinfulosd@tutanota.com>`
   (`git -c user.name=… -c user.email=…`); push and publish the GitHub release
   only when asked.
5. GitHub release: tag `videospeed<version>`, title "Video Speed Controller
   <version>", the CHANGELOG section as notes, the XPI as asset. Installed
   copies read `update.rdf` from raw `main` (`em:updateURL`), so the release
   asset must exist before or with the push that changes `update.rdf`.

## Deliberate differences from upstream

- Disabled sites get no page scripts at all; raw site rules never reach the
  page (`siteDefaultSpeed` instead).
- Shipped default site rules apply from the first run (upstream's bridge reads
  raw storage, so they only take effect after its options page saves once).
- Plain-DOM controller; custom CSS can reach its inner parts.
- `controllerButtonSize` is an integer pref (fractions round down).
- `chrome.storage.sync` quotas are not emulated (the options page keeps its own
  8 KB custom-CSS guard).
- Fixed instead of ported: `window.VSC.inIframe()` (undefined upstream; fork
  uses `DomUtils.inIframe`), the `:root:root` Drive-embed rule (never matched
  upstream), the shadow observers' teardown.

**Upstream bugs ported verbatim** (parity; candidates for upstream reports):
`IntentClassifier.clearTemporaryHoldsForMedia` compares owner entries to the
media element; the options page's focus/blur listeners never fire (not
capturing); the options FAQ's "remember speed" answer contradicted
`settings.load()` (corrected in the fork's text).

## Verify in real Pale Moon

Confirmed by the user in Pale Moon (2026-11-13): the controller sheets attach
and style the controller, also on VORAPIS V3 YouTube pages; the settings
handshake works (chrome listeners added with `wantsUntrusted` receive page
CustomEvents); keyboard shortcuts work; the options page (then HTML) opens in
a tab.

Still unverified (not provable in jsdom): the bridge `WeakMap` keeps identity
for content documents across frame walks (popup commands into embedded
players); `options.xul` looks exactly like the HTML page did (viewport fill and
scrolling, sticky header, font size, `#faq-…` links scroll to their answers),
its blob export downloads, and without `beforeinput` the speed fields filter
via keypress/paste; the popup draws on the panel background, fits its height
and refreshes on every opening.
