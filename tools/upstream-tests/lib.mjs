// Shared paths and loaders for the upstream-test tooling (see sync.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Fork repository root. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Upstream checkout the tests come from (override: VSC_UPSTREAM). */
export const upstreamRoot = path.resolve(
  process.env.VSC_UPSTREAM || path.join(repoRoot, '..', 'videospeed-0.11.1')
);

/**
 * Scratch run directory holding the copied tests, the fork's src/ and the
 * test dependencies — kept outside the repository (override: VSC_TEST_RUN_DIR).
 */
export const runDir = path.resolve(
  process.env.VSC_TEST_RUN_DIR || path.join(os.tmpdir(), 'vsc-uxp-upstream-tests')
);

/** Test dependencies, pinned to upstream 0.11.1's package-lock.json. */
export const PINNED = { vitest: '4.1.10', jsdom: '30.0.1' };

export const INSTALL_HINT =
  `cd "${runDir}" && npm install --no-audit --no-fund --ignore-scripts ` +
  `vitest@${PINNED.vitest} jsdom@${PINNED.jsdom}`;

/** Page scripts in the fork's real injection order (overlay.js). */
export function overlayScripts() {
  const overlay = fs.readFileSync(path.join(repoRoot, 'chrome/content/overlay.js'), 'utf8');
  const block = overlay.match(/_contentScripts:\s*\[([\s\S]*?)\r?\n\s*\],/);
  if (!block) {
    throw new Error('Could not locate _contentScripts in chrome/content/overlay.js');
  }
  return [...block[1].matchAll(/"([^"]+\.js)"/g)].map((m) => m[1]);
}

/** Load a test dependency from the run directory, or explain how to get it. */
export function requireFromRunDir(name) {
  try {
    return createRequire(path.join(runDir, 'package.json'))(name);
  } catch {
    console.error(`Cannot load ${name} from ${runDir}.\nRun: node tools/upstream-tests/sync.mjs\nthen: ${INSTALL_HINT}`);
    process.exit(2);
  }
}
