#!/usr/bin/env node
/**
 * 后端测试聚合运行器。
 *
 * server/tests 下的用例是独立的 Node 脚本，此前没有统一入口，
 * 也就没有任何 CI 在跑它们。本脚本负责发现、串行执行并汇总结果。
 *
 * 用法：
 *   node server/tests/run-all.js              运行全部 *.test.js
 *   node server/tests/run-all.js authSecurity 只运行文件名包含该关键字的用例
 *
 * 默认把 DB_STORAGE 指向临时目录，避免测试连上仓库里的真实数据库。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;
const TEST_FILE_PATTERN = /\.test\.js$/;

function discoverTests(filter) {
  return fs
    .readdirSync(TESTS_DIR)
    .filter(name => TEST_FILE_PATTERN.test(name))
    .filter(name => !filter || name.toLowerCase().includes(filter.toLowerCase()))
    .sort();
}

function createScratchDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-metrics-tests-'));
  return { dir, storage: path.join(dir, 'test.sqlite') };
}

function removeScratchDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响测试结论
  }
}

function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function run() {
  const filter = process.argv[2];
  const tests = discoverTests(filter);

  if (tests.length === 0) {
    console.error(filter ? `没有匹配 "${filter}" 的测试文件` : '未发现任何测试文件');
    process.exit(1);
  }

  const scratch = createScratchDbPath();
  const env = {
    ...process.env,
    // 显式指定则尊重调用方，否则一律用临时库，防止误连仓库数据库
    DB_STORAGE: process.env.DB_STORAGE || scratch.storage,
  };

  console.log(`运行 ${tests.length} 个后端测试文件（Node ${process.version}）\n`);

  const failures = [];
  const startedAt = Date.now();

  tests.forEach(name => {
    const testStartedAt = Date.now();
    const result = spawnSync(process.execPath, [path.join(TESTS_DIR, name)], {
      env,
      encoding: 'utf8',
      timeout: 120000,
    });

    const duration = formatDuration(Date.now() - testStartedAt);
    const ok = result.status === 0;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${duration}`);

    if (!ok) {
      failures.push({
        name,
        status: result.status,
        signal: result.signal,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      });
    }
  });

  removeScratchDir(scratch.dir);

  const total = formatDuration(Date.now() - startedAt);

  if (failures.length > 0) {
    console.log(`\n${'='.repeat(70)}`);
    failures.forEach(failure => {
      const reason = failure.signal ? `signal ${failure.signal}` : `exit ${failure.status}`;
      console.log(`\n失败：${failure.name}（${reason}）`);
      const output = `${failure.stdout}\n${failure.stderr}`.trim();
      // 只保留末尾输出，避免 Sequelize 的启动日志淹没断言信息
      console.log(output.split('\n').slice(-25).join('\n'));
    });
    console.log(`\n${'='.repeat(70)}`);
  }

  const passed = tests.length - failures.length;
  console.log(`\n结果：${passed}/${tests.length} 通过，耗时 ${total}`);

  if (failures.length > 0) {
    console.log(`失败文件：${failures.map(failure => failure.name).join(', ')}`);
    process.exit(1);
  }
}

run();
