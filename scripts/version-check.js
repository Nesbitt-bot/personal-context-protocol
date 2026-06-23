const fs = require('fs');
const path = require('path');
const { readProjectVersion } = require('./project-version');

const root = process.cwd();
const version = readProjectVersion(root);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];

function requireMatch(name, actual, expected = version) {
  if (actual !== expected) {
    failures.push(`${name} is ${actual || 'missing'}, expected ${expected}`);
  }
}

requireMatch('package.json version', packageJson.version);

const runtimeVersionPath = path.join(root, 'src', 'lib', 'version.ts');
if (fs.existsSync(runtimeVersionPath)) {
  const runtimeVersion = fs.readFileSync(runtimeVersionPath, 'utf8');
  const fallback = runtimeVersion.match(/\|\| '([^']+)'/);
  requireMatch('src/lib/version.ts fallback', fallback?.[1]);
}

const composePath = path.join(root, 'docker-compose.yml');
if (fs.existsSync(composePath)) {
  const compose = fs.readFileSync(composePath, 'utf8');
  const tagDefault = compose.match(/image:\s*personal-context-protocol:\$\{PCP_VERSION:-([^}]+)\}/);
  const argDefault = compose.match(/APP_VERSION:\s*"\$\{PCP_VERSION:-([^}]+)\}"/);
  requireMatch('docker-compose image tag default', tagDefault?.[1]);
  requireMatch('docker-compose APP_VERSION default', argDefault?.[1]);
}

const dockerfilePath = path.join(root, 'Dockerfile');
if (fs.existsSync(dockerfilePath)) {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const argDefault = dockerfile.match(/ARG APP_VERSION=([^\s]+)/);
  requireMatch('Dockerfile APP_VERSION default', argDefault?.[1]);
}

if (failures.length > 0) {
  console.log('Unable to validate version consistency: release metadata / VERSION alignment - mismatched version values:');
  failures.forEach((failure) => console.log(`   - ${failure}`));
  process.exit(1);
}

console.log(`Version consistency: release metadata / VERSION alignment - all checked files use ${version}.`);
