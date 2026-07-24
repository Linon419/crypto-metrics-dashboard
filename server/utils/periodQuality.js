const QUALITY_LOOKBACK_DAYS = 365;

const PHASE_LABELS = {
  entry: {
    high: '高质量进场',
    low: '低质量进场',
  },
  exit: {
    high: '高质量退场',
    low: '低质量退场',
  },
};

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
      fromRole: fromNode.role,
      toRole: toNode.role,
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

function getComparisonChange(comparison) {
  if (Number.isFinite(comparison.changeValue)) {
    return comparison.changeValue;
  }

  return Number.isFinite(comparison.changePercent) ? comparison.changePercent : null;
}

function classifyPeriodQuality({ phase, comparisons = [] }) {
  const labels = PHASE_LABELS[phase];
  const usableComparisons = comparisons.filter((comparison) => getComparisonChange(comparison) !== null);

  if (!labels || usableComparisons.length === 0) {
    return {
      phase,
      label: '数据不足',
      pattern: 'insufficient',
      confidence: 'none',
      evidenceCount: 0,
      reason: '缺少可比较的关键节点',
      comparisons: usableComparisons,
    };
  }

  const latestComparison = usableComparisons[usableComparisons.length - 1];
  const latestChange = getComparisonChange(latestComparison);
  const expectedDirection = phase === 'entry' ? 1 : -1;
  const isExpectedDirection = (change) => Math.sign(change) === expectedDirection;
  // 进退场质量都由最近一组相邻关键节点反映当前状态。
  const isExpectedQuality = isExpectedDirection(latestChange);
  const pattern = isExpectedQuality ? 'steady' : (latestChange === 0 ? 'flat' : 'reversal');
  const directionText = phase === 'entry' ? '上升' : '下降';
  const reverseText = phase === 'entry' ? '下降' : '上升';

  return {
    phase,
    label: isExpectedQuality ? labels.high : labels.low,
    pattern,
    confidence: usableComparisons.length >= 2 ? 'high' : 'medium',
    evidenceCount: usableComparisons.length,
    reason: isExpectedQuality
      ? `最近相邻关键节点场外指数${directionText}`
      : `最近相邻关键节点场外指数${pattern === 'flat' ? '持平' : reverseText}`,
    comparisons: usableComparisons,
  };
}

module.exports = {
  QUALITY_LOOKBACK_DAYS,
  buildKeyNodeComparisons,
  classifyPeriodQuality,
};
