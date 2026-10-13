// Gate self-test.
//
// A testing gate that has never been seen to stop a release is an assumption,
// not a control. This script exists so the gate can be exercised on demand:
// run the pipeline with `simulate_test_failure: true` and this assertion
// fails, which fails the test job, which means every downstream job - build
// promotion, staging, production - is skipped rather than run.
//
// The assignment brief suggests exactly this shape:
//
//     const assert = require('assert');
//     assert.strictEqual(1 + 1, 2);
//
// ...noting that "if an assertion fails, the script exits with an error, so
// the test job fails, which is exactly what the pipeline needs to detect".
//
// Two deliberate choices:
//
// 1. It is a separate npm script, not a test file. `npm test` and the unit
//    suite stay honest - nobody can make the real suite pass by flipping an
//    environment variable, and this file is never picked up by the test glob.
// 2. It only fails when asked. The default run asserts the arithmetic the
//    brief uses and passes, so having it wired into the pipeline costs
//    nothing on a normal run.

import assert from 'node:assert/strict';
import process from 'node:process';

const simulate = String(process.env.SIMULATE_FAILURE || '').trim().toLowerCase() === 'true';

console.log(`gate self-test: SIMULATE_FAILURE=${simulate}`);

// The baseline assertion from the brief. If this ever fails, something is
// deeply wrong with the runtime rather than with the project.
assert.strictEqual(1 + 1, 2, 'arithmetic is broken; the runtime cannot be trusted');

if (simulate) {
    console.log('deliberately failing so the release gate can be observed stopping the pipeline');
    // Mirrors what a genuine regression looks like to the runner: a failed
    // assertion, a non-zero exit code, and a legible reason in the log.
    assert.strictEqual(
        'release blocked',
        'release allowed',
        'SIMULATED FAILURE: this is the gate self-test, not a real regression. '
        + 'Every job after the test stage should now be skipped.',
    );
}

console.log('gate self-test passed');
