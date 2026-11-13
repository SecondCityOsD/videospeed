// Visibility render matrix: the fork's real stylesheets vs upstream's pure
// ControllerVisibility.isVisible() model — the plain-DOM analogue of
// upstream's Chrome display-toggle matrix (docs/controller-visibility.md).
// Selector matching uses jsdom's element.matches(); the cascade (importance >
// specificity > source order, then inheritance for `visibility`) is computed
// here because jsdom's own cascade is not faithful.
//   node tools/upstream-tests/css-matrix.mjs
// Exits non-zero on any state whose rendering disagrees with the model.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, requireFromRunDir } from './lib.mjs';

const { JSDOM } = requireFromRunDir('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://www.youtube.com/watch',
  runScripts: 'outside-only',
});
const { window } = dom;
const ctx = dom.getInternalVMContext();
for (const rel of [
  'utils/key-maps.js',
  'styles/controller-css-defaults.js',
  'utils/constants.js',
  'utils/logger.js',
  'core/controller-visibility.js',
  'ui/shadow-dom.js',
]) {
  new vm.Script(fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8'), { filename: rel }).runInContext(ctx);
}
const VSC = window.VSC;
const CV = VSC.ControllerVisibility;

// The controller sheet overlay.js attaches on youtube.com: the inner
// controller CSS, then the host and site rules preprocessed for that host.
const sheetCSS = VSC.controllerSheetCSS('www.youtube.com');

function parseRules(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim();
      let value = d.slice(i + 1).trim();
      const important = /!important$/.test(value);
      value = value.replace(/\s*!important$/, '');
      decls[prop] = { value, important };
    }
    for (const sel of m[1].split(',')) rules.push({ selector: sel.trim(), decls });
  }
  return rules;
}

function specificity(sel) {
  const s = sel.replace(/:not\(/g, '(').replace(/::?(before|after)/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not)[\w-]+/g) || []).length;
  const types = (
    s.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+|:[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~(])([a-z][\w-]*)/gi) || []
  ).length;
  return ids * 1e6 + cls * 1e3 + types;
}

const rules = parseRules(sheetCSS).map((r, order) => ({
  ...r,
  order,
  spec: specificity(r.selector),
}));
const unsupported = new Set();

function cascade(el, prop, inherited) {
  let best = null;
  for (const r of rules) {
    const d = r.decls[prop];
    if (!d) continue;
    let matched = false;
    try {
      matched = el.matches(r.selector);
    } catch {
      unsupported.add(r.selector);
    }
    if (!matched) continue;
    const key = [d.important ? 1 : 0, r.spec, r.order];
    if (
      !best ||
      key[0] > best.key[0] ||
      (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))
    ) {
      best = { key, value: d.value };
    }
  }
  if (!best || best.value === 'inherit') return inherited;
  return best.value;
}

let checked = 0;
const mismatches = [];
for (const override of ['auto', 'show', 'hide'])
  for (const automaticHidden of [false, true])
    for (const siteAutohide of [false, true])
      for (const flash of [false, true])
        for (const noSource of [false, true]) {
          if (override === 'hide' && flash) continue; // invalid in the model
          const player = window.document.createElement('div');
          player.className = 'html5-video-player' + (siteAutohide ? ' ytp-autohide' : '');
          const host = window.document.createElement('vsc-controller');
          host.className = ['vsc-controller', automaticHidden && 'vsc-hidden', flash && 'vsc-show', noSource && 'vsc-nosource']
            .filter(Boolean)
            .join(' ');
          if (override !== 'auto') host.dataset.vscVisibility = override;
          const root = VSC.ShadowDOMManager.createShadowDOM(host, {});
          player.appendChild(host);
          window.document.body.appendChild(player);
          const ctrl = VSC.ShadowDOMManager.getController(root);

          const hostVis = cascade(host, 'visibility', 'visible');
          const hostDisplay = cascade(host, 'display', 'inline');
          const rootVis = cascade(root, 'visibility', hostVis);
          const rootDisplay = cascade(root, 'display', 'block');
          const ctrlVis = cascade(ctrl, 'visibility', rootVis);
          const rendered = hostDisplay !== 'none' && rootDisplay !== 'none' && ctrlVis !== 'hidden';
          const model = CV.isVisible(
            CV.createState({
              override,
              automaticHidden,
              siteAutohide,
              noSource,
              flash: flash ? CV.FLASH.TIMED_ARMED : CV.FLASH.NONE,
            })
          );
          checked++;
          if (rendered !== model) {
            mismatches.push({ override, automaticHidden, siteAutohide, flash, noSource, rendered, model });
          }
          player.remove();
        }

console.log(`render matrix: ${checked} states checked, ${mismatches.length} mismatches vs ControllerVisibility.isVisible()`);
for (const m of mismatches) console.log(`  ${JSON.stringify(m)}`);
if (unsupported.size) {
  console.log(`selectors this engine could not parse (dropped, as a browser would): ${unsupported.size}`);
  for (const s of unsupported) console.log(`  ${s}`);
}
window.close();
process.exitCode = mismatches.length ? 1 : 0;
