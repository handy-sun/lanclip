import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const releaseWorkflow = read('.github/workflows/release.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

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

[
    'config.json',
    'history.json',
    '.storage',
    'cloud-clipboard.phar',
    'server-node/static',
].forEach(pattern => {
    assert.match(dockerignore, new RegExp(`(^|\\n)${pattern.replaceAll('.', '\\.')}(/)?(\\n|$)`), `.dockerignore must exclude ${pattern}`);
});

assert.match(ciWorkflow, /node-version:\s+22\b/, 'CI executable build must use Node.js 22, not latest');
assert.match(ciWorkflow, /cache-dependency-path:\s+"\*\*\/package-lock\.json"/, 'CI npm cache must key off package-lock.json');

console.log('Release configuration checks passed.');
