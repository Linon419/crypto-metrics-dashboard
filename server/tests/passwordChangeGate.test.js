const assert = require('assert');

const { requirePasswordChange } = require('../middleware/auth');

function createResponse() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    res: {
      status(code) {
        captured.statusCode = code;
        return this;
      },
      json(payload) {
        captured.body = payload;
        return this;
      },
    },
  };
}

function run() {
  // 仍在使用初始密码的会话必须被拦截
  {
    const { captured, res } = createResponse();
    let nextCalled = false;
    requirePasswordChange(
      { user: { id: 1, username: 'admin', passwordChangeRecommended: true } },
      res,
      () => { nextCalled = true; }
    );

    assert.strictEqual(nextCalled, false, '初始密码会话不应进入业务路由');
    assert.strictEqual(captured.statusCode, 403);
    assert.strictEqual(captured.body.code, 'PASSWORD_CHANGE_REQUIRED');
  }

  // 已完成改密的会话正常放行
  {
    const { captured, res } = createResponse();
    let nextCalled = false;
    requirePasswordChange(
      { user: { id: 1, username: 'admin', passwordChangeRecommended: false } },
      res,
      () => { nextCalled = true; }
    );

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(captured.statusCode, null);
  }

  // 缺失该字段时（例如开发绕过注入的用户）不应误伤
  {
    const { res } = createResponse();
    let nextCalled = false;
    requirePasswordChange({ user: { id: 999, username: 'dev-mode' } }, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  }

  // 非真值的伪造字段不得绕过（仅严格 true 触发拦截，其余放行）
  {
    const { res } = createResponse();
    let nextCalled = false;
    requirePasswordChange(
      { user: { id: 1, passwordChangeRecommended: 'false' } },
      res,
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true);
  }

  // 本地一键启动：只提示不锁功能，避免非技术用户被关不掉的弹窗挡住
  {
    const previous = process.env.DASHBOARD_LOCAL_MODE;
    process.env.DASHBOARD_LOCAL_MODE = '1';
    try {
      const { captured, res } = createResponse();
      let nextCalled = false;
      requirePasswordChange(
        { user: { id: 1, username: 'admin', passwordChangeRecommended: true } },
        res,
        () => { nextCalled = true; }
      );
      assert.strictEqual(nextCalled, true, '本地模式不应拦截业务接口');
      assert.strictEqual(captured.statusCode, null);
    } finally {
      if (previous === undefined) delete process.env.DASHBOARD_LOCAL_MODE;
      else process.env.DASHBOARD_LOCAL_MODE = previous;
    }
  }

  console.log('passwordChangeGate.test.js passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
