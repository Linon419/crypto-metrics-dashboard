const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ensureDependencies } = require('../../scripts/start-local-dashboard');

function createRoot({ withNodeModules = false, withPatch = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-launcher-deps-'));
  if (withNodeModules) fs.mkdirSync(path.join(root, 'node_modules'));
  if (withPatch) {
    fs.mkdirSync(path.join(root, 'node_modules', '@ant-design', 'v5-patch-for-react-19'), {
      recursive: true,
    });
  }
  return root;
}

function checkInstall(root) {
  const calls = [];
  ensureDependencies({
    root,
    hasCommand: () => true,
    installDependencies: () => calls.push('install'),
    logMessage: () => {},
  });
  return calls;
}

function run() {
  const roots = [];
  try {
    const completeRoot = createRoot({ withPatch: true });
    roots.push(completeRoot);
    assert.deepStrictEqual(checkInstall(completeRoot), []);

    const emptyRoot = createRoot();
    roots.push(emptyRoot);
    assert.deepStrictEqual(checkInstall(emptyRoot), ['install']);

    const incompleteRoot = createRoot({ withNodeModules: true });
    roots.push(incompleteRoot);
    assert.deepStrictEqual(checkInstall(incompleteRoot), ['install']);
  } finally {
    roots.forEach(root => fs.rmSync(root, { recursive: true, force: true }));
  }

  console.log('localLauncherDependencies.test.js passed');
}

run();
