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

// 机器人的 sqlite 在测试里用内存结构模拟：发送记录（去重）、网页通知待发表、过期清理
function createFakeDb({ subscribers = [] } = {}) {
  const history = new Set();
  const outbox = [];
  const historyPrunes = [];
  let outboxId = 1;

  return {
    history,
    outbox,
    historyPrunes,
    all(sql, params, callback) {
      if (/FROM users/.test(sql)) {
        return callback(null, subscribers.map(chatId => ({ chat_id: chatId })));
      }
      if (/FROM web_notification_outbox/.test(sql)) {
        const rows = params.length > 0 ? outbox.filter(row => row.chat_id === params[0]) : outbox;
        return callback(null, rows.map(row => ({ ...row })));
      }
      return callback(new Error(`Unexpected all(): ${sql}`));
    },
    get(sql, params, callback) {
      if (/MAX\(notification_date\)/.test(sql)) {
        const dates = [...history]
          .map(key => key.split('|'))
          .filter(([chatId, symbol, type]) => chatId === String(params[0]) && symbol === 'SYSTEM' && type === params[1])
          .map(parts => parts[3])
          .sort();
        return callback(null, { last_date: dates[dates.length - 1] || null });
      }
      if (/FROM notification_history/.test(sql)) {
        return callback(null, history.has(params.join('|')) ? { id: 1 } : undefined);
      }
      return callback(new Error(`Unexpected get(): ${sql}`));
    },
    run(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (/INSERT OR IGNORE INTO notification_history/.test(sql)) {
        history.add(params.join('|'));
      } else if (/INSERT OR IGNORE INTO web_notification_outbox/.test(sql)) {
        const [chatId, externalId, payload] = params;
        if (!outbox.some(row => row.chat_id === chatId && row.external_id === externalId)) {
          outbox.push({
            id: outboxId,
            chat_id: chatId,
            external_id: externalId,
            payload,
            attempts: 0,
            created_at: new Date().toISOString(),
          });
          outboxId += 1;
        }
      } else if (/DELETE FROM web_notification_outbox/.test(sql)) {
        const index = outbox.findIndex(row => row.id === params[0]);
        if (index >= 0) outbox.splice(index, 1);
      } else if (/UPDATE web_notification_outbox/.test(sql)) {
        const row = outbox.find(item => item.id === params[1]);
        if (row) {
          row.attempts += 1;
          row.last_error = params[0];
        }
      } else if (/DELETE FROM notification_history/.test(sql)) {
        historyPrunes.push(params[0]);
      } else {
        return callback?.(new Error(`Unexpected run(): ${sql}`));
      }
      return callback?.call({ lastID: outboxId, changes: 1 }, null);
    },
  };
}

function makeMetric(date, overrides = {}) {
  return {
    coin: { id: 1, symbol: 'BTC', name: 'Bitcoin' },
    date,
    otc_index: 1200,
    explosion_index: 210,
    entry_exit_type: 'entry',
    entry_exit_day: 1,
    period_quality: '高质量进场',
    momentum_indicators: [],
    previous_day_data: { date: '2026-08-17', explosion_index: 205 },
    ...overrides,
  };
}

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
  const fakeDb = createFakeDb({ subscribers: [7] });
  const notificationHistory = fakeDb.history;

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
  assert.strictEqual(fakeDb.historyPrunes.length, 1, '过期发送记录每天只清理一次');
  assert.match(fakeDb.historyPrunes[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(
    notificationHistory.has('7|SYSTEM|data_update|2026-08-19'),
    true,
    'the second summary should be deduplicated by its data date'
  );

  // 2026-07-26 22:30 UTC 在悉尼已是 07-27：通知日期按机器人时区而非 UTC
  const notificationTime = new Date('2026-07-26T22:30:00.000Z');
  const webNotification = buildWebNotificationPayload(
    '<b>高质量进场期初期</b>\n\n<b>BTC</b> · Bitcoin\n场外：<b>1080</b>\n质量：高质量进场',
    { now: notificationTime }
  );
  assert.strictEqual(webNotification.title, '高质量进场期初期');
  assert.ok(webNotification.content.includes('BTC · Bitcoin'));
  assert.ok(webNotification.content.includes('场外：1080'));
  assert.strictEqual(webNotification.category, 'quality');
  assert.strictEqual(webNotification.notificationDate, '2026-07-27');
  assert.strictEqual(webNotification.priority, 'normal', '"高质量"字样本身不代表风险，不应抬高优先级');
  assert.strictEqual(webNotification.metadata, null, '不再把整段 TG 原文塞进 metadata');
  assert.match(webNotification.externalId, /^telegram:[a-f0-9]{64}$/);
  assert.strictEqual(
    buildWebNotificationPayload('<b>收藏币种跌破 200</b>\nBTC', { now: notificationTime }).priority,
    'high'
  );
  assert.strictEqual(
    buildWebNotificationPayload('<b>高质量进场期初期</b>\nBTC', { now: notificationTime }).externalId,
    buildWebNotificationPayload('<b>高质量进场期初期</b>\nBTC', { now: notificationTime }).externalId,
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

  await testDataUpdateWebPayloads();
  await testRestartCatchUp();
  await testWebDeliveryIndependentOfTelegram();

  console.log('telegramScheduler.test.js passed');
}

// 综合摘要：TG 与网页都是一期一条；分组、币种、各组优先级放进 metadata，未读数每期只加 1
async function testDataUpdateWebPayloads() {
  const { buildDataUpdateWebPayload } = scheduler.__testUtils;
  const groups = [
    {
      type: 'market_changes',
      title: '📊 市场重要变化',
      content: [
        { coin: { symbol: 'BTC', name: 'Bitcoin' }, changeType: '爆破跌破 200', description: '爆破 204 → 176', notificationKey: 'explosion_drop_200', currentData: { otc_index: 1100, explosion_index: 176 } },
        { coin: { symbol: 'ETH', name: 'Ethereum' }, changeType: '新进入进场期', description: '质量评估：高质量进场', notificationKey: 'change_entry_day_1', currentData: { otc_index: 1000, explosion_index: 220 } },
      ],
    },
    {
      type: 'favorite_alerts',
      title: '⭐ 收藏币种提醒',
      content: [{ coin: { symbol: 'SOL', name: 'Solana' }, alertType: '进入退场期', description: '退场期第1天', priority: 'high' }],
    },
    {
      type: 'quality_opportunities',
      title: '🌟 优质机会发现',
      content: [{ coin: { symbol: 'DOGE', name: 'Dogecoin' }, opportunityType: '🌟 刚进入高质量进场期', description: '第1天 - 高质量进场', indices: { otc: 900, explosion: 230 }, notificationKey: 'quality_entry_start' }],
    },
    {
      type: 'strategy_signals',
      title: '📌 策略关键信息',
      content: [{ coin: { symbol: 'LINK', name: 'Chainlink' }, signalType: '做多：场外三连升', direction: 'long', description: '场外指数连续3天大于1000且上升', indices: { otc: 1300, explosion: 240 }, notificationKey: 'strategy_otc_up_3' }],
    },
    {
      type: 'momentum_alerts',
      title: '⚡ 动能信号',
      content: [{ coin: { symbol: 'PEPE', name: 'Pepe' }, indicator: '‼', title: '⚠️ 短期撤出信号', indices: { otc: 800, explosion: 150 }, notificationKey: 'momentum_‼' }],
    },
  ];

  const payload = buildDataUpdateWebPayload(groups, '2026-08-18', new Date('2026-08-20T01:00:00.000Z'));
  assert.strictEqual(payload.title, '数据摘要 · 2026-08-18');
  assert.strictEqual(payload.notificationDate, '2026-08-18', '补发时通知日期是数据日期');
  assert.strictEqual(payload.priority, 'critical', '取本期各组里最高的优先级');
  assert.strictEqual(payload.category, 'favorite', '分类取最高优先级那一组');
  assert.strictEqual(payload.coinSymbol, null, '涉及多个币种时不填单一币种');
  assert.deepStrictEqual(payload.metadata, {
    dataDate: '2026-08-18',
    coins: ['BTC', 'ETH', 'SOL', 'DOGE', 'LINK', 'PEPE'],
    groups: [
      { type: 'market_changes', category: 'market', priority: 'high', coins: ['BTC', 'ETH'] },
      { type: 'favorite_alerts', category: 'favorite', priority: 'critical', coins: ['SOL'] },
      { type: 'quality_opportunities', category: 'quality', priority: 'normal', coins: ['DOGE'] },
      { type: 'strategy_signals', category: 'strategy', priority: 'normal', coins: ['LINK'] },
      { type: 'momentum_alerts', category: 'momentum', priority: 'high', coins: ['PEPE'] },
    ],
  });
  ['📊 市场重要变化', '⭐ 收藏币种提醒', '📌 策略关键信息', 'BTC · Bitcoin', 'PEPE · Pepe'].forEach(text => {
    assert.ok(payload.content.includes(text), `正文应包含 ${text}`);
  });

  // 同一期在不同时刻重建，去重键不变（TG 正文里带发送时刻，不能用正文做键）
  const rebuilt = buildDataUpdateWebPayload(groups, '2026-08-18', new Date('2026-08-21T09:00:00.000Z'));
  assert.strictEqual(rebuilt.externalId, payload.externalId);
  assert.notStrictEqual(buildDataUpdateWebPayload(groups, '2026-08-19').externalId, payload.externalId);

  // 只命中一组、一个币种时带上该币种
  const single = buildDataUpdateWebPayload([groups[3]], '2026-08-18');
  assert.strictEqual(single.coinSymbol, 'LINK');
  assert.strictEqual(single.category, 'strategy');
  assert.strictEqual(single.priority, 'normal');

  // 三连降仍按现有规则算 high（优先级规则本次未调整）
  const shortPayload = buildDataUpdateWebPayload([{
    type: 'strategy_signals',
    title: '📌 策略关键信息',
    content: [{ coin: { symbol: 'ETH', name: 'Ethereum' }, signalType: '做空：场外三连降', direction: 'short', description: '场外指数连续3天下降', indices: { otc: 1100, explosion: 90 } }],
  }], '2026-08-18');
  assert.strictEqual(shortPayload.priority, 'high');
}

// 机器人重启后内存基线为空：从发送记录找到上次发到哪一期，补发之后的日期
async function testRestartCatchUp() {
  const fakeDb = createFakeDb({ subscribers: [8] });
  fakeDb.history.add('8|SYSTEM|data_update|2026-08-18');
  const sentMessages = [];
  const originalGetUserCredentials = UserAuth.getUserCredentials;
  const originalRequest = UserAuth.makeUserAuthenticatedRequest;

  try {
    UserAuth.getUserCredentials = async () => ({ username: 'test' });
    UserAuth.makeUserAuthenticatedRequest = async (chatId, method, endpoint) => {
      if (endpoint === '/data/latest') {
        return { success: true, date: '2026-08-19', metrics: [makeMetric('2026-08-19', { entry_exit_type: 'exit', entry_exit_day: 1, period_quality: '高质量退场' })] };
      }
      if (endpoint === '/data/by-date/2026-08-18') {
        return { success: true, date: '2026-08-18', coins: [{ id: 1, symbol: 'BTC', name: 'Bitcoin', otcIndex: 1200, explosionIndex: 210, entryExitType: 'entry', entryExitDay: 9, period_quality: '高质量进场' }] };
      }
      if (endpoint === '/data/available-dates') {
        return { success: true, dates: ['2026-08-19', '2026-08-18'] };
      }
      if (endpoint === '/favorites') return [];
      if (endpoint === '/notifications' && method === 'post') return { success: true };
      throw new Error(`Unexpected request: ${method} ${endpoint}`);
    };
    scheduler.initializeDependencies({
      async sendMessage(chatId, message) {
        sentMessages.push(message);
        return { message_id: sentMessages.length };
      },
    }, fakeDb);

    await scheduler.checkDataUpdates();
  } finally {
    UserAuth.getUserCredentials = originalGetUserCredentials;
    UserAuth.makeUserAuthenticatedRequest = originalRequest;
  }

  assert.strictEqual(sentMessages.length, 1, '重启后第一次检查就要补发漏掉的那一期');
  assert.match(sentMessages[0], /数据日期：<b>2026-08-19<\/b>/);
  assert.strictEqual(fakeDb.history.has('8|SYSTEM|data_update|2026-08-19'), true);
}

// 网页通知与 TG 发送互不牵连：TG 失败不影响网页写入，网页失败留在待发表下次重试，且不产生重复
async function testWebDeliveryIndependentOfTelegram() {
  const fakeDb = createFakeDb({ subscribers: [9] });
  fakeDb.history.add('9|SYSTEM|data_update|2026-08-18');
  const posted = [];
  const sentMessages = [];
  let telegramMode = 'fail';
  let webMode = 'ok';
  const originalGetUserCredentials = UserAuth.getUserCredentials;
  const originalRequest = UserAuth.makeUserAuthenticatedRequest;
  const originalError = console.error;
  const originalWarn = console.warn;

  const telegramError = (statusCode) => {
    const error = new Error(`ETELEGRAM: ${statusCode}`);
    error.code = 'ETELEGRAM';
    error.response = { statusCode, body: { error_code: statusCode } };
    return error;
  };

  try {
    console.error = () => {};
    console.warn = () => {};
    UserAuth.getUserCredentials = async () => ({ username: 'test' });
    UserAuth.makeUserAuthenticatedRequest = async (chatId, method, endpoint, data) => {
      if (endpoint === '/data/latest') {
        return { success: true, date: '2026-08-19', metrics: [makeMetric('2026-08-19', { entry_exit_type: 'exit', entry_exit_day: 1, period_quality: '高质量退场' })] };
      }
      if (endpoint === '/data/by-date/2026-08-18') {
        return { success: true, date: '2026-08-18', coins: [{ id: 1, symbol: 'BTC', name: 'Bitcoin', otcIndex: 1200, explosionIndex: 210, entryExitType: 'entry', entryExitDay: 9, period_quality: '高质量进场' }] };
      }
      if (endpoint === '/data/available-dates') return { success: true, dates: ['2026-08-19', '2026-08-18'] };
      if (endpoint === '/favorites') return [];
      if (endpoint === '/notifications' && method === 'post') {
        if (webMode === 'fail') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        posted.push(data.externalId);
        return { success: true };
      }
      throw new Error(`Unexpected request: ${method} ${endpoint}`);
    };
    scheduler.initializeDependencies({
      async sendMessage(chatId, message) {
        if (telegramMode === 'fail') throw telegramError(502);
        if (telegramMode === 'blocked') throw telegramError(403);
        sentMessages.push(message);
        return { message_id: sentMessages.length };
      },
    }, fakeDb);

    // 第 1 轮：TG 502 失败 → 网页照写；本期不记为已发送，下轮重试
    await scheduler.checkDataUpdates();
    assert.strictEqual(sentMessages.length, 0);
    assert.strictEqual(posted.length, 1, 'TG 失败时网页通知仍然写入，且一期只有一条');
    const firstRoundIds = [...new Set(posted)].sort();
    assert.strictEqual(fakeDb.history.has('9|SYSTEM|data_update|2026-08-19'), false);

    // 第 2 轮：TG 恢复 → 补发 TG；网页去重键不变，服务端 findOrCreate 不会重复
    telegramMode = 'ok';
    await scheduler.checkDataUpdates();
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual([...new Set(posted)].sort(), firstRoundIds, '重试不产生新的网页通知');
    assert.strictEqual(fakeDb.history.has('9|SYSTEM|data_update|2026-08-19'), true);
    assert.strictEqual(fakeDb.outbox.length, 0);

    // 网页写入失败：留在待发表，下一轮检查时补写
    const { deliverNotification, flushWebNotificationOutbox } = scheduler.__testUtils;
    webMode = 'fail';
    await deliverNotification(9, '<b>收藏币种跌破 200</b>\nETH', [
      { externalId: 'telegram:retry-me', title: 't', content: 'c', category: 'favorite', priority: 'critical' },
    ]);
    assert.strictEqual(fakeDb.outbox.length, 1);
    assert.strictEqual(fakeDb.outbox[0].attempts, 1);
    webMode = 'ok';
    await flushWebNotificationOutbox();
    assert.ok(posted.includes('telegram:retry-me'));
    assert.strictEqual(fakeDb.outbox.length, 0);

    // 用户屏蔽了机器人（403）：不再无限重试，网页通知照常写入
    telegramMode = 'blocked';
    await deliverNotification(9, '<b>收藏币种进入退场期</b>\nETH', [
      { externalId: 'telegram:blocked', title: 't', content: 'c', category: 'favorite', priority: 'critical' },
    ]);
    assert.ok(posted.includes('telegram:blocked'));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    UserAuth.getUserCredentials = originalGetUserCredentials;
    UserAuth.makeUserAuthenticatedRequest = originalRequest;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
