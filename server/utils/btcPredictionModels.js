const { FEATURE_NAMES, getFeatureVector } = require('./btcPredictionFeatures');

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }

  const z = Math.exp(value);
  return z / (1 + z);
}

function createRng(seed = 42) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;

  return function rng() {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, fallback = 1) {
  if (values.length <= 1) return fallback;
  const avg = mean(values);
  const value = mean(values.map(item => (item - avg) ** 2));
  return value > 1e-9 ? value : fallback;
}

function fitScaler(rows, featureNames = FEATURE_NAMES) {
  const vectors = rows.map(row => getFeatureVector(row, featureNames));
  const means = featureNames.map((_, index) => mean(vectors.map(vector => vector[index])));
  const stds = featureNames.map((_, index) => {
    const std = Math.sqrt(variance(vectors.map(vector => vector[index]), 1));
    return std > 1e-9 ? std : 1;
  });

  return {
    transform(row) {
      return getFeatureVector(row, featureNames).map((value, index) => (value - means[index]) / stds[index]);
    },
    transformVector(vector) {
      return vector.map((value, index) => (value - means[index]) / stds[index]);
    },
    means,
    stds,
  };
}

function trainMajorityModel(rows = []) {
  const upCount = rows.filter(row => Number(row.target_up) === 1).length;
  const probability = (upCount + 1) / (rows.length + 2);

  return {
    modelName: 'Majority Baseline',
    predict() {
      return { probability };
    },
  };
}

function trainLogisticRegression(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const scaler = fitScaler(rows, featureNames);
  const learningRate = options.learningRate || 0.04;
  const l2 = options.l2 || 0.001;
  const epochs = options.epochs || 700;
  const weights = new Array(featureNames.length).fill(0);
  const positiveRate = (rows.filter(row => row.target_up === 1).length + 1) / (rows.length + 2);
  let bias = Math.log(positiveRate / (1 - positiveRate));

  const training = rows.map(row => ({
    x: scaler.transform(row),
    y: Number(row.target_up) === 1 ? 1 : 0,
  }));

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    training.forEach(({ x, y }) => {
      const score = bias + weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
      const error = sigmoid(score) - y;
      for (let index = 0; index < weights.length; index += 1) {
        weights[index] -= learningRate * (error * x[index] + l2 * weights[index]);
      }
      bias -= learningRate * error;
    });
  }

  return {
    modelName: 'Logistic Regression',
    predict(row) {
      const x = scaler.transform(row);
      const score = bias + weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
      return { probability: sigmoid(score) };
    },
    weights,
    bias,
  };
}

function trainGaussianNaiveBayes(rows = [], featureNames = FEATURE_NAMES) {
  const scaler = fitScaler(rows, featureNames);
  const byClass = [0, 1].map(targetClass => rows
    .filter(row => Number(row.target_up) === targetClass)
    .map(row => scaler.transform(row)));

  const summaries = byClass.map((vectors) => {
    const count = vectors.length;
    const columns = featureNames.map((_, index) => vectors.map(vector => vector[index]));
    return {
      count,
      prior: (count + 1) / (rows.length + 2),
      means: columns.map(column => mean(column)),
      variances: columns.map(column => variance(column, 1)),
    };
  });

  function logLikelihood(x, summary) {
    return Math.log(summary.prior) + x.reduce((sum, value, index) => {
      const varValue = summary.variances[index];
      const diff = value - summary.means[index];
      return sum - 0.5 * Math.log(2 * Math.PI * varValue) - (diff * diff) / (2 * varValue);
    }, 0);
  }

  return {
    modelName: 'Naive Bayes',
    predict(row) {
      const x = scaler.transform(row);
      const downLog = logLikelihood(x, summaries[0]);
      const upLog = logLikelihood(x, summaries[1]);
      return { probability: sigmoid(upLog - downLog) };
    },
  };
}

function gini(rows) {
  if (rows.length === 0) return 0;
  const positiveRate = rows.filter(row => row.y === 1).length / rows.length;
  return 1 - positiveRate ** 2 - (1 - positiveRate) ** 2;
}

function leafNode(rows) {
  const positives = rows.filter(row => row.y === 1).length;
  return {
    type: 'leaf',
    probability: (positives + 1) / (rows.length + 2),
    count: rows.length,
  };
}

function uniqueThresholds(values, maxThresholds = 10) {
  const sorted = [...new Set(values)]
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (sorted.length <= 1) return [];

  const thresholds = [];
  const step = Math.max(1, Math.floor(sorted.length / maxThresholds));
  for (let index = step; index < sorted.length; index += step) {
    thresholds.push((sorted[index - 1] + sorted[index]) / 2);
  }

  return [...new Set(thresholds)];
}

function findBestSplit(rows, featureIndices, options = {}) {
  const minLeaf = options.minLeaf || 5;
  let best = null;
  const parentGini = gini(rows);

  featureIndices.forEach((featureIndex) => {
    const thresholds = uniqueThresholds(rows.map(row => row.x[featureIndex]), options.maxThresholds || 12);
    thresholds.forEach((threshold) => {
      const left = rows.filter(row => row.x[featureIndex] <= threshold);
      const right = rows.filter(row => row.x[featureIndex] > threshold);
      if (left.length < minLeaf || right.length < minLeaf) return;

      const weightedGini = (left.length / rows.length) * gini(left) + (right.length / rows.length) * gini(right);
      const gain = parentGini - weightedGini;
      if (!best || gain > best.gain) {
        best = { featureIndex, threshold, left, right, gain };
      }
    });
  });

  return best;
}

function randomSubset(values, size, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy.slice(0, size);
}

function buildTree(rows, featureIndices, options = {}, depth = 0, rng = null) {
  const maxDepth = options.maxDepth || 4;
  const minLeaf = options.minLeaf || 5;
  const positives = rows.filter(row => row.y === 1).length;
  const negatives = rows.length - positives;

  if (depth >= maxDepth || rows.length < minLeaf * 2 || positives === 0 || negatives === 0) {
    return leafNode(rows);
  }

  const splitFeatures = rng
    ? randomSubset(featureIndices, Math.max(1, Math.floor(Math.sqrt(featureIndices.length))), rng)
    : featureIndices;
  const split = findBestSplit(rows, splitFeatures, options);

  if (!split || split.gain <= 0) {
    return leafNode(rows);
  }

  return {
    type: 'split',
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: buildTree(split.left, featureIndices, options, depth + 1, rng),
    right: buildTree(split.right, featureIndices, options, depth + 1, rng),
  };
}

function predictTree(node, x) {
  if (node.type === 'leaf') return node.probability;
  return x[node.featureIndex] <= node.threshold
    ? predictTree(node.left, x)
    : predictTree(node.right, x);
}

function trainDecisionTree(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const scaler = fitScaler(rows, featureNames);
  const training = rows.map(row => ({
    x: scaler.transform(row),
    y: Number(row.target_up) === 1 ? 1 : 0,
  }));
  const featureIndices = featureNames.map((_, index) => index);
  const tree = buildTree(training, featureIndices, options);

  return {
    modelName: 'Decision Tree',
    predict(row) {
      return { probability: predictTree(tree, scaler.transform(row)) };
    },
    tree,
  };
}

function trainRandomForest(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const scaler = fitScaler(rows, featureNames);
  const rng = createRng(options.seed || 5310);
  const treeCount = options.treeCount || 45;
  const featureIndices = featureNames.map((_, index) => index);
  const training = rows.map(row => ({
    x: scaler.transform(row),
    y: Number(row.target_up) === 1 ? 1 : 0,
  }));
  const trees = [];

  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const sample = new Array(training.length)
      .fill(null)
      .map(() => training[Math.floor(rng() * training.length)]);
    trees.push(buildTree(sample, featureIndices, {
      maxDepth: options.maxDepth || 5,
      minLeaf: options.minLeaf || 4,
      maxThresholds: options.maxThresholds || 10,
    }, 0, rng));
  }

  return {
    modelName: 'Random Forest',
    predict(row) {
      const x = scaler.transform(row);
      return {
        probability: mean(trees.map(tree => predictTree(tree, x))),
      };
    },
    trees,
  };
}

function trainGradientBoostedStumps(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const scaler = fitScaler(rows, featureNames);
  const training = rows.map(row => ({
    x: scaler.transform(row),
    y: Number(row.target_up) === 1 ? 1 : 0,
  }));
  const positiveRate = (training.filter(row => row.y === 1).length + 1) / (training.length + 2);
  const learningRate = options.learningRate || 0.12;
  const rounds = options.rounds || 60;
  const featureIndices = featureNames.map((_, index) => index);
  const scores = new Array(training.length).fill(Math.log(positiveRate / (1 - positiveRate)));
  const stumps = [];

  for (let round = 0; round < rounds; round += 1) {
    const residualRows = training.map((row, index) => ({
      ...row,
      residual: row.y - sigmoid(scores[index]),
    }));
    let best = null;

    featureIndices.forEach((featureIndex) => {
      const thresholds = uniqueThresholds(residualRows.map(row => row.x[featureIndex]), 12);
      thresholds.forEach((threshold) => {
        const left = residualRows.filter(row => row.x[featureIndex] <= threshold);
        const right = residualRows.filter(row => row.x[featureIndex] > threshold);
        if (left.length < 4 || right.length < 4) return;

        const leftValue = mean(left.map(row => row.residual));
        const rightValue = mean(right.map(row => row.residual));
        const error = residualRows.reduce((sum, row) => {
          const predicted = row.x[featureIndex] <= threshold ? leftValue : rightValue;
          return sum + (row.residual - predicted) ** 2;
        }, 0);

        if (!best || error < best.error) {
          best = { featureIndex, threshold, leftValue, rightValue, error };
        }
      });
    });

    if (!best) break;
    stumps.push(best);
    training.forEach((row, index) => {
      const contribution = row.x[best.featureIndex] <= best.threshold ? best.leftValue : best.rightValue;
      scores[index] += learningRate * contribution;
    });
  }

  return {
    modelName: 'Gradient Boosted Stumps',
    predict(row) {
      const x = scaler.transform(row);
      const baseScore = Math.log(positiveRate / (1 - positiveRate));
      const score = stumps.reduce((sum, stump) => {
        const contribution = x[stump.featureIndex] <= stump.threshold ? stump.leftValue : stump.rightValue;
        return sum + learningRate * contribution;
      }, baseScore);
      return { probability: sigmoid(score) };
    },
    stumps,
  };
}

function distanceSquared(a, b) {
  return a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0);
}

function trainKMeansStateModel(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const selectedFeatures = options.stateFeatures || [
    'otc_index',
    'explosion_index',
    'entry_exit_day',
    'otc_change_3d',
    'explosion_change_3d',
    'is_entry_period',
    'is_exit_period',
  ];
  const scaler = fitScaler(rows, selectedFeatures);
  const vectors = rows.map(row => scaler.transform(row));
  const k = Math.min(options.k || 4, Math.max(1, vectors.length));
  let centers = new Array(k).fill(null).map((_, index) => vectors[Math.floor(index * vectors.length / k)] || vectors[0]);
  let assignments = new Array(vectors.length).fill(0);

  for (let iteration = 0; iteration < (options.iterations || 25); iteration += 1) {
    assignments = vectors.map(vector => {
      let bestIndex = 0;
      let bestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = distanceSquared(vector, center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    });

    centers = centers.map((center, index) => {
      const clusterVectors = vectors.filter((_, vectorIndex) => assignments[vectorIndex] === index);
      if (clusterVectors.length === 0) return center;
      return center.map((_, featureIndex) => mean(clusterVectors.map(vector => vector[featureIndex])));
    });
  }

  const clusterStats = centers.map((_, index) => {
    const clusterRows = rows.filter((_, rowIndex) => assignments[rowIndex] === index);
    const up = clusterRows.filter(row => row.target_up === 1).length;
    return {
      cluster: index,
      total: clusterRows.length,
      up,
      probability: (up + 1) / (clusterRows.length + 2),
    };
  });

  return {
    modelName: 'K-means State Model',
    predict(row) {
      const vector = scaler.transform(row);
      let bestIndex = 0;
      let bestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = distanceSquared(vector, center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return {
        probability: clusterStats[bestIndex].probability,
        marketState: bestIndex,
        sampleSize: clusterStats[bestIndex].total,
      };
    },
    centers,
    clusterStats,
  };
}

function trainLinearReturnRegression(rows = [], featureNames = FEATURE_NAMES, options = {}) {
  const scaler = fitScaler(rows, featureNames);
  const learningRate = options.learningRate || 0.02;
  const epochs = options.epochs || 900;
  const l2 = options.l2 || 0.001;
  const weights = new Array(featureNames.length).fill(0);
  let bias = mean(rows.map(row => Number(row.future_return) || 0));
  const training = rows.map(row => ({
    x: scaler.transform(row),
    y: Number(row.future_return) || 0,
  }));

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = new Array(weights.length).fill(0);
    let biasGradient = 0;

    training.forEach(({ x, y }) => {
      const prediction = bias + weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
      const error = prediction - y;
      for (let index = 0; index < weights.length; index += 1) {
        weightGradients[index] += error * x[index];
      }
      biasGradient += error;
    });

    const scale = training.length || 1;
    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= learningRate * (weightGradients[index] / scale + l2 * weights[index]);
    }
    bias -= learningRate * (biasGradient / scale);
  }

  return {
    modelName: 'Linear Return Regression',
    predict(row) {
      const x = scaler.transform(row);
      const predictedReturn = bias + weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
      return {
        predictedReturn,
        probability: sigmoid(predictedReturn / 0.03),
      };
    },
  };
}

function calculateAuc(predictions) {
  const positives = predictions.filter(item => item.yTrue === 1);
  const negatives = predictions.filter(item => item.yTrue === 0);
  if (positives.length === 0 || negatives.length === 0) return 0.5;

  let wins = 0;
  let ties = 0;
  positives.forEach((positive) => {
    negatives.forEach((negative) => {
      if (positive.probability > negative.probability) wins += 1;
      if (positive.probability === negative.probability) ties += 1;
    });
  });

  return (wins + ties * 0.5) / (positives.length * negatives.length);
}

function calculateMaxDrawdown(returns) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  returns.forEach((value) => {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  });

  return maxDrawdown;
}

function evaluateBinaryPredictions(predictions = [], options = {}) {
  const threshold = options.threshold || 0.5;
  const signalThreshold = options.signalThreshold || 0.6;
  const cleanPredictions = predictions
    .filter(item => Number.isFinite(Number(item.probability)) && (item.yTrue === 0 || item.yTrue === 1))
    .map(item => ({
      ...item,
      probability: clamp(Number(item.probability)),
      yPred: Number(item.probability) >= threshold ? 1 : 0,
      signal: Number(item.probability) >= signalThreshold,
      futureReturn: Number.isFinite(Number(item.futureReturn)) ? Number(item.futureReturn) : 0,
    }));

  const total = cleanPredictions.length;
  const tp = cleanPredictions.filter(item => item.yTrue === 1 && item.yPred === 1).length;
  const tn = cleanPredictions.filter(item => item.yTrue === 0 && item.yPred === 0).length;
  const fp = cleanPredictions.filter(item => item.yTrue === 0 && item.yPred === 1).length;
  const fn = cleanPredictions.filter(item => item.yTrue === 1 && item.yPred === 0).length;
  const signals = cleanPredictions.filter(item => item.signal);
  const winningSignals = signals.filter(item => item.yTrue === 1);

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const signalReturns = signals.map(item => item.futureReturn);

  return {
    total,
    accuracy: total > 0 ? (tp + tn) / total : 0,
    precision,
    recall,
    f1,
    auc: calculateAuc(cleanPredictions),
    signalThreshold,
    signalCount: signals.length,
    precisionAtThreshold: signals.length > 0 ? winningSignals.length / signals.length : 0,
    winRateWhenSignal: signals.length > 0 ? winningSignals.length / signals.length : 0,
    averageReturnWhenSignal: signalReturns.length > 0 ? mean(signalReturns) : 0,
    maxDrawdownWhenSignal: calculateMaxDrawdown(signalReturns),
    averageProbability: total > 0 ? mean(cleanPredictions.map(item => item.probability)) : 0,
    confusion: { tp, tn, fp, fn },
  };
}

function pickBestModelResult(results = [], options = {}) {
  const minSignals = options.minSignals || 5;
  const ranked = [...results].sort((a, b) => {
    const score = (result) => {
      const metrics = result.metrics || {};
      const enoughSignals = (metrics.signalCount || 0) >= minSignals ? 1 : -1;
      const horizonBonus = [3, 5].includes(result.horizon) ? 0.15 : 0;
      const averageReturnScore = Math.max(metrics.averageReturnWhenSignal || 0, -0.03) * 200;
      return enoughSignals
        + (metrics.precisionAtThreshold || 0) * 3
        + averageReturnScore
        + (metrics.f1 || 0) * 0.5
        + (metrics.auc || 0) * 0.5
        + Math.min(metrics.signalCount || 0, 50) / 200
        + horizonBonus;
    };
    return score(b) - score(a);
  });

  return ranked[0] || null;
}

module.exports = {
  evaluateBinaryPredictions,
  fitScaler,
  pickBestModelResult,
  sigmoid,
  trainDecisionTree,
  trainGaussianNaiveBayes,
  trainGradientBoostedStumps,
  trainKMeansStateModel,
  trainLinearReturnRegression,
  trainLogisticRegression,
  trainMajorityModel,
  trainRandomForest,
};
