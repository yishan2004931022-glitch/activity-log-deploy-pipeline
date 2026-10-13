// Integration tests for the built action.
//
// These are deliberately a different KIND of test from test/unit. The unit
// tests import pure functions from src/ and assert on return values. These
// import nothing from src/ at all: they launch dist/index.js as a child
// process, exactly as action.yml does, pointed at a stub GitHub API, and
// assert on what the action actually produced.
//
// That is why the pipeline downloads the build artifact before running this
// job. A bundling mistake - a module dropped by ncc, a dynamic import that
// does not survive compilation, a bad entry point in package.json - passes
// every unit test and fails here. This stage is the one that can tell the
// difference between "the source is correct" and "the thing we are about to
// release works".

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

import {
    botCommit,
    humanCommit,
    issuesEvent,
    pushEvent,
    startStubGithubApi,
    watchEvent,
} from '../helpers/stubGithubApi.js';
import {
    BUNDLE,
    activityBlock,
    makeReadme,
    makeReadmeWithoutMarkers,
    runAction,
} from '../helpers/runAction.js';

describe('built action (dist/index.js) against a stub GitHub API', () => {
    let stub;

    before(async () => {
        assert.ok(
            fs.existsSync(BUNDLE),
            `${BUNDLE} is missing. The integration stage runs against the build artifact, ` +
            'so either download it or run `npm run build` first.',
        );

        stub = await startStubGithubApi({
            events: [
                pushEvent({ repo: 'octocat/hello', sha: 'aaa1111' }),
                watchEvent({ repo: 'octocat/starred-one' }),
                watchEvent({ repo: 'octocat/not-starred' }),
                issuesEvent({ repo: 'octocat/hello', action: 'opened', number: 7 }),
                pushEvent({ repo: 'octocat/bots', sha: 'bbb2222' }),
                pushEvent({ repo: 'octocat/gone', sha: 'ccc3333' }),
            ],
            starred: ['octocat/starred-one'],
            commits: {
                aaa1111: humanCommit('Fix the thing'),
                bbb2222: botCommit('chore: bump dependency'),
                // ccc3333 is deliberately absent, so the stub answers 404.
            },
        });
    });

    after(async () => {
        if (stub) await stub.close();
    });

    it('renders the activity feed and exits cleanly', async () => {
        const result = await runAction({ apiUrl: stub.baseUrl, readmePath: makeReadme() });

        assert.equal(result.code, 0, `action exited ${result.code}\n${result.output}`);
        const block = activityBlock(result.stdout);
        assert.match(block, /Committed to \[octocat\/hello\]/);
        assert.match(block, /Opened an issue \[#7\]/);
    });

    it('turns a watch on a starred repo into a star, and leaves the others alone', async () => {
        // This is the assertion that most needs two endpoints to agree: the
        // event feed says WatchEvent, the starred list decides which emoji.
        const result = await runAction({ apiUrl: stub.baseUrl, readmePath: makeReadme() });
        const block = activityBlock(result.stdout);

        assert.match(block, /⭐ Starred \[octocat\/starred-one\]/);
        assert.match(block, /🔔 Watching \[octocat\/not-starred\]/);
    });

    it('drops push events whose commit looks bot-authored', async () => {
        const result = await runAction({ apiUrl: stub.baseUrl, readmePath: makeReadme() });
        const block = activityBlock(result.stdout);

        assert.doesNotMatch(block, /octocat\/bots/,
            'a dependabot-authored push reached the rendered output');
        assert.match(result.output, /skipped due to filters/);
    });

    it('keeps an event when the commit lookup 404s', async () => {
        // A force-push deletes the sha. Losing the whole event over that would
        // be worse than including it, so the action keeps it.
        const result = await runAction({ apiUrl: stub.baseUrl, readmePath: makeReadme() });

        assert.equal(result.code, 0);
        assert.match(activityBlock(result.stdout), /octocat\/gone/);
    });

    it('honours EVENT_LIMIT', async () => {
        const result = await runAction({
            apiUrl: stub.baseUrl,
            readmePath: makeReadme(),
            inputs: { 'INPUT_EVENT_LIMIT': '2' },
        });

        const items = activityBlock(result.stdout)
            .split('\n')
            .filter((line) => /^\s*\d+\./.test(line));
        assert.equal(items.length, 2, `expected 2 entries, got:\n${result.stdout}`);
    });

    it('honours IGNORE_EVENTS', async () => {
        const result = await runAction({
            apiUrl: stub.baseUrl,
            readmePath: makeReadme(),
            inputs: { 'INPUT_IGNORE_EVENTS': '["IssuesEvent"]' },
        });

        assert.doesNotMatch(activityBlock(result.stdout), /Opened an issue/);
    });

    it('renders anchors when OUTPUT_STYLE is HTML', async () => {
        const result = await runAction({
            apiUrl: stub.baseUrl,
            readmePath: makeReadme(),
            inputs: { 'INPUT_OUTPUT_STYLE': 'HTML' },
        });

        const block = activityBlock(result.stdout);
        assert.match(block, /<a href="https:\/\/github\.com\/octocat\/hello/);
        assert.doesNotMatch(block, /\]\(https/, 'markdown links leaked into HTML output');
    });

    it('fails the action when the README has no section markers', async () => {
        const result = await runAction({
            apiUrl: stub.baseUrl,
            readmePath: makeReadmeWithoutMarkers(),
        });

        assert.notEqual(result.code, 0, 'a README without markers should fail the job');
        assert.match(result.output, /::error::.*markers not found/i);
    });

    it('rejects an out-of-range EVENT_LIMIT instead of guessing', async () => {
        const result = await runAction({
            apiUrl: stub.baseUrl,
            readmePath: makeReadme(),
            inputs: { 'INPUT_EVENT_LIMIT': '9999' },
        });

        assert.notEqual(result.code, 0);
        assert.match(result.output, /EVENT_LIMIT cannot be greater than 250/);
    });

    it('never writes to the README in dry run', async () => {
        const readme = makeReadme();
        const before_ = fs.readFileSync(readme, 'utf-8');

        await runAction({ apiUrl: stub.baseUrl, readmePath: readme });

        assert.equal(fs.readFileSync(readme, 'utf-8'), before_,
            'dry run modified the README on disk');
    });
});
