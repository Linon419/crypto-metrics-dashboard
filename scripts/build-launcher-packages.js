const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'local-artifacts', 'launchers');
const INCLUDE_DATABASE = process.argv.includes('--include-db');
const PACKAGE_NAME = INCLUDE_DATABASE
  ? 'crypto-dashboard-local-one-click-with-data'
  : 'crypto-dashboard-local-one-click';
const PACKAGE_DIR = path.join(OUTPUT_ROOT, PACKAGE_NAME);
const ZIP_PATH = path.join(OUTPUT_ROOT, `${PACKAGE_NAME}.zip`);
const INCLUDE_FILES = [
  '.env.example',
  'Dockerfile',
  'README.md',
  'package-lock.json',
  'package.json',
  'postcss.config.js',
  'tailwind.config.js',
];
const INCLUDE_DIRS = [
  'launchers',
  'public',
  'scripts',
  'server',
  'src',
];

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { force: true, recursive: true });
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (
      entry.name === 'node_modules' ||
      entry.name === 'client' ||
      entry.name === 'output' ||
      entry.name === '.env' ||
      entry.name.endsWith('.sqlite') ||
      entry.name.endsWith('.sqlite3') ||
      entry.name.endsWith('.db')
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function commandExists(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function copyDatabaseIfRequested() {
  if (!INCLUDE_DATABASE) return;

  const databasePath = path.join(ROOT, 'database.sqlite');
  if (!fs.existsSync(databasePath)) {
    throw new Error(`--include-db was requested, but ${databasePath} does not exist`);
  }

  fs.copyFileSync(databasePath, path.join(PACKAGE_DIR, 'database.sqlite'));
}

function createZip() {
  removeIfExists(ZIP_PATH);

  if (commandExists('zip')) {
    execFileSync('zip', ['-r', '-X', ZIP_PATH, PACKAGE_NAME], { cwd: OUTPUT_ROOT, stdio: 'ignore' });
    return true;
  }

  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/ditto')) {
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', PACKAGE_DIR, ZIP_PATH]);
    return true;
  }

  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path "${PACKAGE_DIR}" -DestinationPath "${ZIP_PATH}" -Force`,
    ]);
    return true;
  }

  return false;
}

function writeMetadata() {
  const metadata = {
    name: PACKAGE_NAME,
    appUrl: 'http://localhost:3001',
    includesDatabase: INCLUDE_DATABASE,
    createdAt: new Date().toISOString(),
    contents: [
      'launchers/windows/Start Crypto Dashboard.bat',
      'launchers/windows/Start-CryptoDashboard.ps1',
      'launchers/mac/Start Crypto Dashboard.command',
      'README.md',
    ],
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

function main() {
  removeIfExists(PACKAGE_DIR);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });
  for (const fileName of INCLUDE_FILES) {
    fs.copyFileSync(path.join(ROOT, fileName), path.join(PACKAGE_DIR, fileName));
  }
  for (const dirName of INCLUDE_DIRS) {
    copyDirectory(path.join(ROOT, dirName), path.join(PACKAGE_DIR, dirName));
  }
  copyDatabaseIfRequested();
  writeMetadata();
  fs.chmodSync(path.join(PACKAGE_DIR, 'launchers', 'mac', 'Start Crypto Dashboard.command'), 0o755);

  const zipped = createZip();
  console.log(`Launcher package folder: ${PACKAGE_DIR}`);
  if (zipped) {
    console.log(`Launcher package zip: ${ZIP_PATH}`);
  } else {
    console.log('Zip tool unavailable. Use the package folder directly.');
  }
}

main();
