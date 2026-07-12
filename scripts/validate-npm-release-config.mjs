import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverPackage = JSON.parse(fs.readFileSync('server-node/package.json', 'utf8'));
const serverLock = JSON.parse(fs.readFileSync('server-node/package-lock.json', 'utf8'));
const clientPackage = JSON.parse(fs.readFileSync('client/package.json', 'utf8'));
const clientLock = JSON.parse(fs.readFileSync('client/package-lock.json', 'utf8'));
const flake = fs.readFileSync('flake.nix', 'utf8');
const main = fs.readFileSync('server-node/main.js', 'utf8');
const workflow = fs.existsSync('.github/workflows/npm-publish.yml')
    ? fs.readFileSync('.github/workflows/npm-publish.yml', 'utf8')
    : '';

assert.equal(serverPackage.name, 'lanclip-server', 'npm package name must be lanclip-server');
assert.equal(serverLock.name, serverPackage.name, 'server lockfile package name must match package.json');
assert.equal(serverLock.packages?.['']?.name, serverPackage.name, 'server lockfile root package name must match package.json');
assert.equal(clientLock.name, clientPackage.name, 'client lockfile package name must match package.json');
assert.equal(clientLock.packages?.['']?.name, clientPackage.name, 'client lockfile root package name must match package.json');
assert.notEqual(serverPackage.private, true, 'npm package must not be private');
assert.match(serverPackage.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'npm package version must be valid semver');
assert.equal(serverPackage.main, 'main.js', 'npm package must expose main.js');
assert.deepEqual(serverPackage.bin, { lanclip: 'main.js' }, 'npm package must expose the lanclip CLI');
assert.ok(main.startsWith('#!/usr/bin/env node\n'), 'main.js must have a node shebang for npm bin execution');
assert.equal(serverPackage.license, 'MIT', 'npm package must declare MIT license');
assert.equal(serverPackage.repository?.url, 'git+https://github.com/handy-sun/lanclip.git', 'repository URL must match the GitHub repo for npm trusted publishing');
assert.equal(serverPackage.repository?.directory, 'server-node', 'repository directory must point to server-node');
assert.equal(serverPackage.publishConfig?.registry, 'https://registry.npmjs.org/', 'publishConfig must target npm registry');
assert.equal(serverPackage.publishConfig?.access, 'public', 'publishConfig must publish a public package');

const flakeVersions = [...flake.matchAll(/^\s+version = "([^"]+)";$/gm)]
    .map(match => match[1]);
assert.equal(flakeVersions.length, 2, 'flake.nix must declare client and server package versions');

const releaseVersions = {
    clientPackage: clientPackage.version,
    clientLock: clientLock.version,
    clientLockRoot: clientLock.packages?.['']?.version,
    serverPackage: serverPackage.version,
    serverLock: serverLock.version,
    serverLockRoot: serverLock.packages?.['']?.version,
    flakeClient: flakeVersions[0],
    flakeServer: flakeVersions[1],
};
assert.equal(
    new Set(Object.values(releaseVersions)).size,
    1,
    `release versions must match: ${JSON.stringify(releaseVersions)}`,
);

[
    'app/',
    'main.js',
    'static/',
].forEach(file => {
    assert.ok(serverPackage.files?.includes(file), `npm package files must include ${file}`);
});

assert.match(workflow, /name:\s+npm Publish/, 'npm publish workflow must exist');
assert.match(workflow, /id-token:\s+write/, 'npm publish workflow must request OIDC id-token permission');
assert.match(workflow, /registry-url:\s+'https:\/\/registry\.npmjs\.org'/, 'npm publish workflow must target npm registry');
assert.match(workflow, /npm run build/, 'npm publish workflow must build frontend static assets');
assert.match(workflow, /working-directory:\s+server-node[\s\S]*npm publish/, 'npm publish workflow must publish from server-node');

console.log('npm release configuration checks passed.');
