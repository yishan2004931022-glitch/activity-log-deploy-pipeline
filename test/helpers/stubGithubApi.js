// A stand-in for api.github.com, used by the integration tests.
//
// The integration tests do not import any source module. They run the BUILT
// bundle (dist/index.js, the file action.yml actually executes) as a child
// process and point it at this server with GITHUB_API_URL. That makes them a
// real test of the shipped artifact: bundling, input parsing, HTTP layer,
// filtering logic and file rendering all have to work together.
//
// Only the three endpoints the action calls are implemented:
//   GET /users/:username/events            - the activity feed
//   GET /user/starred                      - used to tell StarEvent from WatchEvent
//   GET /repos/:owner/:repo/commits/:ref   - used to drop bot-authored pushes

import http from 'node:http';

/**
 * @param {object} options
 * @param {object[]} options.events         events returned on page 1
 * @param {string[]} options.starred        "owner/name" strings the user has starred
 * @param {Record<string, object>} options.commits  sha -> commit payload
 */
export async function startStubGithubApi({ events = [], starred = [], commits = {} } = {}) {
    const requests = [];

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const page = Number(url.searchParams.get('page') || '1');
        requests.push(`${req.method} ${url.pathname}?page=${page}`);

        const send = (status, body) => {
            const payload = JSON.stringify(body);
            res.writeHead(status, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                // The action's octokit client reads rate-limit headers on the
                // retry path; supplying them keeps that path realistic.
                'x-ratelimit-remaining': '4999',
            });
            res.end(payload);
        };

        // Pagination terminates by returning an empty page.
        if (url.pathname === '/user/starred') {
            return send(200, page === 1
                ? starred.map((full) => {
                    const [login, name] = full.split('/');
                    return { name, owner: { login } };
                })
                : []);
        }

        const eventsMatch = url.pathname.match(/^\/users\/([^/]+)\/events$/);
        if (eventsMatch) {
            return send(200, page === 1 ? events : []);
        }

        const commitMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/commits\/(.+)$/);
        if (commitMatch) {
            const sha = commitMatch[3];
            if (commits[sha]) return send(200, commits[sha]);
            // A force-pushed or deleted commit. The action treats 404 as
            // "not a bot" and keeps the event, which is behaviour worth testing.
            return send(404, { message: 'Not Found' });
        }

        return send(404, { message: `unstubbed endpoint: ${url.pathname}` });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** Minimal event builders, so each test only states what it cares about. */
export function pushEvent({ repo = 'octocat/hello', sha = 'cafe1234', ref = 'refs/heads/main', actor = 'octocat' } = {}) {
    return {
        type: 'PushEvent',
        actor: { login: actor },
        repo: { name: repo, url: `https://api.github.com/repos/${repo}` },
        payload: { head: sha, ref, size: 1 },
        created_at: '2026-10-01T10:00:00Z',
        public: true,
    };
}

export function watchEvent({ repo = 'octocat/hello', actor = 'octocat' } = {}) {
    return {
        type: 'WatchEvent',
        actor: { login: actor },
        repo: { name: repo, url: `https://api.github.com/repos/${repo}` },
        payload: { action: 'started' },
        created_at: '2026-10-01T11:00:00Z',
        public: true,
    };
}

export function issuesEvent({ repo = 'octocat/hello', action = 'opened', number = 7 } = {}) {
    return {
        type: 'IssuesEvent',
        actor: { login: 'octocat' },
        repo: { name: repo, url: `https://api.github.com/repos/${repo}` },
        payload: { action, issue: { number, title: 'A bug', html_url: `https://github.com/${repo}/issues/${number}` } },
        created_at: '2026-10-01T12:00:00Z',
        public: true,
    };
}

export function humanCommit(message = 'Fix the thing') {
    return {
        author: { login: 'octocat' },
        committer: { login: 'octocat' },
        commit: {
            message,
            author: { name: 'Octo Cat', email: 'octo@example.com' },
            committer: { name: 'Octo Cat', email: 'octo@example.com' },
        },
    };
}

export function botCommit(message = 'chore: bump dependency') {
    return {
        author: { login: 'dependabot[bot]' },
        committer: { login: 'dependabot[bot]' },
        commit: {
            message,
            author: { name: 'dependabot[bot]', email: 'bot@example.com' },
            committer: { name: 'dependabot[bot]', email: 'bot@example.com' },
        },
    };
}
