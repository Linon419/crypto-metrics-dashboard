const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUILD_FINGERPRINT_FILE = '.launcher-build-fingerprint';
const FRONTEND_BUILD_INPUTS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  'package-lock.json',
  'package.json',
  'postcss.config.js',
  'public',
  'src',
  'tailwind.config.js',
];
const BUILD_ENV_KEYS = new Set([
  'DISABLE_ESLINT_PLUGIN',
  'GENERATE_SOURCEMAP',
  'IMAGE_INLINE_SIZE_LIMIT',
  'INLINE_RUNTIME_CHUNK',
  'PUBLIC_URL',
]);

function isFrontendBuildInput(relativePath) {
  const normalized = String(relativePath).split(path.sep).join('/');
  if (/(^|\/)__tests__(\/|$)/.test(normalized)) return false;
  if (/\.(test|spec)\.[^/]+$/.test(normalized)) return false;
  if (normalized === 'src/setupTests.js') return false;
  return true;
}

function collectBuildInputFiles(root, entry, files) {
  const absolutePath = path.join(root, entry);
  if (!fs.existsSync(absolutePath)) return;

  const stats = fs.statSync(absolutePath);
  if (stats.isFile()) {
    if (isFrontendBuildInput(entry)) files.push(entry);
    return;
  }
  if (!stats.isDirectory()) return;

  fs.readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach(child => collectBuildInputFiles(root, path.join(entry, child.name), files));
}

function computeFrontendBuildFingerprint(root, env = process.env) {
  const hash = crypto.createHash('sha256');
  const files = [];
  FRONTEND_BUILD_INPUTS.forEach(entry => collectBuildInputFiles(root, entry, files));
  files.sort().forEach((relativePath) => {
    hash.update(`file:${relativePath}\0`);
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update('\0');
  });

  Object.keys(env)
    .filter(key => key.startsWith('REACT_APP_') || BUILD_ENV_KEYS.has(key))
    .sort()
    .forEach(key => hash.update(`env:${key}=${env[key]}\0`));

  return hash.digest('hex');
}

function readBuildFingerprint(buildDirectory) {
  const fingerprintPath = path.join(buildDirectory, BUILD_FINGERPRINT_FILE);
  if (!fs.existsSync(fingerprintPath)) return '';
  return fs.readFileSync(fingerprintPath, 'utf8').trim();
}

function writeBuildFingerprint(buildDirectory, fingerprint) {
  fs.writeFileSync(path.join(buildDirectory, BUILD_FINGERPRINT_FILE), `${fingerprint}\n`);
}

function ensureFrontendBuild({
  root,
  env = process.env,
  logMessage,
  runBuild,
  copyBuild,
}) {
  const buildSource = path.join(root, 'build');
  const buildTarget = path.join(root, 'server', 'client', 'build');
  const sourceIndex = path.join(buildSource, 'index.html');
  const targetIndex = path.join(buildTarget, 'index.html');
  const fingerprint = computeFrontendBuildFingerprint(root, env);

  const sourceIsCurrent = fs.existsSync(sourceIndex)
    && readBuildFingerprint(buildSource) === fingerprint;
  if (!sourceIsCurrent) {
    logMessage('Frontend sources changed or no current build exists. Building frontend.');
    runBuild();
    if (!fs.existsSync(sourceIndex)) {
      throw new Error('Frontend build completed without producing build/index.html');
    }
    writeBuildFingerprint(buildSource, fingerprint);
  }

  const targetIsCurrent = fs.existsSync(targetIndex)
    && readBuildFingerprint(buildTarget) === fingerprint;
  if (!targetIsCurrent) {
    logMessage('Synchronizing the frontend build used by the local server.');
    copyBuild(buildSource, buildTarget);
    return;
  }

  logMessage('Using current frontend build.');
}

module.exports = {
  BUILD_FINGERPRINT_FILE,
  computeFrontendBuildFingerprint,
  ensureFrontendBuild,
  isFrontendBuildInput,
  readBuildFingerprint,
};
