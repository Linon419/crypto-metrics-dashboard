const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * agent-skills/crypto-metrics/scripts/cm.mjs 回归测试：
 * /data/latest 与 /data/by-date 字段风格不同，归一化后 Agent 看到的结构必须一致。
 */

const SCRIPT_URL = pathToFileURL(
  path.join(__dirname, '../../agent-skills/crypto-metrics/scripts/cm.mjs')
).href;

const latestCoin = {
  otc_index: 1040,
  explosion_index: 74,
  schelling_point: null,
  entry_exit_type: 'entry',
  entry_exit_day: 15,
  near_threshold: true,
  momentum_indicators: ['$', '↑'],
  coin: { symbol: 'BTC' },
  previous_day_data: { otc_index: 1080, explosion_index: 144 },
  otc_index_change_percent: -3.7037,
  explosion_index_change_percent: -48.6111,
  period_quality: '高质量进场',
  risk_notes: [],
  strategy_signal: { direction: 'short', label: '做空：场外三连降', reasons: ['场外指数连续3天下降'], warnings: [] },
};

const byDateCoin = {
  symbol: 'BTC',
  otcIndex: 1040,
  explosionIndex: 74,
  schellingPoint: null,
  entryExitType: 'entry',
  entryExitDay: 15,
  nearThreshold: true,
  momentumIndicators: ['$', '↑'],
  previousDayData: { otc_index: 1080, explosion_index: 144 },
  otcChangePercent: -3.7037,
  explosionChangePercent: -48.6111,
  period_quality: '高质量进场',
  risk_notes: [],
  strategy_signal: { direction: 'short', label: '做空：场外三连降', reasons: ['场外指数连续3天下降'], warnings: [] },
};

async function run() {
  const cm = await import(SCRIPT_URL);

  // 两种接口形态归一化后完全一致
  const fromLatest = cm.normalizeCoin(latestCoin);
  assert.deepStrictEqual(cm.normalizeCoin(byDateCoin), fromLatest);
  assert.strictEqual(fromLatest.symbol, 'BTC');
  assert.strictEqual(fromLatest.phase, '进场第15天');
  assert.strictEqual(fromLatest.otcChangePct, -3.7);
  assert.strictEqual(fromLatest.prevExplosion, 144);
  assert.strictEqual(fromLatest.momentum, '$↑');

  const snapshot = cm.buildSnapshot({
    date: '2026-07-25',
    metrics: [
      { ...latestCoin, coin: { symbol: 'ETH' }, otc_index: 900, strategy_signal: { direction: 'long', label: '做多：触发', reasons: ['进场期第一天'] } },
      latestCoin,
      { ...latestCoin, coin: { symbol: 'SOL' }, otc_index: 1200, strategy_signal: null },
    ],
    liquidity: { date: '2026-07-25', btc_fund_change: -11, eth_fund_change: -5, sol_fund_change: -1, total_market_fund_change: 0.1 },
  });
  assert.deepStrictEqual(snapshot.coins.map(coin => coin.symbol), ['SOL', 'BTC', 'ETH'], '按场外指数降序');
  assert.strictEqual(snapshot.liquidity.btc, -11);

  const signals = cm.pickSignals(snapshot);
  assert.deepStrictEqual(signals.long.map(item => item.symbol), ['ETH']);
  assert.deepStrictEqual(signals.short.map(item => item.symbol), ['BTC']);

  assert.deepStrictEqual(cm.parseArgs(['coin', 'btc', '--days', '7']), {
    command: 'coin',
    args: ['btc'],
    options: { days: '7' },
  });

  // 客户端：带 Bearer，兼容带 /api 结尾的地址，错误信息包含状态码
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    if (String(url).includes('/missing')) {
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '{"error":"Coin not found"}' };
    }
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const get = cm.createClient({ baseUrl: 'http://host:3001/api/', token: 'cmagent_x', fetchImpl: fakeFetch });
  await get('/data/latest', { limit: 5, empty: '' });
  assert.strictEqual(calls[0].url, 'http://host:3001/api/data/latest?limit=5');
  assert.strictEqual(calls[0].auth, 'Bearer cmagent_x');
  await assert.rejects(() => get('/missing'), /404.*Coin not found/);
  assert.throws(() => cm.createClient({ baseUrl: '', token: '' }), /CRYPTO_METRICS_URL/);

  // coin 的区间以最新有数据日期为终点，含终点共 N 天
  const requested = [];
  const fakeGet = async (apiPath, params) => {
    requested.push({ apiPath, params });
    if (apiPath === '/data/available-dates') return { newestDate: '2026-07-25' };
    return [{ date: '2026-07-25', otc_index: 1040, explosion_index: 74, entry_exit_type: 'exit', entry_exit_day: 1 }];
  };
  const coin = await cm.runCommand({ command: 'coin', args: ['btc'], options: { days: '7' } }, fakeGet);
  assert.deepStrictEqual(requested[1], {
    apiPath: '/coins/BTC/metrics',
    params: { startDate: '2026-07-19', endDate: '2026-07-25' },
  });
  assert.strictEqual(coin.history[0].phase, '退场第1天');

  // 布尔开关不能吞掉后面的参数
  assert.deepStrictEqual(cm.parseArgs(['notifications', '--unread', '--limit', '5']).options, {
    unread: true,
    limit: '5',
  });

  const notificationRequests = [];
  const notifications = await cm.runCommand(
    { command: 'notifications', args: [], options: { unread: true, limit: '500' } },
    async (apiPath, params) => {
      notificationRequests.push({ apiPath, params });
      return {
        unreadCount: 2,
        notifications: [{
          id: 9,
          notificationDate: '2026-07-25',
          createdAt: '2026-07-25T10:00:00.000Z',
          category: 'strategy',
          priority: 'high',
          coinSymbol: 'ETH',
          title: 'ETH 做空信号',
          content: '场外三连降',
          readAt: null,
        }, {
          id: 8,
          notificationDate: '2026-07-25',
          createdAt: '2026-07-25T09:00:00.000Z',
          category: 'market',
          priority: 'high',
          coinSymbol: null,
          title: '数据摘要 · 2026-07-25',
          content: 'BTC · Bitcoin ...',
          readAt: null,
          metadata: {
            dataDate: '2026-07-25',
            coins: ['BTC', 'SOL'],
            groups: [
              { type: 'market_changes', category: 'market', priority: 'high', coins: ['BTC'] },
              { type: 'favorite_alerts', category: 'favorite', priority: 'critical', coins: ['SOL'] },
            ],
          },
        }],
      };
    },
  );
  assert.deepStrictEqual(notificationRequests[0], {
    apiPath: '/notifications',
    params: { limit: 100, unreadOnly: 'true' },
  });
  assert.strictEqual(notifications.unreadCount, 2);
  assert.deepStrictEqual(notifications.notifications[0], {
    id: 9,
    date: '2026-07-25',
    createdAt: '2026-07-25T10:00:00.000Z',
    category: 'strategy',
    priority: 'high',
    coin: 'ETH',
    coins: ['ETH'],
    groups: [],
    title: 'ETH 做空信号',
    content: '场外三连降',
    read: false,
  });
  assert.deepStrictEqual(notifications.notifications[1].coins, ['BTC', 'SOL']);
  assert.deepStrictEqual(notifications.notifications[1].groups, [
    { category: 'market', priority: 'high', coins: ['BTC'] },
    { category: 'favorite', priority: 'critical', coins: ['SOL'] },
  ]);

  console.log('agent skill script tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
