// Reads the c8 coverage summary and decides whether a release may proceed.
//
// Why this is a separate gate from the test result
// ------------------------------------------------
// A failing test and thin coverage are different problems and deserve
// different consequences:
//
//   failing test   -> the code is known to be wrong. The job FAILS, so every
//                     downstream job is skipped by `needs`.
//   low coverage   -> the code might be wrong and nobody would know. The job
//                     SUCCEEDS and reports a number; the release jobs then
//                     skip themselves with an `if:` on that number.
//
// Conflating the two would mean either shipping untested code or treating a
// coverage dip as an outage. Keeping them apart is also why this script never
// exits non-zero: deciding is the workflow's job, measuring is this script's.
//
// Usage:  node scripts/coverage_gate.js <summary.json> <threshold>

import fs from 'node:fs';
import process from 'node:process';

const [, , summaryPath = 'coverage/coverage-summary.json', rawThreshold = '80'] = process.argv;

function fail(message) {
    console.log(`::error::coverage gate: ${message}`);
    process.exit(1);
}

/** Append `name=value` lines to a GitHub Actions file, if we are in Actions. */
function emit(file, text) {
    const target = process.env[file];
    if (target) fs.appendFileSync(target, text);
}

const threshold = Number(rawThreshold);
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    fail(`threshold must be a number between 0 and 100, got "${rawThreshold}"`);
}

if (!fs.existsSync(summaryPath)) {
    fail(`${summaryPath} not found. Did the coverage reporter run?`);
}

let summary;
try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
} catch (error) {
    fail(`${summaryPath} is not valid JSON: ${error.message}`);
}

const totals = summary.total;
if (!totals || !totals.lines) {
    fail(`${summaryPath} has no "total.lines" section`);
}

const lines = Number(totals.lines.pct);
const branches = Number(totals.branches?.pct ?? 0);
const functions = Number(totals.functions?.pct ?? 0);
const passed = lines >= threshold;

// Rounded to one decimal so the number in the log matches the number in the
// report; the raw value can have a long tail.
const pct = (n) => `${n.toFixed(1)}%`;

console.log(`lines     ${pct(lines)}  (${totals.lines.covered}/${totals.lines.total})`);
console.log(`branches  ${pct(branches)}`);
console.log(`functions ${pct(functions)}`);
console.log(`threshold ${pct(threshold)} on lines`);
console.log(passed
    ? 'PASS - release may proceed'
    : 'BELOW THRESHOLD - release jobs will skip themselves');

emit('GITHUB_OUTPUT', [
    `coverage_lines=${lines.toFixed(1)}`,
    `coverage_branches=${branches.toFixed(1)}`,
    `coverage_functions=${functions.toFixed(1)}`,
    `coverage_threshold=${threshold}`,
    `coverage_ok=${passed}`,
    '',
].join('\n'));

emit('GITHUB_STEP_SUMMARY', [
    '### Coverage',
    '',
    '| Metric | Result | Gate |',
    '| --- | --- | --- |',
    `| Lines | ${pct(lines)} (${totals.lines.covered}/${totals.lines.total}) | threshold ${pct(threshold)} |`,
    `| Branches | ${pct(branches)} | reported only |`,
    `| Functions | ${pct(functions)} | reported only |`,
    '',
    passed
        ? 'Coverage is at or above the threshold, so the release is allowed to continue.'
        : '**Coverage is below the threshold.** The test job still passes, because nothing '
          + 'is known to be broken, but `deploy-staging` and `deploy-production` will skip '
          + 'themselves rather than release code this thinly covered.',
    '',
].join('\n'));

if (!passed) {
    // A warning annotation, not an error: the run is not broken, the release
    // is simply not allowed.
    console.log(`::warning::line coverage ${pct(lines)} is below the ${pct(threshold)} `
        + 'threshold; the release stages will be skipped');
}

// Always exit 0. See the note at the top of this file.
process.exit(0);
