// Load the fork's page scripts the way Pale Moon does: successive classic
// scripts (vm.Script in jsdom's context — NOT eval, which would hide
// let/const/class declarations) in ONE window, in overlay.js order. The page's
// settings request is left unanswered: this check is about loading. vitest
// imports modules as ES modules and cannot see these problems.
//   node tools/upstream-tests/classic-load.mjs
// Fails on any load error, page-global lexical name, or window property
// beyond the ones upstream itself creates.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { repoRoot, overlayScripts, requireFromRunDir } from './lib.mjs';

const { JSDOM } = requireFromRunDir('jsdom');
const scripts = overlayScripts();
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://www.example.com/watch',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const ctx = dom.getInternalVMContext();
const errors = [];
window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
window.console.log = () => {};

const before = new Set(Object.getOwnPropertyNames(window));
for (const rel of scripts) {
  try {
    new vm.Script(fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8'), {
      filename: rel,
    }).runInContext(ctx);
  } catch (e) {
    errors.push(`${rel}: ${e.name}: ${e.message}`);
  }
}

// Every top-level class/const a module declares, probed by name: lexical
// globals are not window properties, so they must be looked up in scope.
const declared = new Set();
for (const rel of scripts) {
  const code = fs.readFileSync(path.join(repoRoot, 'src', rel), 'utf8');
  for (const m of code.matchAll(/^(?:class|const|let|function)\s+([A-Za-z_$][\w$]*)/gm)) {
    declared.add(m[1]);
  }
}
const lexical = new vm.Script(
  `[${[...declared].map((n) => `typeof ${n} !== 'undefined' ? '${n}' : null`).join(',')}].filter(Boolean)`
).runInContext(ctx);
const added = Object.getOwnPropertyNames(window).filter((k) => !before.has(k));
// The page globals upstream's own bundle creates; anything else is a fork leak.
const UPSTREAM_GLOBALS = ['VSC', 'VSC_controller', 'VSC_settings', 'vscDebugHelper'];
const extra = added.filter((k) => !UPSTREAM_GLOBALS.includes(k));

console.log(`loaded ${scripts.length} scripts; load errors: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
console.log(`window properties added: [${added.join(', ')}]; beyond upstream's: [${extra.join(', ')}]`);
console.log(`page-global lexical names: ${lexical.length} [${lexical.join(', ')}]`);
window.close();
process.exitCode = errors.length || extra.length || lexical.length ? 1 : 0;
