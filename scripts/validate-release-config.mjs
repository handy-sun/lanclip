import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const releaseWorkflow = read('.github/workflows/release.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

assert.match(
    releaseWorkflow,
    /name:\s+Verify release tag matches server version[\s\S]*process\.env\.GITHUB_REF_NAME/,
    'release workflow must verify tag version against server-node/package.json',
);

assert.match(
    releaseWorkflow,
    /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\},enable=\$\{\{ !contains\(github\.ref_name, '-'\) \}\}/,
    'minor Docker tag must only be pushed for stable release tags',
);
assert.match(
    releaseWorkflow,
    /type=semver,pattern=\{\{major\}\},enable=\$\{\{ !contains\(github\.ref_name, '-'\) \}\}/,
    'major Docker tag must only be pushed for stable release tags',
);
assert.match(
    releaseWorkflow,
    /type=raw,value=latest,enable=\$\{\{ !contains\(github\.ref_name, '-'\) \}\}/,
    'latest Docker tag must only be pushed for stable release tags',
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
