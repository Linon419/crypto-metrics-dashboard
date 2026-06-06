const assert = require('assert');

const scheduler = require('../../telegram-bot/scheduler');

const {
  analyzeDataChanges,
  analyzeQualityOpportunities,
  analyzeStrategySignals,
  formatComprehensiveNotification,
  isExplosionDropBelow200,
  isExplosionTurnPositive,
  isImportantMomentumIndicator,
} = scheduler.__testUtils || {};

async function run() {
  assert.strictEqual(typeof analyzeDataChanges, 'function');
  assert.strictEqual(typeof analyzeQualityOpportunities, 'function');
  assert.strictEqual(typeof analyzeStrategySignals, 'function');
  assert.strictEqual(typeof formatComprehensiveNotification, 'function');

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
  ]);

  assert.ok(message.includes('<b>Crypto Metrics</b>'));
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
