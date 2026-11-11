# Video Speed Controller for Pale Moon and Basilisk

**Video Speed Controller** gives you fine-grained control over any HTML5 video
or audio element, on any site. This is the UXP port of
[igrigorik/videospeed](https://github.com/igrigorik/videospeed) **0.11.1** for
Pale Moon (28–33) and Basilisk (52–56): the same features and the same
behavior as the Chrome extension, built as a classic XUL extension.

## The science of accelerated playback

**TL;DR** — faster playback translates to better engagement and retention.

The average adult reads at [250–300 words per minute][wpm-study] (wpm). Speech
averages ~150 wpm; slide presentations are often closer to 100 wpm. Given the
choice, most viewers [speed up playback to ~1.3–1.5x][ms-study] to close the
gap. Accelerated viewing [keeps attention longer][byu-study], and with practice
many settle at 2x or above and find it [uncomfortable to return to 1x][mit-study].

HTML5 media elements expose a native playback-rate API, but most players hide or
limit it. Speed changes should be effortless and frequent: we don't read at a
fixed pace, and we shouldn't watch at one either.

[wpm-study]: http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf
[ms-study]: http://research.microsoft.com/en-us/um/redmond/groups/coet/compression/chi99/paper.pdf
[byu-study]: http://www.enounce.com/docs/BYUPaper020319.pdf
[mit-study]: http://alumni.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech

## Install

1. Download `videospeed-uxp-0.11.1.xpi` from the
   [Releases page](https://github.com/SecondCityOsD/videospeed/releases).
2. Open the Add-ons Manager (**Ctrl+Shift+A**), click the gear menu and choose
   **Install Add-on From File…**, then pick the downloaded file. Dropping the
   file onto the browser window works too.
3. Restart the browser when asked. The Video Speed Controller button is added
   to the navigation toolbar.

Updating from an older version keeps your settings: shortcuts recorded in the
old format and the old "disabled sites" list are converted on the first start.

## Features

- **Universal** — works on any site with HTML5 media: YouTube, Netflix,
  Coursera, podcasts, local files (no extra permission needed) and private
  windows.
- **Video and audio** — controls both `<video>` and `<audio>` elements.
- **Fine-grained speed** — 0.07x to 16x in configurable increments.
- **Per-site speed rules** — a default speed for specific sites (for example,
  always 2x on lecture sites).
- **Per-site disable** — no controller at all on sites where you don't want it.
- **Remember speed** — optionally keep your last speed across pages and
  sessions.
- **Speed fightback** — re-applies your chosen speed when a site's player
  resets it, while still respecting speeds you pick in the player's own menu.
- **Draggable overlay** — drag the speed badge to put the controller anywhere.
- **Fully customizable shortcuts** — remap every key, add Ctrl/Shift/Alt
  combinations, create several preferred-speed shortcuts.
- **Custom controller CSS** — style or reposition the overlay with your own
  rules.

## Default keyboard shortcuts

| Key | Action |
| --- | --- |
| **S** | Decrease speed by 0.1 |
| **D** | Increase speed by 0.1 |
| **R** | Reset to 1.0x — press again to return to the previous speed |
| **Z** | Rewind 10 seconds |
| **X** | Advance 10 seconds |
| **G** | Toggle between the current and the preferred speed (1.8x) |
| **V** | Show/hide the controller |
| **M** | Set a marker at the current position |
| **J** | Jump back to the marker |

Hovering over the controller reveals buttons to rewind, slow down, speed up and
advance; the mouse wheel over it changes the speed, and double-clicking the
speed badge resets it.

## Toolbar button

The toolbar button opens a small panel with speed presets (0.5x–2.5x), step
buttons, your preferred speed, a power button that turns the extension on or
off (reload open pages afterwards) and a shortcut to the settings. The icon
shows its disabled version while the extension is off.

## Settings

Open them from the panel's gear button, or with the add-on's **Options**
button in the Add-ons Manager. The page opens in a tab:

- **Settings** — shortcuts (press a key in a shortcut field to record it,
  Backspace to clear, Escape to unbind; **Add New** for more) and preferences:
  audio support, remember speed, hide the controller by default, exclusive
  shortcuts.
- **Advanced** — controller opacity and button size, log level, **site rules**
  (a site name such as `example.com` or a `/regex/`, with *Disable* or a
  default *Speed*; the first matching rule wins) and the **controller CSS**
  editor, which checks your CSS as you type.
- **FAQ** — answers to common questions.

The menu next to **Save** has **Import**, **Export** (a JSON file) and **Reset**
(back to the defaults). Reload open pages after changing settings for all of
them to take effect.

## How it differs from the Chrome version

Only where the platform requires it:

- Settings are stored as browser preferences (`extensions.videospeed.*` in
  `about:config`) and are not synced between computers.
- Site rules are evaluated by the browser side of the extension: on a disabled
  site no extension code runs at all, and web pages never see your rule list.
  The default rules (imgur, Microsoft Teams and Google Meet disabled) apply from
  the first run; the Chrome version applies them only after its settings page
  has been saved once.
- Google Meet and Hangouts are never touched, as in the Chrome version.
- The controller is a plain page element rather than a Shadow DOM, so custom
  CSS can reach its inner parts too. `@import` rules in custom CSS are ignored,
  as in Chrome.
- Controller button sizes are whole pixels.

## Building from source

```sh
./build.sh                 # Linux / macOS: writes videospeed-uxp-<version>.xpi here
./build.sh <dir>           # ...or into <dir>
```

```powershell
.\build-xpi.ps1            # Windows
.\build-xpi.ps1 -OutDir <dir>
```

Both scripts package `install.rdf`, `chrome.manifest`, `LICENSE` and the
`chrome/`, `defaults/` and `src/` trees, and refuse to build when the page-script
list in `chrome/content/overlay.js` doesn't match the files under `src/`.

## Development

Most of the code is generated from upstream rather than edited by hand:
`tools/port-upstream.mjs` holds every upstream file the fork ships, with each
Pale Moon adaptation as an explicit edit, and expects an upstream 0.11.1
checkout next to this repository (`../videospeed-0.11.1`).

```sh
node tools/port-upstream.mjs           # check: generated files match upstream + edits
node tools/port-upstream.mjs --write   # regenerate them
```

Tests live in `tools/upstream-tests/` (see the header of `sync.mjs`): upstream's
own test suite run against the fork, plus end-to-end checks of the page
scripts, the browser-side bridge, the settings page and the toolbar panel.
`tools/diff-upstream.mjs` runs the speed and visibility engines side by side
with upstream's on randomized input. Code under `src/` and the settings page
must stay within Pale Moon's JavaScript support: no optional chaining (`?.`),
nullish operators (`??`, `??=`), static class fields or `catch {}`.

## License

MIT License — Copyright (c) 2014 Ilya Grigorik. Pale Moon / Basilisk port by
SecondCityOsD.
