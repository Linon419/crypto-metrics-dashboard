# Options Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/options` page that combines BTC implied-volatility candles with a searchable, source-backed options strategy knowledge base from 《魔方内参》.

**Architecture:** Use a generated static index for course content and a live API endpoint for BTC DVOL history. The frontend reads `src/data/optionsKnowledgeIndex.json`, applies local filtering/search, and renders focused components for chart, filters, cards, and detail drawer.

**Tech Stack:** React 19, Ant Design 5, ECharts, Express, Node.js scripts, macOS `textutil` for `.docx` extraction, Node `assert`, React Testing Library.

---

## File Structure

- Create `scripts/optionsStrategyCatalog.js`: fixed strategy metadata, category tags, operation steps, keywords, image hints.
- Create `scripts/build-options-knowledge-index.js`: reads course sources, extracts matching original text, writes index and report.
- Create `scripts/tests/optionsKnowledgeIndex.test.js`: Node tests for catalog integrity and text matching helpers.
- Create `src/data/optionsKnowledgeIndex.json`: generated strategy knowledge index.
- Create `src/utils/optionsKnowledge.js`: pure frontend helpers for search, filters, labels, and counts.
- Create `src/utils/optionsKnowledge.test.js`: Jest tests for frontend filter/search behavior.
- Modify `server/utils/btcVolatility.js`: add Deribit DVOL candle history support.
- Modify `server/routes/volatility.js`: add `/btc/history` route.
- Modify `server/tests/btcVolatility.test.js`: cover DVOL history parsing and snapshot compatibility.
- Modify `src/services/api.js`: add `fetchBtcVolatilityHistory`.
- Create `src/components/OptionsVolatilityChart.jsx`: top K-line chart.
- Create `src/components/OptionsStrategyCard.jsx`: strategy summary card.
- Create `src/components/OptionsStrategyDrawer.jsx`: source-backed detail drawer.
- Create `src/components/OptionsPage.jsx`: page composition, filters, search, states.
- Create `src/components/__tests__/OptionsPage.test.jsx`: page behavior tests.
- Modify `src/App.js`: route and nav entry.
- Modify `src/App.test.js`: replace starter CRA assertion with a stable app render assertion.
- Modify `src/styles/design-system.css`: scoped options page styles.

## Task 1: Strategy Catalog And Extraction Helpers

**Files:**
- Create: `scripts/optionsStrategyCatalog.js`
- Create: `scripts/tests/optionsKnowledgeIndex.test.js`

- [ ] **Step 1: Write the catalog integrity test**

Create `scripts/tests/optionsKnowledgeIndex.test.js` with this initial content:

```js
const assert = require('assert');

const {
  OPTIONS_STRATEGY_CATALOG,
  collectMatchingParagraphs,
  normalizeText,
} = require('../optionsStrategyCatalog');

function testCatalogIntegrity() {
  const requiredIds = [
    'long-straddle',
    'short-strangle',
    'calendar-spread',
    'diagonal-spread',
    'butterfly',
    'collar',
    'gamma-scalping',
    'iron-condor',
    'bull-put-spread',
    'risk-reversal',
    'alligator-strategy',
  ];

  const ids = OPTIONS_STRATEGY_CATALOG.map(item => item.id);
  requiredIds.forEach(id => assert.ok(ids.includes(id), `${id} exists`));

  OPTIONS_STRATEGY_CATALOG.forEach(item => {
    assert.ok(item.nameZh, `${item.id} has Chinese name`);
    assert.ok(item.nameEn, `${item.id} has English name`);
    assert.ok(item.marketStates.length > 0, `${item.id} has market states`);
    assert.ok(item.strategyTypes.length > 0, `${item.id} has strategy types`);
    assert.ok(item.operationSteps.length >= 4, `${item.id} has operation steps`);
    assert.ok(item.keywords.length >= 2, `${item.id} has matching keywords`);
  });
}

function testTextMatching() {
  const text = normalizeText(`
    老师这里讲铁鹰策略，也就是 iron condor。
    下方做 bull put spread，上方做 bear call spread。

    这一段讲第二战法，和铁鹰无关。
  `);

  const matches = collectMatchingParagraphs(text, ['铁鹰', 'iron condor'], 500);
  assert.strictEqual(matches.length, 1);
  assert.ok(matches[0].includes('iron condor'));
  assert.ok(matches[0].includes('bear call spread'));
}

testCatalogIntegrity();
testTextMatching();

console.log('optionsKnowledgeIndex.test.js passed');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node scripts/tests/optionsKnowledgeIndex.test.js
```

Expected result:

```text
Error: Cannot find module '../optionsStrategyCatalog'
```

- [ ] **Step 3: Implement `scripts/optionsStrategyCatalog.js`**

Create `scripts/optionsStrategyCatalog.js`:

```js
const MARKET_STATES = {
  volatilityRising: '波动率开始上升',
  lowIvHighRv: '低 IV + 高 RV 预期',
  highIvFalling: '高 IV + 预期回落',
  rangeBound: '区间震荡',
  nearFlatFarVol: '近端横盘 + 远端保留波动',
  trendStarting: '单边趋势开始',
  hedgeExistingPosition: '已有底仓需要保护',
  bullishSynthetic: '偏多合成与结构增强',
};

const STRATEGY_TYPES = {
  longVol: '买入波动率',
  shortVol: '卖出波动率',
  longDirection: '买入方向',
  sellerIncome: '卖方收租',
  timeStructure: '时间结构',
  rangeStructure: '区间结构',
  trendSpread: '趋势价差',
  hedge: '底仓保护',
  syntheticLong: '合成多头',
  courseCombo: '课程组合结构',
};

const OPTIONS_STRATEGY_CATALOG = [
  {
    id: 'long-straddle',
    nameZh: '买入跨式',
    nameEn: 'long straddle',
    marketStates: [MARKET_STATES.volatilityRising],
    strategyTypes: [STRATEGY_TYPES.longVol],
    whenToUse: '预期行情会大幅波动，方向暂时不明确，且实际波动有机会跑赢买入成本。',
    setup: ['买入同一到期日、同一行权价的 call', '买入同一到期日、同一行权价的 put'],
    operationSteps: ['判断 IV 是否仍有上升空间', '确认事件或行情能带来足够 RV', '选择流动性好的平值行权价', '同时买入 call 和 put', '持仓中观察价格是否快速远离行权价', '当单边盈利覆盖双腿成本或 IV 明显回落时处理仓位'],
    coreGreeks: ['gamma', 'vega', 'theta'],
    risks: ['横盘消耗权利金', 'IV 回落抵消价格波动', '盈亏平衡点距离过远'],
    sourceLessons: ['day3'],
    keywords: ['long straddle', 'straddle', '跨式', '买波动', '买入跨式'],
    imageHints: ['assets/payoffs/volatility-structures-grid.png', 'assets/day3/WechatIMG30.jpg'],
  },
  {
    id: 'long-strangle',
    nameZh: '买入宽跨式',
    nameEn: 'long strangle',
    marketStates: [MARKET_STATES.volatilityRising],
    strategyTypes: [STRATEGY_TYPES.longVol],
    whenToUse: '预期大波动，愿意用更远的盈亏平衡点换更低初始成本。',
    setup: ['买入较高行权价 call', '买入较低行权价 put', '两条腿同标的、同到期'],
    operationSteps: ['判断行情是否可能突破外侧行权价', '选择两侧流动性足够的虚值腿', '计算上下两个盈亏平衡点', '同时买入 call 和 put', '持仓中观察价格是否靠近任一外侧腿', '波动兑现后处理盈利腿或整体退出'],
    coreGreeks: ['gamma', 'vega', 'theta'],
    risks: ['需要更大价格移动', '双腿同时被 theta 消耗', 'IV 回落导致估值下降'],
    sourceLessons: ['day3'],
    keywords: ['long strangle', 'strangle', '宽跨', '买入宽跨', '买波动'],
    imageHints: ['assets/payoffs/volatility-structures-grid.png', 'assets/day3/WechatIMG30.jpg'],
  },
  {
    id: 'short-straddle',
    nameZh: '卖出跨式',
    nameEn: 'short straddle',
    marketStates: [MARKET_STATES.highIvFalling, MARKET_STATES.rangeBound],
    strategyTypes: [STRATEGY_TYPES.shortVol, STRATEGY_TYPES.sellerIncome],
    whenToUse: '预期价格围绕平值区域震荡，IV 偏高且可能回落。',
    setup: ['卖出同一到期日、同一行权价的 call', '卖出同一到期日、同一行权价的 put'],
    operationSteps: ['确认 IV 偏高且趋势突破风险可控', '选择平值附近行权价', '计算双边最大可承受波动范围', '同时卖出 call 和 put', '持仓中观察任一侧 delta 和 gamma 扩张', '达到目标权利金比例或区间失效时退出'],
    coreGreeks: ['theta', 'vega', 'gamma'],
    risks: ['两侧尾部风险', '单边突破后负 gamma 放大', '保证金压力上升'],
    sourceLessons: ['day3'],
    keywords: ['short straddle', '卖出跨式', '卖跨式', '卖波动', 'straddle'],
    imageHints: ['assets/payoffs/volatility-structures-grid.png', 'assets/day3/WechatIMG30.jpg'],
  },
  {
    id: 'short-strangle',
    nameZh: '卖出宽跨式',
    nameEn: 'short strangle',
    marketStates: [MARKET_STATES.highIvFalling, MARKET_STATES.rangeBound],
    strategyTypes: [STRATEGY_TYPES.shortVol, STRATEGY_TYPES.sellerIncome],
    whenToUse: '预期价格留在较宽区间内，想用更外侧短腿收取时间价值。',
    setup: ['卖出较高行权价 call', '卖出较低行权价 put', '两条腿同标的、同到期'],
    operationSteps: ['确定上下边界', '选择距离当前价格较远的短 call 和短 put', '检查净收入与保证金', '预设危险侧处理方式', '持仓中观察价格靠近哪一侧短腿', '收到目标权利金比例或突破区间时处理仓位'],
    coreGreeks: ['theta', 'vega', 'gamma'],
    risks: ['区间外单边行情', '短腿接近后亏损扩张', '宽区间带来风险麻痹'],
    sourceLessons: ['day3'],
    keywords: ['short strangle', '卖出宽跨', '卖宽跨', '卖波动', 'strangle'],
    imageHints: ['assets/payoffs/volatility-structures-grid.png', 'assets/day3/WechatIMG30.jpg'],
  },
  {
    id: 'calendar-spread',
    nameZh: '日历价差',
    nameEn: 'calendar spread',
    marketStates: [MARKET_STATES.nearFlatFarVol],
    strategyTypes: [STRATEGY_TYPES.timeStructure],
    whenToUse: '预期近端围绕目标行权价震荡，同时远端时间价值或波动率仍有保留价值。',
    setup: ['卖出近月期权', '买入远月同一行权价期权', '通常同为 call 或同为 put'],
    operationSteps: ['选择目标停留价位', '检查近月 theta 是否足够', '检查远月 vega 和流动性', '建立近月空腿和远月多腿', '持仓中观察短 gamma 风险', '近腿衰减后平仓或滚动'],
    coreGreeks: ['theta', 'vega', 'gamma'],
    risks: ['近端强单边突破', 'delta neutral 被误读为无方向风险', '远月 IV 回落'],
    sourceLessons: ['day4'],
    keywords: ['calendar spread', 'calendar', '日历价差', '日历', '近月', '远月'],
    imageHints: ['assets/payoffs/calendar-vs-diagonal-grid.png'],
  },
  {
    id: 'diagonal-spread',
    nameZh: '对角价差',
    nameEn: 'diagonal spread',
    marketStates: [MARKET_STATES.nearFlatFarVol, MARKET_STATES.trendStarting],
    strategyTypes: [STRATEGY_TYPES.timeStructure, STRATEGY_TYPES.trendSpread],
    whenToUse: '既想吃近端时间价值，又对方向有明确倾斜。',
    setup: ['买入远月一条腿', '卖出近月另一条腿', '两条腿到期不同、行权价不同'],
    operationSteps: ['确认方向偏多或偏空', '选择远月主腿', '选择近月收租腿并留出安全距离', '检查净 delta 和短腿风险', '持仓中观察短腿是否受压', '方向失效或短腿突破时调整'],
    coreGreeks: ['delta', 'theta', 'vega', 'gamma'],
    risks: ['短腿被快速穿越', '方向倾斜判断错误', '远腿成本过高'],
    sourceLessons: ['day4'],
    keywords: ['diagonal spread', 'diagonal', '对角价差', '对角', '日历'],
    imageHints: ['assets/payoffs/calendar-vs-diagonal-grid.png'],
  },
  {
    id: 'butterfly',
    nameZh: '蝶式策略',
    nameEn: 'butterfly',
    marketStates: [MARKET_STATES.rangeBound],
    strategyTypes: [STRATEGY_TYPES.rangeStructure],
    whenToUse: '预期到期时价格钉在某个中间价附近，追求有限风险的精确区间收益。',
    setup: ['买入 1 张低行权价 call', '卖出 2 张中间行权价 call', '买入 1 张高行权价 call', '三档同标的、同到期'],
    operationSteps: ['确定目标中间价', '选择上下翼宽度', '检查净成本或净收入', '建立 1-2-1 结构', '持仓中观察价格是否靠近中间价', '价格明显远离目标区时退出或调整'],
    coreGreeks: ['theta', 'gamma', 'delta'],
    risks: ['目标价判断过窄', '价格远离中间价', '临期 gamma 变化快'],
    sourceLessons: ['day5'],
    keywords: ['butterfly', '蝶式', '1-2-1', '中间价', '钉住'],
    imageHints: ['assets/payoffs/long-butterfly-payoff.png'],
  },
  {
    id: 'collar',
    nameZh: '领口策略',
    nameEn: 'collar',
    marketStates: [MARKET_STATES.hedgeExistingPosition],
    strategyTypes: [STRATEGY_TYPES.hedge],
    whenToUse: '已经持有现货或期货多头，希望锁下方风险，并愿意让出一部分上方收益。',
    setup: ['持有底仓多头', '买入下方 put', '卖出上方 call'],
    operationSteps: ['确认底仓需要保护的时间窗口', '选择下方保护价', '选择可接受的上方让利价', '用卖 call 收入补贴买 put 成本', '持仓中观察底仓和期权组合总盈亏', '风险解除或上方被突破时处理期权腿'],
    coreGreeks: ['delta', 'vega', 'theta'],
    risks: ['上方收益被封顶', '保护期限覆盖不足', '下方保护成本过高'],
    sourceLessons: ['day6'],
    keywords: ['collar', '领口', '保护', 'protective', '底仓', '保险'],
    imageHints: ['assets/payoffs/collar-payoff.png', 'assets/day6/collar-zero-cost.png'],
  },
  {
    id: 'put-spread-collar',
    nameZh: '区间化领口',
    nameEn: 'put-spread collar',
    marketStates: [MARKET_STATES.hedgeExistingPosition],
    strategyTypes: [STRATEGY_TYPES.hedge, STRATEGY_TYPES.rangeStructure],
    whenToUse: '底仓只需要保护一段明确下跌区间，希望进一步压低保险成本。',
    setup: ['持有底仓多头', '下方用 bear put spread 保护一段下跌', '上方卖 call 补贴成本'],
    operationSteps: ['确认要保护的下跌区间', '买入较高行权价 put', '卖出较低行权价 put', '卖出上方 call', '检查跌破保护下沿后的剩余底仓风险', '风险解除或区间变化时退出'],
    coreGreeks: ['delta', 'theta', 'vega'],
    risks: ['跌破低行权价后保护变弱', '上方让利', '保护区间设置过窄'],
    sourceLessons: ['day10'],
    keywords: ['put-spread collar', '区间化', 'collar', 'bear put spread', '领口'],
    imageHints: ['assets/payoffs/collar-payoff.png', 'assets/payoffs/bullish-bearish-spreads-grid.png'],
  },
  {
    id: 'gamma-scalping',
    nameZh: 'Gamma Scalping',
    nameEn: 'gamma scalping',
    marketStates: [MARKET_STATES.lowIvHighRv],
    strategyTypes: [STRATEGY_TYPES.longVol],
    whenToUse: 'IV 相对低，预期 RV 更高，市场有来回摆动，且交易成本可控。',
    setup: ['买入正 gamma 期权核心腿', '用期货或现货动态对冲净 delta'],
    operationSteps: ['确认 IV 较低且未来可能有真实波动', '选择正 gamma 核心腿', '建立期货或现货对冲工具', '价格摆动后按净 delta 调整线性腿', '记录再平衡收益是否覆盖 theta 和费用', '波动消失或时间消耗过快时退出'],
    coreGreeks: ['gamma', 'delta', 'theta', 'vega'],
    risks: ['震荡幅度覆盖不了成本', '对冲频率和滑点损耗', '时间价值持续消耗'],
    sourceLessons: ['day6'],
    keywords: ['gamma scalping', '正 gamma', 'gamma', '动态对冲', 'delta hedge'],
    imageHints: ['assets/day6/gamma-scalping-flow.png', 'assets/payoffs/gamma-scalping-core.png'],
  },
  {
    id: 'iron-condor',
    nameZh: '铁鹰策略',
    nameEn: 'iron condor',
    marketStates: [MARKET_STATES.rangeBound, MARKET_STATES.highIvFalling],
    strategyTypes: [STRATEGY_TYPES.shortVol, STRATEGY_TYPES.rangeStructure],
    whenToUse: '预期价格留在明确上下边界内，IV 有回落空间，想双边收租并封顶亏损。',
    setup: ['下方建立 bull put spread', '上方建立 bear call spread', '四条腿同标的、同到期'],
    operationSteps: ['判断区间上下边界', '选择到期日', '确定上下短腿', '买入两侧保护长腿封顶风险', '检查净收入和最大亏损比例', '持仓观察危险侧和 IV 回落', '达到目标权利金比例或区间失效时退出'],
    coreGreeks: ['theta', 'vega', 'gamma'],
    risks: ['单边突破区间', '最大亏损大于权利金收入', '危险侧处理太慢'],
    sourceLessons: ['day11'],
    keywords: ['iron condor', '铁鹰', '铁鹰策略', 'condor', '区间收租'],
    imageHints: ['assets/strategy/spread-payoffs.png'],
  },
  {
    id: 'bull-call-spread',
    nameZh: '牛市认购价差',
    nameEn: 'bull call spread',
    marketStates: [MARKET_STATES.trendStarting],
    strategyTypes: [STRATEGY_TYPES.trendSpread, STRATEGY_TYPES.longDirection],
    whenToUse: '温和看涨，希望降低买 call 成本，并接受上方盈利封顶。',
    setup: ['买入较低行权价 call', '卖出较高行权价 call', '两条腿同标的、同到期'],
    operationSteps: ['确认看涨目标区', '买入低行权价 call', '卖出高行权价 call 补贴成本', '检查最大盈利和最大亏损', '持仓中观察价格是否接近上方短腿', '到目标区或方向失效时退出'],
    coreGreeks: ['delta', 'theta', 'gamma'],
    risks: ['上方收益封顶', '慢涨仍可能被 theta 消耗', '短腿管理不及时'],
    sourceLessons: ['day9', 'day10'],
    keywords: ['bull call spread', '牛市认购', '认购牛市价差', 'call spread'],
    imageHints: ['assets/payoffs/bullish-bearish-spreads-grid.png'],
  },
  {
    id: 'bull-put-spread',
    nameZh: '牛市认沽价差',
    nameEn: 'bull put spread',
    marketStates: [MARKET_STATES.trendStarting],
    strategyTypes: [STRATEGY_TYPES.trendSpread, STRATEGY_TYPES.sellerIncome],
    whenToUse: '中性偏多或趋势向上，希望用正 theta 的价差结构参与行情。',
    setup: ['卖出较高行权价 put', '买入较低行权价 put', '两条腿同标的、同到期'],
    operationSteps: ['确认偏多趋势或潜力区条件', '选择短 put 行权价', '买入更低行权价 put 封顶风险', '检查净权利金和最大亏损', '上涨后观察是否滚动短腿', '方向失效或短腿受压时处理'],
    coreGreeks: ['theta', 'delta', 'gamma'],
    risks: ['跌破短 put 后亏损扩大', '滚动路径依赖', '保留低价值 put 的收益需要后续反转'],
    sourceLessons: ['day10'],
    keywords: ['bull put spread', '牛市认沽', '认沽牛市价差', 'put spread'],
    imageHints: ['assets/payoffs/bullish-bearish-spreads-grid.png', 'assets/day10/WechatIMG82.jpg'],
  },
  {
    id: 'bear-put-spread',
    nameZh: '熊市认沽价差',
    nameEn: 'bear put spread',
    marketStates: [MARKET_STATES.trendStarting, MARKET_STATES.hedgeExistingPosition],
    strategyTypes: [STRATEGY_TYPES.trendSpread, STRATEGY_TYPES.hedge],
    whenToUse: '温和看跌，或只想保护一段明确下跌区间。',
    setup: ['买入较高行权价 put', '卖出较低行权价 put', '两条腿同标的、同到期'],
    operationSteps: ['确认下跌目标区', '买入高行权价 put', '卖出低行权价 put 降低成本', '检查保护下沿和净成本', '价格进入目标区后止盈或完成保护', '跌破低行权价后重新评估保护缺口'],
    coreGreeks: ['delta', 'theta', 'gamma'],
    risks: ['更深下跌保护被截断', '方向不到时净成本消耗', '保护区间选窄'],
    sourceLessons: ['day10'],
    keywords: ['bear put spread', '熊市认沽', '认沽熊市价差', 'bear spread'],
    imageHints: ['assets/payoffs/bullish-bearish-spreads-grid.png'],
  },
  {
    id: 'risk-reversal',
    nameZh: '风险逆转',
    nameEn: 'risk reversal',
    marketStates: [MARKET_STATES.bullishSynthetic],
    strategyTypes: [STRATEGY_TYPES.syntheticLong, STRATEGY_TYPES.courseCombo],
    whenToUse: '偏多观点强，希望用卖 put 补贴买 call，并接受下方义务。',
    setup: ['买入虚值 call', '卖出虚值 put', '通常选择相近 delta 的两条腿'],
    operationSteps: ['确认强偏多方向', '选择目标 call', '选择可承担义务的 put', '检查净成本或净收入', '持仓中观察下方 short put 风险', '方向兑现或下方风险上升时处理'],
    coreGreeks: ['delta', 'vega', 'theta'],
    risks: ['下跌时 short put 成为主要风险', '保证金压力', '把偏斜指标和结构名称混淆'],
    sourceLessons: ['day13'],
    keywords: ['risk reversal', '风险逆转', '25 delta', '偏斜', 'synthetic'],
    imageHints: ['assets/day13/WechatIMG106.jpg'],
  },
  {
    id: 'synthetic-long-stock',
    nameZh: '合成多头',
    nameEn: 'synthetic long stock',
    marketStates: [MARKET_STATES.bullishSynthetic],
    strategyTypes: [STRATEGY_TYPES.syntheticLong],
    whenToUse: '希望用期权组合合成接近持有标的的线性多头暴露。',
    setup: ['买入同一行权价 call', '卖出同一行权价 put', '两条腿同标的、同到期'],
    operationSteps: ['确认需要线性多头暴露', '选择同一行权价和到期日', '买入 call 并卖出 put', '检查保证金和下方风险', '持仓中观察净 delta 是否接近多头', '方向兑现或风险上升时整体处理'],
    coreGreeks: ['delta', 'theta', 'vega'],
    risks: ['下跌体验接近持有标的多头', 'short put 保证金压力', '到期处理要求高'],
    sourceLessons: ['day13'],
    keywords: ['synthetic long', 'synthetic long stock', '合成多头', '合成股票'],
    imageHints: ['assets/day13/WechatIMG107.jpg'],
  },
  {
    id: 'bullish-crab',
    nameZh: '看涨螃蟹',
    nameEn: 'bullish crab',
    marketStates: [MARKET_STATES.bullishSynthetic, MARKET_STATES.rangeBound],
    strategyTypes: [STRATEGY_TYPES.courseCombo, STRATEGY_TYPES.rangeStructure],
    whenToUse: '偏多但希望通过身体、租金和远端腿组合，兼顾稳定和右侧爆发。',
    setup: ['用价差身体承接主体结构', '用近端租金补贴', '保留远端 call 爆发腿'],
    operationSteps: ['确认偏多结构需要', '搭建价差身体', '配置近端收租腿', '配置远端 call', '观察身体稳定性和远端腿价值', '趋势变化时调整租金腿或远端腿'],
    coreGreeks: ['delta', 'theta', 'gamma', 'vega'],
    risks: ['课程结构执行偏差', '租金腿和远端腿管理复杂', '行情停滞拖累远端腿'],
    sourceLessons: ['day11'],
    keywords: ['看涨螃蟹', '螃蟹', 'crab', '远端 call', '租金'],
    imageHints: ['assets/day11/WechatIMG91.jpg'],
  },
  {
    id: 'ratio-spread',
    nameZh: '比例价差',
    nameEn: 'ratio spread',
    marketStates: [MARKET_STATES.trendStarting, MARKET_STATES.bullishSynthetic],
    strategyTypes: [STRATEGY_TYPES.trendSpread, STRATEGY_TYPES.courseCombo],
    whenToUse: '偏多爆发观点较强，希望右侧突破后多腿接管利润。',
    setup: ['卖出 1 张较低行权价 call', '买入 2 张较高行权价 call'],
    operationSteps: ['确认上方爆发目标', '选择短 call 行权价', '选择更高行权价的两张长 call', '检查中间区域亏损', '价格冲过上方后观察长 call 接管程度', '价格卡在中间区域时处理'],
    coreGreeks: ['delta', 'gamma', 'theta'],
    risks: ['中间区域亏损', '方向慢导致时间损耗', '腿数比例管理复杂'],
    sourceLessons: ['day12'],
    keywords: ['比例价差', 'ratio spread', '卖 1', '买 2', 'ratio'],
    imageHints: ['assets/day12/WechatIMG98.jpg'],
  },
  {
    id: 'bull-three-leg',
    nameZh: '牛三腿',
    nameEn: 'bull three-leg',
    marketStates: [MARKET_STATES.bullishSynthetic],
    strategyTypes: [STRATEGY_TYPES.courseCombo, STRATEGY_TYPES.sellerIncome],
    whenToUse: '偏多但节奏不确定，想同时收租、吃慢涨，并保留后续调比例能力。',
    setup: ['下方卖 put', '上方卖 call', '中间买一张偏实值或近平值 call'],
    operationSteps: ['确认偏多但节奏未完全明朗', '选择下方 short put', '选择中间 long call', '选择上方 short call', '检查组合总 Greeks', '横盘时收租、慢涨时保留主梁、快涨时处理上方短腿'],
    coreGreeks: ['delta', 'gamma', 'theta', 'vega'],
    risks: ['下方 short put 风险', '上方 short call 压住趋势', '比例调整慢'],
    sourceLessons: ['day13'],
    keywords: ['牛三腿', '三腿', 'long call', 'short put', 'short call'],
    imageHints: ['assets/day13/WechatIMG108.jpg'],
  },
  {
    id: 'alligator-strategy',
    nameZh: '鳄鱼策略',
    nameEn: 'alligator strategy',
    marketStates: [MARKET_STATES.trendStarting, MARKET_STATES.bullishSynthetic],
    strategyTypes: [STRATEGY_TYPES.trendSpread, STRATEGY_TYPES.courseCombo],
    whenToUse: '偏多趋势启动，希望左侧亏损有限，中间利润上升更快，右侧继续保留斜率。',
    setup: ['以 bull call spread 为身体', '额外增加一条 long call', '通过短 call 控制部分时间价值'],
    operationSteps: ['确认趋势启动信号', '建立 bull call spread', '增加额外 long call 增强右侧', '检查净成本和上方斜率', '持仓中观察趋势速度和 theta', '方向失效或结构降档时退出'],
    coreGreeks: ['delta', 'gamma', 'theta'],
    risks: ['净成本更高', '方向慢或 IV 回落拖累结构', '课程名称和标准术语映射需要保留来源'],
    sourceLessons: ['day13'],
    keywords: ['鳄鱼', 'alligator', 'bull call spread', 'extra long call', '右侧'],
    imageHints: ['assets/day13/WechatIMG109.jpg'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[　]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitParagraphs(text) {
  return normalizeText(text)
    .split(/\n{2,}|\n(?=\S)/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length >= 12);
}

function collectMatchingParagraphs(text, keywords, maxExcerptChars = 1200) {
  const loweredKeywords = keywords.map(keyword => String(keyword).toLowerCase());
  return splitParagraphs(text)
    .filter(paragraph => {
      const lowered = paragraph.toLowerCase();
      return loweredKeywords.some(keyword => lowered.includes(keyword));
    })
    .map(paragraph => paragraph.length > maxExcerptChars
      ? `${paragraph.slice(0, maxExcerptChars)}`
      : paragraph);
}

module.exports = {
  MARKET_STATES,
  OPTIONS_STRATEGY_CATALOG,
  STRATEGY_TYPES,
  collectMatchingParagraphs,
  normalizeText,
  splitParagraphs,
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
node scripts/tests/optionsKnowledgeIndex.test.js
```

Expected:

```text
optionsKnowledgeIndex.test.js passed
```

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add scripts/optionsStrategyCatalog.js scripts/tests/optionsKnowledgeIndex.test.js
git commit -m "feat: 新增期权策略目录"
```

## Task 2: Knowledge Index Generator

**Files:**
- Create: `scripts/build-options-knowledge-index.js`
- Create: `src/data/optionsKnowledgeIndex.json`
- Generated local report: `local-artifacts/options/options-knowledge-index-report.json`
- Modify: `scripts/tests/optionsKnowledgeIndex.test.js`

- [ ] **Step 1: Extend the script test for index building**

Append this test to `scripts/tests/optionsKnowledgeIndex.test.js` before the final `console.log`:

```js
const { buildIndexFromSourceTexts } = require('../build-options-knowledge-index');

function testBuildIndexFromSourceTexts() {
  const index = buildIndexFromSourceTexts({
    sourceTexts: [
      {
        sourceFile: 'day11微信录音 魔方_20260414225958_原文.docx',
        text: '铁鹰策略就是 iron condor，下方做 bull put spread，上方做 bear call spread，目标是在区间内收租。',
      },
    ],
    maxExcerptChars: 500,
  });

  const ironCondor = index.find(item => item.id === 'iron-condor');
  assert.ok(ironCondor);
  assert.strictEqual(ironCondor.quotes.length, 1);
  assert.strictEqual(ironCondor.quotes[0].sourceFile, 'day11微信录音 魔方_20260414225958_原文.docx');
  assert.ok(ironCondor.quotes[0].excerpt.includes('iron condor'));
}

testBuildIndexFromSourceTexts();
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node scripts/tests/optionsKnowledgeIndex.test.js
```

Expected:

```text
Error: Cannot find module '../build-options-knowledge-index'
```

- [ ] **Step 3: Implement the generator**

Create `scripts/build-options-knowledge-index.js`:

```js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  OPTIONS_STRATEGY_CATALOG,
  collectMatchingParagraphs,
} = require('./optionsStrategyCatalog');

const DEFAULT_SOURCE_DIR = '/Users/yang/Documents/知识星球/魔方内参';
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '../src/data/optionsKnowledgeIndex.json');
const DEFAULT_REPORT_PATH = path.join(__dirname, '../local-artifacts/options/options-knowledge-index-report.json');

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    outputPath: DEFAULT_OUTPUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    maxExcerptChars: 1800,
  };

  argv.forEach(arg => {
    if (arg.startsWith('--source=')) args.sourceDir = arg.slice('--source='.length);
    if (arg.startsWith('--out=')) args.outputPath = arg.slice('--out='.length);
    if (arg.startsWith('--report=')) args.reportPath = arg.slice('--report='.length);
    if (arg.startsWith('--maxExcerptChars=')) {
      args.maxExcerptChars = Number(arg.slice('--maxExcerptChars='.length)) || args.maxExcerptChars;
    }
  });

  return args;
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function listDocxFiles(sourceDir) {
  const originalsDir = path.join(sourceDir, '原文');
  if (!fs.existsSync(originalsDir)) {
    throw new Error(`Source originals directory is missing: ${originalsDir}`);
  }

  return fs.readdirSync(originalsDir)
    .filter(fileName => fileName.endsWith('.docx'))
    .filter(fileName => !fileName.startsWith('~$'))
    .sort()
    .map(fileName => path.join(originalsDir, fileName));
}

function readDocxText(filePath) {
  return execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function buildQuote({ sourceFile, excerpt }) {
  const compact = String(excerpt || '').trim();
  return {
    sourceFile,
    excerpt: compact,
    startHint: compact.slice(0, 28),
    endHint: compact.slice(Math.max(0, compact.length - 28)),
  };
}

function buildIndexFromSourceTexts({ sourceTexts, maxExcerptChars = 1800 }) {
  return OPTIONS_STRATEGY_CATALOG.map(strategy => {
    const quotes = sourceTexts.flatMap(source => (
      collectMatchingParagraphs(source.text, strategy.keywords, maxExcerptChars)
        .slice(0, 8)
        .map(excerpt => buildQuote({
          sourceFile: source.sourceFile,
          excerpt,
        }))
    ));

    return {
      id: strategy.id,
      nameZh: strategy.nameZh,
      nameEn: strategy.nameEn,
      marketStates: strategy.marketStates,
      strategyTypes: strategy.strategyTypes,
      whenToUse: strategy.whenToUse,
      setup: strategy.setup,
      operationSteps: strategy.operationSteps,
      coreGreeks: strategy.coreGreeks,
      risks: strategy.risks,
      sourceLessons: strategy.sourceLessons,
      quotes,
      images: strategy.imageHints,
      keywords: strategy.keywords,
    };
  });
}

function buildReport(index) {
  return {
    generatedAt: new Date().toISOString(),
    strategyCount: index.length,
    strategies: index.map(item => ({
      id: item.id,
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      quoteCount: item.quotes.length,
      sourceFiles: Array.from(new Set(item.quotes.map(quote => quote.sourceFile))).sort(),
    })),
  };
}

function writeJson(filePath, payload) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const files = listDocxFiles(args.sourceDir);
  const sourceTexts = files.map(filePath => ({
    sourceFile: path.basename(filePath),
    text: readDocxText(filePath),
  }));

  const index = buildIndexFromSourceTexts({
    sourceTexts,
    maxExcerptChars: args.maxExcerptChars,
  });

  const report = buildReport(index);
  writeJson(args.outputPath, index);
  writeJson(args.reportPath, report);

  console.log(`Wrote ${index.length} strategies to ${args.outputPath}`);
  console.log(`Wrote extraction report to ${args.reportPath}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  buildIndexFromSourceTexts,
  buildReport,
  listDocxFiles,
  parseArgs,
  readDocxText,
  run,
};
```

- [ ] **Step 4: Run tests and generate the index**

Run:

```bash
node scripts/tests/optionsKnowledgeIndex.test.js
node scripts/build-options-knowledge-index.js
```

Expected:

```text
optionsKnowledgeIndex.test.js passed
Wrote 20 strategies to /Users/yang/Documents/Projects/crypto-metrics-dashboard/src/data/optionsKnowledgeIndex.json
Wrote extraction report to /Users/yang/Documents/Projects/crypto-metrics-dashboard/local-artifacts/options/options-knowledge-index-report.json
```

- [ ] **Step 5: Inspect generated report**

Run:

```bash
node -e "const r=require('./local-artifacts/options/options-knowledge-index-report.json'); console.log(r.strategyCount); console.log(r.strategies.filter(s=>s.quoteCount===0).map(s=>s.id))"
```

Expected:

```text
20
[]
```

If any strategy has zero quotes, add a missing keyword to `scripts/optionsStrategyCatalog.js`, rerun the generator, and rerun the report command.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add scripts/build-options-knowledge-index.js scripts/optionsStrategyCatalog.js scripts/tests/optionsKnowledgeIndex.test.js src/data/optionsKnowledgeIndex.json
git commit -m "feat: 生成期权课程索引"
```

## Task 3: BTC DVOL History API

**Files:**
- Modify: `server/utils/btcVolatility.js`
- Modify: `server/routes/volatility.js`
- Modify: `server/tests/btcVolatility.test.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Add backend tests first**

In `server/tests/btcVolatility.test.js`, update the import:

```js
const {
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
  calculateAtr,
  calculateDailyIvFromDvol,
  calculateDailyRv,
  classifyVolatilityComparison,
  parseDeribitDvolCandle,
} = require('../utils/btcVolatility');
```

Add this test block before the final `console.log`:

```js
  const parsedDvol = parseDeribitDvolCandle([Date.UTC(2026, 0, 15, 12), 50, 52, 49, 51]);
  assert.strictEqual(parsedDvol.timestamp, '2026-01-15T12:00:00.000Z');
  assert.strictEqual(parsedDvol.open, 50);
  assert.strictEqual(parsedDvol.high, 52);
  assert.strictEqual(parsedDvol.low, 49);
  assert.strictEqual(parsedDvol.close, 51);

  const historyFetchImpl = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      result: {
        data: [
          [Date.UTC(2026, 0, 15, 10), 48, 51, 47, 50],
          [Date.UTC(2026, 0, 15, 11), 50, 53, 49, 52],
        ],
      },
    }),
  });

  const history = await buildBtcVolatilityHistory({
    fetchImpl: historyFetchImpl,
    now: Date.UTC(2026, 0, 15, 12),
    lookbackHours: 2,
    resolution: '60',
  });

  assert.strictEqual(history.symbol, 'BTC');
  assert.strictEqual(history.resolution, '60');
  assert.strictEqual(history.candles.length, 2);
  assert.strictEqual(history.candles[1].close, 52);
  assert.strictEqual(history.timestamps.generatedAt, '2026-01-15T12:00:00.000Z');
```

- [ ] **Step 2: Run backend test and verify it fails**

Run:

```bash
node server/tests/btcVolatility.test.js
```

Expected:

```text
TypeError: parseDeribitDvolCandle is not a function
```

- [ ] **Step 3: Implement DVOL history helpers**

In `server/utils/btcVolatility.js`, add these functions after `fetchDeribitDvol`:

```js
function parseDeribitDvolCandle(row) {
  if (!Array.isArray(row) || row.length < 5) {
    throw new Error('Invalid Deribit DVOL candle payload');
  }

  return {
    timestamp: new Date(toNumber(row[0], 'dvolTimestamp')).toISOString(),
    open: toNumber(row[1], 'dvolOpen'),
    high: toNumber(row[2], 'dvolHigh'),
    low: toNumber(row[3], 'dvolLow'),
    close: toNumber(row[4], 'dvolClose'),
  };
}

async function fetchDeribitDvolCandles({
  currency = 'BTC',
  fetchImpl = global.fetch,
  lookbackHours = 24 * 30,
  now = Date.now(),
  resolution = '60',
} = {}) {
  const params = new URLSearchParams({
    currency,
    start_timestamp: String(now - lookbackHours * ONE_HOUR_MS),
    end_timestamp: String(now),
    resolution: String(resolution),
  });
  const url = `${DERIBIT_API_URL}?${params.toString()}`;
  const payload = await fetchJson(url, fetchImpl);
  const rows = payload?.result?.data;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Deribit DVOL history response is empty');
  }

  return rows.map(parseDeribitDvolCandle);
}

async function buildBtcVolatilityHistory({
  fetchImpl = global.fetch,
  lookbackHours = 24 * 30,
  now = Date.now(),
  resolution = '60',
} = {}) {
  const candles = await fetchDeribitDvolCandles({
    fetchImpl,
    lookbackHours,
    now,
    resolution,
  });

  return {
    symbol: 'BTC',
    source: 'Deribit BTC DVOL',
    resolution: String(resolution),
    lookbackHours,
    candles,
    timestamps: {
      generatedAt: new Date(now).toISOString(),
      firstCandleAt: candles[0]?.timestamp || null,
      lastCandleAt: candles[candles.length - 1]?.timestamp || null,
    },
  };
}
```

Update the existing `fetchDeribitDvol` latest parsing to use the shared parser:

```js
  const latest = rows[rows.length - 1];
  return parseDeribitDvolCandle(latest);
```

Update `module.exports` with:

```js
  buildBtcVolatilityHistory,
  fetchDeribitDvolCandles,
  parseDeribitDvolCandle,
```

- [ ] **Step 4: Add route and client method**

In `server/routes/volatility.js`, add cache state near the existing cache:

```js
const historyCache = new Map();
```

Import `buildBtcVolatilityHistory`:

```js
const {
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
} = require('../utils/btcVolatility');
```

Add this route after `/btc`:

```js
router.get('/btc/history', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const lookbackHours = Math.min(Math.max(Number(req.query.lookbackHours) || 24 * 30, 6), 24 * 120);
    const resolution = String(req.query.resolution || '60');
    const cacheKey = `${lookbackHours}:${resolution}`;
    const now = Date.now();
    const cached = historyCache.get(cacheKey);

    if (!forceRefresh && cached && cached.expiresAt > now) {
      return res.json({
        success: true,
        cached: true,
        data: cached.data,
      });
    }

    const data = await buildBtcVolatilityHistory({ now, lookbackHours, resolution });
    historyCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      data,
    });

    return res.json({
      success: true,
      cached: false,
      data,
    });
  } catch (error) {
    console.error('Error fetching BTC volatility history:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch BTC volatility history',
    });
  }
});
```

Extend `clearCache()`:

```js
    historyCache.clear();
```

In `src/services/api.js`, add cache slots:

```js
  btcVolatilityHistory: null,
  lastBtcVolatilityHistoryFetchTime: 0
```

Add client method after `fetchBtcVolatility`:

```js
export const fetchBtcVolatilityHistory = async ({ refresh = false, lookbackHours = 24 * 30, resolution = '60' } = {}) => {
  const now = Date.now();
  if (!refresh && dataCache.btcVolatilityHistory && (now - dataCache.lastBtcVolatilityHistoryFetchTime < 60 * 1000)) {
    return dataCache.btcVolatilityHistory;
  }

  try {
    const response = await callApiWithRetry(() => api.get('/volatility/btc/history', {
      params: {
        lookbackHours,
        resolution,
        ...(refresh ? { refresh: 1 } : {}),
      },
    }));
    if (response.data && response.data.success) {
      dataCache.btcVolatilityHistory = response.data;
      dataCache.lastBtcVolatilityHistoryFetchTime = now;
      return response.data;
    }
    throw new Error(response.data?.error || '获取BTC隐含波动率历史失败');
  } catch (error) {
    console.error('获取BTC隐含波动率历史失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取BTC隐含波动率历史失败');
  }
};
```

- [ ] **Step 5: Run backend test**

Run:

```bash
node server/tests/btcVolatility.test.js
```

Expected:

```text
btcVolatility.test.js passed
```

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add server/utils/btcVolatility.js server/routes/volatility.js server/tests/btcVolatility.test.js src/services/api.js
git commit -m "feat: 支持BTC隐波历史K线"
```

## Task 4: Frontend Knowledge Helpers

**Files:**
- Create: `src/utils/optionsKnowledge.js`
- Create: `src/utils/optionsKnowledge.test.js`

- [ ] **Step 1: Write helper tests**

Create `src/utils/optionsKnowledge.test.js`:

```js
import {
  filterOptionsStrategies,
  getOptionsFilterCounts,
  normalizeOptionsSearch,
} from './optionsKnowledge';

const strategies = [
  {
    id: 'iron-condor',
    nameZh: '铁鹰策略',
    nameEn: 'iron condor',
    marketStates: ['区间震荡'],
    strategyTypes: ['卖出波动率', '区间结构'],
    coreGreeks: ['theta', 'vega'],
    sourceLessons: ['day11'],
    quotes: [{ excerpt: '区间内收租' }],
  },
  {
    id: 'long-straddle',
    nameZh: '买入跨式',
    nameEn: 'long straddle',
    marketStates: ['波动率开始上升'],
    strategyTypes: ['买入波动率'],
    coreGreeks: ['gamma', 'vega'],
    sourceLessons: ['day3'],
    quotes: [{ excerpt: '买波动' }],
  },
];

test('normalizes search text', () => {
  expect(normalizeOptionsSearch('  Iron  Condor ')).toBe('iron condor');
});

test('filters by market state and strategy type', () => {
  const result = filterOptionsStrategies(strategies, {
    marketState: '区间震荡',
    strategyType: '卖出波动率',
    searchTerm: '',
  });

  expect(result.map(item => item.id)).toEqual(['iron-condor']);
});

test('searches names greeks lessons and excerpts', () => {
  expect(filterOptionsStrategies(strategies, { searchTerm: 'gamma' }).map(item => item.id)).toEqual(['long-straddle']);
  expect(filterOptionsStrategies(strategies, { searchTerm: '铁鹰' }).map(item => item.id)).toEqual(['iron-condor']);
  expect(filterOptionsStrategies(strategies, { searchTerm: 'day11' }).map(item => item.id)).toEqual(['iron-condor']);
});

test('computes filter counts', () => {
  const counts = getOptionsFilterCounts(strategies);
  expect(counts.marketStates['区间震荡']).toBe(1);
  expect(counts.strategyTypes['买入波动率']).toBe(1);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- --watchAll=false src/utils/optionsKnowledge.test.js
```

Expected:

```text
Cannot find module './optionsKnowledge'
```

- [ ] **Step 3: Implement helpers**

Create `src/utils/optionsKnowledge.js`:

```js
export const MARKET_STATE_FILTERS = [
  '波动率开始上升',
  '低 IV + 高 RV 预期',
  '高 IV + 预期回落',
  '区间震荡',
  '近端横盘 + 远端保留波动',
  '单边趋势开始',
  '已有底仓需要保护',
  '偏多合成与结构增强',
];

export const STRATEGY_TYPE_FILTERS = [
  '买入波动率',
  '卖出波动率',
  '买入方向',
  '卖方收租',
  '时间结构',
  '区间结构',
  '趋势价差',
  '底仓保护',
  '合成多头',
  '课程组合结构',
];

export function normalizeOptionsSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function includesValue(values = [], selected) {
  return !selected || values.includes(selected);
}

function buildSearchText(strategy) {
  return [
    strategy.nameZh,
    strategy.nameEn,
    ...(strategy.marketStates || []),
    ...(strategy.strategyTypes || []),
    ...(strategy.coreGreeks || []),
    ...(strategy.sourceLessons || []),
    ...(strategy.keywords || []),
    ...(strategy.quotes || []).map(quote => `${quote.sourceFile || ''} ${quote.excerpt || ''}`),
  ].join(' ').toLowerCase();
}

export function filterOptionsStrategies(strategies = [], filters = {}) {
  const searchTerm = normalizeOptionsSearch(filters.searchTerm);
  return strategies.filter(strategy => {
    if (!includesValue(strategy.marketStates, filters.marketState)) return false;
    if (!includesValue(strategy.strategyTypes, filters.strategyType)) return false;
    if (!searchTerm) return true;
    return buildSearchText(strategy).includes(searchTerm);
  });
}

export function getOptionsFilterCounts(strategies = []) {
  return strategies.reduce((counts, strategy) => {
    (strategy.marketStates || []).forEach(state => {
      counts.marketStates[state] = (counts.marketStates[state] || 0) + 1;
    });
    (strategy.strategyTypes || []).forEach(type => {
      counts.strategyTypes[type] = (counts.strategyTypes[type] || 0) + 1;
    });
    return counts;
  }, { marketStates: {}, strategyTypes: {} });
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- --watchAll=false src/utils/optionsKnowledge.test.js
```

Expected:

```text
PASS src/utils/optionsKnowledge.test.js
```

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/utils/optionsKnowledge.js src/utils/optionsKnowledge.test.js
git commit -m "test: 覆盖期权策略筛选"
```

## Task 5: Options Page Components

**Files:**
- Create: `src/components/OptionsVolatilityChart.jsx`
- Create: `src/components/OptionsStrategyCard.jsx`
- Create: `src/components/OptionsStrategyDrawer.jsx`
- Create: `src/components/OptionsPage.jsx`
- Create: `src/components/__tests__/OptionsPage.test.jsx`
- Modify: `src/styles/design-system.css`

- [ ] **Step 1: Write page test**

Create `src/components/__tests__/OptionsPage.test.jsx`:

```jsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OptionsPage from '../OptionsPage';
import { fetchBtcVolatilityHistory } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchBtcVolatilityHistory: jest.fn(),
}));

jest.mock('../../data/optionsKnowledgeIndex.json', () => ([
  {
    id: 'iron-condor',
    nameZh: '铁鹰策略',
    nameEn: 'iron condor',
    marketStates: ['区间震荡', '高 IV + 预期回落'],
    strategyTypes: ['卖出波动率', '区间结构'],
    whenToUse: '预期价格留在明确上下边界内。',
    setup: ['下方 bull put spread', '上方 bear call spread'],
    operationSteps: ['判断区间边界', '选择到期日', '确定上下短腿', '买保护长腿封顶风险'],
    coreGreeks: ['theta', 'vega', 'gamma'],
    risks: ['单边突破区间'],
    sourceLessons: ['day11'],
    quotes: [{ sourceFile: 'day11.docx', excerpt: '铁鹰策略原文' }],
    images: [],
  },
  {
    id: 'long-straddle',
    nameZh: '买入跨式',
    nameEn: 'long straddle',
    marketStates: ['波动率开始上升'],
    strategyTypes: ['买入波动率'],
    whenToUse: '预期行情会大幅波动。',
    setup: ['买 call', '买 put'],
    operationSteps: ['判断 IV', '选择平值', '买入双腿', '观察波动'],
    coreGreeks: ['gamma', 'vega'],
    risks: ['theta 消耗'],
    sourceLessons: ['day3'],
    quotes: [{ sourceFile: 'day3.docx', excerpt: '买波动原文' }],
    images: [],
  },
]), { virtual: true });

test('renders options page and filters strategies', async () => {
  fetchBtcVolatilityHistory.mockResolvedValue({
    data: {
      candles: [
        { timestamp: '2026-01-01T00:00:00.000Z', open: 50, close: 52, low: 49, high: 53 },
      ],
      timestamps: { generatedAt: '2026-01-01T00:00:00.000Z' },
    },
  });

  render(<OptionsPage />);

  expect(screen.getByText('期权策略库')).toBeInTheDocument();
  expect(screen.getByText('铁鹰策略')).toBeInTheDocument();
  expect(screen.getByText('买入跨式')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /区间震荡/ }));

  expect(screen.getByText('铁鹰策略')).toBeInTheDocument();
  expect(screen.queryByText('买入跨式')).toBeNull();

  fireEvent.change(screen.getByPlaceholderText('搜索策略、Greek、课程或原文'), {
    target: { value: 'iron condor' },
  });

  expect(screen.getByText('铁鹰策略')).toBeInTheDocument();

  await waitFor(() => expect(fetchBtcVolatilityHistory).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- --watchAll=false src/components/__tests__/OptionsPage.test.jsx
```

Expected:

```text
Cannot find module '../OptionsPage'
```

- [ ] **Step 3: Implement `OptionsVolatilityChart.jsx`**

Create `src/components/OptionsVolatilityChart.jsx`:

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Alert, Button, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchBtcVolatilityHistory } from '../services/api';

const { Text } = Typography;

function formatDateLabel(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
}

function OptionsVolatilityChart() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);

  const loadHistory = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchBtcVolatilityHistory({ refresh, lookbackHours: 24 * 30, resolution: '60' });
      setHistory(response.data);
    } catch (err) {
      setError(err.message || 'BTC 隐含波动率历史加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const candles = history?.candles || [];
  const latest = candles[candles.length - 1];

  const option = useMemo(() => ({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    grid: { left: 42, right: 18, top: 24, bottom: 32 },
    xAxis: {
      type: 'category',
      data: candles.map(item => formatDateLabel(item.timestamp)),
      boundaryGap: true,
      axisLabel: { color: '#6f756e' },
      axisLine: { lineStyle: { color: '#ddd4c2' } },
    },
    yAxis: {
      scale: true,
      axisLabel: { color: '#6f756e', formatter: value => `${value}%` },
      splitLine: { lineStyle: { color: 'rgba(78, 68, 50, 0.14)' } },
    },
    series: [{
      name: 'BTC DVOL',
      type: 'candlestick',
      data: candles.map(item => [item.open, item.close, item.low, item.high]),
      itemStyle: {
        color: '#2f8f61',
        color0: '#c75d4d',
        borderColor: '#2f8f61',
        borderColor0: '#c75d4d',
      },
    }],
  }), [candles]);

  if (loading && !history) {
    return (
      <section className="options-vol-panel">
        <Spin size="small" /> <Text>BTC 隐含波动率加载中</Text>
      </section>
    );
  }

  if (error) {
    return (
      <Alert
        className="options-vol-panel"
        type="warning"
        showIcon
        message="BTC 隐含波动率 K 线加载失败"
        description={error}
        action={<Button size="small" icon={<ReloadOutlined />} onClick={() => loadHistory({ refresh: true })}>重试</Button>}
      />
    );
  }

  return (
    <section className="options-vol-panel">
      <div className="options-vol-panel__header">
        <div>
          <div className="options-vol-panel__eyebrow">BTC Implied Volatility</div>
          <h2>BTC 隐含波动率 K 线</h2>
        </div>
        <div className="options-vol-panel__meta">
          <span>最新 DVOL <strong>{latest ? `${latest.close.toFixed(2)}%` : 'n/a'}</strong></span>
          <span>样本 <strong>{candles.length}</strong></span>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => loadHistory({ refresh: true })}>刷新</Button>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />
    </section>
  );
}

export default OptionsVolatilityChart;
```

- [ ] **Step 4: Implement strategy card and drawer**

Create `src/components/OptionsStrategyCard.jsx`:

```jsx
import React from 'react';
import { Button, Tag } from 'antd';

function OptionsStrategyCard({ strategy, onOpen }) {
  return (
    <article className="options-strategy-card">
      <div className="options-strategy-card__head">
        <div>
          <h3>{strategy.nameZh}</h3>
          <p>{strategy.nameEn}</p>
        </div>
        <Button type="primary" onClick={() => onOpen(strategy)}>查看原文</Button>
      </div>

      <div className="options-strategy-card__tags">
        {(strategy.marketStates || []).map(tag => <Tag key={tag} color="blue">{tag}</Tag>)}
        {(strategy.strategyTypes || []).map(tag => <Tag key={tag} color="gold">{tag}</Tag>)}
      </div>

      <dl className="options-strategy-card__body">
        <dt>什么时候用</dt>
        <dd>{strategy.whenToUse}</dd>
        <dt>怎么搭</dt>
        <dd>{(strategy.setup || []).join(' / ')}</dd>
        <dt>核心 Greeks</dt>
        <dd>{(strategy.coreGreeks || []).join(' / ')}</dd>
      </dl>
    </article>
  );
}

export default OptionsStrategyCard;
```

Create `src/components/OptionsStrategyDrawer.jsx`:

```jsx
import React from 'react';
import { Button, Drawer, Empty, Tag, Typography } from 'antd';

const { Paragraph, Text } = Typography;

function OptionsStrategyDrawer({ strategy, open, onClose }) {
  return (
    <Drawer
      title={strategy ? `${strategy.nameZh}（${strategy.nameEn}）` : '策略详情'}
      width={680}
      open={open}
      onClose={onClose}
    >
      {strategy ? (
        <div className="options-drawer">
          <section>
            <h3>怎么操作</h3>
            <ol>
              {(strategy.operationSteps || []).map(step => <li key={step}>{step}</li>)}
            </ol>
          </section>

          <section>
            <h3>主要风险</h3>
            <div className="options-strategy-card__tags">
              {(strategy.risks || []).map(risk => <Tag key={risk} color="volcano">{risk}</Tag>)}
            </div>
          </section>

          <section>
            <h3>老师原文</h3>
            {(strategy.quotes || []).length > 0 ? (
              strategy.quotes.map((quote, index) => (
                <div className="options-quote" key={`${quote.sourceFile}-${index}`}>
                  <Text strong>{quote.sourceFile}</Text>
                  <Paragraph>{quote.excerpt}</Paragraph>
                  <Button size="small" onClick={() => navigator.clipboard?.writeText(quote.excerpt)}>复制原文</Button>
                </div>
              ))
            ) : (
              <Empty description="待补充来源" />
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

export default OptionsStrategyDrawer;
```

- [ ] **Step 5: Implement page component**

Create `src/components/OptionsPage.jsx`:

```jsx
import React, { useMemo, useState } from 'react';
import { Empty, Input, Tag, Typography } from 'antd';
import optionsKnowledgeIndex from '../data/optionsKnowledgeIndex.json';
import {
  MARKET_STATE_FILTERS,
  STRATEGY_TYPE_FILTERS,
  filterOptionsStrategies,
  getOptionsFilterCounts,
} from '../utils/optionsKnowledge';
import OptionsStrategyCard from './OptionsStrategyCard';
import OptionsStrategyDrawer from './OptionsStrategyDrawer';
import OptionsVolatilityChart from './OptionsVolatilityChart';

const { Text } = Typography;

function FilterButton({ active, count, label, onClick }) {
  return (
    <button className={`options-filter-chip ${active ? 'is-active' : ''}`} onClick={onClick} type="button">
      {label} <span>{count || 0}</span>
    </button>
  );
}

function OptionsPage() {
  const [marketState, setMarketState] = useState('');
  const [strategyType, setStrategyType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  const counts = useMemo(() => getOptionsFilterCounts(optionsKnowledgeIndex), []);
  const filteredStrategies = useMemo(() => filterOptionsStrategies(optionsKnowledgeIndex, {
    marketState,
    strategyType,
    searchTerm,
  }), [marketState, strategyType, searchTerm]);

  return (
    <main className="options-page">
      <OptionsVolatilityChart />

      <section className="options-page__header">
        <div>
          <div className="dashboard-eyebrow">Options Playbook</div>
          <h1>期权策略库</h1>
          <Text>按市场状态和策略属性检索《魔方内参》期权原文、操作步骤和风险点。</Text>
        </div>
        <Input
          className="options-search"
          placeholder="搜索策略、Greek、课程或原文"
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
        />
      </section>

      <section className="options-filter-grid">
        <div>
          <h2>市场状态</h2>
          <div className="options-filter-list">
            <FilterButton label="全部状态" active={!marketState} count={optionsKnowledgeIndex.length} onClick={() => setMarketState('')} />
            {MARKET_STATE_FILTERS.map(label => (
              <FilterButton
                key={label}
                label={label}
                active={marketState === label}
                count={counts.marketStates[label]}
                onClick={() => setMarketState(label)}
              />
            ))}
          </div>
        </div>
        <div>
          <h2>策略属性</h2>
          <div className="options-filter-list">
            <FilterButton label="全部属性" active={!strategyType} count={optionsKnowledgeIndex.length} onClick={() => setStrategyType('')} />
            {STRATEGY_TYPE_FILTERS.map(label => (
              <FilterButton
                key={label}
                label={label}
                active={strategyType === label}
                count={counts.strategyTypes[label]}
                onClick={() => setStrategyType(label)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="options-result-meta">
        <Tag color="default">{filteredStrategies.length} 个策略</Tag>
        {marketState && <Tag color="blue">{marketState}</Tag>}
        {strategyType && <Tag color="gold">{strategyType}</Tag>}
      </section>

      {filteredStrategies.length > 0 ? (
        <section className="options-strategy-grid">
          {filteredStrategies.map(strategy => (
            <OptionsStrategyCard
              key={strategy.id}
              strategy={strategy}
              onOpen={setSelectedStrategy}
            />
          ))}
        </section>
      ) : (
        <Empty description="暂无期权策略内容" />
      )}

      <OptionsStrategyDrawer
        strategy={selectedStrategy}
        open={Boolean(selectedStrategy)}
        onClose={() => setSelectedStrategy(null)}
      />
    </main>
  );
}

export default OptionsPage;
```

- [ ] **Step 6: Add scoped styles**

Append to `src/styles/design-system.css`:

```css
.options-page {
  width: min(1480px, calc(100vw - 48px));
  margin: 0 auto;
  padding: 18px 0 44px;
}

.options-vol-panel,
.options-page__header,
.options-filter-grid,
.options-strategy-card {
  border: 1px solid rgba(78, 68, 50, 0.13);
  border-radius: 8px;
  background: var(--cm-panel);
  box-shadow: var(--cm-shadow);
}

.options-vol-panel {
  margin-bottom: 14px;
  padding: 16px;
}

.options-vol-panel__header,
.options-page__header,
.options-strategy-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.options-vol-panel__eyebrow {
  color: var(--cm-muted);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.options-vol-panel h2,
.options-page__header h1,
.options-filter-grid h2,
.options-strategy-card h3 {
  margin: 0;
  color: var(--cm-ink);
}

.options-vol-panel__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  color: var(--cm-muted);
  font-size: 12px;
}

.options-vol-panel__meta strong {
  color: var(--cm-ink);
}

.options-page__header {
  margin-bottom: 14px;
  padding: 16px;
}

.options-search {
  max-width: 360px;
}

.options-filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 12px;
  padding: 14px;
}

.options-filter-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.options-filter-chip {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid rgba(78, 68, 50, 0.16);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.84);
  color: var(--cm-ink);
  cursor: pointer;
  font-weight: 650;
}

.options-filter-chip span {
  margin-left: 4px;
  color: var(--cm-muted);
}

.options-filter-chip.is-active {
  border-color: var(--cm-graphite);
  background: var(--cm-graphite);
  color: #fbf7ed;
}

.options-filter-chip.is-active span {
  color: rgba(251, 247, 237, 0.76);
}

.options-result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.options-strategy-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.options-strategy-card {
  padding: 14px;
}

.options-strategy-card__head p {
  margin: 2px 0 0;
  color: var(--cm-muted);
  font-family: "DIN Alternate", "Avenir Next", sans-serif;
}

.options-strategy-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
}

.options-strategy-card__body {
  margin: 0;
}

.options-strategy-card__body dt {
  margin-top: 10px;
  color: var(--cm-muted);
  font-size: 12px;
  font-weight: 800;
}

.options-strategy-card__body dd {
  margin: 2px 0 0;
  color: var(--cm-ink);
}

.options-drawer section + section {
  margin-top: 22px;
}

.options-quote {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid rgba(78, 68, 50, 0.12);
  border-radius: 8px;
  background: #fbfaf6;
}

@media (max-width: 1100px) {
  .options-strategy-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .options-page {
    width: calc(100vw - 16px);
    padding: 8px 0 24px;
  }

  .options-vol-panel__header,
  .options-page__header,
  .options-strategy-card__head {
    display: block;
  }

  .options-search {
    max-width: none;
    margin-top: 12px;
  }

  .options-filter-grid,
  .options-strategy-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: Run page test**

Run:

```bash
npm test -- --watchAll=false src/components/__tests__/OptionsPage.test.jsx
```

Expected:

```text
PASS src/components/__tests__/OptionsPage.test.jsx
```

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/components/OptionsVolatilityChart.jsx src/components/OptionsStrategyCard.jsx src/components/OptionsStrategyDrawer.jsx src/components/OptionsPage.jsx src/components/__tests__/OptionsPage.test.jsx src/styles/design-system.css
git commit -m "feat: 新增期权策略页面"
```

## Task 6: Routing, Navigation, And App Test

**Files:**
- Modify: `src/App.js`
- Modify: `src/App.test.js`

- [ ] **Step 1: Update App test**

Replace `src/App.test.js` with:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

test('renders login page for unauthenticated users', async () => {
  localStorage.clear();
  render(<App />);
  await waitFor(() => expect(screen.getByText(/登录/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Modify route and nav**

In `src/App.js`, add import:

```js
import OptionsPage from './components/OptionsPage';
```

Update `activeKey`:

```js
  const activeKey = location.pathname.startsWith('/input')
    ? '2'
    : location.pathname.startsWith('/users')
    ? '3'
    : location.pathname.startsWith('/options')
    ? '5'
    : location.pathname.startsWith('/dashboard') || location.pathname === '/'
    ? '4'
    : '4';
```

Add menu item after 数据看板:

```jsx
        <Menu.Item key="5">
          <Link to="/options">期权</Link>
        </Menu.Item>
```

Add protected route before unknown redirect:

```jsx
            <Route path="/options" element={
              <ProtectedRoute>
                <OptionsPage />
              </ProtectedRoute>
            } />
```

- [ ] **Step 3: Run route test**

Run:

```bash
npm test -- --watchAll=false src/App.test.js
```

Expected:

```text
PASS src/App.test.js
```

- [ ] **Step 4: Commit Task 6**

Run:

```bash
git add src/App.js src/App.test.js
git commit -m "feat: 接入期权页面路由"
```

## Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run script tests**

Run:

```bash
node scripts/tests/optionsKnowledgeIndex.test.js
node server/tests/btcVolatility.test.js
```

Expected:

```text
optionsKnowledgeIndex.test.js passed
btcVolatility.test.js passed
```

- [ ] **Step 2: Run frontend targeted tests**

Run:

```bash
npm test -- --watchAll=false src/utils/optionsKnowledge.test.js src/components/__tests__/OptionsPage.test.jsx src/App.test.js
```

Expected:

```text
PASS src/utils/optionsKnowledge.test.js
PASS src/components/__tests__/OptionsPage.test.jsx
PASS src/App.test.js
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully.
```

- [ ] **Step 4: Start local app**

Run:

```bash
npm run dev
```

Expected:

```text
Server running on port 3001
webpack compiled
```

- [ ] **Step 5: Browser verification**

Open:

```text
http://localhost:3000/options
```

Verify:

- The login flow still protects `/options`.
- After login, the `期权` nav item is present.
- The BTC implied-volatility K-line panel renders or shows a retryable warning.
- Clicking `区间震荡` filters to iron condor and butterfly-related cards.
- Clicking `卖出波动率` includes iron condor and short-volatility structures.
- Searching `铁鹰` shows iron condor.
- Searching `gamma` shows gamma-related strategies.
- Opening a strategy shows operation steps and original excerpts.

- [ ] **Step 6: Confirm final working-tree scope**

Run:

```bash
git status --short
```

Expected: only known pre-existing untracked workspace folders remain, or the working tree is clean after the previous task commits.

## Self-Review

- Spec coverage: Tasks cover route, navigation, BTC IV K-line, dual directory filters, search, strategy cards, operation steps, source excerpts, generated report, empty states, and verification.
- Placeholder scan: The plan uses concrete file paths, commands, expected outputs, strategy IDs, and code snippets.
- Type consistency: Strategy records use the same field names across generator, JSON, frontend utilities, cards, drawer, and tests.
