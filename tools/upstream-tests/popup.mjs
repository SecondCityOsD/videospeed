// Toolbar-popup test: the real chrome/content/popup/popup.xul and popup.js in
// jsdom (as XML; XUL widgets are plain elements here), over VSCPrefs.jsm on
// the simulated pref branch (xpcom.mjs) and a stub browser window. Checks the
// behavior of upstream's src/ui/popup/popup.js: labels from the stored key
// bindings, commands to the selected tab, the power toggle, the settings
// button, and a fresh read on every opening.
//   node tools/upstream-tests/popup.mjs
// Exits non-zero on any failed expectation or popup error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, requireFromRunDir } from './lib.mjs';
import { makePrefs } from './xpcom.mjs';

const { JSDOM } = requireFromRunDir('jsdom');
const POPUP_DIR = path.join(repoRoot, 'chrome/content/popup');
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
}

const prefs = makePrefs();
const dom = new JSDOM(fs.readFileSync(path.join(POPUP_DIR, 'popup.xul'), 'utf8'), {
  url: 'chrome://videospeed/content/popup/popup.xul',
  contentType: 'application/xml',
  runScripts: 'outside-only',
});
const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

// The browser window the popup's panel lives in.
const sent = [];
const opened = [];
let panelHidden = 0;
const mainWindow = {
  VideoSpeedOverlay: { sendToSelectedTab: (message) => sent.push(JSON.parse(JSON.stringify(message))) },
  switchToTabHavingURI: (url, openNew) => opened.push([url, openNew]),
  document: { getElementById: (id) => (id === 'videospeed-panel' ? { hidePopup: () => panelHidden++ } : null) },
};
window.Components = {
  classes: {
    '@mozilla.org/appshell/window-mediator;1': {
      getService: () => ({ getMostRecentWindow: (type) => (type === 'navigator:browser' ? mainWindow : null) }),
    },
  },
  interfaces: { nsIWindowMediator: {} },
  utils: {
    import(url) {
      if (url !== 'chrome://videospeed-modules/content/VSCPrefs.jsm') throw new Error(`unexpected module ${url}`);
      window.VSCPrefs = prefs.VSCPrefs;
    },
    reportError: (e) => errors.push(String(e)),
  },
};
new vm.Script(fs.readFileSync(path.join(POPUP_DIR, 'popup.js'), 'utf8'), { filename: 'popup.js' }).runInContext(
  dom.getInternalVMContext()
);
// popup.js starts on the window's load event, which fires once.
if (doc.readyState === 'complete') {
  window.dispatchEvent(new window.Event('load'));
} else {
  await new Promise((resolve) => window.addEventListener('load', resolve));
}

const $ = (id) => doc.getElementById(id);
const command = (el) => el.dispatchEvent(new window.Event('command'));
const labels = () => ['speed-decrease', 'speed-reset', 'speed-increase'].map((id) => $(id).getAttribute('label'));
const shown = async () => {
  window.postMessage({ type: 'VSC_PANEL_SHOWN' }, '*');
  await tick();
};

expect('without stored bindings: upstream fallbacks -0.1 / 1 / +0.1', labels(), ['-0.1', '1', '+0.1']);
expect('the power button offers to disable', $('disable').getAttribute('tooltiptext'), 'Disable Extension');

command(doc.querySelectorAll('.preset-btn')[4]);
command($('speed-increase'));
command($('speed-reset'));
expect('presets, steps and reset go to the selected tab', sent.splice(0), [
  { type: 'VSC_SET_SPEED', payload: { speed: 1.5 } },
  { type: 'VSC_ADJUST_SPEED', payload: { delta: 0.1 } },
  { type: 'VSC_SET_SPEED', payload: { speed: 1 } },
]);

command($('disable'));
expect('power toggles the pref and asks for a reload', [prefs.VSCPrefs.getAll().enabled, $('status').hidden, $('status').getAttribute('value'), $('disable').getAttribute('tooltiptext')], [false, false, 'Disabled. Reload page.', 'Enable Extension']);

// Elsewhere (the options page, another window) while the panel is closed.
const bindings = prefs.VSCPrefs.getAll().keyBindings;
expect('(fixture) no bindings stored yet', bindings, []);
prefs.VSCPrefs.set('keyBindings', [
  { action: 'slower', code: 'KeyS', value: 0.25, predefined: true },
  { action: 'faster', code: 'KeyD', value: 0.5, predefined: true },
  { action: 'fast', code: 'KeyG', value: 1.8, predefined: true },
]);
prefs.VSCPrefs.set('enabled', true);
await shown();
expect('reopening re-reads the step and preferred-speed labels', labels(), ['-0.25', '1.8', '+0.5']);
expect('reopening re-reads the enabled state and clears the status line', [$('disable').getAttribute('tooltiptext'), $('disable').hasAttribute('disabled-state'), $('status').hidden, $('status').getAttribute('value')], ['Disable Extension', false, true, '']);
command($('speed-decrease'));
expect('steps use the re-read values', sent.splice(0), [{ type: 'VSC_ADJUST_SPEED', payload: { delta: -0.25 } }]);

command($('config'));
expect('settings opens (or focuses) the options tab and closes the panel', [opened, panelHidden], [[['chrome://videospeed/content/options/options.html', true]], 1]);
expect('no popup errors', errors, []);
window.close();

console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall expectations passed');
process.exitCode = failures ? 1 : 0;
