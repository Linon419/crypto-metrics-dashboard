const { trainBayesianRuleModel } = require('./btcBayesianSignals');
const {
  FEATURE_NAMES,
  HORIZONS,
  buildBtcPredictionRows,
  buildLatestFeatureRow,
  hasPublishPrice,
  hasRequiredInputs,
  hasSchellingPoint,
  sortMetrics,
} = require('./btcPredictionFeatures');
const {
  evaluateBinaryPredictions,
  pickBestModelResult,
  trainDecisionTree,
  trainGaussianNaiveBayes,
  trainGradientBoostedStumps,
  trainKMeansStateModel,
  trainLinearReturnRegression,
  trainLogisticRegression,
  trainMajorityModel,
  trainRandomForest,
} = require('./btcPredictionModels');

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function toPercent(value) {
  return round(Number(value) * 100, 2);
}

function serializeMetrics(metrics) {
  return {
    total: metrics.total,
    accuracy: round(metrics.accuracy),
    precision: round(metrics.precision),
    recall: round(metrics.recall),
    f1: round(metrics.f1),
    auc: round(metrics.auc),
    signalThreshold: metrics.signalThreshold,
    signalCount: metrics.signalCount,
    precisionAtThreshold: round(metrics.precisionAtThreshold),
    winRateWhenSignal: round(metrics.winRateWhenSignal),
    averageReturnWhenSignal: round(metrics.averageReturnWhenSignal),
    maxDrawdownWhenSignal: round(metrics.maxDrawdownWhenSignal),
    averageProbability: round(metrics.averageProbability),
    confusion: metrics.confusion,
  };
}

function createModelSpecs(featureNames = FEATURE_NAMES) {
  return [
    {
      modelName: 'Majority Baseline',
      train: rows => trainMajorityModel(rows),
    },
    {
      modelName: 'Logistic Regression',
      train: rows => trainLogisticRegression(rows, featureNames),
    },
    {
      modelName: 'Decision Tree',
      train: rows => trainDecisionTree(rows, featureNames, { maxDepth: 4, minLeaf: 5 }),
    },
    {
      modelName: 'Naive Bayes',
      train: rows => trainGaussianNaiveBayes(rows, featureNames),
    },
    {
      modelName: 'Random Forest',
      train: rows => trainRandomForest(rows, featureNames, {
        treeCount: 35,
        maxDepth: 5,
        minLeaf: 4,
        seed: 5310,
      }),
    },
    {
      modelName: 'Gradient Boosted Stumps',
      train: rows => trainGradientBoostedStumps(rows, featureNames, {
        rounds: 55,
        learningRate: 0.12,
      }),
    },
    {
      modelName: 'K-means State Model',
      train: rows => trainKMeansStateModel(rows, featureNames, { k: 4 }),
    },
    {
      modelName: 'Linear Return Regression',
      train: rows => trainLinearReturnRegression(rows, featureNames),
    },
    {
      modelName: 'Bayesian Rule Model',
      train: rows => trainBayesianRuleModel(rows),
    },
  ];
}

function buildWalkForwardFolds(rows, options = {}) {
  const minTrainingRows = options.minTrainingRows || Math.max(50, Math.floor(rows.length * 0.45));
  const remainingRows = rows.length - minTrainingRows;
  if (remainingRows <= 0) return [];

  const requestedFolds = options.folds || 5;
  const testWindow = Math.max(8, Math.floor(remainingRows / requestedFolds));
  const folds = [];

  for (let testStart = minTrainingRows; testStart < rows.length; testStart += testWindow) {
    const testEnd = Math.min(testStart + testWindow, rows.length);
    if (testEnd <= testStart) break;
    folds.push({
      trainRows: rows.slice(0, testStart),
      testRows: rows.slice(testStart, testEnd),
      trainStart: rows[0]?.date,
      trainEnd: rows[testStart - 1]?.date,
      testStart: rows[testStart]?.date,
      testEnd: rows[testEnd - 1]?.date,
    });
  }

  return folds;
}

function modelCanTrain(rows) {
  const positives = rows.filter(row => row.target_up === 1).length;
  const negatives = rows.length - positives;
  return rows.length >= 20 && positives > 0 && negatives > 0;
}

function runModelPrediction(model, row) {
  const result = model.predict(row);
  const probability = Math.min(Math.max(Number(result.probability), 0), 1);
  return {
    ...result,
    probability,
  };
}

function backtestHorizon(rows, horizon, modelSpecs, options = {}) {
  const horizonRows = rows
    .filter(row => row.target_horizon === horizon)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const folds = buildWalkForwardFolds(horizonRows, options);
  const byModel = new Map();

  modelSpecs.forEach((spec) => {
    byModel.set(spec.modelName, []);
  });

  folds.forEach((fold, foldIndex) => {
    if (!modelCanTrain(fold.trainRows)) return;

    modelSpecs.forEach((spec) => {
      const model = spec.train(fold.trainRows);
      fold.testRows.forEach((row) => {
        const prediction = runModelPrediction(model, row);
        byModel.get(spec.modelName).push({
          date: row.date,
          futureDate: row.future_date,
          yTrue: row.target_up,
          probability: prediction.probability,
          futureReturn: row.future_return,
          foldIndex,
          explanation: prediction.explanation,
          conditionKey: prediction.conditionKey,
          marketState: prediction.marketState,
          sampleSize: prediction.sampleSize,
        });
      });
    });
  });

  return [...byModel.entries()].map(([modelName, predictions]) => {
    const metrics = evaluateBinaryPredictions(predictions);
    return {
      horizon,
      modelName,
      folds: folds.length,
      predictions: predictions.length,
      metrics: serializeMetrics(metrics),
    };
  });
}

function buildLatestPredictions(rows, latestFeature, modelSpecs) {
  if (!latestFeature) return [];

  return HORIZONS.flatMap((horizon) => {
    const horizonRows = rows
      .filter(row => row.target_horizon === horizon)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!modelCanTrain(horizonRows)) return [];

    return modelSpecs.map((spec) => {
      const model = spec.train(horizonRows);
      const prediction = runModelPrediction(model, latestFeature);
      return {
        horizon,
        modelName: spec.modelName,
        probability: round(prediction.probability),
        probabilityPercent: toPercent(prediction.probability),
        predictedDirection: prediction.probability >= 0.6 ? 'up' : prediction.probability <= 0.4 ? 'down' : 'neutral',
        explanation: prediction.explanation,
        conditionKey: prediction.conditionKey,
        sampleSize: prediction.sampleSize,
        marketState: prediction.marketState,
        trainingRows: horizonRows.length,
      };
    });
  });
}

function summarizeData(metrics, predictionRows, latestFeature) {
  const sorted = sortMetrics(metrics);
  const withInputs = sorted.filter(hasRequiredInputs);
  const withSchelling = withInputs.filter(hasSchellingPoint);
  const withPublishPrice = withInputs.filter(hasPublishPrice);
  const nullSchellingRows = withInputs.length - withSchelling.length;
  const nullPublishPriceRows = withInputs.length - withPublishPrice.length;

  return {
    totalRows: sorted.length,
    rowsWithInputs: withInputs.length,
    rowsWithSchellingPoint: withSchelling.length,
    rowsWithoutSchellingPoint: nullSchellingRows,
    rowsWithBtcPublishPrice: withPublishPrice.length,
    rowsWithoutBtcPublishPrice: nullPublishPriceRows,
    predictionRows: predictionRows.length,
    firstDate: sorted[0]?.date || null,
    lastDate: sorted[sorted.length - 1]?.date || null,
    firstTrainingDate: withPublishPrice[0]?.date || null,
    latestTrainingFeatureDate: latestFeature?.date || null,
    latestRawDate: withInputs[withInputs.length - 1]?.date || null,
  };
}

function runBtcPredictionBacktest(metrics = [], options = {}) {
  const horizons = options.horizons || HORIZONS;
  const featureNames = options.featureNames || FEATURE_NAMES;
  const predictionRows = buildBtcPredictionRows(metrics, { horizons });
  const latestFeature = buildLatestFeatureRow(metrics);
  const modelSpecs = createModelSpecs(featureNames);
  const modelResults = horizons.flatMap(horizon => backtestHorizon(
    predictionRows,
    horizon,
    modelSpecs,
    options
  ));
  const bestResult = pickBestModelResult(modelResults);
  const latestPredictions = buildLatestPredictions(predictionRows, latestFeature, modelSpecs);
  const bestLatestPrediction = bestResult
    ? latestPredictions.find(item => item.horizon === bestResult.horizon && item.modelName === bestResult.modelName)
    : null;
  const bestByHorizon = horizons
    .map(horizon => pickBestModelResult(modelResults.filter(result => result.horizon === horizon)))
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    target: 'BTC Binance USD-M perpetual publish-price direction',
    horizons,
    data: summarizeData(metrics, predictionRows, latestFeature),
    latestFeature: latestFeature ? {
      date: latestFeature.date,
      timestamp: latestFeature.timestamp,
      otc_index: latestFeature.otc_index,
      explosion_index: latestFeature.explosion_index,
      schelling_point: latestFeature.schelling_point,
      btc_publish_price: latestFeature.btc_publish_price,
      entry_exit_type: latestFeature.entry_exit_type,
      entry_exit_day: latestFeature.entry_exit_day,
      periodState: latestFeature.periodState,
    } : null,
    modelResults,
    bestByHorizon,
    bestResult,
    bestLatestPrediction,
    latestPredictions,
    notes: [
      'Targets use future BTCUSDT Binance USD-M perpetual 1m close at each publish minute.',
      'Rows without cached BTC publish price are excluded from target evaluation.',
      'Schelling point remains a model feature when available.',
      'Gradient Boosted Stumps is the local no-dependency boosting benchmark for this Node project.',
    ],
  };
}

module.exports = {
  buildWalkForwardFolds,
  createModelSpecs,
  runBtcPredictionBacktest,
};
