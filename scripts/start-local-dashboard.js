const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCAL_JWT_SECRET = 'local-one-click-dashboard-secret-change-me-2026';
const LOCAL_ADMIN_PASSWORD = '123456';

let serverProcess = null;

function log(message) {
  console.log(`[local-launcher] ${message}`);
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadRootEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    log('No .env file found. Local defaults will be used.');
    log('Copy .env.example to .env to configure OpenAI and local credentials.');
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = parseEnvValue(normalized.slice(separatorIndex + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  log('Loaded configuration from .env.');
}

function getLocalPort() {
  return process.env.PORT || '3001';
}

function getAppUrl() {
  return process.env.API_PUBLIC_HOST || `http://localhost:${getLocalPort()}`;
}

function getHealthUrl() {
  return `${getAppUrl()}/api/test`;
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function run(command, args, options = {}) {
  log(`${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: 'false',
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { force: true, recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function ensureDependencies() {
  if (!commandExists('node') || !commandExists('npm')) {
    throw new Error('Node.js and npm are required. Install Node.js LTS from https://nodejs.org/ and run this launcher again.');
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log('Installing dependencies. This can take several minutes on the first run.');
    run('npm', ['install']);
  }
}

function ensureFrontendBuild() {
  const buildSource = path.join(ROOT, 'build');
  const buildTarget = path.join(ROOT, 'server', 'client', 'build');
  const targetIndex = path.join(buildTarget, 'index.html');

  if (!fs.existsSync(targetIndex)) {
    log('Building frontend for local use.');
    run('npm', ['run', 'build']);
    copyDirectory(buildSource, buildTarget);
    return;
  }

  log('Using existing frontend build.');
}

function checkHealth(timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = http.get(getHealthUrl(), { timeout: timeoutMs }, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    if (await checkHealth()) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

function openBrowser(url) {
  if (process.env.LOCAL_LAUNCHER_NO_BROWSER === '1') {
    log(`Browser opening skipped by LOCAL_LAUNCHER_NO_BROWSER. URL: ${url}`);
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function startServer() {
  const port = getLocalPort();
  const appUrl = getAppUrl();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: port,
    API_PUBLIC_HOST: appUrl,
    DB_STORAGE: process.env.DB_STORAGE || path.join(ROOT, 'database.sqlite'),
    JWT_SECRET: process.env.JWT_SECRET || LOCAL_JWT_SECRET,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || LOCAL_ADMIN_PASSWORD,
  };

  serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  serverProcess.on('exit', code => {
    if (code !== 0 && code !== null) {
      console.error(`[local-launcher] Local server exited with code ${code}`);
    }
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
}

async function main() {
  process.on('SIGINT', () => {
    stopServer();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopServer();
    process.exit(0);
  });

  log('Starting Crypto Metrics Dashboard locally.');
  log(`Project folder: ${ROOT}`);

  ensureDependencies();
  loadRootEnv();
  ensureFrontendBuild();

  if (await checkHealth()) {
    log('Local service is already running.');
    openBrowser(getAppUrl());
    return;
  }

  startServer();

  const ready = await waitForServer();
  if (!ready) {
    throw new Error('Local service did not become ready within 90 seconds. Check the log above.');
  }

  log(`Local dashboard is ready: ${getAppUrl()}`);
  log(`First local admin account on a new database: admin / ${LOCAL_ADMIN_PASSWORD}`);
  openBrowser(getAppUrl());

  if (process.env.LOCAL_LAUNCHER_EXIT_AFTER_READY === '1') {
    stopServer();
    return;
  }

  await new Promise(() => {});
}

main().catch(error => {
  console.error(`[local-launcher] ${error.message}`);
  stopServer();
  process.exit(1);
});
