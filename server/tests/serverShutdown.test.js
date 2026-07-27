const assert = require('assert');

const {
  closeApplicationResources,
  closeHttpServer,
} = require('../utils/serverShutdown');

async function run() {
  const events = [];
  const clients = [
    { terminate() { events.push('client-1'); } },
    { terminate() { events.push('client-2'); } },
  ];
  const wss = {
    clients,
    close(callback) {
      assert.deepStrictEqual(events, ['client-1', 'client-2']);
      events.push('websocket-server');
      callback();
    },
  };
  const server = {
    close(callback) {
      assert.strictEqual(events.at(-1), 'websocket-server');
      events.push('http-server');
      callback();
    },
  };
  const sequelize = {
    async close() {
      assert.strictEqual(events.at(-1), 'http-server');
      events.push('database');
    },
  };

  await closeApplicationResources({ server, wss, sequelize });
  assert.deepStrictEqual(events, [
    'client-1',
    'client-2',
    'websocket-server',
    'http-server',
    'database',
  ]);

  await assert.rejects(
    () => closeHttpServer({ close(callback) { callback(new Error('close failed')); } }),
    /close failed/
  );

  console.log('serverShutdown.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
