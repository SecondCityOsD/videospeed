# Video Speed Controller for UXP — Developer Guide

This document explains the source code structure and how the extension works, for anyone who wants to fork, modify, or maintain it.

## Overview

This is a **XUL overlay extension** for Pale Moon / UXP browsers. It injects speed controls into web pages with HTML5 video or audio elements. The extension was ported from the Chrome MV3 version (v0.9.1) of [Video Speed Controller](https://github.com/igrigorik/videospeed).

Unlike modern WebExtensions, XUL overlay extensions hook directly into the browser chrome via `overlay.xul`, have full XPCOM access, and use frame scripts to interact with web content.

## How to build

```
./build.sh
```

This produces `videospeed-uxp-0.9.1.xpi` — a standard ZIP file you can install in Pale Moon via File > Open File.

## File structure

### Root files

| File | Purpose |
|---|---|
| `install.rdf` | Extension metadata: ID, name, version, target app compatibility (Pale Moon 28+, Basilisk 39+) |
| `chrome.manifest` | Registers chrome content, skin, overlay, and resource paths with the browser |
| `build.sh` | Shell script that zips everything into an `.xpi` |
| `defaults/preferences/prefs.js` | Default preference values (loaded on first install). All prefs live under `extensions.videospeed.*` in `about:config` |

### chrome/ — Browser chrome (privileged context)

Everything in `chrome/` runs with full browser privileges (XPCOM access, Components, etc.).

#### chrome/content/overlay.xul

The entry point. This XUL overlay is applied to `browser.xul` (the main browser window) and adds:
- A **toolbar button** (`videospeed-button`) to the navigation bar
- A **popup panel** (`videospeed-panel`) containing an iframe that loads `popup.xul`
- A `<script>` tag that loads `overlay.js`

#### chrome/content/overlay.js

The "background script" equivalent. Runs once per browser window. Responsibilities:
- Loads `framescript.js` into all tabs via `messageManager.loadFrameScript()`
- Tracks which tabs have active video controllers (using a WeakMap keyed by browser element)
- Updates the toolbar button icon (active vs. disabled) based on the selected tab
- Handles the popup panel open/close
- On first install, inserts the toolbar button into the nav-bar

#### chrome/content/framescript.js

The bridge between browser chrome and web page content. Loaded into every tab's content process. On `DOMContentLoaded`:
1. Reads user preferences via `VSCPrefs.jsm`
2. Checks the blacklist — bails out if the current site is blacklisted
3. Injects CSS (`inject.css`) and ~22 JavaScript files into the page via `<script src="resource://videospeed/...">` tags
4. Dispatches a `VSC_USER_SETTINGS` CustomEvent to pass settings from chrome context into page context
5. Bridges messages between the page and chrome (e.g., saving settings, controller lifecycle)

#### chrome/content/popup/

The toolbar button popup panel UI (loaded in an iframe inside `videospeed-panel`).

| File | Purpose |
|---|---|
| `popup.xul` | XUL layout: speed control buttons (-0.1 / reset / +0.1), 4×2 preset grid, footer with power and settings icons |
| `popup.css` | Material Design styling (white background, rounded buttons, purple accent, SVG icons) |
| `popup.js` | Reads keybinding settings to configure button labels/values. Sends `VSC:AdjustSpeed` and `VSC:SetSpeed` messages to the active tab's content script. Handles enable/disable toggle and settings button |

#### chrome/content/options/

The extension settings page (opened as a tab via `chrome://videospeed/content/options/options.xul`).

| File | Purpose |
|---|---|
| `options.xul` | XUL layout with scrollable container. Sections: Shortcuts (9 predefined keybinding rows + "Add New"), Other (4 core checkboxes), action buttons (Save / Show advanced features / Restore defaults), Advanced settings (hidden by default: enable, opacity, button size, log level, blacklist), Help & Support, FAQ |
| `options.css` | Styling including purple accent Save button, indent for descriptions |
| `options.js` | Loads/saves all settings via `VSCPrefs.jsm`. Handles dynamic shortcut row creation, key recording, input validation, advanced features toggle. Uses `document.createElementNS()` with XUL namespace for dynamic elements |

#### chrome/modules/VSCPrefs.jsm

A JavaScript module (JSM) that provides a shared preferences API. Imported by popup, options, framescript, and overlay. Key exports:
- `VSCPrefs.get(key)` / `VSCPrefs.set(key, value)` — read/write individual prefs
- `VSCPrefs.getAll()` — returns all settings as an object (parses JSON for complex prefs like `keyBindings`)
- `VSCPrefs.setMultiple(obj)` — bulk save
- `VSCPrefs.branch` — direct access to the `nsIPrefBranch` for `extensions.videospeed.*`

#### chrome/skin/classic/

| File | Purpose |
|---|---|
| `browser.css` | Toolbar button icon styling (normal and disabled states, small icon mode) |
| `icon*.png` | Toolbar and extension icons at various sizes (16, 19, 38, 48, 128) plus disabled variants |

### src/ — Page-injected scripts (unprivileged context)

Everything in `src/` runs in the **web page context** with no special privileges. These files are injected by `framescript.js` via `<script>` tags using `resource://videospeed/` URLs.

#### src/content/inject.js

The main entry point for page-side code. Defines the `VideoSpeedExtension` class which:
1. Listens for the `VSC_USER_SETTINGS` event to receive settings from the chrome context
2. Initializes the media observer, mutation observer, and site handlers
3. Manages the extension lifecycle (init, cleanup)

#### src/core/

| File | Purpose |
|---|---|
| `video-controller.js` | The core class. Attaches to a `<video>` or `<audio>` element, creates the speed overlay UI, handles speed changes, and manages the controller lifecycle |
| `action-handler.js` | Maps keyboard shortcuts to actions (slower, faster, rewind, advance, reset, preferred speed, pause, mute, volume, markers) |
| `settings.js` | Client-side settings manager. Receives settings from chrome context and provides them to other modules |
| `storage-manager.js` | Handles saving settings back to chrome context via CustomEvents (bridges page → framescript → VSCPrefs) |

#### src/observers/

| File | Purpose |
|---|---|
| `media-observer.js` | Watches for new `<video>` and `<audio>` elements appearing in the DOM and attaches VideoController instances to them |
| `mutation-observer.js` | Uses MutationObserver to detect dynamically added media elements (e.g., SPAs that load videos after initial page load) |

#### src/site-handlers/

Site-specific logic for video players that need special treatment.

| File | Purpose |
|---|---|
| `base-handler.js` | Base class with default behavior |
| `youtube-handler.js` | YouTube-specific adjustments |
| `netflix-handler.js` | Netflix player integration |
| `facebook-handler.js` | Facebook video handling |
| `amazon-handler.js` | Amazon Prime Video |
| `apple-handler.js` | Apple TV+ |
| `index.js` | Auto-detects the current site and returns the appropriate handler |
| `scripts/netflix.js` | Additional Netflix-specific script |

#### src/ui/

| File | Purpose |
|---|---|
| `controls.js` | Creates the on-page speed controller overlay (the draggable "1.00x" badge on videos). Uses plain DOM with scoped `.vsc-*` CSS classes |
| `shadow-dom.js` | DOM isolation wrapper. The Chrome version uses Shadow DOM; this UXP port falls back to plain DOM with CSS scoping |
| `drag-handler.js` | Makes the controller overlay draggable |

#### src/styles/inject.css

CSS for the on-page controller overlay. Uses `.vsc-*` class prefix to avoid conflicts with page styles.

#### src/utils/

| File | Purpose |
|---|---|
| `constants.js` | Shared constants (event names, CSS class names, default values) |
| `logger.js` | Logging utility with configurable verbosity levels |
| `dom-utils.js` | DOM helper functions |
| `event-manager.js` | Event listener management (add/remove/cleanup) |
| `debug-helper.js` | Debug utilities for development |

## Data flow

```
User clicks toolbar button
  → overlay.xul panel opens
    → popup.xul loads in iframe
      → popup.js reads prefs via VSCPrefs.jsm
      → User clicks a speed button
        → popup.js sends message via messageManager
          → framescript.js receives and dispatches CustomEvent to page
            → inject.js / video-controller.js applies the speed change
```

```
Page loads with a <video> element
  → framescript.js fires on DOMContentLoaded
    → Injects src/ scripts into the page
    → Dispatches VSC_USER_SETTINGS event with prefs
      → inject.js initializes VideoSpeedExtension
        → media-observer.js detects the <video>
          → video-controller.js attaches and creates overlay UI
```

## Preferences

All preferences are stored under `extensions.videospeed.*` in `about:config`. Key prefs:

| Pref | Type | Description |
|---|---|---|
| `enabled` | bool | Master enable/disable |
| `lastSpeed` | string (float) | Last used speed |
| `rememberSpeed` | bool | Persist speed across page loads |
| `forceLastSavedSpeed` | bool | Override site-set speeds |
| `audioBoolean` | bool | Also control audio elements |
| `startHidden` | bool | Hide controller overlay by default |
| `controllerOpacity` | string (float) | Overlay opacity (0.0–1.0) |
| `controllerButtonSize` | int | Overlay font size in px |
| `logLevel` | int | 1=None, 2=Error, 3=Warning, 4=Info, 5=Debug, 6=Verbose |
| `keyBindings` | string (JSON) | Array of {action, key, value, force, predefined} |
| `blacklist` | string | Newline-separated site patterns (regex supported) |

## Key differences from the Chrome version

1. **No `chrome.*` APIs** — All browser interaction goes through XPCOM (`nsIPrefBranch`, `nsIWindowMediator`, etc.) and the frame message manager
2. **No Shadow DOM** — The controller overlay uses plain DOM with `.vsc-*` scoped CSS classes instead
3. **No service worker** — `overlay.js` loaded via XUL overlay replaces the Chrome background service worker
4. **No `content_scripts` manifest** — `framescript.js` manually injects scripts using `<script>` tags with `resource://` URLs
5. **XUL UI** — Popup and options pages use native XUL elements (button, menulist, checkbox, textbox, groupbox) styled with CSS to match Chrome's Material Design look
