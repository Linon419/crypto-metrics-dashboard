/**
 * 回归用例：同一 (coin_id, date) 的多版本记录不得被当成相邻两天。
 *
 * 关键节点扫描是拿 historicalMetrics[i] 与 [i-1] 比较的，
 * 取数处只按 date 排序、不去重，因此同一天的两条"版本"会被误判成
 * 一次跨日变化，凭空造出"爆破跌破200 / 由负转正"节点。
 *
 * 真实例子：CRV 2026-04-30 同时有 explosion 209(id 11951) 与 188(id 11990)，
 * 后者其实是 05-01 的数据被错填成 04-30。算法据此在当天内部造出跌破 200 的节点，
 * 把标签从"高质量进场"翻成"低质量进场"。生产库共有 228 组这样的重复。
 */

const assert = require('assert');

const {
  calculatePeriodQualityForDate,
  __internals,
} = require('../utils/periodQualityEvaluation');

const { dedupeMetricsByDate } = __internals;

function run() {
  assert.strictEqual(typeof dedupeMetricsByDate, 'function', 'dedupeMetricsByDate 应导出供测试');

  // 1. 每个日期只保留最新版本：timestamp 优先，其次 id
  const deduped = dedupeMetricsByDate([
    { id: 2, date: '2026-04-30', explosion_index: 188, timestamp: '2026-04-30T10:00:00Z' },
    { id: 1, date: '2026-04-30', explosion_index: 209, timestamp: '2026-04-30T08:00:00Z' },
    { id: 3, date: '2026-04-23', explosion_index: 300 },
  ]);
  assert.strictEqual(deduped.length, 2, '同一天应只保留一条');
  assert.strictEqual(deduped[0].date, '2026-04-30', '结果必须仍按日期降序');
  assert.strictEqual(deduped[0].id, 2, '应保留 timestamp 更新的那条');

  // 没有 timestamp 时按 id 兜底
  const byId = dedupeMetricsByDate([
    { id: 5, date: '2026-01-01', explosion_index: 1 },
    { id: 9, date: '2026-01-01', explosion_index: 2 },
  ]);
  assert.strictEqual(byId.length, 1);
  assert.strictEqual(byId[0].id, 9, '无 timestamp 时应保留 id 更大的那条');

  // Date 对象与字符串日期应归到同一天
  const mixed = dedupeMetricsByDate([
    { id: 1, date: new Date('2026-03-05T00:00:00Z'), explosion_index: 10 },
    { id: 2, date: '2026-03-05', explosion_index: 20 },
  ]);
  assert.strictEqual(mixed.length, 1, 'Date 与字符串表示的同一天应合并');

  // 2. 端到端：重复版本不得改变质量判定
  //
  // 关键在于 04-23 的爆破指数低于 200，因此真正的跨日配对
  // （04-23 150 -> 04-30 188）并不跨越阈值；只有同日的
  // 209 -> 188 会跨越，从而伪造出一个"跌破200"节点。
  // 该伪造节点的 otc 从 1251 掉到 900，足以把标签翻成低质量。
  const clean = [
    { id: 40, date: '2026-05-06', otc_index: 1500, explosion_index: 260, entry_exit_type: 'entry', entry_exit_day: 18 },
    { id: 36, date: '2026-04-30', otc_index: 900, explosion_index: 188, entry_exit_type: 'entry', entry_exit_day: 12, timestamp: '2026-04-30T10:00:00Z' },
    { id: 30, date: '2026-04-23', otc_index: 1385, explosion_index: 150, entry_exit_type: 'entry', entry_exit_day: 5 },
    { id: 20, date: '2026-04-20', otc_index: 1251, explosion_index: 180, entry_exit_type: 'entry', entry_exit_day: 2 },
    { id: 10, date: '2026-04-19', otc_index: 1200, explosion_index: 210, entry_exit_type: 'entry', entry_exit_day: 1 },
    { id: 5, date: '2026-04-18', otc_index: 1100, explosion_index: 240, entry_exit_type: 'exit', entry_exit_day: 9 },
  ];

  // 往 04-30 再插一条更早的版本（explosion 209），构成同日 209 -> 188
  const withDuplicate = [
    clean[0],
    clean[1],
    { id: 35, date: '2026-04-30', otc_index: 1385, explosion_index: 209, entry_exit_type: 'entry', entry_exit_day: 11, timestamp: '2026-04-30T08:00:00Z' },
    ...clean.slice(2),
  ];

  const quiet = console.log;
  console.log = () => {};
  return Promise.all([
    calculatePeriodQualityForDate(1, '2026-05-06', clean),
    calculatePeriodQualityForDate(1, '2026-05-06', withDuplicate),
  ]).then(([cleanQuality, duplicateQuality]) => {
    console.log = quiet;
    assert.strictEqual(
      duplicateQuality,
      cleanQuality,
      `同日多版本不应改变判定：干净数据=${cleanQuality}，含重复版本=${duplicateQuality}`
    );
    console.log('sameDayVersionDedupe.test.js passed');
  }).catch(error => {
    console.log = quiet;
    throw error;
  });
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
