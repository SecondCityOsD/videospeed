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
  window.addEventListener('error', (e) => pageErrors.push(e.message));
  window.console.log = () => {};
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
  return { window, doc, video: doc.querySelector('video'), injected, pageErrors, ready, frames: [] };
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
  expect('live pref change reaches the page (custom CSS sheet)', top.doc.getElementById('vsc-controller-custom') && top.doc.getElementById('vsc-controller-custom').textContent, 'vsc-controller { top: 5px; }');

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

console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall expectations passed');
process.exitCode = failures ? 1 : 0;
