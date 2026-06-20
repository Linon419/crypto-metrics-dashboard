import React, { useMemo } from 'react';

const LONG_VOL_STRATEGY_IDS = new Set(['long-straddle', 'long-strangle']);

const LONG_VOL_NOTES = [
  ['动机', '一种从标的股票价格波动加剧或剧烈波动中获利的方法。'],
  ['高波动性预期', '寻找期权有效期内股价的剧烈波动，无论上涨还是下跌。'],
  ['最大增益', '最大收益没有上限。最好的结果就是股价出现大幅波动，无论是上涨还是下跌。'],
  ['最大损失', '最大损失仅限于已支付的两期保费。最坏的情况是股价保持稳定，隐含波动率下降。'],
  ['时间衰减', '极其重要，负面影响。'],
  ['波动性影响', '极其重要。这一策略的成功将取决于隐含波动率的上升。'],
  ['行使/分配风险', '如果期权持有至到期日，其中一项期权可能会自动行权。'],
];

const STRATEGY_COMPARISON_PROFILES = {
  'long-straddle': {
    name: '买入跨式',
    scenario: '预期大幅波动，方向不明',
    advantage: '双向盈利，Gamma 正',
    drawback: 'Theta 损耗大，成本高',
  },
  'long-strangle': {
    name: '买入勒式',
    scenario: '预期大幅波动但方向不明',
    advantage: '成本更低，盈亏平衡点更远',
    drawback: '需要更大波动才能盈利',
  },
  'gamma-scalping': {
    name: 'Gamma Scalping',
    scenario: '低 IV 且实际波动充足',
    advantage: '能把短线波动兑现成调仓收益',
    drawback: '需要高频盯盘和严格对冲',
  },
  'short-straddle': {
    name: '卖出跨式',
    scenario: '高 IV 回落，价格贴近平值横盘',
    advantage: '权利金收入最高，Theta 贡献强',
    drawback: '两侧尾部风险最大',
  },
  'short-strangle': {
    name: '卖出宽跨式',
    scenario: '高 IV 回落，价格在宽区间震荡',
    advantage: '区间更宽，胜率较高',
    drawback: '尾部风险仍需对冲',
  },
  'iron-condor': {
    name: '铁鹰策略',
    scenario: '高 IV 回落，价格留在上下边界内',
    advantage: '风险封顶，收益区间更明确',
    drawback: '单边突破会快速侵蚀权利金',
  },
  butterfly: {
    name: '蝶式策略',
    scenario: '预期价格钉在目标区间',
    advantage: '成本低，目标位收益集中',
    drawback: '盈利窗口窄',
  },
  'calendar-spread': {
    name: '日历价差',
    scenario: '近端横盘，远端保留波动',
    advantage: '利用近月 theta，保留远月 vega',
    drawback: '价格快速远离会压缩收益',
  },
  'diagonal-spread': {
    name: '对角价差',
    scenario: '近端收租，远端保留方向暴露',
    advantage: '兼顾时间结构和方向判断',
    drawback: '腿部管理复杂',
  },
  collar: {
    name: '领口策略',
    scenario: '已有底仓需要保护',
    advantage: '用卖 call 补贴买 put 成本',
    drawback: '上涨空间被卖 call 限制',
  },
  'put-spread-collar': {
    name: '区间化领口',
    scenario: '已有底仓，需要降低保护成本',
    advantage: '保护成本更低，风险区间清晰',
    drawback: '极端下跌保护有边界',
  },
  'bear-put-spread': {
    name: '熊市认沽价差',
    scenario: '看跌或底仓需要下行保护',
    advantage: '亏损封顶，方向表达清晰',
    drawback: '下跌收益有上限',
  },
  'bull-call-spread': {
    name: '牛市认购价差',
    scenario: '看涨但控制买方成本',
    advantage: '成本低于裸买 call',
    drawback: '上涨收益封顶',
  },
  'bull-put-spread': {
    name: '牛市认沽价差',
    scenario: '看涨或价格守住支撑',
    advantage: '收权利金，容错区间较宽',
    drawback: '跌破短 put 后风险加速',
  },
  'risk-reversal': {
    name: '风险逆转',
    scenario: '偏多并愿意承担下方义务',
    advantage: '低成本获得上涨暴露',
    drawback: '下跌时卖 put 风险放大',
  },
  'synthetic-long-stock': {
    name: '合成多头',
    scenario: '用期权复制现货多头',
    advantage: '资金效率高，Delta 暴露直接',
    drawback: '需要管理保证金和分配风险',
  },
  'bullish-crab': {
    name: '看涨螃蟹',
    scenario: '偏多但希望多腿结构增强',
    advantage: '多腿组合可攻可守',
    drawback: '结构复杂，调仓要求高',
  },
  'ratio-spread': {
    name: '比例价差',
    scenario: '确认一侧目标，但希望降低成本',
    advantage: '方向正确时收益弹性高',
    drawback: '比例腿会带来尾部风险',
  },
  'bull-three-leg': {
    name: '牛三腿',
    scenario: '偏多并希望卖方收入辅助',
    advantage: '上涨、小跌、横盘都有处理空间',
    drawback: '短腿区域需要主动管理',
  },
  'alligator-strategy': {
    name: '鳄鱼策略',
    scenario: '趋势启动后的多腿攻防结构',
    advantage: '能随趋势拆腿和转换结构',
    drawback: '执行路径依赖强',
  },
};

const STRATEGY_COMPARISON_GROUPS = {
  'long-straddle': ['long-straddle', 'long-strangle', 'gamma-scalping'],
  'long-strangle': ['long-straddle', 'long-strangle', 'gamma-scalping'],
  'gamma-scalping': ['gamma-scalping', 'long-straddle', 'long-strangle'],
  'short-straddle': ['short-straddle', 'short-strangle', 'iron-condor', 'butterfly'],
  'short-strangle': ['short-straddle', 'short-strangle', 'iron-condor', 'butterfly'],
  'iron-condor': ['iron-condor', 'short-strangle', 'short-straddle', 'butterfly'],
  butterfly: ['butterfly', 'iron-condor', 'short-strangle'],
  'calendar-spread': ['calendar-spread', 'diagonal-spread'],
  'diagonal-spread': ['diagonal-spread', 'calendar-spread'],
  collar: ['collar', 'put-spread-collar', 'bear-put-spread'],
  'put-spread-collar': ['put-spread-collar', 'collar', 'bear-put-spread'],
  'bear-put-spread': ['bear-put-spread', 'collar', 'put-spread-collar'],
  'bull-call-spread': ['bull-call-spread', 'bull-put-spread', 'ratio-spread', 'alligator-strategy'],
  'bull-put-spread': ['bull-put-spread', 'bull-call-spread', 'bull-three-leg'],
  'risk-reversal': ['risk-reversal', 'synthetic-long-stock', 'bullish-crab'],
  'synthetic-long-stock': ['synthetic-long-stock', 'risk-reversal', 'bullish-crab'],
  'bullish-crab': ['bullish-crab', 'risk-reversal', 'bull-three-leg'],
  'ratio-spread': ['ratio-spread', 'bull-call-spread', 'bull-three-leg', 'alligator-strategy'],
  'bull-three-leg': ['bull-three-leg', 'ratio-spread', 'bull-put-spread', 'bullish-crab'],
  'alligator-strategy': ['alligator-strategy', 'ratio-spread', 'bull-call-spread'],
};

function joinValues(values) {
  return (values || []).filter(Boolean).join(' / ');
}

function buildGenericNotes(strategy) {
  const greeks = new Set((strategy.coreGreeks || []).map(item => String(item).toLowerCase()));
  const marketState = joinValues(strategy.marketStates);
  const risks = joinValues(strategy.risks);

  return [
    ['动机', strategy.whenToUse || marketState || '结合实时搭建和盈亏图确认策略动机。'],
    ['高波动性预期', marketState || '依据当前 IV、RV 和价格区间确认波动假设。'],
    ['最大增益', '结合右侧盈亏图确认收益结构、封顶位置和盈亏平衡点。'],
    ['最大损失', risks || '结合右侧盈亏图确认最大亏损和触发条件。'],
    ['时间衰减', greeks.has('theta') ? '重点观察 theta 对持仓的正负贡献。' : '按持仓周期观察时间价值变化。'],
    ['波动性影响', greeks.has('vega') ? '重点观察 IV 变化对策略估值的影响。' : '结合策略结构观察 IV 变化。'],
    ['行使/分配风险', '持有至到期时，实值期权可能自动行权或被分配。'],
  ];
}

function buildFallbackComparison(strategy) {
  if (!strategy?.id) return null;
  return {
    name: strategy.nameZh || strategy.nameEn || strategy.id,
    scenario: strategy.whenToUse || joinValues(strategy.marketStates) || '按当前行情假设确认适用场景',
    advantage: joinValues(strategy.setup) || '结合实时搭建确认结构优势',
    drawback: joinValues(strategy.risks) || '结合盈亏图确认主要风险',
  };
}

function getComparisonRows(strategy) {
  const group = STRATEGY_COMPARISON_GROUPS[strategy?.id];
  if (!group) {
    const fallback = buildFallbackComparison(strategy);
    return fallback ? [fallback] : [];
  }
  return group
    .map(id => STRATEGY_COMPARISON_PROFILES[id])
    .filter(Boolean);
}

function OptionsStrategicNotes({ strategy }) {
  const notes = useMemo(() => {
    if (LONG_VOL_STRATEGY_IDS.has(strategy?.id)) return LONG_VOL_NOTES;
    return buildGenericNotes(strategy || {});
  }, [strategy]);
  const comparisonRows = useMemo(() => getComparisonRows(strategy || {}), [strategy]);

  return (
    <section className="options-strategic-notes" aria-label="战略要点">
      <h3>战略要点</h3>
      <dl className="options-strategic-notes__grid">
        {notes.map(([title, body]) => (
          <div className="options-strategic-note" key={title}>
            <dt>{title}</dt>
            <dd>{body}</dd>
          </div>
        ))}
      </dl>

      {comparisonRows.length > 0 ? (
        <div className="options-strategic-comparison">
          <h4>策略对比</h4>
          <table>
            <thead>
              <tr>
                <th>策略</th>
                <th>适用场景</th>
                <th>优点</th>
                <th>缺点</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map(row => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.scenario}</td>
                  <td>{row.advantage}</td>
                  <td>{row.drawback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default OptionsStrategicNotes;
