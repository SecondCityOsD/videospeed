# Changelog

## 0.11.1

Now based on upstream [Video Speed Controller 0.11.1](https://github.com/igrigorik/videospeed).

#### Fixes / changes

- New speed engine: keeps speeds picked in a player's own menu, re-applies yours when a site resets it (up to 4 times per conflict)
- New settings page: site rules (per-site speed or disable), exclusive shortcuts, controller CSS editor, import/export/reset, FAQ
- Shortcuts are recorded by physical key, with Ctrl/Alt/Shift; existing shortcuts and disabled-sites list are converted
- Remembered speed is saved only for your own changes and no longer changes other open tabs
- `R` resets to 1.0x, press again to go back; `V` flips what is showing
- Drag the controller by its speed badge; double-click the badge to reset
- Controller stays visible on pages that restyle or rewrite themselves (e.g. VORAPIS V3)
- Toolbar panel refreshes on every opening and reaches players in frames
- Default disabled sites: imgur, Microsoft Teams, Google Meet (no longer Instagram, x.com)
- Automatic updates through the Add-ons Manager — versions before 0.11.1 can't check, so install this one manually once; settings are kept
- Pale Moon 28–35, Basilisk 52–56

#### Closed as fixed (upstream):

- [YouTube click-and-hold / Space hold-for-2x](https://github.com/igrigorik/videospeed/issues/1554)
- [Arrow-key seeking and progress-bar clicks reset the speed](https://github.com/igrigorik/videospeed/issues/1546)
- [Speed forced at page load / native speed menu choices not kept](https://github.com/igrigorik/videospeed/issues/1521)
- [Remembered speed bleeds into other open tabs](https://github.com/igrigorik/videospeed/issues/1559)
- [Remembered speed lost when seeking resets playback to 1x](https://github.com/igrigorik/videospeed/issues/1600)
- [Granular speeds lost on players that clamp speed changes](https://github.com/igrigorik/videospeed/issues/1606)
- [`V` show/hide fights the player's auto-hiding controls](https://github.com/igrigorik/videospeed/issues/1584)
- [Controller centered or offset in flex/grid layouts](https://github.com/igrigorik/videospeed/issues/1557)
- [Controller missing in YouTube embeds](https://github.com/igrigorik/videospeed/issues/1501)
- [Ctrl+wheel / pinch zoom over the controller changes speed](https://github.com/igrigorik/videospeed/issues/1539)
- [Bilibili scroll-to-volume broken](https://github.com/igrigorik/videospeed/issues/1598)

#### Commits history since last version

- https://github.com/SecondCityOsD/videospeed/compare/videospeed0.9.1...videospeed0.11.1
