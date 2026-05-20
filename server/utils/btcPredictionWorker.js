const { parentPort, workerData } = require('worker_threads');
const { runBtcPredictionBacktest } = require('./btcPredictionRunner');

try {
  const result = runBtcPredictionBacktest(workerData.metrics || []);
  parentPort.postMessage({ success: true, result });
} catch (error) {
  parentPort.postMessage({
    success: false,
    error: error.message || 'BTC prediction worker failed',
    stack: error.stack,
  });
}
