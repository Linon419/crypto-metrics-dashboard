export const PERIOD_QUALITY_METHOD = {
  title: '关键节点趋势识别',
  intro: '系统只比较关键节点的场外指数，并通过相邻节点是否持续同向变化判断周期质量。',
  rules: [
    '进场期相邻关键节点持续抬升为高质量，出现持平、下降或反复为低质量。',
    '退场期相邻关键节点持续下行为高质量，出现持平、上升或反复为低质量。',
    '缺少可比较的关键节点时保持待观察。',
    '进场首日爆破高于 200 作为短线偏热提示，不直接改变周期质量。',
    '进场满一周后，若首周未跌回 200 且爆破均值走弱，系统直接下调为低质量进场。',
  ],
};

export const PERIOD_QUALITY_GUIDE = [
  {
    key: 'high',
    color: 'success',
    label: '高质量',
    description: '进场节点持续上升或退场节点持续下降，周期方向明确。',
  },
  {
    key: 'low',
    color: 'error',
    label: '低质量',
    description: '关键节点出现持平、反向或反复，周期更容易缩短。',
  },
  {
    key: 'pending',
    color: 'warning',
    label: '待观察',
    description: '当前缺少可比较的关键节点，后续节点形成后继续判断。',
  },
];

const LEGACY_QUALITY_ALIASES = {
  修复型进场: '低质量进场',
  观察型进场: '低质量进场',
  修复型退场: '低质量退场',
  观察型退场: '低质量退场',
  '低质量进场（需调仓）': '低质量进场',
};

export function normalizePeriodQualityLabel(quality) {
  return LEGACY_QUALITY_ALIASES[quality] || quality;
}

const META = {
  高质量进场: {
    tagColor: 'success',
    ribbonColor: 'green',
    shortText: '高进',
    description: '2→3 与后续关键节点持续抬升，主力加仓连续，进场期更容易充分展开。',
  },
  低质量进场: {
    tagColor: 'error',
    ribbonColor: '#ff4d4f',
    shortText: '低进',
    description: '关键节点缺少持续抬升，拉盘动力偏弱，进场期更容易缩短。',
  },
  '进场期 (待观察)': {
    tagColor: 'warning',
    ribbonColor: '#faad14',
    shortText: '待观',
    description: '当前还缺少可比较的关键节点，后续 2→3 或 3→4 会继续更新判断。',
  },
  高质量退场: {
    tagColor: 'success',
    ribbonColor: 'green',
    shortText: '高退',
    description: '2→3 与后续关键节点持续下行，主力撤离明确，退场质量更高。',
  },
  低质量退场: {
    tagColor: 'error',
    ribbonColor: '#ff4d4f',
    shortText: '低退',
    description: '关键节点出现反复或反抽偏强，退场期更容易变短。',
  },
  '退场期 (待观察)': {
    tagColor: 'warning',
    ribbonColor: '#faad14',
    shortText: '待观',
    description: '当前还缺少可比较的关键节点，后续 2→3 或 3→4 会继续更新判断。',
  },
  观望: {
    tagColor: 'default',
    ribbonColor: 'default',
    shortText: '观望',
    description: '当前阶段以等待为主，新的进退场信号尚未形成。',
  },
  数据不足: {
    tagColor: 'default',
    ribbonColor: 'default',
    shortText: '无数据',
    description: '历史样本不足，当前无法完成关键节点比较。',
  },
  计算出错: {
    tagColor: 'error',
    ribbonColor: '#ff4d4f',
    shortText: '异常',
    description: '本次质量计算出现异常，刷新后可再次确认。',
  },
};

export function getPeriodQualityMeta(quality) {
  if (!quality) {
    return {
      tagColor: 'default',
      ribbonColor: 'default',
      shortText: '',
      description: '当前没有质量标签。',
    };
  }

  const normalizedQuality = normalizePeriodQualityLabel(quality);
  const meta = META[normalizedQuality] || {
    tagColor: 'default',
    ribbonColor: 'default',
    shortText: normalizedQuality,
    description: '当前标签已生成，说明文案稍后补充。',
  };

  return {
    ...meta,
    displayLabel: normalizedQuality,
  };
}

export function getQualityRibbonProps(quality) {
  if (!quality) {
    return { display: 'none', text: '', color: 'blue' };
  }

  const meta = getPeriodQualityMeta(quality);
  return {
    display: 'block',
    text: meta.shortText,
    color: meta.ribbonColor,
  };
}
