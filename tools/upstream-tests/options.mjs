// Options-page test: upstream's options page as the fork ships it —
// chrome/content/options/options.html, its scripts run in tag order
// (resource://videospeed/* from src/, the rest from chrome/content/options/)
// as successive classic scripts in one jsdom window — over the real
// chrome-storage.js shim and VSCPrefs.jsm on the simulated pref branch
// (xpcom.mjs). Covers restore, save, shortcut recording, site rules, CSS
// validation, reset, export/import, live storage changes, the speed-value
// input filter, the shim's chrome.storage semantics and the install wiring.
//   node tools/upstream-tests/options.mjs
// Exits non-zero on any failed expectation or page error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, requireFromRunDir } from './lib.mjs';
import { makePrefs } from './xpcom.mjs';

const { JSDOM, VirtualConsole } = requireFromRunDir('jsdom');
const OPTIONS_DIR = path.join(repoRoot, 'chrome/content/options');
const OPTIONS_URL = 'chrome://videospeed/content/options/options.html';
const html = fs.readFileSync(path.join(OPTIONS_DIR, 'options.html'), 'utf8');

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
}

/** options.html's <script src> list, resolved to repository files. */
function optionsScripts() {
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) =>
    m[1].startsWith('resource://videospeed/')
      ? path.join(repoRoot, 'src', m[1].slice('resource://videospeed/'.length))
      : path.join(OPTIONS_DIR, m[1])
  );
}

/**
 * Open the options page over a fresh pref branch holding `userPrefs`.
 * `beforeInput: false` removes the beforeinput event, as Goanna builds lack
 * it, so options.js takes its keypress/paste fallback. Returns once
 * DOMContentLoaded's restore_options() has rendered.
 */
async function openOptions(userPrefs = {}, { beforeInput = true } = {}) {
  const prefs = makePrefs(userPrefs);
  const errors = [];
  const warnings = [];
  // jsdom's CSS parser is not Goanna's: its complaint about the deliberately
  // broken CSS below is not a page error.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (!/Could not parse CSS stylesheet/.test(e.message)) errors.push(`jsdom: ${e.message}`);
  });
  const dom = new JSDOM(html, { url: OPTIONS_URL, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  if (!beforeInput) {
    delete window.HTMLElement.prototype.onbeforeinput;
  }
  window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
  window.console.error = (...a) => errors.push(`console.error: ${a.map(String).join(' ')}`);
  window.console.warn = (...a) => warnings.push(a.map(String).join(' '));
  window.console.log = window.console.info = window.console.debug = () => {};
  // A chrome-privileged document's Components: Cu.import(url, scope).
  window.Components = {
    utils: {
      import(url, scope) {
        if (url !== 'chrome://videospeed-modules/content/VSCPrefs.jsm') {
          throw new Error(`unexpected module ${url}`);
        }
        scope.VSCPrefs = prefs.VSCPrefs;
        return scope;
      },
    },
  };
  const before = new Set(Object.getOwnPropertyNames(window));
  const ctx = dom.getInternalVMContext();
  for (const file of optionsScripts()) {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(repoRoot, file) }).runInContext(ctx);
    } catch (e) {
      errors.push(`${path.relative(repoRoot, file)}: ${e.name}: ${e.message}`);
    }
  }
  const globals = Object.getOwnPropertyNames(window).filter((k) => !before.has(k));
  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve));
  } else {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  await tick(50);

  const doc = window.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const click = async (el) => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  };
  const key = (target, init) => {
    const e = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  const setValue = (el, v) => {
    el.value = v;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const row = (action) => doc.getElementById(action);
  const rules = () =>
    $$('#site-rules-container .row.site-rule').map((r) => [
      r.querySelector('.rulePattern').value,
      r.querySelector('.ruleDisabled').checked,
      r.querySelector('.ruleSpeed').value,
    ]);
  const status = () => $('#status').textContent;
  return { window, doc, prefs, errors, warnings, globals, $, $$, click, key, setValue, row, rules, status };
}

const DEFAULTS = await (async () => {
  const page = await openOptions();
  const d = JSON.parse(JSON.stringify(page.window.VSC.Constants.DEFAULT_SETTINGS));
  page.window.close();
  return d;
})();

// --- 1. Fresh open ------------------------------------------------------------
{
  const p = await openOptions();
  const own = p.globals.filter((g) => g !== 'Components');
  expect('scripts load and only VSC + chrome become window globals', own.sort(), ['VSC', 'chrome']);
  expect('opening the page writes nothing (fresh storage stays empty)', [...p.prefs.user.keys()], []);
  expect('default shortcuts render as locked predefined rows', p.$$('#shortcuts-container .row.customs').map((r) => [r.id, r.querySelector('.customDo').disabled]), DEFAULTS.keyBindings.map((b) => [b.action, true]));
  expect('shortcut labels come from displayKey', p.$$('.customKey').slice(0, 3).map((i) => i.value), ['S', 'D', 'Z']);
  expect('default site rules render', p.rules(), [['imgur.com', true, ''], ['teams.microsoft.com', true, ''], ['meet.google.com', true, '']]);
  expect('preferences show the defaults', ['rememberSpeed', 'exclusiveKeys', 'audioBoolean', 'startHidden'].map((id) => p.$(`#${id}`).checked).concat(['controllerOpacity', 'controllerButtonSize', 'logLevel', 'controllerCSS'].map((id) => p.$(`#${id}`).value)), [false, false, true, false, '0.3', '14', '3', '']);
  expect('no page errors on open', p.errors, []);

  p.window.dispatchEvent(new p.window.Event('unload'));
  expect('unload removes the pref observer', p.prefs.observers.length, 0);
  p.window.close();
}

// --- 2. Save round trip ------------------------------------------------------------
{
  const p = await openOptions();
  p.$('#rememberSpeed').checked = true;
  p.$('#exclusiveKeys').checked = true;
  p.setValue(p.$('#controllerOpacity'), '0');
  p.setValue(p.$('#controllerButtonSize'), '20');
  await p.click(p.$('#add-site-rule'));
  const added = p.$$('#site-rules-container .row.site-rule').pop();
  p.setValue(added.querySelector('.rulePattern'), '  lectures.example.org ');
  p.setValue(added.querySelector('.ruleSpeed'), '2');
  await p.click(p.$('#save'));
  const s = p.prefs.VSCPrefs.getAll();
  expect('save writes the edited preferences', [s.rememberSpeed, s.exclusiveKeys, s.controllerOpacity, s.controllerButtonSize], [true, true, 0, 20]);
  expect('an opacity of 0 is kept (upstream reads it through Number())', p.prefs.user.get('controllerOpacity'), '0');
  expect('a new site rule is saved trimmed, enabled, with its speed', s.siteRules[3], { pattern: 'lectures.example.org', enabled: true, speed: 2 });
  expect('values equal to their defaults stay unset', ['audioBoolean', 'startHidden', 'customCSS', 'logLevel'].map((k) => p.prefs.user.has(k)), [false, false, false, false]);
  expect('save stores every shortcut with its event.code', s.keyBindings.map((b) => [b.action, b.code, b.predefined]), DEFAULTS.keyBindings.map((b) => [b.action, b.code, true]));
  expect('the save button shows the saved state', p.$('#save').classList.contains('saved'), true);

  const again = await openOptions(Object.fromEntries(p.prefs.user));
  expect('a reopened page shows the saved values', [again.$('#rememberSpeed').checked, again.$('#exclusiveKeys').checked, again.$('#controllerOpacity').value, again.$('#controllerButtonSize').value, again.rules()[3]], [true, true, '0', '20', ['lectures.example.org', false, '2']]);
  expect('no page errors in the save round trip', [...p.errors, ...again.errors], []);
  p.window.close();
  again.window.close();
}

// --- 3. Shortcut recording -------------------------------------------------------
{
  const p = await openOptions();
  const slower = p.row('slower').querySelector('.customKey');
  const e = p.key(slower, { code: 'KeyQ', key: 'Q', keyCode: 81, ctrlKey: true, shiftKey: true });
  expect('a chord records as "Ctrl + Shift + Q" and is swallowed', [slower.value, e.defaultPrevented], ['Ctrl + Shift + Q', true]);
  p.key(slower, { code: 'Tab', key: 'Tab', keyCode: 9 });
  expect('blacklisted codes (Tab) are not recorded', slower.value, 'Ctrl + Shift + Q');
  const faster = p.row('faster').querySelector('.customKey');
  p.key(faster, { code: 'KeyA', key: 'a', keyCode: 65, ctrlKey: true, altKey: true });
  expect('Ctrl+Alt warns about AltGr', p.row('faster').querySelector('.shortcut-warning').textContent, 'This combination may conflict with AltGr input on some keyboard layouts.');
  const rewind = p.row('rewind').querySelector('.customKey');
  p.key(rewind, { code: 'Escape', key: 'Escape', keyCode: 27 });
  const advance = p.row('advance').querySelector('.customKey');
  p.key(advance, { code: 'Backspace', key: 'Backspace', keyCode: 8 });
  expect('Escape unbinds ("null"), Backspace clears', [rewind.value, advance.value], ['null', '']);

  await p.click(p.$('#add'));
  const custom = p.$$('#shortcuts-container .row.customs').pop();
  const action = custom.querySelector('.customDo');
  action.value = 'pause';
  action.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  p.key(custom.querySelector('.customKey'), { code: 'Numpad5', key: '5', keyCode: 101 });
  expect('numpad keys keep their "Num" label; value-less actions hide the value', [custom.querySelector('.customKey').value, custom.querySelector('.customValue').style.display], ['Num 5', 'none']);
  await p.click(p.$('#save'));
  const kb = p.prefs.VSCPrefs.getAll().keyBindings;
  expect('the recorded chord is stored in the v2 format', kb.find((b) => b.action === 'slower'), { action: 'slower', code: 'KeyQ', key: 81, keyCode: 81, displayKey: 'q', value: 0.1, predefined: true, modifiers: { ctrl: true, alt: false, shift: true, meta: false } });
  expect('an unbound key stores code null', kb.find((b) => b.action === 'rewind').code, null);
  expect('the custom shortcut is stored', kb.find((b) => !b.predefined), { action: 'pause', code: 'Numpad5', key: 101, keyCode: 101, displayKey: 'Num 5', value: 0, predefined: false });
  expect('no page errors while recording', p.errors, []);
  p.window.close();
}

// --- 4. Validation -----------------------------------------------------------------
{
  const p = await openOptions();
  await p.click(p.$('#add-site-rule'));
  const rule = p.$$('#site-rules-container .row.site-rule').pop();
  p.setValue(rule.querySelector('.rulePattern'), '/(/');
  await p.click(p.$('#save'));
  expect('an invalid regex blocks saving', [p.status(), p.prefs.user.size], ['Error: Invalid site rule regex: "/(/". Unable to save.', 0]);
  p.setValue(rule.querySelector('.rulePattern'), '/\\.edu$/i');
  p.setValue(rule.querySelector('.ruleSpeed'), '20');
  await p.click(p.$('#save'));
  expect('an out-of-range rule speed blocks saving', [p.status(), p.prefs.user.size], ['Error: Speed for "/\\.edu$/i" must be between 0.07 and 16.', 0]);
  rule.querySelector('.removeParent').click();
  await tick();

  const css = p.$('#controllerCSS');
  p.setValue(css, `/* ${'x'.repeat(8200)} */`);
  await p.click(p.$('#save'));
  expect('custom CSS over 8 KB blocks saving', [p.status().startsWith('Error: Controller CSS exceeds 8KB'), p.prefs.user.size], [true, 0]);
  p.setValue(css, 'not css at all');
  await tick(350);
  expect('text without rules warns (debounced live validation)', p.$('#cssValidation').textContent, 'No CSS rules parsed — check for syntax errors.');
  // jsdom never fetches @import, so watch what reaches the probe <style>.
  const parsed = [];
  const textContent = Object.getOwnPropertyDescriptor(p.window.Node.prototype, 'textContent');
  Object.defineProperty(p.window.HTMLStyleElement.prototype, 'textContent', {
    configurable: true,
    get: textContent.get,
    set(v) {
      parsed.push(v);
      textContent.set.call(this, v);
    },
  });
  const sheetsBefore = p.doc.querySelectorAll('style').length;
  p.setValue(css, '@import url(https://example.invalid/x.css);\nvsc-controller { top: 3px; }');
  await tick(350);
  delete p.window.HTMLStyleElement.prototype.textContent;
  expect('@import is dropped before parsing, as by replaceSync()', [parsed, p.$('#cssValidation').textContent, p.doc.querySelectorAll('style').length - sheetsBefore], [['\nvsc-controller { top: 3px; }'], '', 0]);
  expect('highlighter escapes markup', (p.setValue(css, '<b>{}</b>'), p.$('#cssHighlight').querySelector('b')), null);
  p.setValue(css, '@import url(https://example.invalid/x.css);\nvsc-controller { top: 3px; }');
  await p.click(p.$('#save'));
  expect('custom CSS is saved as typed', p.prefs.VSCPrefs.getAll().customCSS, '@import url(https://example.invalid/x.css);\nvsc-controller { top: 3px; }');
  expect('no page errors in validation', p.errors, []);
  p.window.close();
}

// --- 5. Reset to defaults -----------------------------------------------------------
{
  const p = await openOptions({
    enabled: false,
    rememberSpeed: true,
    customCSS: 'vsc-controller{}',
    siteRules: JSON.stringify([{ pattern: 'a.example', enabled: true, speed: 3 }]),
    keyBindings: JSON.stringify([{ action: 'pause', code: 'KeyP', key: 80, keyCode: 80, displayKey: 'p', value: 0, predefined: false }]),
    speeds: '{}',
    lastSpeed: '2.5',
  });
  expect('stored rules and shortcuts render', [p.rules(), p.$$('.customKey').map((i) => i.value)], [[['a.example', false, '3']], ['P']]);
  await p.click(p.$('#restore'));
  await tick(50);
  const s = p.prefs.VSCPrefs.getAll();
  expect('reset restores every default', [s.enabled, s.rememberSpeed, s.customCSS, s.siteRules, s.keyBindings.length, s.schemaVersion], [true, false, '', DEFAULTS.siteRules, DEFAULTS.keyBindings.length, 2]);
  expect('reset clears keys outside the schema too (chrome.storage clear)', p.prefs.user.has('speeds'), false);
  expect('reset re-renders the page', [p.rules().length, p.$$('#shortcuts-container .row.customs').length, p.status()], [3, DEFAULTS.keyBindings.length, 'Default options restored']);
  expect('no page errors in reset', p.errors, []);
  p.window.close();
}

// --- 6. Export and import -------------------------------------------------------------
{
  const p = await openOptions({ rememberSpeed: false, lastSpeed: '1.7' });
  let blob = null;
  let download = null;
  p.window.URL.createObjectURL = (b) => ((blob = b), 'blob:vsc-test');
  p.window.URL.revokeObjectURL = () => {};
  p.window.HTMLAnchorElement.prototype.click = function () {
    download = [this.getAttribute('href'), this.download];
  };
  await p.click(p.$('#export'));
  const exported = JSON.parse(await new Promise((resolve) => {
    const reader = new p.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  }));
  expect('export downloads videospeed-settings.json', download, ['blob:vsc-test', 'videospeed-settings.json']);
  expect('export carries the loaded settings (lastSpeed null while rememberSpeed is off)', [exported.lastSpeed, exported.keyBindings.length, exported.siteRules.length, exported.siteDefaultSpeed], [null, DEFAULTS.keyBindings.length, 3, null]);

  const importJSON = async (text, { withoutBlobText = false } = {}) => {
    const input = p.$('#importFile');
    const file = new p.window.File([text], 'settings.json', { type: 'application/json' });
    if (withoutBlobText) {
      Object.defineProperty(file, 'text', { value: undefined });
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    await tick(80);
  };
  await importJSON('{ not json');
  expect('invalid JSON is rejected', [p.status(), p.prefs.user.get('lastSpeed')], ['Import failed: File is not valid JSON', '1.7']);
  await importJSON('{"rememberSpeed": true}');
  expect('a file without keyBindings is rejected', p.status(), 'Import failed: File does not look like a Video Speed Controller settings file');
  expect('each rejected file is logged', p.errors.splice(0).map((e) => e.split(': Error: ')[1]), ['File is not valid JSON', 'File does not look like a Video Speed Controller settings file']);

  const file = { ...exported, rememberSpeed: true, enabled: false, unknownKey: 1, siteRules: [{ pattern: 'b.example', enabled: true, speed: 1.5 }] };
  await importJSON(JSON.stringify(file), { withoutBlobText: true });
  const s = p.prefs.VSCPrefs.getAll();
  expect('import replaces storage (FileReader path)', [s.rememberSpeed, s.enabled, s.siteRules, p.status()], [true, false, file.siteRules, 'Settings imported successfully']);
  expect('an imported null lastSpeed stays null, as chrome.storage keeps it', [p.prefs.user.get('lastSpeed'), s.lastSpeed], ['null', null]);
  expect('keys without a pref are not stored', ['unknownKey', 'siteDefaultSpeed', 'defaultLogLevel'].map((k) => p.prefs.user.has(k)), [false, false, false]);
  expect('the page shows the imported settings', [p.$('#rememberSpeed').checked, p.rules()], [true, [['b.example', false, '1.5']]]);
  await importJSON(JSON.stringify({ ...file, rememberSpeed: false }));
  expect('import works with Blob.text() too', p.prefs.VSCPrefs.getAll().rememberSpeed, false);
  expect('no page errors in export/import', p.errors, []);
  p.window.close();
}

// --- 7. Live storage changes and the value filter ------------------------------------------
{
  const live = await openOptions({ rememberSpeed: true, lastSpeed: '1.5' });
  const config = live.window.VSC.videoSpeedConfig;
  live.prefs.VSCPrefs.set('startHidden', true);
  live.prefs.VSCPrefs.set('lastSpeed', 3);
  await tick();
  expect('settings follow other windows\' writes, except lastSpeed (session isolation)', [config.settings.startHidden, config.settings.lastSpeed], [true, 1.5]);
  const typed = (data) => {
    const e = new live.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data });
    live.row('slower').querySelector('.customValue').dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect('upstream beforeinput filter: digits pass, letters do not', [typed('5'), typed('a')], [false, true]);
  expect('no page errors with live changes', live.errors, []);
  live.window.close();
}
{
  const p = await openOptions({}, { beforeInput: false });
  const value = p.row('slower').querySelector('.customValue');
  const typeKey = (charCode, mods = {}) => {
    const e = new p.window.KeyboardEvent('keypress', { bubbles: true, cancelable: true, charCode, ...mods });
    value.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const paste = (text) => {
    const e = new p.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } });
    value.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect('the beforeinput event is really gone', 'onbeforeinput' in p.doc.documentElement, false);
  expect('without beforeinput, keypress filters: digits pass, letters do not', [typeKey(53), typeKey(97)], [false, true]);
  expect('Ctrl+V / Alt+key shortcuts pass; AltGr characters are filtered', [typeKey(118, { ctrlKey: true }), typeKey(102, { altKey: true }), typeKey(64, { ctrlKey: true, altKey: true })], [false, false, true]);
  expect('pasted text is filtered like upstream insertFromPaste', [paste('25'), paste('2x')], [false, true]);
  expect('no page errors in the fallback filter', p.errors, []);
  p.window.close();
}

// --- 8. The chrome.storage shim ----------------------------------------------------------
{
  const p = await openOptions();
  const sync = p.window.chrome.storage.sync;
  const call = (fn, ...args) => new Promise((resolve) => fn(...args, (r) => resolve([r, p.window.chrome.runtime.lastError])));
  let sync1 = false;
  sync.get(null, () => (sync1 = true));
  expect('callbacks run asynchronously', sync1, false);
  await tick();
  const batches = [];
  p.window.chrome.storage.onChanged.addListener((changes, area) => batches.push([area, changes]));

  await call(sync.set, { rememberSpeed: true, audioBoolean: false, junk: 1, customCSS: undefined });
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort());
  expect('get(null) returns stored keys only', sorted((await call(sync.get, null))[0]), { audioBoolean: false, rememberSpeed: true });
  expect('get(string) / get(array) skip absent keys', [(await call(sync.get, 'rememberSpeed'))[0], (await call(sync.get, ['rememberSpeed', 'startHidden']))[0]], [{ rememberSpeed: true }, { rememberSpeed: true }]);
  expect('get(object) fills absent keys with the given defaults', (await call(sync.get, { startHidden: 'dflt', rememberSpeed: false, controllerCSS: null }))[0], { startHidden: 'dflt', rememberSpeed: true, controllerCSS: null });
  const [copy] = await call(sync.get, { siteRules: p.window.VSC.Constants.DEFAULT_SETTINGS.siteRules });
  copy.siteRules.push({ pattern: 'x' });
  expect('results are copies, never the caller\'s defaults', p.window.VSC.Constants.DEFAULT_SETTINGS.siteRules.length, 3);
  await tick();
  expect('one onChanged batch per set(), with old and new values', batches.splice(0), [['sync', { rememberSpeed: { newValue: true }, audioBoolean: { newValue: false } }]]);
  await call(sync.set, { rememberSpeed: true });
  await call(sync.set, { audioBoolean: true });
  await tick();
  expect('an unchanged write reports nothing; a write back to the default reports the removal', batches.splice(0), [['sync', { audioBoolean: { oldValue: false } }]]);
  await call(sync.remove, ['rememberSpeed']);
  await tick();
  expect('remove reports oldValue only', batches.splice(0), [['sync', { rememberSpeed: { oldValue: true } }]]);
  sync.set({ startHidden: true });
  sync.remove('startHidden');
  await tick();
  expect('back-to-back calls fire one event each, as in Chrome', batches.splice(0).map(([, c]) => c), [{ startHidden: { newValue: true } }, { startHidden: { oldValue: true } }]);
  p.prefs.VSCPrefs.set('startHidden', true);
  p.prefs.VSCPrefs.set('exclusiveKeys', true);
  await tick();
  p.prefs.VSCPrefs.set('startHidden', false);
  p.prefs.VSCPrefs.set('startHidden', true);
  await tick();
  expect('outside writes batch per task; a burst ending where it began reports nothing', batches.splice(0).map(([, c]) => c), [{ startHidden: { newValue: true }, exclusiveKeys: { newValue: true } }]);

  const setBoolPref = p.prefs.branch.setBoolPref;
  p.prefs.branch.setBoolPref = () => {
    throw new Error('NS_ERROR_FAILURE');
  };
  const [, lastError] = await call(sync.set, { startHidden: true });
  expect('a failed write sets runtime.lastError during its callback only', [lastError && lastError.message, p.window.chrome.runtime.lastError], ['NS_ERROR_FAILURE', undefined]);
  p.$('#startHidden').checked = true;
  await p.click(p.$('#save'));
  expect('the page reports a failed save', p.status(), 'Error: failed to save options to storage');
  p.prefs.branch.setBoolPref = setBoolPref;
  p.errors.length = 0; // the storage failure above is logged on purpose
  p.window.close();
}

// --- 9. Install wiring ---------------------------------------------------------------
{
  const rdf = fs.readFileSync(path.join(repoRoot, 'install.rdf'), 'utf8');
  const popup = fs.readFileSync(path.join(repoRoot, 'chrome/content/popup/popup.js'), 'utf8');
  expect('install.rdf opens options.html in a tab', [rdf.match(/<em:optionsURL>([^<]+)</)[1], rdf.match(/<em:optionsType>([^<]+)</)[1]], [OPTIONS_URL, '3']);
  expect('the popup opens the same page', popup.includes(`switchToTabHavingURI("${OPTIONS_URL}", true)`), true);
  expect('every options script exists', optionsScripts().filter((f) => !fs.existsSync(f)), []);
  expect('the XUL options page is gone', fs.existsSync(path.join(OPTIONS_DIR, 'options.xul')), false);
}

console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall expectations passed');
process.exitCode = failures ? 1 : 0;
