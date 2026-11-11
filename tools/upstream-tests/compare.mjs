// Compare two vitest JSON reports test-by-test.
//   node tools/upstream-tests/compare.mjs before.json after.json
// Exits non-zero when a test that passed before no longer passes.
import fs from 'node:fs';

const [before, after] = process.argv.slice(2).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));

function byTest(report) {
  const map = new Map();
  for (const file of report.testResults) {
    const name = file.name.replace(/.*[\\/]tests[\\/]/, '');
    if (!file.assertionResults.length) {
      map.set(`${name} :: <load>`, file.status);
    }
    for (const test of file.assertionResults) {
      map.set(`${name} :: ${test.fullName}`, test.status);
    }
  }
  return map;
}

const was = byTest(before);
const now = byTest(after);
const fixed = [];
const broke = [];
for (const [key, status] of now) {
  if (status === 'passed' && was.get(key) !== 'passed') fixed.push(key);
  if (status !== 'passed' && was.get(key) === 'passed') broke.push(key);
}
for (const [key, status] of was) {
  if (status === 'passed' && !now.has(key)) broke.push(`${key} (missing)`);
}

console.log(
  `before: ${before.numPassedTests} passed / ${before.numFailedTests} failed;  ` +
    `after: ${after.numPassedTests} passed / ${after.numFailedTests} failed`
);
console.log(`newly passing: ${fixed.length}`);
for (const key of fixed) console.log(`  + ${key}`);
console.log(`REGRESSIONS: ${broke.length}`);
for (const key of broke) console.log(`  - ${key}`);
process.exitCode = broke.length ? 1 : 0;
