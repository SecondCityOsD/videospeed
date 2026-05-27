# Video Speed Controller — Pale Moon / UXP Port

## Project Overview

XUL overlay extension port of `igrigorik/videospeed` (Chrome MV3, upstream
0.10.2) for Pale Moon / Basilisk / other UXP-based browsers. **Single-process
target only** — UXP is not e10s, so no frame-script layer.

- **Repo:** <https://github.com/SecondCityOsD/videospeed>
- **Project root (Windows):** `D:\Vibe coding\videospeed-uxp0.9.1`
- **Extension ID:** `videospeed-uxp@secondcityosd`
- **Pale Moon target:** 28.0–33.* (Goanna engine)
- **Build:** `build-xpi.ps1` on Windows or `build.sh` on Linux → produces
  `videospeed-uxp-<version>.xpi`

## Architecture (current)

XUL overlay extension. Restart required to install / update.

```
videospeed-uxp0.9.1/
├── install.rdf                          # Extension metadata
├── chrome.manifest                      # Content / skin / resource registration
├── build-xpi.ps1                        # Windows builder (.NET ZipArchive)
├── build.sh                             # Linux builder (zip)
├── defaults/preferences/prefs.js        # Default pref values
├── chrome/
│   ├── content/
│   │   ├── overlay.xul                  # Overlays browser.xul (toolbar button + panel)
│   │   ├── overlay.js                   # Chrome-context bootstrap: injects content
│   │   │                                  scripts directly into every tab, listens for
│   │   │                                  VSC_* events, persists prefs, broadcasts
│   │   │                                  prefs changes to all open documents.
│   │   ├── popup/                       # Toolbar popup panel (legacy XUL widgets)
│   │   │   ├── popup.xul
│   │   │   ├── popup.css
│   │   │   └── popup.js
│   │   └── options/                     # Options page (XUL widgets)
│   │       ├── options.xul
│   │       ├── options.css
│   │       └── options.js
│   ├── modules/
│   │   └── VSCPrefs.jsm                 # XPCOM pref read/write + addObserver
│   └── skin/classic/                    # Toolbar icons
└── src/                                 # Page-injected content scripts
    ├── content/inject.js                # Main entry; VideoSpeedExtension class
    ├── core/
    │   ├── action-handler.js            # Speed adjust / seek / reset / etc.
    │   ├── settings.js                  # VideoSpeedConfig (settings load/save)
    │   ├── state-manager.js             # Tracks attached controllers per session
    │   ├── storage-manager.js           # Reads VSC_USER_SETTINGS, writes
    │   │                                  VSC_SAVE_SETTINGS events
    │   └── video-controller.js          # Per-video controller (lifecycle, position)
    ├── observers/
    │   ├── media-observer.js            # Scans for <video>/<audio>
    │   └── mutation-observer.js         # Watches DOM changes (incl. shadow roots)
    ├── site-handlers/
    │   ├── base-handler.js              # Default behaviour (handleSeek, handleSpeedChange)
    │   ├── index.js                     # SiteHandlerManager (lazy init,
    │   │                                  GIF-video skip)
    │   ├── youtube-handler.js           # Insertion point + ignore logic
    │   ├── netflix-handler.js           # postMessage-based seeking
    │   ├── facebook-handler.js
    │   ├── amazon-handler.js
    │   ├── apple-handler.js
    │   └── dailymotion-handler.js       # Inserts above native overlay
    ├── styles/
    │   ├── controller-css-defaults.js   # Outer .vsc-controller wrapper rules
    │   │                                  + site-specific offsets (YT, Netflix, FB, Prime)
    │   └── inject.css                   # (legacy; not loaded by UXP build)
    ├── ui/
    │   ├── shadow-dom.js                # Plain-DOM controller builder + CSS
    │   ├── controls.js                  # Drag handle, button handlers, wheel gate,
    │   │                                  double-click reset, click prevention
    │   └── drag-handler.js              # Document-level pointer drag logic
    └── utils/
        ├── constants.js                 # DEFAULT_SETTINGS, regex, LOG_LEVELS,
        │                                  requestIdleCallback polyfill
        ├── debug-helper.js
        ├── dom-utils.js                 # findVideoParent, isBlacklisted,
        │                                  initializeWhenReady, etc.
        ├── event-manager.js             # Keybindings + ratechange + fight detection
        ├── key-maps.js                  # event.code ↔ keyCode normalization
        └── logger.js                    # Verbosity-gated console wrapper
```

### Boot sequence

1. `overlay.xul` adds a toolbar button + `<panel>` to the browser chrome.
2. `overlay.js` (chrome context):
   - Reads `extensions.videospeed.*` prefs via `VSCPrefs.jsm`.
   - On every tab's `DOMContentLoaded`:
     - Resets the per-browser controller count.
     - Injects `window.VSC_initial_settings` inline.
     - Appends `<script src="resource://videospeed/…">` for each module in
       deterministic order (`script.async = false`).
   - Subscribes to `VSCPrefs.addObserver(callback)` so any pref change is
     broadcast as a `VSC_STORAGE_CHANGED` CustomEvent into every open
     content document — live settings, no reload needed.
   - Listens (via `gBrowser.addEventListener('VSC_…', this, false, true)`)
     for `VSC_CONTROLLER_CREATED`, `VSC_CONTROLLER_REMOVED`,
     `VSC_SAVE_SETTINGS` bubbling up from content.
3. Content scripts (page scope) run in declared order, build
   `window.VSC.*`, then `inject.js` IIFE wires up the extension.
4. **No frame script. No `messageManager`.** All chrome↔content
   communication is via DOM CustomEvents bubbling up to `gBrowser`.
5. Controller UI is **plain DOM**, scoped by `.vsc-controller …` class
   chain. CSS specificity floor is `(0, 3, 0)` so userscript reskins
   (notably VORAPIS V3) can't override layout.

### Key differences from upstream 0.10.2

| Area | Chrome MV3 (0.10.2) | UXP Port |
|---|---|---|
| Extension format | `manifest.json` (MV3) | `install.rdf` + `chrome.manifest` |
| Background | Service worker (`background.js`) | `overlay.js` in chrome scope |
| Content injection | `content_scripts` manifest | `<script>` tags from `overlay.js` |
| Storage | `chrome.storage.sync` | `nsIPrefBranch` via `VSCPrefs.jsm` |
| Pref hot-reload | `chrome.storage.onChanged` | `nsIPrefBranch.addObserver` + broadcast |
| Controller UI | Real Shadow DOM + Constructable Stylesheets | Plain DOM + `<style>` element |
| Popup | `chrome.action` HTML popup | `<panel>` with XUL `<iframe>` |
| Messaging | `chrome.runtime.sendMessage` | DOM CustomEvents on `documentElement` |
| URLs | `chrome.runtime.getURL()` | `resource://videospeed/` |
| Drag | `pointerdown` + `setPointerCapture` | document-level `mousedown` + capture |

### Pale Moon API caveats (the gotchas)

These broke earlier iterations and are *enshrined* in current code — do
not regress them:

- **No Constructable Stylesheets.** `new CSSStyleSheet()` /
  `document.adoptedStyleSheets` don't exist on UXP. CSS is injected via
  `<style>` element (see `inject.js#_appendStyle` and
  `shadow-dom.js#ensureCSS`).
- **No full Shadow DOM.** The controller is built as light DOM with
  scoped classes. CSS specificity floor `(0, 3, 0)` defends against
  hostile page CSS.
- **`composedPath()` works but is meaningless** on plain DOM. Use
  `event.target` directly (see `event-manager.js#handleRateChange`).
- **`contentaccessible=yes` is not recognized on `resource` lines** —
  Pale Moon parses the line without the flag. resource:// URLs are
  content-accessible by default on UXP, so no flag needed.
- **`Compress-Archive` on Windows writes backslash-separated entries**,
  which Mozilla's XPI parser can't resolve. `build-xpi.ps1` uses .NET
  `ZipArchive` directly to write forward-slash entries.
- **Class-level `const X = …` is not a window global.** Files that
  define top-level constants must explicitly assign
  `window.VSC.X = X;` at the bottom (see
  `controller-css-defaults.js`, `key-maps.js`).
- **Stylesheet `!important` outranks normal-priority inline styles.**
  `drag-handler.js` mutates `innerCtrl.style.left/top` inline, so the
  `top` and `left` rules in `shadow-dom.js` *must not* carry `!important`
  or drag freezes at 0,0.
- **`em` units inherit through the parent chain.** Hostile sites
  (VORAPIS V3 on YouTube) can change effective font-size on ancestors.
  Sizes inside the controller are pinned to absolute pixels.

### Pref keys (`extensions.videospeed.*`)

- `enabled` (bool), `rememberSpeed` (bool), `audioBoolean` (bool),
  `startHidden` (bool)
- `lastSpeed` (char/float), `controllerOpacity` (char/float)
- `controllerButtonSize` (int), `logLevel` (int), `displayKeyCode` (int)
- `keyBindings` (char/JSON), `speeds` (char/JSON; legacy, unused),
  `blacklist` (char)
- `forceLastSavedSpeed` (bool; legacy, unused — kept for backward
  compatibility with old options-page UI)

### Backported upstream 0.10.2 features

- Fight detection (`event-manager.js#handleRateChange`) — re-applies the
  user's `lastSpeed` when a site dispatches `ratechange` that diverges
  from intent within the 3 s cooldown window.
- In-session speed memory regardless of `rememberSpeed`
  (`video-controller.js#setupEventHandlers`) — the `play` / `seeked`
  handler restores `lastSpeed` on quality switches and ad transitions.
- Hover-dwell wheel gate (300 ms), touchpad delta filter, double-click
  reset (`controls.js`).
- GIF-video skip (`<video loop muted no-controls>` in
  `site-handlers/index.js#shouldIgnoreVideo`).
- Dailymotion handler.
- Whole controller body is a drag handle (not just the speed pill).

## Build

### Windows (PowerShell)

```
& 'D:\Vibe coding\videospeed-uxp0.9.1\build-xpi.ps1'
```

Produces `videospeed-uxp-<version>.xpi` next to the script. Uses .NET
`ZipArchive` to write forward-slash entries. Fails loud if any source
file is missing or the version can't be parsed.

### Linux / Bash

```
./build.sh
```

Anchors `cwd` to the script's directory, packs via `zip -r9`.

## Status

- Released to `main` on the repo above.
- Diagnostic `console.log('[VSC] …')` checkpoints stripped (Phase F3).
- `DEFAULT_SETTINGS.logLevel = 3` (WARNING) for release builds.
- All upstream-0.10.2 high-impact features backported (Phase G1–G3).
- Live settings hot-reload via `VSCPrefs.addObserver` (Phase F1).

## Known limitations

- **Ancestor `transform: scale()` on the host page still scales the
  controller visually** — CSS inside the controller can't undo an
  ancestor transform. Workaround: re-parenting to `document.body`
  outside any transformed container; not implemented because it loses
  "follow the video" positioning.
- **Cross-origin iframes** — the keybinding listener can't be attached
  to a cross-origin top document; key shortcuts only work when focus is
  inside same-origin frames (handled gracefully, no errors).
- **Pale Moon < 30** may parse-fail on optional chaining (`?.`) and
  nullish coalescing (`??`) used in the upstream-derived files. The
  current `install.rdf` `minVersion=28.0` is aspirational; realistic
  floor is Pale Moon 30+.
