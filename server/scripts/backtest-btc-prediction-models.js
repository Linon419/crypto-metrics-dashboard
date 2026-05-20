const fs = require('fs');
const path = require('path');
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { runBtcPredictionBacktest } = require('../utils/btcPredictionRunner');

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return 'n/a';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function printTopResults(result) {
  const topResults = [...result.modelResults]
    .sort((a, b) => {
      const score = (item) => {
        const metrics = item.metrics || {};
        const enoughSignals = (metrics.signalCount || 0) >= 5 ? 1 : -1;
        const horizonBonus = [3, 5].includes(item.horizon) ? 0.15 : 0;
        const averageReturnScore = Math.max(metrics.averageReturnWhenSignal || 0, -0.03) * 200;
        return enoughSignals
          + (metrics.precisionAtThreshold || 0) * 3
          + averageReturnScore
          + (metrics.f1 || 0) * 0.5
          + (metrics.auc || 0) * 0.5
          + Math.min(metrics.signalCount || 0, 50) / 200
          + horizonBonus;
      };
      const aScore = score(a);
      const bScore = score(b);
      return bScore - aScore;
    })
    .slice(0, 12);

  console.log('\n========== Top backtest results ==========');
  topResults.forEach((item, index) => {
    console.log(`${index + 1}. ${item.modelName} ${item.horizon}d`);
    console.log(`   total=${item.metrics.total}, signals=${item.metrics.signalCount}, precision@60=${formatPercent(item.metrics.precisionAtThreshold)}, f1=${formatPercent(item.metrics.f1)}, auc=${formatPercent(item.metrics.auc)}, avgSignalReturn=${formatPercent(item.metrics.averageReturnWhenSignal)}`);
  });
}

async function loadBtcMetrics() {
  const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
  if (!btcCoin) {
    throw new Error('BTC coin is missing from database');
  }

  return DailyMetric.findAll({
    where: { coin_id: btcCoin.id },
    order: [['date', 'ASC']],
    raw: true,
  });
}

async function main() {
  try {
    const metrics = await loadBtcMetrics();
    const result = runBtcPredictionBacktest(metrics);
    const outputDir = path.join(__dirname, '..', 'output');
    const outputPath = path.join(outputDir, 'btc-prediction-backtest.json');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    console.log('\n========== BTC prediction backtest ==========');
    console.log(`Rows: total=${result.data.totalRows}, with_schelling=${result.data.rowsWithSchellingPoint}, without_schelling=${result.data.rowsWithoutSchellingPoint}`);
    console.log(`Training feature range: ${result.data.firstTrainingDate} -> ${result.data.latestTrainingFeatureDate}`);
    console.log(`Latest raw BTC row: ${result.data.latestRawDate}`);
    console.log(`Output: ${outputPath}`);

    printTopResults(result);

    if (result.bestResult) {
      console.log('\n========== Best selected result ==========');
      console.log(`${result.bestResult.modelName} ${result.bestResult.horizon}d`);
      console.log(`precision@60=${formatPercent(result.bestResult.metrics.precisionAtThreshold)}, signals=${result.bestResult.metrics.signalCount}, f1=${formatPercent(result.bestResult.metrics.f1)}, auc=${formatPercent(result.bestResult.metrics.auc)}, avgSignalReturn=${formatPercent(result.bestResult.metrics.averageReturnWhenSignal)}`);
    }

    if (result.bestLatestPrediction) {
      console.log('\n========== Latest usable prediction ==========');
      console.log(`Date: ${result.latestFeature.date}`);
      console.log(`Period: ${result.latestFeature.periodState.period_state_label}`);
      console.log(`${result.bestLatestPrediction.modelName} ${result.bestLatestPrediction.horizon}d probability=${result.bestLatestPrediction.probabilityPercent}% direction=${result.bestLatestPrediction.predictedDirection}`);
      if (result.bestLatestPrediction.explanation) {
        console.log(`Explanation: ${result.bestLatestPrediction.explanation}`);
      }
    }
  } catch (error) {
    console.error('BTC prediction backtest failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
