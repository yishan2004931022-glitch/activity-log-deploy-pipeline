// Runs the built action the way GitHub Actions runs it.
//
// GitHub passes action inputs as INPUT_<NAME> environment variables and the
// API host as GITHUB_API_URL, so driving the bundle through those is the same
// contract the real runner uses. Nothing here imports from src/.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const BUNDLE = path.join(REPO_ROOT, 'dist', 'index.js');

export const START_MARKER = '<!--START_SECTION:activity-->';
export const END_MARKER = '<!--END_SECTION:activity-->';

/** A throwaway README containing the markers the action writes between. */
export function makeReadme(existingSection = '') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-log-it-'));
    const file = path.join(dir, 'README.md');
    fs.writeFileSync(file, `# Fixture\n\n${START_MARKER}\n${existingSection}\n${END_MARKER}\n`);
    return file;
}

/** A README with no markers, used to test the failure path. */
export function makeReadmeWithoutMarkers() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-log-it-'));
    const file = path.join(dir, 'README.md');
    fs.writeFileSync(file, '# Fixture\n\nNothing to see here.\n');
    return file;
}

/**
 * Execute dist/index.js and collect its output.
 * Always runs in DRY_RUN so the action never attempts to commit anything.
 */
export function runAction({ apiUrl, readmePath, inputs = {}, timeoutMs = 30000 }) {
    const env = {
        // A deliberately minimal environment: inheriting the whole shell would
        // let an ambient GITHUB_TOKEN or proxy setting change the result and
        // make the test depend on where it runs.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SYSTEMROOT: process.env.SYSTEMROOT,
        GITHUB_API_URL: apiUrl,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'yishan2004931022-glitch/activity-log-deploy-pipeline',
        // The stub listens on loopback, so no proxy may be consulted.
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        'INPUT_GITHUB_USERNAME': 'octocat',
        'INPUT_GITHUB_TOKEN': 'test-token-not-a-real-credential',
        'INPUT_EVENT_LIMIT': '10',
        'INPUT_OUTPUT_STYLE': 'MARKDOWN',
        'INPUT_IGNORE_EVENTS': '[]',
        'INPUT_HIDE_DETAILS_ON_PRIVATE_REPOS': 'false',
        'INPUT_README_PATH': readmePath,
        'INPUT_COMMIT_MESSAGE': 'Update README.md with latest activity',
        'INPUT_EVENT_EMOJI_MAP': '',
        'INPUT_EVENT_TEMPLATE': '',
        'INPUT_DRY_RUN': 'true',
        ...inputs,
    };

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [BUNDLE], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`action did not exit within ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, output: stdout + stderr });
        });
    });
}

/**
 * The rendered activity block.
 *
 * In dry-run the action prints the block it would have written, after the
 * @actions/core workflow commands. Everything before the first list item is
 * logging, so the block starts at the first line that looks like one.
 */
export function activityBlock(stdout) {
    const lines = stdout.split('\n');
    const first = lines.findIndex((l) => /^\s*(\d+\.|-|<li>|<ul>)/.test(l));
    if (first === -1) return '';
    return lines.slice(first).join('\n').trim();
}
