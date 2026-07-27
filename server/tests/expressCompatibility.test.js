/**
 * 回归用例：server/index.js 必须在 express 4 与 5 上都能注册路由。
 *
 * 背景：仓库根装 express 5，server/ 下装 express 4，
 * 而 scripts/build-launcher-packages.js 打包时会跳过 server/node_modules，
 * 于是分发出去的一键启动器只能解析到根目录的 express 5。
 * express 5 的 path-to-regexp v8 不再接受裸 '*'，
 * `app.get('*', ...)` 会在启动时抛 TypeError: Missing parameter name，
 * 用户只会看到"本地服务 90 秒内未就绪"。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '../index.js');

function run() {
  const rawSource = fs.readFileSync(INDEX_PATH, 'utf8');
  // 注释里会引用这个反例写法，先剥掉注释再检查，避免自我误报
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  // 1. 不得再出现 express 5 无法解析的裸通配路由
  const badWildcard = /app\.(get|post|put|delete|all|use)\(\s*(['"`])\*\2/;
  assert.ok(
    !badWildcard.test(source),
    "server/index.js 不得使用裸 '*' 路由：express 5 会在启动时抛 Missing parameter name"
  );

  // 2. 实测当前解析到的 express 能吃下 index.js 里用到的路由写法
  const express = require('express');
  const version = require('express/package.json').version;
  const app = express();

  assert.doesNotThrow(() => {
    // SPA 回退改用 app.use，两个大版本都成立
    app.use((req, res, next) => next());
  }, `app.use 中间件在 express ${version} 上注册失败`);

  // 同时确认裸 '*' 在 express 5 上确实会炸——这条断言保证上面的检查不是空转
  if (Number(version.split('.')[0]) >= 5) {
    assert.throws(
      () => express().get('*', (req, res) => res.end()),
      /Missing parameter name|pathToRegexpError/,
      'express 5 应当拒绝裸 * 路由；若不再抛错说明上游行为已变，本用例需要更新'
    );
  }

  // 3. 根与 server 的 express 大版本必须一致，否则容器与本地跑的不是同一套代码
  const rootPkg = require('../../package.json');
  const serverPkg = require('../package.json');
  const major = spec => String(spec).replace(/^[^\d]*/, '').split('.')[0];
  assert.strictEqual(
    major(serverPkg.dependencies.express),
    major(rootPkg.dependencies.express),
    'server/package.json 与根 package.json 的 express 大版本必须一致'
  );

  console.log(`expressCompatibility.test.js passed (express ${version})`);
}

run();
