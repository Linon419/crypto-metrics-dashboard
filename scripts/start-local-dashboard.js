const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ensureFrontendBuild: ensureCachedFrontendBuild } = require('./frontend-build-cache');

const ROOT = path.join(__dirname, '..');
const LOCAL_JWT_SECRET = 'local-one-click-dashboard-secret-change-me-2026';

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

function ensureDependencies({
  root = ROOT,
  hasCommand = commandExists,
  installDependencies = () => run('npm', ['install']),
  logMessage = log,
} = {}) {
  if (!hasCommand('node') || !hasCommand('npm')) {
    throw new Error('Node.js and npm are required. Install Node.js LTS from https://nodejs.org/ and run this launcher again.');
  }

  const requiredDependency = path.join(
    root,
    'node_modules',
    '@ant-design',
    'v5-patch-for-react-19',
  );
  if (!fs.existsSync(path.join(root, 'node_modules')) || !fs.existsSync(requiredDependency)) {
    logMessage('Installing missing dependencies. This can take several minutes on the first run.');
    installDependencies();
  }
}

function ensureFrontendBuild({
  root = ROOT,
  env = process.env,
  logMessage = log,
  runBuild = () => run('npm', ['run', 'build']),
  copyBuild = copyDirectory,
} = {}) {
  return ensureCachedFrontendBuild({ root, env, logMessage, runBuild, copyBuild });
}

function checkHealth(timeoutMs = 1500) {
  return new Promise(resolve => {
    // 仅凭状态码判断会误判：端口上任何服务返回 404 都落在 200~499 内，
    // 启动器就会认定"服务已在运行"并把浏览器指向别人的应用。
    // 这里要求 200 且响应体是本服务 /api/test 的固定标记。
    const req = http.get(getHealthUrl(), { timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (body.length < 2048) body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).message === 'API is working!');
        } catch (error) {
          resolve(false);
        }
      });
      res.on('error', () => resolve(false));
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
    // 标记为本地模式：内置弱密钥只告警不中断，且服务仅监听 127.0.0.1
    DASHBOARD_LOCAL_MODE: '1',
    PORT: port,
    API_PUBLIC_HOST: appUrl,
    DB_STORAGE: process.env.DB_STORAGE || path.join(ROOT, 'database.sqlite'),
    JWT_SECRET: process.env.JWT_SECRET || LOCAL_JWT_SECRET,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
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
  log('First admin on a new database: admin / 123456. Replace the password after login.');
  openBrowser(getAppUrl());

  if (process.env.LOCAL_LAUNCHER_EXIT_AFTER_READY === '1') {
    stopServer();
    return;
  }

  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[local-launcher] ${error.message}`);
    stopServer();
    process.exit(1);
  });
}

module.exports = {
  ensureDependencies,
  ensureFrontendBuild,
};
