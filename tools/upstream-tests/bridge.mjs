// Chrome-side bridge test: the real chrome/content/overlay.js and
// chrome/modules/VSCPrefs.jsm, loaded against the simulated XPCOM layer in
// xpcom.mjs (plus a stub gBrowser), driving jsdom content documents that run
// the fork's real page scripts. Covers injection decisions, the settings handshake, page writes,
// pref relays, popup routing into frames, disable/teardown and migrations.
//   node tools/upstream-tests/bridge.mjs
// Exits non-zero on any failed expectation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, overlayScripts, requireFromRunDir } from './lib.mjs';
import { makePrefs } from './xpcom.mjs';

const { JSDOM } = requireFromRunDir('jsdom');
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
}

// --- Chrome window ---------------------------------------------------------------
// The real overlay.js over the simulated XPCOM layer (xpcom.mjs).
function makeChrome(userPrefs = {}) {
  const prefs = makePrefs(userPrefs);
  const { Components, Services, utils, VSCPrefs } = prefs;
  const button = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const gBrowser = { browsers: [], selectedBrowser: null, addEventListener() {}, removeEventListener() {} };
  const overlayCtx = {
    Components: { ...Components, utils: { ...utils, import() { overlayCtx.VSCPrefs = VSCPrefs; } } },
    Services,
    gBrowser,
    document: { getElementById: (id) => (id === 'videospeed-button' ? button : null) },
    window: { addEventListener() {} },
  };
  vm.createContext(overlayCtx);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'chrome/content/overlay.js'), 'utf8'), overlayCtx);
  return { VSCPrefs, overlay: overlayCtx.VideoSpeedOverlay, gBrowser, button, user: prefs.user, errors: prefs.errors, branch: prefs.branch };
}

// A content document: jsdom page with a sized, playable <video>. The real
// overlay decides whether to inject; the harness then runs the page scripts
// overlay.js would have loaded (resource:// URLs do not load in jsdom).
function makePage(chrome, url) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="p"><video src="a.mp4"></video></div></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const pageErrors = [];
  const pageWarnings = []; // the VSC logger's WARNING:/ERROR: lines
  window.addEventListener('error', (e) => pageErrors.push(e.message));
  window.console.log = (...a) => {
    const line = a.join(' ');
    if (/^(WARNING|ERROR):/.test(line)) pageWarnings.push(line);
  };
  window.console.error = (...a) => pageErrors.push(a.join(' '));
  const rates = new WeakMap();
  const proto = window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(proto, 'currentSrc', { configurable: true, get() { return this.getAttribute('src') || ''; } });
  Object.defineProperty(proto, 'playbackRate', {
    configurable: true,
    get() { return rates.has(this) ? rates.get(this) : 1; },
    set(v) {
      const old = rates.has(this) ? rates.get(this) : 1;
      rates.set(this, v);
      if (old !== v) this.dispatchEvent(new window.Event('ratechange'));
    },
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 10, left: 10, width: 640, height: 360, right: 650, bottom: 370 });
  for (const p of ['offsetWidth', 'clientWidth']) Object.defineProperty(window.HTMLElement.prototype, p, { configurable: true, get: () => 640 });
  for (const p of ['offsetHeight', 'clientHeight']) Object.defineProperty(window.HTMLElement.prototype, p, { configurable: true, get: () => 360 });

  // nsIDOMWindowUtils author sheets, as Gecko keeps them: a per-document list
  // outside the DOM (loading one twice is an error). `sheets` holds their CSS.
  const sheetURIs = [];
  const windowUtils = {
    AUTHOR_SHEET: 2,
    loadSheetUsingURIString(uri, type) {
      if (type !== 2) throw new Error(`unexpected sheet type ${type}`);
      if (sheetURIs.includes(uri)) throw new Error('NS_ERROR_INVALID_ARG: sheet already loaded');
      sheetURIs.push(uri);
    },
    removeSheetUsingURIString(uri) {
      const at = sheetURIs.indexOf(uri);
      if (at !== -1) sheetURIs.splice(at, 1);
    },
  };
  window.QueryInterface = () => ({ getInterface: () => windowUtils });
  const sheets = () => sheetURIs.map((uri) => decodeURIComponent(uri.replace('data:text/css;charset=utf-8,', '')));

  const doc = window.document;
  const ready = [];
  doc.documentElement.addEventListener('VSC_SETTINGS_READY', (e) => ready.push(JSON.parse(JSON.stringify(e.detail))));
  chrome.overlay.handleEvent({ type: 'DOMContentLoaded', originalTarget: doc });
  const injected = doc.querySelectorAll('script[src^="resource://videospeed/"]').length;
  if (injected) {
    const ctx = dom.getInternalVMContext();
    for (const rel of overlayScripts()) {
      new vm.Script(fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8'), { filename: rel }).runInContext(ctx);
    }
  }
  return { window, doc, video: doc.querySelector('video'), injected, pageErrors, pageWarnings, ready, sheets, frames: [] };
}

const asWindow = (page) => ({ document: page.doc, frames: page.frames.map(asWindow) });
function selectTab(chrome, page) {
  const browser = { contentWindow: asWindow(page) };
  chrome.gBrowser.browsers.push(browser);
  chrome.gBrowser.selectedBrowser = browser;
}

// --- 1. Handshake, remembered speed, page writes, relays, frames, disable ----
{
  const chrome = makeChrome({ rememberSpeed: true, lastSpeed: '1.5' });
  chrome.overlay.init();
  const top = makePage(chrome, 'https://www.example.com/watch');
  const frame = makePage(chrome, 'https://embed.example.org/player');
  top.frames.push(frame);
  selectTab(chrome, top);
  await tick(500);

  expect('scripts injected into an enabled page', top.injected, 32);
  expect('handshake delivers settings: remembered speed applies at load', [top.video.playbackRate, frame.video.playbackRate], [1.5, 1.5]);
  const payload = top.ready[0] || { settings: {} };
  expect('one VSC_SETTINGS_READY answer, with the www-less hostname', [top.ready.length, payload.hostname], [1, 'example.com']);
  expect('the payload never carries enabled, blacklist or siteRules', ['enabled', 'blacklist', 'siteRules'].filter((k) => k in payload.settings), []);
  expect('toolbar icon shows enabled', chrome.button.attrs.status, undefined);

  top.doc.body.dispatchEvent(new top.window.KeyboardEvent('keydown', { code: 'KeyD', key: 'd', keyCode: 68, bubbles: true }));
  await tick(1200);
  expect('a user speed change is written back through VSC_WRITE_STORAGE', chrome.user.get('lastSpeed'), '1.6');

  top.doc.documentElement.dispatchEvent(new top.window.CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 99, enabled: false, siteRules: [] } }));
  expect('page writes: only lastSpeed crosses, clamped to 16', [chrome.user.get('lastSpeed'), chrome.user.has('enabled'), chrome.user.has('siteRules')], ['16', false, false]);
  top.doc.documentElement.dispatchEvent(new top.window.CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 'fast' } }));
  expect('non-numeric lastSpeed is ignored', chrome.user.get('lastSpeed'), '16');

  chrome.VSCPrefs.set('customCSS', 'vsc-controller { top: 5px; }');
  expect('live pref change reaches the page settings and the custom sheet', [top.window.VSC.videoSpeedConfig.settings.customCSS, top.sheets()[1]], ['vsc-controller { top: 5px; }', 'vsc-controller { top: 5px; }']);

  chrome.overlay.sendToSelectedTab({ type: 'VSC_SET_SPEED', payload: { speed: 2 } });
  expect('popup command reaches the top page and its frame', [top.video.playbackRate, frame.video.playbackRate], [2, 2]);

  chrome.VSCPrefs.set('enabled', false);
  await tick(50);
  expect('disable tears down every frame and greys the icon', [!!top.video.vsc, !!frame.video.vsc, chrome.button.attrs.status], [false, false, 'disabled']);
  chrome.VSCPrefs.set('enabled', true);
  chrome.overlay.sendToSelectedTab({ type: 'VSC_SET_SPEED', payload: { speed: 3 } });
  expect('re-enable is reload-only for already-open pages (#1527)', [!!top.video.vsc, top.video.playbackRate], [false, 2]);
  const reloaded = makePage(chrome, 'https://www.example.com/watch');
  await tick(500);
  expect('a newly loaded page is injected again after re-enable', [reloaded.injected, !!reloaded.video.vsc], [32, true]);
  expect('no page errors', [...top.pageErrors, ...frame.pageErrors, ...reloaded.pageErrors], []);
  expect('no chrome errors', chrome.errors, []);
}

// --- 2. Site rules, exclusions and legacy blacklist ----------------------------
{
  const rules = [
    { pattern: 'lectures.example.org', enabled: true, speed: 2 },
    { pattern: 'blocked.example.net', enabled: false, speed: null },
    { pattern: 'example.com', enabled: true, speed: null },
    { pattern: 'www.example.com', enabled: false, speed: null },
  ];
  const chrome = makeChrome({ siteRules: JSON.stringify(rules) });
  chrome.overlay.init();
  const lecture = makePage(chrome, 'https://lectures.example.org/course/1');
  const blocked = makePage(chrome, 'https://blocked.example.net/');
  const firstMatch = makePage(chrome, 'https://www.example.com/');
  const meet = makePage(chrome, 'https://meet.google.com/abc-defg-hij');
  const about = makePage(chrome, 'about:blank');
  await tick(500);
  expect('a site rule speed is the initial authority', lecture.video.playbackRate, 2);
  expect('a disabled site gets no page scripts at all', [blocked.injected, typeof blocked.window.VSC], [0, 'undefined']);
  expect('the FIRST matching rule decides (upstream matchSiteRule)', firstMatch.injected, 32);
  expect('meet.google.com is never injected (upstream exclude_matches)', meet.injected, 0);
  expect('about: documents are never injected', about.injected, 0);

  chrome.VSCPrefs.set('siteRules', '');
  chrome.user.set('blacklist', 'lectures.example.org');
  const legacy = makePage(chrome, 'https://lectures.example.org/course/2');
  expect('legacy blacklist applies only while siteRules is absent', legacy.injected, 0);
}

// --- 3. Migrations ---------------------------------------------------------------
{
  const v1 = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
    { action: 'pause', key: 80, value: 0, force: false, predefined: false },
    { action: 'muted', key: 255, value: 0, force: false, predefined: false },
  ];
  const chrome = makeChrome({
    blacklist: 'foo.com\n  /bar\\.net/i  \n',
    keyBindings: JSON.stringify(v1),
    speeds: '{}',
    displayKeyCode: 86,
  });
  chrome.VSCPrefs.migrate();
  const s = chrome.VSCPrefs.getAll();
  expect('customized blacklist migrates to disabled site rules', s.siteRules, [
    { pattern: 'foo.com', enabled: false, speed: null },
    { pattern: '/bar\\.net/i', enabled: false, speed: null },
  ]);
  expect('deprecated keys are removed', [chrome.user.has('speeds'), chrome.user.has('displayKeyCode')], [false, false]);
  expect('v1 key bindings gain event.code (predefined, custom, unmappable)', s.keyBindings.slice(0, 3).map((b) => [b.action, b.code, b.keyCode, b.displayKey]), [
    ['slower', 'KeyS', 83, 's'],
    ['pause', 'KeyP', 80, 'p'],
    ['muted', null, 255, ''],
  ]);
  expect('missing predefined actions are added', s.keyBindings.map((b) => b.action).sort(), ['advance', 'display', 'fast', 'faster', 'jump', 'mark', 'muted', 'pause', 'reset', 'rewind', 'slower'].sort());
  expect('schemaVersion becomes 2', s.schemaVersion, 2);

  const fresh = makeChrome();
  fresh.VSCPrefs.migrate();
  expect('fresh install keeps the shipped default site rules', fresh.VSCPrefs.getAll().siteRules.map((r) => r.pattern), ['imgur.com', 'teams.microsoft.com', 'meet.google.com']);
  expect('fresh install writes nothing', [...fresh.user.keys()], []);
}

// --- 4. Fresh install, as upstream's storage.sync.get(null) sees it ----------------
{
  const chrome = makeChrome();
  chrome.overlay.init();
  const page = makePage(chrome, 'https://www.example.com/watch');
  const blocked = makePage(chrome, 'https://imgur.com/gallery/x');
  await tick(500);
  const payload = page.ready[0] || {};
  expect('the payload carries stored keys only (none yet)', payload.settings, {});
  expect('the page runs on the built-in default shortcuts', page.window.VSC.videoSpeedConfig.settings.keyBindings.map((b) => b.code), page.window.VSC.Constants.DEFAULT_SETTINGS.keyBindings.map((b) => b.code));
  expect('nothing is written back and nothing is logged', [chrome.user.has('keyBindings'), page.pageWarnings, page.pageErrors], [false, [], []]);
  // UXP: upstream's bridge reads raw storage, so its shipped default rules
  // disable nothing until the options page saves once; the fork applies them
  // from the start, as its options page shows them.
  expect('the shipped default rules apply from the start', blocked.injected, 0);
}

// --- 5. Documents that replace their <html> (document.write apps, page rebuilders) -------
// jsdom keeps the window across these (Chrome's behavior); what chrome code sees
// in Gecko — a new root, and a second DOMContentLoaded after document.open() /
// write() — is simulated directly.
{
  const chrome = makeChrome();
  chrome.overlay.init();
  const tick500 = () => tick(500);
  const scripts = (doc) => doc.querySelectorAll('script[src^="resource://videospeed/"]').length;
  const newRoot = (doc) => {
    const html = doc.createElement('html');
    html.appendChild(doc.createElement('head'));
    html.appendChild(doc.createElement('body'));
    doc.replaceChild(html, doc.documentElement);
    return html;
  };
  const answers = (root) => {
    const got = [];
    root.addEventListener('VSC_SETTINGS_READY', (e) => got.push(JSON.parse(JSON.stringify(e.detail))));
    return got;
  };

  // In-place swap, scripts alive: nothing is injected again, and both sides
  // keep talking on the original root.
  const live = makePage(chrome, 'https://www.example.com/watch');
  selectTab(chrome, live);
  await tick500();
  const injectedOnce = scripts(live.doc);
  chrome.overlay.handleEvent({ type: 'DOMContentLoaded', originalTarget: live.doc });
  expect('a repeated DOMContentLoaded on the same root adds nothing', [injectedOnce, scripts(live.doc)], [32, 32]);
  newRoot(live.doc);
  const video = live.doc.createElement('video');
  video.src = 'b.mp4';
  live.doc.body.appendChild(video);
  await tick(1300);
  expect('a video in the swapped-in <html> gets a controller', !!video.vsc, true);
  expect('the controller sheet belongs to the document, not to the swapped <html>', live.sheets().length, 1);
  chrome.overlay.sendToSelectedTab({ type: 'VSC_SET_SPEED', payload: { speed: 2 } });
  await tick();
  expect('popup commands still reach the page', video.playbackRate, 2);
  expect('no second injection without a new DOMContentLoaded', scripts(live.doc), 0);

  // document.open()/write(): new root + DOMContentLoaded again → fresh injection
  // and a fresh bridge on the new root.
  const reopened = makePage(chrome, 'https://www.example.org/app');
  await tick500();
  const root2 = newRoot(reopened.doc);
  const got = answers(root2);
  chrome.overlay.handleEvent({ type: 'DOMContentLoaded', originalTarget: reopened.doc });
  root2.dispatchEvent(new reopened.window.CustomEvent('VSC_REQUEST_SETTINGS'));
  expect('a re-opened document is injected again and answered on its new root', [scripts(reopened.doc), got.length, !!(got[0] && got[0].settings)], [32, 1, true]);
  expect('…with its controller sheet replaced, not loaded twice', [reopened.sheets().length, chrome.errors], [1, []]);

  // Disabled while open: stays reload-only, as upstream's bridge keeps it.
  const off = makePage(chrome, 'https://www.example.net/');
  selectTab(chrome, off);
  await tick500();
  chrome.VSCPrefs.set('enabled', false);
  chrome.VSCPrefs.set('enabled', true);
  newRoot(off.doc);
  chrome.overlay.handleEvent({ type: 'DOMContentLoaded', originalTarget: off.doc });
  expect('a document disabled while open is not injected again', scripts(off.doc), 0);
  expect('no page errors around replaced documents', [...live.pageErrors, ...reopened.pageErrors, ...off.pageErrors], []);
}

// --- 6. Controller sheets ----------------------------------------------------------
// Upstream's CSS is out of the page's reach (manifest CSS, adopted sheets); the
// overlay attaches the fork's as nsIDOMWindowUtils author sheets.
{
  const chrome = makeChrome();
  chrome.overlay.init();
  const yt = makePage(chrome, 'https://www.youtube.com/watch?v=x');
  const other = makePage(chrome, 'https://www.example.com/watch');
  selectTab(chrome, yt);
  chrome.gBrowser.browsers.push({ contentWindow: { document: other.doc, frames: [] } });
  await tick(500);
  const hasYouTubeRules = (css) => css.includes('.ytp-hide-info-bar > vsc-controller');
  expect('an active page gets one controller sheet, and no <style> in its DOM', [yt.sheets().length, yt.doc.querySelectorAll('style').length], [1, 0]);
  expect('the sheet holds the inner controller CSS and the host rules', ['.vsc-controller .vsc-controller-inner .vsc-ctrl {', 'vsc-controller {'].map((s) => yt.sheets()[0].includes(s)), [true, true]);
  expect('site rules are preprocessed for the host (YouTube only on YouTube, no markers left)', [hasYouTubeRules(yt.sheets()[0]), hasYouTubeRules(other.sheets()[0]), yt.sheets()[0].includes('--vsc-domain')], [true, false, false]);
  expect('the controller is styled by it', yt.window.VSC.controllerSheetCSS('www.youtube.com'), yt.sheets()[0]);

  chrome.VSCPrefs.set('customCSS', '@import url(https://example.invalid/x.css);\nvsc-controller { top: 3px; }');
  expect('custom CSS becomes a second sheet, after the controller sheet, without @import', [yt.sheets().length, yt.sheets()[1], other.sheets()[1]], [2, '\nvsc-controller { top: 3px; }', '\nvsc-controller { top: 3px; }']);
  chrome.VSCPrefs.set('customCSS', 'vsc-controller { left: 1px; }');
  expect('a custom CSS change replaces that sheet', yt.sheets(), [yt.sheets()[0], 'vsc-controller { left: 1px; }']);
  chrome.VSCPrefs.set('customCSS', '');
  expect('clearing custom CSS removes it', yt.sheets().length, 1);

  const later = makePage(chrome, 'https://www.example.org/');
  chrome.gBrowser.browsers.push({ contentWindow: { document: later.doc, frames: [] } });
  chrome.VSCPrefs.set('customCSS', 'vsc-controller { top: 9px; }');
  await tick(500);
  expect('a page loaded with custom CSS set gets both sheets', later.sheets().length, 2);

  chrome.VSCPrefs.set('enabled', false);
  expect('disabling removes every sheet', [yt.sheets().length, other.sheets().length, later.sheets().length], [0, 0, 0]);
  chrome.VSCPrefs.set('enabled', true);
  expect('re-enabling attaches nothing (reload-only)', yt.sheets().length, 0);
  expect('no chrome or page errors with sheets', [chrome.errors, yt.pageErrors, other.pageErrors, later.pageErrors], [[], [], [], []]);
}

console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall expectations passed');
process.exitCode = failures ? 1 : 0;
