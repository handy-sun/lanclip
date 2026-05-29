import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const releaseWorkflow = read('.github/workflows/release.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

// ── release.yml ──────────────────────────────────────────────

assert.match(
    releaseWorkflow,
    /name:\s+Verify release tag matches server version[\s\S]*process\.env\.RELEASE_VERSION/,
    'release workflow must verify tag version against server-node/package.json',
);
assert.match(
    releaseWorkflow,
    /workflow_dispatch:[\s\S]*tag:[\s\S]*Release tag to publish/,
    'release workflow must support manual dispatch for backfilling an existing release tag',
);
assert.match(
    releaseWorkflow,
    /ref:\s+\$\{\{ steps\.release\.outputs\.tag \}\}/,
    'release workflow must checkout the resolved release tag',
);

// Docker tags
assert.match(
    releaseWorkflow,
    /type=semver,pattern=\{\{version\}\},value=\$\{\{ steps\.release\.outputs\.tag \}\}/,
    'exact Docker semver tag must be generated from the resolved release tag',
);
assert.match(
    releaseWorkflow,
    /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\},value=\$\{\{ steps\.release\.outputs\.tag \}\},enable=\$\{\{ steps\.release\.outputs\.stable == 'true' \}\}/,
    'minor Docker tag must only be pushed for stable release tags',
);
assert.match(
    releaseWorkflow,
    /type=semver,pattern=\{\{major\}\},value=\$\{\{ steps\.release\.outputs\.tag \}\},enable=\$\{\{ steps\.release\.outputs\.stable == 'true' \}\}/,
    'major Docker tag must only be pushed for stable release tags',
);
assert.match(
    releaseWorkflow,
    /type=raw,value=latest,enable=\$\{\{ steps\.release\.outputs\.stable == 'true' \}\}/,
    'latest Docker tag must only be pushed for stable release tags',
);

// Cross-platform Docker build
assert.match(
    releaseWorkflow,
    /uses:\s+docker\/setup-qemu-action@v3[\s\S]*uses:\s+docker\/setup-buildx-action@v3/,
    'release workflow must set up QEMU before Buildx for cross-platform builds',
);
assert.match(
    releaseWorkflow,
    /platforms:\s+linux\/amd64,linux\/arm64/,
    'release workflow must publish linux/amd64 and linux/arm64 Docker images',
);

// GitHub Release job
assert.match(
    releaseWorkflow,
    /jobs:[\s\S]*^\s{2}build:[\s\S]*^\s{2}release:/m,
    'release workflow must have both build and release jobs',
);
assert.match(
    releaseWorkflow,
    /release:[\s\S]*needs:\s*build/,
    'release job must depend on build job',
);
assert.match(
    releaseWorkflow,
    /softprops\/action-gh-release@v2/,
    'release workflow must create a GitHub Release with softprops/action-gh-release',
);
assert.match(
    releaseWorkflow,
    /permissions:[\s\S]*contents:\s*write/,
    'release job must have contents:write permission',
);
assert.match(
    releaseWorkflow,
    /lanclip-linux-amd64[\s\S]*lanclip-windows-amd64/,
    'release assets must include linux and windows executables',
);
assert.match(
    releaseWorkflow,
    /merge-multiple:\s*false/,
    'download-artifact must not merge artifacts so each OS executable is separate',
);

// ── ci.yml ───────────────────────────────────────────────────

assert.match(ciWorkflow, /node-version:\s+22\b/, 'CI executable build must use Node.js 22, not latest');
assert.match(ciWorkflow, /cache-dependency-path:\s+"\*\*\/package-lock\.json"/, 'CI npm cache must key off package-lock.json');
assert.match(
    ciWorkflow,
    /--output\s+"\.\.\/dist\/lanclip\$\{ext\}"/,
    'CI caxa output must use lanclip filename',
);
assert.match(
    ciWorkflow,
    /name:\s+lanclip-\$\{\{\s*runner\.os\s*\}\}/,
    'CI executable artifact must be named lanclip-<os>',
);
assert.match(
    ciWorkflow,
    /if:\s*runner\.os\s*==\s*'Linux'/,
    'static files should only be uploaded once (Linux only)',
);
assert.match(
    ciWorkflow,
    /validate-release-config\.mjs/,
    'CI must run the release config validator',
);

// ── Dockerfile ───────────────────────────────────────────────

assert.doesNotMatch(
    dockerfile,
    /^COPY \. \/app$/m,
    'runtime Docker image must not copy the whole repository',
);
assert.match(
    dockerfile,
    /^COPY server-node\/package\*\.json \.\/$/m,
    'runtime Docker image should install from server package manifests before copying source',
);

// ── .dockerignore ────────────────────────────────────────────

[
    'config.json',
    'history.json',
    '.storage',
    'server-node/static',
].forEach(pattern => {
    assert.match(dockerignore, new RegExp(`(^|\\n)${pattern.replaceAll('.', '\\.')}(/)?(\\n|$)`), `.dockerignore must exclude ${pattern}`);
});

console.log('Release configuration checks passed.');
