const assert = require('assert');

const scheduler = require('../../telegram-bot/scheduler');
const UserAuth = require('../../telegram-bot/user-auth');

const {
  analyzeDataChanges,
  analyzeQualityOpportunities,
  analyzeStrategySignals,
  buildWebNotificationPayload,
  formatComprehensiveNotification,
  isExplosionDropBelow200,
  isExplosionTurnPositive,
  isImportantMomentumIndicator,
  getSchedulerJobDefinitions,
  getPendingDataDates,
  normalizeDateDataResponse,
  shouldProcessDataUpdate,
} = scheduler.__testUtils || {};

async function run() {
  assert.strictEqual(typeof analyzeDataChanges, 'function');
  assert.strictEqual(typeof analyzeQualityOpportunities, 'function');
  assert.strictEqual(typeof analyzeStrategySignals, 'function');
  assert.strictEqual(typeof buildWebNotificationPayload, 'function');
  assert.strictEqual(typeof formatComprehensiveNotification, 'function');
  assert.strictEqual(typeof getSchedulerJobDefinitions, 'function');
  assert.strictEqual(typeof getPendingDataDates, 'function');
  assert.strictEqual(typeof normalizeDateDataResponse, 'function');
  assert.strictEqual(typeof shouldProcessDataUpdate, 'function');

  const baselineSnapshot = {
    date: '2026-07-29',
    totalCoins: 1,
    coins: [{
      symbol: 'BTC',
      otc_index: 1000,
      explosion_index: 200,
      entry_exit_type: 'entry',
      period_quality: '高质量进场',
      near_threshold: false,
      momentumIndicators: [],
      strategy_signal_level: null,
    }],
  };
  const unchangedSnapshot = JSON.parse(JSON.stringify(baselineSnapshot));
  const updatedSnapshot = JSON.parse(JSON.stringify(baselineSnapshot));
  updatedSnapshot.coins[0].otc_index = 1051;

  assert.strictEqual(
    shouldProcessDataUpdate(null, baselineSnapshot),
    false,
    'the first poll should establish a silent baseline'
  );
  assert.strictEqual(
    shouldProcessDataUpdate(baselineSnapshot, unchangedSnapshot),
    false,
    'unchanged data should stay silent'
  );
  assert.strictEqual(
    shouldProcessDataUpdate(baselineSnapshot, updatedSnapshot),
    true,
    'a meaningful data change should enter notification analysis'
  );
  assert.deepStrictEqual(
    getSchedulerJobDefinitions().map(job => job.jobName),
    ['checkDataUpdates', 'checkDataUpdates'],
    'all automatic notification jobs should flow through data update detection'
  );

  assert.deepStrictEqual(
    getPendingDataDates(
      '2026-08-17',
      '2026-08-19',
      ['2026-08-19', '2026-08-18', '2026-08-17']
    ),
    ['2026-08-18', '2026-08-19'],
    'all data dates added between polls should be processed in chronological order'
  );
  assert.deepStrictEqual(
    getPendingDataDates('2026-08-19', '2026-08-19', ['2026-08-19']),
    ['2026-08-19'],
    'the latest date should still be checked for same-date data changes'
  );

  const normalizedHistoricalData = normalizeDateDataResponse({
    success: true,
    date: '2026-08-18',
    coins: [{
      id: 1,
      symbol: 'BTC',
      name: 'Bitcoin',
      otcIndex: 1200,
      explosionIndex: 210,
      schellingPoint: 1.5,
      entryExitType: 'entry',
      entryExitDay: 2,
      momentumIndicators: ['$'],
      previousDayData: { date: '2026-08-17', explosion_index: 180 },
      strategy_signal: { level: 'otc_up_3' },
    }],
  });
  assert.strictEqual(normalizedHistoricalData.metrics[0].coin.symbol, 'BTC');
  assert.strictEqual(normalizedHistoricalData.metrics[0].otc_index, 1200);
  assert.strictEqual(normalizedHistoricalData.metrics[0].previous_day_data.date, '2026-08-17');
  assert.deepStrictEqual(normalizedHistoricalData.metrics[0].momentum_indicators, ['$']);

  const originalGetUserCredentials = UserAuth.getUserCredentials;
  const originalMakeUserAuthenticatedRequest = UserAuth.makeUserAuthenticatedRequest;
  const sentMessages = [];
  const notificationHistory = new Set();
  let latestRequestCount = 0;
  const makeLatestData = (date, entryExitDay, previousExplosion) => ({
    success: true,
    date,
    metrics: [{
      coin: { id: 1, symbol: 'BTC', name: 'Bitcoin' },
      date,
      otc_index: 1200 + entryExitDay,
      explosion_index: 210 + entryExitDay,
      entry_exit_type: entryExitDay > 0 ? 'entry' : 'neutral',
      entry_exit_day: entryExitDay,
      period_quality: entryExitDay > 0 ? '高质量进场' : '数据不足',
      momentum_indicators: [],
      previous_day_data: previousExplosion === null ? null : {
        date: '2026-08-17',
        explosion_index: previousExplosion,
      },
    }],
  });
  const baselineData = makeLatestData('2026-08-17', 0, null);
  const latestData = makeLatestData('2026-08-19', 2, 211);
  const fakeDb = {
    all(sql, params, callback) {
      callback(null, [{ chat_id: 7 }]);
    },
    get(sql, params, callback) {
      callback(null, notificationHistory.has(params.join('|')) ? { id: 1 } : undefined);
    },
    run(sql, params, callback) {
      notificationHistory.add(params.join('|'));
      callback.call({ lastID: notificationHistory.size }, null);
    },
  };

  try {
    UserAuth.getUserCredentials = async () => ({ username: 'test' });
    UserAuth.makeUserAuthenticatedRequest = async (chatId, method, endpoint) => {
      if (endpoint === '/data/latest') {
        latestRequestCount += 1;
        return latestRequestCount === 1 ? baselineData : latestData;
      }
      if (endpoint === '/data/available-dates') {
        return {
          success: true,
          dates: ['2026-08-19', '2026-08-18', '2026-08-17'],
        };
      }
      if (endpoint === '/data/by-date/2026-08-18') {
        return {
          success: true,
          date: '2026-08-18',
          coins: [{
            id: 1,
            symbol: 'BTC',
            name: 'Bitcoin',
            otcIndex: 1201,
            explosionIndex: 211,
            entryExitType: 'entry',
            entryExitDay: 1,
            period_quality: '高质量进场',
            momentumIndicators: [],
            previousDayData: {
              date: '2026-08-17',
              explosion_index: 210,
            },
          }],
        };
      }
      if (endpoint === '/favorites') return [];
      if (endpoint === '/notifications' && method === 'post') return { success: true };
      throw new Error(`Unexpected request: ${method} ${endpoint}`);
    };
    scheduler.initializeDependencies({
      async sendMessage(chatId, message) {
        sentMessages.push({ chatId, message });
        return { message_id: sentMessages.length };
      },
    }, fakeDb);

    await scheduler.checkDataUpdates();
    await scheduler.checkDataUpdates();
    await scheduler.checkDataUpdates();
  } finally {
    UserAuth.getUserCredentials = originalGetUserCredentials;
    UserAuth.makeUserAuthenticatedRequest = originalMakeUserAuthenticatedRequest;
  }

  assert.deepStrictEqual(
    sentMessages.map(item => item.message.match(/数据日期：<b>(\d{4}-\d{2}-\d{2})<\/b>/)?.[1]),
    ['2026-08-18', '2026-08-19'],
    'two dates added between polls should produce two independently dated summaries'
  );
  assert.strictEqual(
    notificationHistory.has('7|SYSTEM|data_update|2026-08-18'),
    true,
    'the first summary should be deduplicated by its data date'
  );
  assert.strictEqual(
    notificationHistory.has('7|SYSTEM|data_update|2026-08-19'),
    true,
    'the second summary should be deduplicated by its data date'
  );

  const notificationTime = new Date('2026-07-26T08:30:00.000Z');
  const webNotification = buildWebNotificationPayload(
    '<b>高质量进场期初期</b>\n\n<b>BTC</b> · Bitcoin\n场外：<b>1080</b>\n质量：高质量进场',
    notificationTime
  );
  assert.strictEqual(webNotification.title, '高质量进场期初期');
  assert.ok(webNotification.content.includes('BTC · Bitcoin'));
  assert.ok(webNotification.content.includes('场外：1080'));
  assert.strictEqual(webNotification.category, 'quality');
  assert.strictEqual(webNotification.priority, 'high');
  assert.match(webNotification.externalId, /^telegram:[a-f0-9]{64}$/);
  assert.strictEqual(
    buildWebNotificationPayload('<b>高质量进场期初期</b>\nBTC', notificationTime).externalId,
    buildWebNotificationPayload('<b>高质量进场期初期</b>\nBTC', notificationTime).externalId,
    'same Telegram content should produce a stable idempotency key'
  );

  const percentOnlyMove = {
    coin: { symbol: 'BTC', name: 'Bitcoin' },
    otc_index: 1500,
    explosion_index: 120,
    otc_index_change_percent: 45,
    explosion_index_change_percent: 80,
    entry_exit_type: 'neutral',
    entry_exit_day: 0,
  };

  assert.deepStrictEqual(
    analyzeDataChanges([percentOnlyMove]),
    [],
    'percent-only changes should stay out of TG push notifications'
  );

  const entryQualityChange = analyzeDataChanges([
    {
      coin: { symbol: 'BTC', name: 'Bitcoin' },
      otc_index: 1406,
      explosion_index: 176,
      entry_exit_type: 'entry',
      entry_exit_day: 36,
      period_quality: '低质量进场',
    },
  ], {
    coins: [
      {
        symbol: 'BTC',
        entry_exit_type: 'entry',
        period_quality: '高质量进场',
      },
    ],
  });

  assert.strictEqual(entryQualityChange.length, 1);
  assert.strictEqual(entryQualityChange[0].changeType, '进场质量变化');
  assert.strictEqual(entryQualityChange[0].description, '高质量进场 → 低质量进场');

  assert.deepStrictEqual(
    analyzeDataChanges([
      {
        coin: { symbol: 'ETH', name: 'Ethereum' },
        otc_index: 1200,
        explosion_index: 210,
        entry_exit_type: 'entry',
        entry_exit_day: 2,
        period_quality: '高质量进场',
      },
    ], {
      coins: [
        {
          symbol: 'ETH',
          entry_exit_type: 'entry',
          period_quality: '高质量进场',
        },
      ],
    }),
    [],
    'unchanged entry quality should not notify'
  );

  assert.strictEqual(isExplosionDropBelow200({
    explosion_index: 176,
    previous_day_data: { explosion_index: 204 },
  }), true);

  assert.strictEqual(isExplosionDropBelow200({
    explosion_index: 176,
    previous_day_data: { explosion_index: 180 },
  }), false);

  assert.strictEqual(isExplosionTurnPositive({
    explosion_index: 12,
    previous_day_data: { explosion_index: -5 },
  }), true);

  assert.strictEqual(isExplosionTurnPositive({
    explosion_index: 12,
    explosion_index_change_percent: 80,
  }), false);

  assert.strictEqual(isImportantMomentumIndicator('$'), true);
  assert.strictEqual(isImportantMomentumIndicator('‼'), true);
  assert.strictEqual(isImportantMomentumIndicator('※'), false);
  assert.strictEqual(isImportantMomentumIndicator('↑'), false);

  const opportunities = await analyzeQualityOpportunities([
    {
      coin: { symbol: 'SOL', name: 'Solana' },
      entry_exit_type: 'entry',
      entry_exit_day: 2,
      period_quality: '高质量进场',
      explosion_index: 230,
      otc_index: 1500,
    },
    {
      coin: { symbol: 'ETH', name: 'Ethereum' },
      entry_exit_type: 'neutral',
      entry_exit_day: 0,
      explosion_index: 15,
      previous_day_data: { explosion_index: -8 },
      explosion_index_change_percent: 200,
      otc_index: 1200,
    },
    {
      coin: { symbol: 'DOGE', name: 'Dogecoin' },
      entry_exit_type: 'neutral',
      entry_exit_day: 0,
      explosion_index: 15,
      explosion_index_change_percent: 200,
      otc_index: 900,
    },
  ], 1, '2026-05-20', async () => false);

  assert.deepStrictEqual(
    opportunities.map(item => item.coin.symbol),
    ['SOL', 'ETH'],
    'quality setup and real zero-crossing should notify, percent-only positive move should not'
  );

  const strategySignals = await analyzeStrategySignals([
    {
      coin: { symbol: 'BTC', name: 'Bitcoin' },
      otc_index: 1600,
      explosion_index: 120,
      strategy_signal: {
        direction: 'long',
        level: 'otc_up_3',
        label: '做多：场外三连升',
        reasons: ['场外指数连续3天大于1000且上升'],
      },
    },
    {
      coin: { symbol: 'ETH', name: 'Ethereum' },
      otc_index: 1100,
      explosion_index: 90,
      strategy_signal: {
        direction: 'short',
        level: 'otc_down_3',
        label: '做空：场外三连降',
        reasons: ['场外指数连续3天下降'],
      },
    },
    {
      coin: { symbol: 'SOL', name: 'Solana' },
      otc_index: 1500,
      explosion_index: 8,
      strategy_signal: {
        direction: 'long',
        level: 'long_trigger',
        label: '做多：触发',
        reasons: ['爆破指数负转正'],
      },
    },
  ], 1, '2026-05-20', async () => false);

  assert.deepStrictEqual(
    strategySignals.map(item => item.coin.symbol),
    ['BTC', 'ETH'],
    'otc three-day trend strategy signals should push to TG'
  );
  assert.strictEqual(strategySignals[0].notificationKey, 'strategy_otc_up_3');
  assert.strictEqual(strategySignals[1].notificationKey, 'strategy_otc_down_3');

  const message = formatComprehensiveNotification([
    {
      type: 'quality_opportunities',
      title: '重要机会',
      content: opportunities.slice(0, 1),
    },
    {
      type: 'strategy_signals',
      title: '策略关键信息',
      content: strategySignals,
    },
  ], '2026-08-19');

  assert.ok(message.includes('<b>Crypto Metrics</b>'));
  assert.ok(message.includes('数据日期：<b>2026-08-19</b>'));
  assert.ok(message.includes('<b>SOL</b>'));
  assert.ok(message.includes('场外三连升'));
  assert.ok(message.includes('场外三连降'));
  assert.ok(!message.includes('**SOL**'));

  console.log('telegramScheduler.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
