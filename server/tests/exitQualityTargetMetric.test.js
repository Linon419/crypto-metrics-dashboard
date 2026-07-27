/**
 * 回归用例：退场期实时质量必须以“最新一天”为 targetMetric。
 *
 * evaluateExitQualityBodong 的第 5 个参数 targetMetric 默认取退场期首日。
 * calculatePeriodQuality（实时路径）一旦漏传该参数，
 * getComparisonsUpToTarget 会把退场期首日之后的全部转正节点比较过滤掉：
 *   - 有 beforeNode 时标签冻结在“before→start”那一次，永不随退场期推进更新；
 *   - 没有 beforeNode 时比较集为空，直接退化成“退场期 (待观察)”。
 *
 * 本用例走完整的 DB 实时路径，因为这个 bug 出在调用点而非被调函数，
 * 只测 evaluateExitQualityBodong 本身是抓不到的。
 */

const assert = require('assert');

const db = require('../models');
const { calculatePeriodQuality } = require('../utils/periodQualityEvaluation');
const { __internals } = require('../utils/periodQualityEvaluation');

// 构造：退场期首日之前没有转正节点，之后有一个。
// 于是 targetMetric 取首日 -> 比较集为空 -> “退场期 (待观察)”；
// targetMetric 取最新一天 -> 该节点参与比较 -> 得到真实标签。
function buildMetrics(coinId) {
  return [
    { coin_id: coinId, date: '2026-05-31', otc_index: 900, explosion_index: 30, entry_exit_type: 'entry', entry_exit_day: 9 },
    { coin_id: coinId, date: '2026-06-01', otc_index: 1000, explosion_index: 50, entry_exit_type: 'exit', entry_exit_day: 1 },
    { coin_id: coinId, date: '2026-06-10', otc_index: 800, explosion_index: -20, entry_exit_type: 'exit', entry_exit_day: 10 },
    { coin_id: coinId, date: '2026-06-11', otc_index: 1300, explosion_index: 15, entry_exit_type: 'exit', entry_exit_day: 11 },
    { coin_id: coinId, date: '2026-06-12', otc_index: 1320, explosion_index: 40, entry_exit_type: 'exit', entry_exit_day: 12 },
  ];
}

async function run() {
  const quiet = console.log;
  await db.sequelize.sync();

  const coin = await db.Coin.create({ symbol: 'EXITFIX', name: 'Exit Fix Probe' });
  await db.DailyMetric.bulkCreate(buildMetrics(coin.id));

  console.log = () => {};
  const liveLabel = await calculatePeriodQuality(coin.id);
  console.log = quiet;

  // 实时路径必须已经把退场期首日之后的转正节点纳入比较
  assert.notStrictEqual(
    liveLabel,
    '退场期 (待观察)',
    'calculatePeriodQuality 漏传 targetMetric 时会退化成“退场期 (待观察)”'
  );
  assert.ok(
    liveLabel === '高质量退场' || liveLabel === '低质量退场',
    `退场期实时质量应给出确定标签，实际为 ${liveLabel}`
  );

  // 直接对比两种调用形式，锁住“默认值会丢节点”这一语义
  const { evaluateExitQualityBodong } = __internals;
  const historicalMetrics = await db.DailyMetric.findAll({
    where: { coin_id: coin.id },
    order: [['date', 'DESC']],
    raw: true,
  });
  const latestMetric = historicalMetrics[0];
  const exitStartDateMetric = historicalMetrics.find(m => m.date === '2026-06-01');

  console.log = () => {};
  const withDefaultTarget = evaluateExitQualityBodong(
    historicalMetrics, exitStartDateMetric, exitStartDateMetric.otc_index, coin.id
  );
  const withLatestTarget = evaluateExitQualityBodong(
    historicalMetrics, exitStartDateMetric, exitStartDateMetric.otc_index, coin.id, latestMetric
  );
  console.log = quiet;

  assert.strictEqual(
    withDefaultTarget,
    '退场期 (待观察)',
    '默认 targetMetric（退场期首日）应过滤掉之后的转正节点'
  );
  assert.strictEqual(
    withLatestTarget,
    liveLabel,
    '实时路径应等价于显式传入最新一天'
  );

  await db.DailyMetric.destroy({ where: { coin_id: coin.id } });
  await db.Coin.destroy({ where: { id: coin.id } });
  await db.sequelize.close();

  console.log('exitQualityTargetMetric.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
