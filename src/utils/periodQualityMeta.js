export const PERIOD_QUALITY_METHOD = {
  title: '关键节点贝叶斯识别',
  intro: '系统只比较关键节点的场外指数。进场期先看 2→3，再用 3→4、4→5 继续更新；退场期用同样方式判断场外指数是否稳步下行。',
  rules: [
    '进场期重点看相邻关键节点是否持续抬升。',
    '退场期重点看相邻关键节点是否持续下行。',
    '进场首周若未跌回 200 且爆破均值走弱，系统直接下调为低质量进场。',
  ],
};

export const PERIOD_QUALITY_GUIDE = [
  {
    key: 'high',
    color: 'success',
    label: '高质量',
    description: '关键节点连续同向强化，波动展开更充分。',
  },
  {
    key: 'repair',
    color: 'orange',
    label: '修复型',
    description: '首段承压，后续关键节点完成修复，适合轻仓跟踪。',
  },
  {
    key: 'observe',
    color: 'processing',
    label: '观察型',
    description: '关键节点开始改善，力度仍在确认，仓位以试探为主。',
  },
  {
    key: 'low',
    color: 'error',
    label: '低质量',
    description: '关键节点缺少连续强化，周期更容易缩短。',
  },
];

const META = {
  高质量进场: {
    tagColor: 'success',
    ribbonColor: 'green',
    shortText: '高进',
    description: '2→3 与后续关键节点持续抬升，主力加仓连续，进场期更容易充分展开。',
  },
  修复型进场: {
    tagColor: 'orange',
    ribbonColor: '#fa8c16',
    shortText: '修进',
    description: '2→3 先承压，3→4 开始修复并重新放量，适合轻仓跟踪后续确认。',
  },
  观察型进场: {
    tagColor: 'processing',
    ribbonColor: '#1677ff',
    shortText: '观进',
    description: '关键节点已经改善，展开力度仍在确认，仓位适合试探和跟踪。',
  },
  低质量进场: {
    tagColor: 'error',
    ribbonColor: '#ff4d4f',
    shortText: '低进',
    description: '关键节点缺少持续抬升，拉盘动力偏弱，进场期更容易缩短。',
  },
  '低质量进场（需调仓）': {
    tagColor: 'error',
    ribbonColor: '#ff4d4f',
    shortText: '调仓',
    description: '进场首周未跌回 200 且爆破均值走弱，本轮动能收敛更快，仓位需要收缩。',
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
  修复型退场: {
    tagColor: 'orange',
    ribbonColor: '#fa8c16',
    shortText: '修退',
    description: '早段出现反抽，后续关键节点重新转弱，适合继续跟踪退场确认。',
  },
  观察型退场: {
    tagColor: 'processing',
    ribbonColor: '#1677ff',
    shortText: '观退',
    description: '关键节点开始走弱，退场力度仍在确认，持仓节奏以防守为主。',
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

  return META[quality] || {
    tagColor: 'default',
    ribbonColor: 'default',
    shortText: quality,
    description: '当前标签已生成，说明文案稍后补充。',
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
