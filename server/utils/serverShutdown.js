function closeWebSocketServer(wss) {
  if (!wss) return Promise.resolve();

  wss.clients?.forEach(client => client.terminate?.());
  return new Promise((resolve, reject) => {
    try {
      wss.close(error => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
}

function closeHttpServer(server) {
  if (!server?.close) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      server.close(error => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
}

async function closeApplicationResources({ server, wss, sequelize } = {}) {
  // 升级连接会让 HTTP server.close() 持续等待，先终止 WebSocket 客户端。
  await closeWebSocketServer(wss);
  await closeHttpServer(server);
  await sequelize?.close?.();
}

module.exports = {
  closeApplicationResources,
  closeHttpServer,
  closeWebSocketServer,
};
