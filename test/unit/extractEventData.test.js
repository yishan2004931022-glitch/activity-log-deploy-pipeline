// Unit tests for extractEventData.
//
// extractEventData is the funnel every event passes through before it is
// rendered: it decides the emoji, the human-readable action, the link, the
// ref and whether anything is withheld because the repository is private.
// One wrong branch here silently mislabels an entry in someone's README, so
// the URL and privacy branches are worth covering explicitly.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractEventData } from '../../src/utils/templateEngine.js';

const EMOJI = {
    PushEvent: '📝',
    CreateEvent: '🎉',
    DeleteEvent: '🗑️',
    IssuesEvent: { opened: '🆕', closed: '❌' },
    PullRequestEvent: { opened: '📥', merged: '🔀' },
    ReleaseEvent: { draft: '✏️', published: '🚀' },
    IssueCommentEvent: '🗣',
    CommitCommentEvent: '🗣',
    PullRequestReviewEvent: '🔎',
    WatchEvent: '🔔',
};

/** A public event in octocat/hello unless told otherwise. */
function event(type, payload, overrides = {}) {
    return {
        type,
        payload,
        public: true,
        created_at: '2026-03-04T05:06:07Z',
        repo: { name: 'octocat/hello' },
        ...overrides,
    };
}

describe('extractEventData: links', () => {
    it('links a push to the head commit', () => {
        const data = extractEventData(
            event('PushEvent', { head: 'abc1234', ref: 'refs/heads/main', size: 1 }), EMOJI);
        assert.equal(data.url, 'https://github.com/octocat/hello/commit/abc1234');
    });

    it('links a created branch to the tree and a created tag to the release', () => {
        const branch = extractEventData(
            event('CreateEvent', { ref_type: 'branch', ref: 'feat/x' }), EMOJI);
        assert.equal(branch.url, 'https://github.com/octocat/hello/tree/feat/x');

        const tag = extractEventData(
            event('CreateEvent', { ref_type: 'tag', ref: 'v2.0.0' }), EMOJI);
        assert.equal(tag.url, 'https://github.com/octocat/hello/releases/tag/v2.0.0');
    });

    it('links a created repository to the repository itself', () => {
        const data = extractEventData(
            event('CreateEvent', { ref_type: 'repository' }), EMOJI);
        assert.equal(data.url, 'https://github.com/octocat/hello');
    });

    it('prefers an issue link over the repository fallback', () => {
        const data = extractEventData(
            event('IssuesEvent', { action: 'opened', issue: { number: 42 } }), EMOJI);
        assert.equal(data.url, 'https://github.com/octocat/hello/issues/42');
        assert.equal(data.number, '#42');
    });

    it('links a pull request by number', () => {
        const data = extractEventData(
            event('PullRequestEvent', { action: 'opened', pull_request: { number: 9 } }), EMOJI);
        assert.equal(data.url, 'https://github.com/octocat/hello/pull/9');
        assert.equal(data.number, '#9');
    });

    it('anchors an issue comment at the comment', () => {
        const data = extractEventData(event('IssueCommentEvent', {
            action: 'created', issue: { number: 5 }, comment: { id: 777 },
        }), EMOJI);
        assert.equal(data.url,
            'https://github.com/octocat/hello/issues/5#issuecomment-777');
    });

    it('anchors a commit comment at the commit', () => {
        const data = extractEventData(event('CommitCommentEvent', {
            action: 'created', comment: { id: 31, commit_id: 'deadbee' },
        }), EMOJI);
        assert.equal(data.url,
            'https://github.com/octocat/hello/commit/deadbee#commitcomment-31');
    });

    it('uses the review html_url when GitHub supplies one', () => {
        const data = extractEventData(event('PullRequestReviewEvent', {
            action: 'created',
            review: { html_url: 'https://github.com/octocat/hello/pull/3#pullrequestreview-1' },
            pull_request: { number: 3 },
        }), EMOJI);
        assert.equal(data.url,
            'https://github.com/octocat/hello/pull/3#pullrequestreview-1');
    });

    it('falls back to the repository when nothing more specific exists', () => {
        const data = extractEventData(event('WatchEvent', { action: 'started' }), EMOJI);
        assert.equal(data.url, 'https://github.com/octocat/hello');
    });

    it('gives a draft release no link, and a published one its tag', () => {
        const draft = extractEventData(event('ReleaseEvent', {
            action: 'created', release: { draft: true, tag_name: 'v3.0.0' },
        }), EMOJI);
        assert.equal(draft.url, 'https://github.com/octocat/hello',
            'a draft release is not publicly linkable, so only the repo remains');

        const published = extractEventData(event('ReleaseEvent', {
            action: 'published', release: { draft: false, tag_name: 'v3.0.0' },
        }), EMOJI);
        assert.equal(published.url, 'https://github.com/octocat/hello/releases/tag/v3.0.0');
    });
});

describe('extractEventData: refs', () => {
    it('strips refs/heads and refs/tags prefixes', () => {
        assert.equal(extractEventData(
            event('PushEvent', { head: 'a', ref: 'refs/heads/main' }), EMOJI).ref, 'main');
        assert.equal(extractEventData(
            event('DeleteEvent', { ref_type: 'tag', ref: 'refs/tags/v1' }), EMOJI).ref, 'v1');
    });

    it('reports a release by its tag name', () => {
        const data = extractEventData(event('ReleaseEvent', {
            action: 'published', release: { tag_name: 'v4.1.0' },
        }), EMOJI);
        assert.equal(data.ref, 'v4.1.0');
    });

    it('is empty when the event carries no ref', () => {
        assert.equal(extractEventData(event('WatchEvent', { action: 'started' }), EMOJI).ref, '');
    });

    it('exposes ref_type when present and an empty string when not', () => {
        assert.equal(extractEventData(
            event('CreateEvent', { ref_type: 'tag', ref: 'v1' }), EMOJI).ref_type, 'tag');
        assert.equal(extractEventData(
            event('WatchEvent', { action: 'started' }), EMOJI).ref_type, '');
    });
});

describe('extractEventData: private repositories', () => {
    const privateEvent = event(
        'PushEvent',
        { head: 'abc1234', ref: 'refs/heads/secret' },
        { public: false },
    );

    it('replaces the name, drops the URL and withholds the number', () => {
        const data = extractEventData(privateEvent, EMOJI);
        assert.equal(data.repo, 'a private repository');
        assert.equal(data.repo_url, '');
        assert.equal(data.url, '', 'a private repository must not be linked');
        assert.equal(data.number, '');
    });

    it('keeps the branch name by default', () => {
        assert.equal(extractEventData(privateEvent, EMOJI).ref, 'secret');
    });

    it('hides the branch name when asked to', () => {
        assert.equal(extractEventData(privateEvent, EMOJI, true).ref, '');
    });
});

describe('extractEventData: emoji selection', () => {
    it('reads a scalar mapping directly', () => {
        assert.equal(extractEventData(
            event('PushEvent', { head: 'a' }), EMOJI).emoji, '📝');
    });

    it('reads the action out of a nested mapping', () => {
        assert.equal(extractEventData(
            event('IssuesEvent', { action: 'closed', issue: { number: 1 } }), EMOJI).emoji, '❌');
    });

    it('falls back to the published release icon for an unmapped release action', () => {
        const data = extractEventData(event('ReleaseEvent', {
            action: 'created', release: { draft: false, tag_name: 'v1' },
        }), EMOJI);
        assert.equal(data.emoji, '🚀');
    });

    it('uses the draft icon for a draft release', () => {
        const data = extractEventData(event('ReleaseEvent', {
            action: 'created', release: { draft: true, tag_name: 'v1' },
        }), EMOJI);
        assert.equal(data.emoji, '✏️');
    });

    it('returns an empty emoji for an unmapped event type rather than throwing', () => {
        assert.equal(extractEventData(
            event('SponsorshipEvent', { action: 'created' }), EMOJI).emoji, '');
    });
});

describe('extractEventData: date formatting', () => {
    it('formats in UTC so the output does not depend on the runner timezone', () => {
        const data = extractEventData(event('PushEvent', { head: 'a' }), EMOJI);
        assert.equal(data.date, 'Mar 4, 2026');
    });
});
