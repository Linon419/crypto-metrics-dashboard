const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BUILD_FINGERPRINT_FILE,
  computeFrontendBuildFingerprint,
  ensureFrontendBuild,
} = require('../../scripts/frontend-build-cache');

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-launcher-build-'));
  writeFile(root, 'package.json', '{"scripts":{"build":"fixture"}}\n');
  writeFile(root, 'package-lock.json', '{"lockfileVersion":3}\n');
  writeFile(root, 'postcss.config.js', 'module.exports = {};\n');
  writeFile(root, 'tailwind.config.js', 'module.exports = {};\n');
  writeFile(root, 'public/index.html', '<div id="root"></div>\n');
  writeFile(root, 'src/index.js', 'console.log("v1");\n');
  writeFile(root, 'src/example.test.js', 'throw new Error("test-only");\n');
  return root;
}

function runEnsure(root, calls, env = {}) {
  return ensureFrontendBuild({
    root,
    env,
    logMessage(message) { calls.logs.push(message); },
    runBuild() {
      calls.builds += 1;
      writeFile(root, 'build/index.html', `<html>build-${calls.builds}</html>\n`);
      writeFile(root, `build/static/js/main.${calls.builds}.js`, 'bundle\n');
    },
    copyBuild(source, destination) {
      calls.copies += 1;
      fs.rmSync(destination, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true });
    },
  });
}

function run() {
  const root = createFixture();
  const calls = { builds: 0, copies: 0, logs: [] };

  try {
    runEnsure(root, calls);
    assert.deepStrictEqual({ builds: calls.builds, copies: calls.copies }, { builds: 1, copies: 1 });
    assert.ok(fs.existsSync(path.join(root, 'build', BUILD_FINGERPRINT_FILE)));
    assert.ok(fs.existsSync(path.join(root, 'server/client/build', BUILD_FINGERPRINT_FILE)));

    runEnsure(root, calls);
    assert.deepStrictEqual({ builds: calls.builds, copies: calls.copies }, { builds: 1, copies: 1 });

    const beforeTestChange = computeFrontendBuildFingerprint(root, {});
    writeFile(root, 'src/example.test.js', 'test-only content changed\n');
    assert.strictEqual(computeFrontendBuildFingerprint(root, {}), beforeTestChange);

    writeFile(root, 'src/index.js', 'console.log("v2");\n');
    runEnsure(root, calls);
    assert.deepStrictEqual({ builds: calls.builds, copies: calls.copies }, { builds: 2, copies: 2 });

    fs.writeFileSync(path.join(root, 'server/client/build', BUILD_FINGERPRINT_FILE), 'stale\n');
    runEnsure(root, calls);
    assert.deepStrictEqual({ builds: calls.builds, copies: calls.copies }, { builds: 2, copies: 3 });

    const baseFingerprint = computeFrontendBuildFingerprint(root, {});
    const envFingerprint = computeFrontendBuildFingerprint(root, { REACT_APP_FLAG: 'enabled' });
    assert.notStrictEqual(envFingerprint, baseFingerprint);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('localLauncherBuild.test.js passed');
}

run();
