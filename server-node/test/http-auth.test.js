import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const getFreePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const {port} = server.address();
        server.close(error => error ? reject(error) : resolve(port));
    });
});

const waitForServer = async base => {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const response = await fetch(`${base}/server`);
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('server did not start');
};

test('serves browser cookie authentication while preserving Bearer clients', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanclip-auth-test-'));
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const configPath = path.join(tempDir, 'config.json');
    const config = {
        server: {
            host: ['127.0.0.1'],
            port,
            uds: null,
            prefix: '',
            key: null,
            cert: null,
            history: 10,
            auth: 'test-secret',
            historyFile: path.join(tempDir, 'history.json'),
            storageDir: path.join(tempDir, 'storage'),
        },
        text: {limit: 4096},
        file: {
            expire: 3600,
            chunk: 2097152,
            limit: 268435456,
        },
    };
    await fs.writeFile(configPath, JSON.stringify(config));

    let output = '';
    const child = spawn(process.execPath, ['main.js', configPath], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {...process.env, NO_COLOR: '1'},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);

    t.after(async () => {
        const exited = child.exitCode === null
            ? new Promise(resolve => child.once('exit', resolve))
            : Promise.resolve();
        child.kill('SIGTERM');
        await exited;
        await fs.rm(tempDir, {recursive: true, force: true});
    });

    try {
        await waitForServer(base);
    } catch (error) {
        throw new Error(`${error.message}\n${output}`);
    }

    await t.test('reports that an unauthenticated browser needs to log in', async () => {
        const response = await fetch(`${base}/server`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.auth, true);
        assert.equal(body.authenticated, false);
    });

    await t.test('rejects invalid input and incorrect credentials', async () => {
        const invalidDuration = await fetch(`${base}/auth`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'test-secret', rememberDays: 2}),
        });
        const wrongPassword = await fetch(`${base}/auth`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'wrong', rememberDays: 7}),
        });

        assert.equal(invalidDuration.status, 400);
        assert.equal(wrongPassword.status, 403);
    });

    let sessionCookie;
    await t.test('sets a browser-session cookie', async () => {
        const response = await fetch(`${base}/auth`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'test-secret', rememberDays: null}),
        });
        const setCookie = response.headers.get('set-cookie');
        sessionCookie = setCookie.split(';', 1)[0];

        assert.equal(response.status, 200);
        assert.match(setCookie, /lanclip_auth=test-secret/i);
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Strict/i);
        assert.match(setCookie, /Path=\//i);
        assert.doesNotMatch(setCookie, /Max-Age/i);
        assert.doesNotMatch(setCookie, /Expires/i);
    });

    await t.test('authorizes status and protected APIs with the cookie', async () => {
        const statusResponse = await fetch(`${base}/server`, {
            headers: {Cookie: sessionCookie},
        });
        const status = await statusResponse.json();
        const textResponse = await fetch(`${base}/text`, {
            method: 'POST',
            headers: {
                Cookie: sessionCookie,
                'Content-Type': 'text/plain',
            },
            body: 'cookie-authenticated',
        });

        assert.equal(status.authenticated, true);
        assert.equal(textResponse.status, 200);
    });

    await t.test('keeps Bearer API authentication compatible', async () => {
        const response = await fetch(`${base}/text`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer test-secret',
                'Content-Type': 'text/plain',
            },
            body: 'bearer-authenticated',
        });

        assert.equal(response.status, 200);
    });

    await t.test('sets a fixed Secure lifetime behind an HTTPS proxy', async () => {
        const requestedAt = Date.now();
        const response = await fetch(`${base}/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-Proto': 'https',
            },
            body: JSON.stringify({password: 'test-secret', rememberDays: 7}),
        });
        const setCookie = response.headers.get('set-cookie');
        const expires = /expires=([^;]+)/i.exec(setCookie);

        assert.equal(response.status, 200);
        assert.match(setCookie, /Secure/i);
        assert.ok(expires);
        assert.ok(Date.parse(expires[1]) >= requestedAt + 7 * 24 * 60 * 60 * 1000 - 1000);
        assert.ok(Date.parse(expires[1]) <= Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
    });

    await t.test('logs out by expiring the cookie', async () => {
        const response = await fetch(`${base}/auth`, {
            method: 'DELETE',
            headers: {Cookie: sessionCookie},
        });
        const setCookie = response.headers.get('set-cookie');

        assert.equal(response.status, 200);
        assert.match(setCookie, /lanclip_auth=/i);
        assert.match(setCookie, /expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    });

    assert.doesNotMatch(output, /auth failed:.*wrong/i);
});
