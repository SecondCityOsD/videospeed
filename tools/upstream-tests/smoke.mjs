// End-to-end smoke test through the fork's real boot path: classic scripts in
// overlay.js order, the inline settings seed, inject.js init. A sized,
// playable <video> gets a controller; the test then drives shortcuts, site
// resets, R/G memory, V visibility, popup messages, wheel, drag, double-click
// reset and teardown, asserting each observable outcome.
//   node tools/upstream-tests/smoke.mjs
// Exits non-zero on any failed expectation or page error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, overlayScripts, requireFromRunDir } from './lib.mjs';

const { JSDOM } = requireFromRunDir('jsdom');

async function boot(seed) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="p"><video id="v" src="a.mp4"></video></div></body></html>',
    { url: 'https://www.example.com/watch', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
  window.console.log = () => {};
  window.console.error = (...a) => errors.push(`console.error: ${a.join(' ')}`);

  // A real-looking, sized, playable media element.
  const rates = new WeakMap();
  const proto = window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(proto, 'currentSrc', {
    configurable: true,
    get() {
      return this.getAttribute('src') || '';
    },
  });
  Object.defineProperty(proto, 'playbackRate', {
    configurable: true,
    get() {
      return rates.has(this) ? rates.get(this) : 1;
    },
    set(v) {
      const old = rates.has(this) ? rates.get(this) : 1;
      rates.set(this, v);
      if (old !== v) this.dispatchEvent(new window.Event('ratechange'));
    },
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    top: 10, left: 10, width: 640, height: 360, right: 650, bottom: 370, x: 10, y: 10,
  });
  for (const p of ['offsetWidth', 'clientWidth']) {
    Object.defineProperty(window.HTMLElement.prototype, p, { configurable: true, get: () => 640 });
  }
  for (const p of ['offsetHeight', 'clientHeight']) {
    Object.defineProperty(window.HTMLElement.prototype, p, { configurable: true, get: () => 360 });
  }

  const ctx = dom.getInternalVMContext();
  // Answer the settings handshake as overlay.js's bridge does, attaching the
  // controller sheet first (bridge.mjs tests the real bridge). In Pale Moon
  // that sheet is an author sheet outside the DOM; a marked <style> stands in.
  window.document.documentElement.addEventListener('VSC_REQUEST_SETTINGS', () => {
    const sheet = window.document.createElement('style');
    sheet.setAttribute('data-author-sheet', 'controller');
    sheet.textContent = window.VSC.controllerSheetCSS(window.location.hostname);
    window.document.head.appendChild(sheet);
    window.document.documentElement.dispatchEvent(
      new window.CustomEvent('VSC_SETTINGS_READY', {
        detail: window.JSON.parse(JSON.stringify({ settings: seed, hostname: 'example.com' })),
      })
    );
  });
  for (const rel of overlayScripts()) {
    try {
      new vm.Script(fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8'), {
        filename: rel,
      }).runInContext(ctx);
    } catch (e) {
      errors.push(`${rel}: ${e.name}: ${e.message}`);
    }
  }
  await tick(400);
  return { window, errors, video: window.document.getElementById('v') };
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
}

// --- Main journey ----------------------------------------------------------
{
  const { window, errors, video } = await boot({ enabled: true, logLevel: 2, rememberSpeed: false, lastSpeed: 1 });
  const doc = window.document;
  const key = async (code, k) => {
    doc.body.dispatchEvent(
      new window.KeyboardEvent('keydown', { code, key: k, keyCode: k.toUpperCase().charCodeAt(0), bubbles: true })
    );
    await tick(20);
  };
  const msg = async (type, payload) => {
    doc.documentElement.dispatchEvent(new window.CustomEvent('VSC_MESSAGE', { detail: { type, payload } }));
    await tick(20);
  };
  const rate = () => video.playbackRate;
  const vis = () => video.vsc.div.dataset.vscVisibility || 'auto';
  const epoch = () => window.VSC_controller.eventManager.arbitration.authorityEpoch;

  expect('controller attached as <vsc-controller>', video.vsc && video.vsc.div.tagName, 'VSC-CONTROLLER');
  expect('no opinion at load: native 1.0 untouched', [rate(), window.VSC.videoSpeedConfig.settings.lastSpeed], [1, null]);
  await key('KeyD', 'd');
  expect('D raises speed and badge', [rate(), video.vsc.speedIndicator.textContent], [1.1, '1.10']);
  await key('KeyD', 'd');
  await key('KeyS', 's');
  expect('D then S', rate(), 1.1);
  video.playbackRate = 1;
  await tick(20);
  expect('site reset without a gesture is fought back', rate(), 1.1);
  video.dispatchEvent(new window.Event('play'));
  await tick(20);
  expect('play keeps the authority', rate(), 1.1);

  await key('KeyR', 'r');
  expect('R remembers and resets', rate(), 1);
  await key('KeyR', 'r');
  expect('R again restores', rate(), 1.1);
  await key('KeyS', 's');
  await key('KeyR', 'r');
  expect('R at 1.0 with no memory cross-toggles to G', rate(), 1.8);

  await key('KeyV', 'v');
  expect('first V hides what is visible', vis(), 'hide');
  await key('KeyV', 'v');
  expect('second V shows', vis(), 'show');

  let start = epoch();
  await msg('VSC_SET_SPEED', { speed: 2 });
  expect('popup SET_SPEED: one authority epoch', [rate(), epoch() - start], [2, 1]);
  start = epoch();
  await msg('VSC_ADJUST_SPEED', { delta: 0.25 });
  expect('popup ADJUST_SPEED: one authority epoch', [rate(), epoch() - start], [2.25, 1]);
  await msg('VSC_RESET_SPEED');
  await msg('VSC_RESET_SPEED');
  expect('popup RESET twice restores', rate(), 2.25);

  // Wheel over the controller: hover dwell, then pinch/Ctrl zoom vs a real wheel.
  const ctrl = window.VSC.ShadowDOMManager.getController(window.VSC.ShadowDOMManager.getRoot(video.vsc.div));
  ctrl.dispatchEvent(new window.MouseEvent('mouseenter'));
  await tick(350);
  const zoom = new window.WheelEvent('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: true, cancelable: true });
  ctrl.dispatchEvent(zoom);
  await tick(20);
  expect('Ctrl/pinch wheel is left to browser zoom (#1539)', [rate(), zoom.defaultPrevented], [2.25, false]);
  const wheel = new window.WheelEvent('wheel', { deltaY: -100, deltaMode: 0, cancelable: true, bubbles: true });
  ctrl.dispatchEvent(wheel);
  await tick(20);
  expect('wheel after hover dwell raises speed', [rate(), wheel.defaultPrevented], [2.35, true]);

  // Drag from the badge; the move happens on the document.
  const badge = video.vsc.speedIndicator;
  const left0 = parseInt(ctrl.style.left, 10) || 0;
  const top0 = parseInt(ctrl.style.top, 10) || 0;
  badge.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true, cancelable: true }));
  const dragging = ctrl.classList.contains('dragging');
  doc.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 130, clientY: 120, bubbles: true }));
  doc.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 130, clientY: 120, bubbles: true }));
  expect('badge drag moves the controller and ends on mouseup', [dragging, parseInt(ctrl.style.left, 10) - left0, parseInt(ctrl.style.top, 10) - top0, ctrl.classList.contains('dragging')], [true, 30, 20, false]);
  ctrl.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }));
  doc.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));
  expect('controller body (outside the badge) is not a drag handle', ctrl.classList.contains('dragging'), false);
  doc.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

  badge.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await tick(20);
  expect('double-click on the badge resets', rate(), 1);

  await msg('VSC_TOGGLE_DISPLAY');
  expect('popup TOGGLE_DISPLAY flips explicit intent', vis(), 'hide');

  await msg('VSC_TEARDOWN');
  expect('teardown removes every controller and stops accepting media', [!!video.vsc, doc.querySelectorAll('vsc-controller').length, window.VSC_controller.acceptingMedia], [false, 0, false]);
  const late = doc.createElement('video');
  late.src = 'b.mp4';
  doc.getElementById('p').appendChild(late);
  await tick(1300);
  expect('media added after teardown gets no controller (reload-only)', !!late.vsc, false);
  expect('no page errors in the main journey', errors, []);
  window.close();
}

// --- startHidden + remembered speed ------------------------------------------
{
  const { window, errors, video } = await boot({ enabled: true, logLevel: 2, rememberSpeed: true, lastSpeed: 1.5, startHidden: true });
  const doc = window.document;
  expect('remembered speed applies at load', video.playbackRate, 1.5);
  expect('startHidden hides automatically', video.vsc.div.classList.contains('vsc-hidden'), true);
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyD', key: 'd', keyCode: 68, bubbles: true }));
  await tick(20);
  expect('startHidden blocks the speed flash', video.vsc.div.classList.contains('vsc-show'), false);
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyV', key: 'v', keyCode: 86, bubbles: true }));
  await tick(20);
  expect('first V shows a hidden controller', video.vsc.div.dataset.vscVisibility, 'show');
  expect('no page errors with startHidden', errors, []);
  window.close();
}

// --- Controller CSS ------------------------------------------------------------
// overlay.js attaches the sheets (bridge.mjs); here: the page adds none of its
// own, and the shared builders match upstream.
{
  const { window, errors, video } = await boot({ enabled: true, logLevel: 2, customCSS: 'vsc-controller { top: 3px; }' });
  const VSC = window.VSC;
  expect('the page scripts add no <style> of their own', window.document.querySelectorAll('style:not([data-author-sheet])').length, 0);
  expect('the controller is styled from the controller sheet', window.getComputedStyle(video.vsc.div).position, 'absolute');
  const hosts = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube.googleapis.com', 'www.netflix.com', 'www.example.com'];
  const upstream = (host) => window.VSC_controller.preprocessDomainCSS(VSC.Constants.DEFAULT_CONTROLLER_CSS, host);
  expect("the sheet's host and site rules are upstream's preprocessDomainCSS() output", hosts.filter((h) => !VSC.controllerSheetCSS(h).endsWith('\n' + upstream(h))), []);
  expect('YouTube rules only on YouTube', ['www.youtube.com', 'www.example.com'].map((h) => VSC.controllerSheetCSS(h).includes('.ytp-hide-info-bar > vsc-controller')), [true, false]);
  expect('the custom sheet drops @import (upstream replaceSync)', VSC.customSheetCSS('@import url(https://example.invalid/x.css);\nvsc-controller { top: 3px; }'), '\nvsc-controller { top: 3px; }');
  // [input, expected]: top-level @import statements go, wherever they sit;
  // strings, comments, blocks and look-alikes stay.
  const cases = [
    ['', ''],
    ['.a{color:red}', '.a{color:red}'],
    ['@import url(x.css);\n.a{}', '\n.a{}'],
    ['@IMPORT "x.css" screen;.a{}', '.a{}'],
    [String.raw`@\69mport url(x);.a{}`, '.a{}'],
    [String.raw`@\69 mport url(x);.a{}`, '.a{}'],
    [String.raw`@im\port url(x);.a{}`, '.a{}'],
    [String.raw`@\6d port url(x);.a{}`, String.raw`@\6d port url(x);.a{}`],
    ['@import url(a;b.css);.a{}', '.a{}'],
    ['@import "a;b.css";.a{}', '.a{}'],
    ['@import url(x) supports((a:b);c);.a{}', '.a{}'],
    ['@import url(x)', ''],
    ['@charset "utf-8";@import url(x);@namespace svg url(y);', '@charset "utf-8";@namespace svg url(y);'],
    ['.a{content:"@import x;"}', '.a{content:"@import x;"}'],
    ['/* @import url(x); */.a{}', '/* @import url(x); */.a{}'],
    ['@media screen{@import url(x);}', '@media screen{@import url(x);}'],
    ['.a{} @import url(late);', '.a{} '],
    ['@importx url(x);', '@importx url(x);'],
    ['@import url(x) {}.a{}', '@import url(x) {}.a{}'],
    ['.a{content:"}"} @import url(x);', '.a{content:"}"} '],
    ['@foo{} @import url(x); .b{}', '@foo{}  .b{}'],
  ];
  expect('stripCSSImports edge cases', cases.filter(([css, want]) => window.VSC.stripCSSImports(css) !== want).map(([css]) => css), []);
  expect('no page errors with the controller CSS', errors, []);
  window.close();
}

console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall expectations passed');
process.exitCode = failures ? 1 : 0;
