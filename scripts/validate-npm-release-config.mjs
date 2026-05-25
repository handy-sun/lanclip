import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverPackage = JSON.parse(fs.readFileSync('server-node/package.json', 'utf8'));
const main = fs.readFileSync('server-node/main.js', 'utf8');
const workflow = fs.existsSync('.github/workflows/npm-publish.yml')
    ? fs.readFileSync('.github/workflows/npm-publish.yml', 'utf8')
    : '';

assert.equal(serverPackage.name, 'lanclip', 'npm package name must be lanclip');
assert.notEqual(serverPackage.private, true, 'npm package must not be private');
assert.equal(serverPackage.version, '0.1.0', 'npm package version must be 0.1.0');
assert.equal(serverPackage.main, 'main.js', 'npm package must expose main.js');
assert.deepEqual(serverPackage.bin, { lanclip: 'main.js' }, 'npm package must expose the lanclip CLI');
assert.ok(main.startsWith('#!/usr/bin/env node\n'), 'main.js must have a node shebang for npm bin execution');
assert.equal(serverPackage.license, 'MIT', 'npm package must declare MIT license');
assert.equal(serverPackage.repository?.url, 'git+https://github.com/handy-sun/lanclip.git', 'repository URL must match the GitHub repo for npm trusted publishing');
assert.equal(serverPackage.repository?.directory, 'server-node', 'repository directory must point to server-node');
assert.equal(serverPackage.publishConfig?.registry, 'https://registry.npmjs.org/', 'publishConfig must target npm registry');
assert.equal(serverPackage.publishConfig?.access, 'public', 'publishConfig must publish a public package');

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
