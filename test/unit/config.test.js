// Unit tests for input parsing.
//
// src/config.js reads its inputs at module load time, which is correct for an
// action but awkward to test: one import per process would mean one set of
// inputs. A cache-busting query string on the import specifier gives each case
// a fresh module instance, so every scenario gets its own parse.
//
// Everything here is pure: no network, no child process, no build artifact.
// That separation is the point - these fail fast on a logic regression, and
// the integration suite covers whether the bundled version behaves the same.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

let counter = 0;

/** Load src/config.js fresh with the given action inputs. */
async function loadConfig(inputs = {}) {
    const base = {
        'GITHUB_USERNAME': 'octocat',
        'GITHUB_TOKEN': 'test-token-not-a-real-credential',
        'EVENT_LIMIT': '10',
        'OUTPUT_STYLE': 'MARKDOWN',
        'IGNORE_EVENTS': '[]',
        'HIDE_DETAILS_ON_PRIVATE_REPOS': 'false',
        'README_PATH': 'README.md',
        'COMMIT_MESSAGE': 'Update README.md with latest activity',
        'EVENT_EMOJI_MAP': '',
        'EVENT_TEMPLATE': '',
        'DRY_RUN': 'false',
        ...inputs,
    };

    const applied = [];
    for (const [name, value] of Object.entries(base)) {
        const key = `INPUT_${name.toUpperCase()}`;
        applied.push(key);
        process.env[key] = value;
    }

    try {
        counter += 1;
        return await import(`../../src/config.js?case=${counter}`);
    } finally {
        for (const key of applied) delete process.env[key];
    }
}

describe('config: EVENT_LIMIT', () => {
    it('parses a valid limit', async () => {
        const config = await loadConfig({ 'EVENT_LIMIT': '25' });
        assert.equal(config.eventLimit, 25);
    });

    it('accepts the boundary values', async () => {
        assert.equal((await loadConfig({ 'EVENT_LIMIT': '1' })).eventLimit, 1);
        assert.equal((await loadConfig({ 'EVENT_LIMIT': '250' })).eventLimit, 250);
    });
});

describe('config: IGNORE_EVENTS', () => {
    it('parses a JSON array', async () => {
        const config = await loadConfig({ 'IGNORE_EVENTS': '["PushEvent","WatchEvent"]' });
        assert.deepEqual(config.ignoreEvents, ['PushEvent', 'WatchEvent']);
    });

    it('falls back to a comma-separated list', async () => {
        const config = await loadConfig({ 'IGNORE_EVENTS': 'PushEvent, WatchEvent' });
        assert.deepEqual(config.ignoreEvents, ['PushEvent', 'WatchEvent']);
    });

    it('strips quotes and brackets from a hand-written list', async () => {
        const config = await loadConfig({ 'IGNORE_EVENTS': "['PushEvent', \"ForkEvent\"]" });
        assert.deepEqual(config.ignoreEvents, ['PushEvent', 'ForkEvent']);
    });

    it('treats blank as no filtering', async () => {
        assert.deepEqual((await loadConfig({ 'IGNORE_EVENTS': '' })).ignoreEvents, []);
        assert.deepEqual((await loadConfig({ 'IGNORE_EVENTS': '   ' })).ignoreEvents, []);
    });
});

describe('config: OUTPUT_STYLE', () => {
    it('upper-cases the style', async () => {
        assert.equal((await loadConfig({ 'OUTPUT_STYLE': 'markdown' })).style, 'MARKDOWN');
        assert.equal((await loadConfig({ 'OUTPUT_STYLE': 'html' })).style, 'HTML');
    });
});

describe('config: boolean inputs', () => {
    it('parses true and false', async () => {
        assert.equal((await loadConfig({ 'DRY_RUN': 'true' })).dryRun, true);
        assert.equal((await loadConfig({ 'DRY_RUN': 'false' })).dryRun, false);
    });

    it('is case and whitespace tolerant', async () => {
        assert.equal((await loadConfig({ 'DRY_RUN': '  TRUE ' })).dryRun, true);
    });

    it('treats an unset boolean as false', async () => {
        assert.equal((await loadConfig({ 'DRY_RUN': '' })).dryRun, false);
    });
});

describe('config: EVENT_EMOJI_MAP', () => {
    it('supplies defaults when nothing is given', async () => {
        const config = await loadConfig();
        assert.equal(config.eventEmojiMap.PushEvent, '📝');
        assert.equal(config.eventEmojiMap.IssuesEvent.opened, '🆕');
    });

    it('overrides a single scalar entry without losing the rest', async () => {
        const config = await loadConfig({ 'EVENT_EMOJI_MAP': 'PushEvent: "🚀"' });
        assert.equal(config.eventEmojiMap.PushEvent, '🚀');
        assert.equal(config.eventEmojiMap.ForkEvent, '🍴');
    });

    it('merges into a nested entry rather than replacing it', async () => {
        const config = await loadConfig({
            'EVENT_EMOJI_MAP': 'IssuesEvent:\n  opened: "🌟"\n',
        });
        assert.equal(config.eventEmojiMap.IssuesEvent.opened, '🌟');
        assert.equal(config.eventEmojiMap.IssuesEvent.closed, '❌',
            'merging one action should not drop the siblings');
    });
});

describe('config: EVENT_TEMPLATE', () => {
    it('is null when absent, so the default descriptions are used', async () => {
        assert.equal((await loadConfig({ 'EVENT_TEMPLATE': '' })).eventTemplate, null);
        assert.equal((await loadConfig({ 'EVENT_TEMPLATE': '   ' })).eventTemplate, null);
    });

    it('is trimmed when present', async () => {
        const config = await loadConfig({ 'EVENT_TEMPLATE': '  {emoji} {repo}  ' });
        assert.equal(config.eventTemplate, '{emoji} {repo}');
    });
});
