const QUALITY_LOOKBACK_DAYS = 365;

const PHASE_LABELS = {
  entry: {
    high: '高质量进场',
    repair: '修复型进场',
    observe: '观察型进场',
    low: '低质量进场',
  },
  exit: {
    high: '高质量退场',
    repair: '修复型退场',
    observe: '观察型退场',
    low: '低质量退场',
  },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildNodeLabel(phase, nodeNum, role) {
  if (phase === 'entry') {
    return role === 'start' ? `${nodeNum}进场期第一天` : `${nodeNum}爆破跌200`;
  }

  return role === 'start' ? `${nodeNum}退场期第一天` : `${nodeNum}爆破负变正`;
}

function calculateChangePercent(fromOtcIndex, toOtcIndex) {
  if (typeof fromOtcIndex !== 'number' || typeof toOtcIndex !== 'number') {
    return null;
  }

  if (fromOtcIndex === 0) {
    return null;
  }

  return ((toOtcIndex - fromOtcIndex) / fromOtcIndex) * 100;
}

function buildKeyNodeComparisons({ phase, beforeNode, startNode, afterNodes = [] }) {
  if (!phase || !startNode) {
    return [];
  }

  const orderedNodes = [];

  if (beforeNode) {
    orderedNodes.push({
      ...beforeNode,
      role: 'before',
      label: buildNodeLabel(phase, beforeNode.nodeNum, 'before'),
    });
  }

  orderedNodes.push({
    ...startNode,
    role: 'start',
    label: buildNodeLabel(phase, startNode.nodeNum, 'start'),
  });

  afterNodes.forEach((node) => {
    orderedNodes.push({
      ...node,
      role: 'after',
      label: buildNodeLabel(phase, node.nodeNum, 'after'),
    });
  });

  const comparisons = [];
  for (let index = 0; index < orderedNodes.length - 1; index += 1) {
    const fromNode = orderedNodes[index];
    const toNode = orderedNodes[index + 1];
    const changePercent = calculateChangePercent(fromNode.otc_index, toNode.otc_index);

    comparisons.push({
      phase,
      fromNodeNum: fromNode.nodeNum,
      toNodeNum: toNode.nodeNum,
      fromDate: fromNode.date,
      toDate: toNode.date,
      fromLabel: fromNode.label,
      toLabel: toNode.label,
      fromOtcIndex: fromNode.otc_index,
      toOtcIndex: toNode.otc_index,
      changeValue: typeof fromNode.otc_index === 'number' && typeof toNode.otc_index === 'number'
        ? toNode.otc_index - fromNode.otc_index
        : null,
      changePercent,
    });
  }

  return comparisons;
}

function scoreEntryInitial(changePercent) {
  if (changePercent >= 15) return 0.24;
  if (changePercent >= 5) return 0.12;
  if (changePercent > -10) return 0.02;
  if (changePercent <= -25) return -0.12;
  return -0.08;
}

function scoreEntryFollow(changePercent) {
  if (changePercent >= 15) return 0.2;
  if (changePercent >= 5) return 0.1;
  if (changePercent > 0) return 0.05;
  return -0.15;
}

function scoreExitInitial(changePercent) {
  if (changePercent <= -15) return 0.3;
  if (changePercent <= -5) return 0.15;
  if (changePercent < 10) return 0;
  if (changePercent >= 25) return -0.18;
  return -0.12;
}

function scoreExitFollow(changePercent) {
  if (changePercent <= -10) return 0.18;
  if (changePercent < 0) return 0.1;
  if (changePercent <= 8) return -0.03;
  return -0.15;
}

function scoreBayesianPeriodQuality({ phase, comparisons = [], weekRisk = false }) {
  const labels = PHASE_LABELS[phase];
  const usableComparisons = comparisons.filter((comparison) => Number.isFinite(comparison.changePercent));

  if (!labels || usableComparisons.length === 0) {
    return {
      phase,
      probability: 0,
      label: '数据不足',
      comparisons: usableComparisons,
    };
  }

  const firstChangePercent = usableComparisons[0].changePercent;
  const followUpComparisons = usableComparisons.slice(1);

  let probability = 0.45;

  if (phase === 'entry') {
    probability += scoreEntryInitial(firstChangePercent);
    followUpComparisons.forEach((comparison) => {
      probability += scoreEntryFollow(comparison.changePercent);
    });

    const allPositive = usableComparisons.length >= 2 && usableComparisons.every((comparison) => comparison.changePercent > 0);
    const hasFollowDown = followUpComparisons.some((comparison) => comparison.changePercent <= 0);
    const repairPattern = firstChangePercent <= -10
      && followUpComparisons.length > 0
      && followUpComparisons.every((comparison) => comparison.changePercent > 0)
      && followUpComparisons.some((comparison) => comparison.changePercent >= 15);

    if (allPositive) {
      probability += 0.15;
    }

    if (repairPattern) {
      probability += 0.17;
    }

    if (hasFollowDown) {
      probability -= 0.12;
    }

    if (weekRisk) {
      probability -= 0.25;
    }

    probability = clamp(probability, 0.05, 0.95);

    if (probability >= 0.75) {
      return { phase, probability, label: labels.high, repairPattern, comparisons: usableComparisons };
    }
    if (repairPattern && probability >= 0.55) {
      return { phase, probability, label: labels.repair, repairPattern, comparisons: usableComparisons };
    }
    if (probability >= 0.45) {
      return { phase, probability, label: labels.observe, repairPattern, comparisons: usableComparisons };
    }

    return { phase, probability, label: labels.low, repairPattern, comparisons: usableComparisons };
  }

  probability += scoreExitInitial(firstChangePercent);
  followUpComparisons.forEach((comparison) => {
    probability += scoreExitFollow(comparison.changePercent);
  });

  const allNegative = usableComparisons.length >= 2 && usableComparisons.every((comparison) => comparison.changePercent < 0);
  const hasStrongRebound = followUpComparisons.some((comparison) => comparison.changePercent > 8);
  const repairPattern = firstChangePercent >= 10
    && followUpComparisons.length > 0
    && followUpComparisons.some((comparison) => comparison.changePercent <= -10);

  if (allNegative) {
    probability += 0.12;
  }

  if (repairPattern) {
    probability += 0.18;
  }

  if (hasStrongRebound) {
    probability -= 0.12;
  }

  probability = clamp(probability, 0.05, 0.95);

  if (probability >= 0.75) {
    return { phase, probability, label: labels.high, repairPattern, comparisons: usableComparisons };
  }
  if (repairPattern && probability >= 0.55) {
    return { phase, probability, label: labels.repair, repairPattern, comparisons: usableComparisons };
  }
  if (probability >= 0.45) {
    return { phase, probability, label: labels.observe, repairPattern, comparisons: usableComparisons };
  }

  return { phase, probability, label: labels.low, repairPattern, comparisons: usableComparisons };
}

module.exports = {
  QUALITY_LOOKBACK_DAYS,
  buildKeyNodeComparisons,
  scoreBayesianPeriodQuality,
};
