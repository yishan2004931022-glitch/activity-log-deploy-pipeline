// Unit tests for the template engine.
//
// These run in the `test` job of the deployment pipeline, across the Node
// matrix, before anything is built or released. They cover the pure functions
// only: no network, no GitHub token, no filesystem, so a failure here is always
// a real regression rather than a flaky environment.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    applyTemplate,
    getEventAction,
} from '../../src/utils/templateEngine.js';

describe('applyTemplate', () => {
    it('substitutes every placeholder it is given', () => {
        const out = applyTemplate('{emoji} {action} {subject} {number} in {repo}', {
            emoji: '🚀',
            action: 'merged',
            subject: 'PR',
            number: '#42',
            repo: 'octocat/hello-world',
        });
        assert.equal(out, '🚀 merged PR #42 in octocat/hello-world');
    });

    it('does not leave a dangling markdown link when the url is empty', () => {
        // Private events arrive with no url. Rendering "[repo]()" would produce
        // a broken link in the README, so the engine unwraps it to plain text.
        const out = applyTemplate('{action} in [{repo}]({repo_url})', {
            action: 'committed',
            repo: 'private/repo',
            repo_url: '',
        });
        assert.equal(out, 'committed in private/repo');
        assert.ok(!out.includes('[')); // no half-built link survives
    });

    it('drops empty parenthesised segments instead of leaving "( )"', () => {
        const out = applyTemplate('{action} a tag ({ref})', {
            action: 'created',
            ref: '',
        });
        assert.equal(out, 'created a tag');
    });

    it('collapses the gap left by an empty placeholder', () => {
        const out = applyTemplate('{emoji} {action} {subject} in {repo}', {
            emoji: '',
            action: 'committed',
            subject: '',
            repo: 'a/b',
        });
        assert.equal(out, 'committed in a/b');
        assert.ok(!out.includes('  '), 'no double spaces should remain');
    });

    it('treats regex metacharacters in values as literal text', () => {
        // Values come from repository names and commit data, so a value such as
        // "$&" must not be interpreted as a replacement reference.
        const out = applyTemplate('pushed to {repo}', { repo: 'a$&b' });
        assert.equal(out, 'pushed to a$&b');
    });

    it('returns null for a missing or non-string template', () => {
        assert.equal(applyTemplate(undefined, {}), null);
        assert.equal(applyTemplate('', {}), null);
        assert.equal(applyTemplate(42, {}), null);
    });
});

describe('getEventAction', () => {
    it('reports a merged pull request as merged, not as its raw action', () => {
        const action = getEventAction('PullRequestEvent', {
            action: 'closed',
            pull_request: { merged: true, number: 7 },
        });
        assert.equal(action, 'merged');
    });

    it('keeps "closed" for a pull request that was closed unmerged', () => {
        const action = getEventAction('PullRequestEvent', {
            action: 'closed',
            pull_request: { merged: false, number: 7 },
        });
        assert.equal(action, 'closed');
    });

    it('falls back to a per-type default when the payload has no action', () => {
        assert.equal(getEventAction('PushEvent', {}), 'committed');
        assert.equal(getEventAction('ForkEvent', {}), 'forked');
        assert.equal(getEventAction('DeleteEvent', {}), 'deleted');
    });

    it('forces watched/starred regardless of the payload action', () => {
        assert.equal(getEventAction('WatchEvent', { action: 'started' }), 'watched');
        assert.equal(getEventAction('StarEvent', { action: 'created' }), 'starred');
    });

    it('distinguishes a draft release from a published one', () => {
        assert.equal(getEventAction('ReleaseEvent', { release: { draft: true } }), 'draft');
        assert.equal(getEventAction('ReleaseEvent', { release: { draft: false } }), 'published');
    });
});
