import { evaluateStrategySignal } from './strategySignals';

// 前端兜底计算必须与后端一致：由负转正 = 小于 0 变成大于等于 0
const makeCoin = (prevExplosion, currExplosion) => ({
  symbol: 'BTC',
  explosionIndex: currExplosion,
  otcIndex: 900,
  entryExitType: 'neutral',
  entryExitDay: 0,
  previousDayData: { explosion_index: prevExplosion, otc_index: 900 },
});

test('treats a move from below zero to zero as turning positive', () => {
  expect(evaluateStrategySignal(makeCoin(-5, 0)).reasons).toContain('爆破指数负转正');
  expect(evaluateStrategySignal(makeCoin(-5, 12)).reasons).toContain('爆破指数负转正');
});

test('does not treat a move from zero upward as turning positive', () => {
  expect(evaluateStrategySignal(makeCoin(0, 5)).reasons).not.toContain('爆破指数负转正');
});
