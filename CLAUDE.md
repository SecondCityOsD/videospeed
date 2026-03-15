# Video Speed Controller — UXP Port

## Project Overview
Port of "Video Speed Controller" (Chrome MV3 extension, v0.9.1) to Pale Moon / UXP as a **XUL overlay extension** (NOT bootstrapped/restartless).

- **Fork directory (work here):** `/home/osd/videospeed-uxp/`
- **Original Chrome source (READ-ONLY reference):** `/home/osd/videospeed-0.9.1/`
- **Build:** `./build.sh` → produces `videospeed-uxp-0.9.1.xpi`
- **Extension ID:** `videospeed-uxp@secondcityosd`

## Architecture (UXP port)

### Extension type: XUL overlay (requires restart)

```
videospeed-uxp/
├── install.rdf                    # Extension metadata
├── chrome.manifest                # Content/overlay/skin/resource registration
├── build.sh                       # XPI build script
├── defaults/preferences/prefs.js  # Default pref values
├── chrome/
│   ├── content/
│   │   ├── overlay.xul            # Overlays browser.xul (toolbar button + panel)
│   │   ├── overlay.js             # Chrome-context logic (icon state, frame scripts, messaging)
│   │   ├── framescript.js         # Content frame script (injects into web pages)
│   │   ├── popup/                 # Popup panel UI (chrome context)
│   │   │   ├── popup.html
│   │   │   ├── popup.css
│   │   │   └── popup.js
│   │   └── options/               # Options page (chrome context)
│   │       ├── options.html
│   │       ├── options.css
│   │       └── options.js
│   ├── modules/
│   │   └── VSCPrefs.jsm           # Shared pref utility (XPCOM JSM)
│   └── skin/classic/              # Icons
├── src/                           # Page-injected content scripts
│   ├── utils/                     # constants, logger, dom-utils, event-manager, debug-helper
│   ├── core/                      # storage-manager, settings, action-handler, video-controller
│   ├── observers/                 # media-observer, mutation-observer
│   ├── site-handlers/             # base, youtube, netflix, facebook, amazon, apple, index
│   ├── ui/                        # shadow-dom (plain DOM fallback), controls, drag-handler
│   ├── content/inject.js          # Main entry point (VideoSpeedExtension class)
│   └── styles/inject.css          # Injected CSS
```

### How it works

1. **overlay.xul** adds a toolbar button + popup panel to the browser chrome
2. **overlay.js** loads `framescript.js` into all tabs via `messageManager.loadFrameScript()`
3. **framescript.js** on `DOMContentLoaded`:
   - Reads prefs via `VSCPrefs.jsm`
   - Injects CSS and ~22 JS scripts into page via `<script src="resource://videospeed/...">` tags
   - Dispatches `VSC_USER_SETTINGS` event to inject settings into page context
   - Bridges messages between page ↔ chrome (save settings, controller tracking)
4. **Page scripts** (`window.VSC.*`) run in page context using standard DOM APIs
5. **Controller UI** uses plain DOM with scoped CSS classes (no Shadow DOM)

### Key changes from Chrome original

| Area | Chrome MV3 | UXP Port |
|---|---|---|
| Extension format | `manifest.json` (MV3) | `install.rdf` + `chrome.manifest` (XUL overlay) |
| Background | Service worker | `overlay.js` loaded via XUL overlay |
| Content injection | `content_scripts` manifest | Frame script + `<script>` tag injection |
| Storage | `chrome.storage.sync` | `nsIPrefBranch` via `VSCPrefs.jsm` |
| Controller UI | Shadow DOM | Plain DOM with scoped `.vsc-*` CSS classes |
| Popup | `chrome.action` popup | `<panel>` with `<iframe>` in overlay |
| Messaging | `chrome.runtime.sendMessage` | Frame message manager (`sendAsyncMessage`) |
| URLs | `chrome.runtime.getURL()` | `resource://videospeed/` |

### Pref keys (`extensions.videospeed.*`)
- `enabled` (bool), `lastSpeed` (char/float), `rememberSpeed` (bool)
- `forceLastSavedSpeed` (bool), `audioBoolean` (bool), `startHidden` (bool)
- `controllerOpacity` (char/float), `controllerButtonSize` (int)
- `logLevel` (int), `displayKeyCode` (int), `blacklist` (char)
- `keyBindings` (char/JSON), `speeds` (char/JSON)

## Status — Session 1 (2026-03-15)

### Completed: Full port (all 7 phases implemented)
- Phase 1: XUL overlay scaffolding (install.rdf, chrome.manifest, overlay.xul)
- Phase 2: Storage backend (VSCPrefs.jsm + defaults/preferences/prefs.js)
- Phase 3: Content injection (framescript.js replaces Chrome injector)
- Phase 4: Shadow DOM → plain DOM fallback (shadow-dom.js, controls.js, drag-handler.js rewritten)
- Phase 5: Toolbar button + popup (overlay.xul + popup.html/js in chrome context)
- Phase 6: Options page (options.html/js in chrome context, uses VSCPrefs)
- Phase 7: Background messaging (overlay.js tracks controllers per tab via frame messages)
- Additional: requestIdleCallback polyfill, chrome.runtime.getURL → resource://, build script

### XPI built: `videospeed-uxp-0.9.1.xpi` (140K)

### Immediate next steps
1. **Test in Pale Moon** — install XPI, open a page with video (YouTube, etc.)
2. Check browser console for errors on load
3. Verify controller overlay appears on video elements
4. Test popup panel (toolbar button click)
5. Test options page
6. Test keyboard shortcuts (S/D for speed, Z/X for seek, V to show/hide)

### Known risks to watch for during testing
- **resource:// access** — if page can't load scripts from `resource://videospeed/`, we may need `contentaccessible=yes` in chrome.manifest
- **Cu.cloneInto** in framescript.js — needed for passing objects from chrome→content; verify it works
- **Popup iframe chrome access** — verify that `chrome://videospeed/content/popup/popup.html` can access `Components`
- **CSS scoping** — plain DOM controller styles may conflict with some sites; test on YouTube, Netflix, etc.
