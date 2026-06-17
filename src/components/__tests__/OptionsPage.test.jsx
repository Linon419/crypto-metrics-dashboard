import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OptionsPage from '../OptionsPage';
import {
  calculateBtcOptionPayoff,
  fetchBtcOptionStrategySetup,
  fetchBtcVolatilityHistory,
} from '../../services/api';

jest.mock('echarts-for-react', () => function MockReactECharts({ option }) {
  return <div data-testid="echarts-mock">{option?.series?.map(series => series.name).join(' / ')}</div>;
});

jest.mock('../../services/api', () => ({
  calculateBtcOptionPayoff: jest.fn(),
  fetchBtcOptionStrategySetup: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
});

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

test('switches BTC implied volatility candle periods', async () => {
  fetchBtcVolatilityHistory.mockResolvedValue({
    data: {
      candles: [
        { timestamp: '2026-01-01T00:00:00.000Z', open: 50, close: 52, low: 49, high: 53 },
      ],
      timestamps: { generatedAt: '2026-01-01T00:00:00.000Z' },
    },
  });

  render(<OptionsPage />);

  expect(await screen.findByRole('button', { name: '15min' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '4h' })).toBeInTheDocument();

  await waitFor(() => expect(fetchBtcVolatilityHistory).toHaveBeenCalledWith(
    expect.objectContaining({ resolution: '3600' }),
  ));

  fireEvent.click(screen.getByRole('button', { name: '15min' }));

  await waitFor(() => expect(fetchBtcVolatilityHistory).toHaveBeenCalledWith(
    expect.objectContaining({ resolution: '900' }),
  ));

  fireEvent.click(screen.getByRole('button', { name: '4h' }));

  await waitFor(() => expect(fetchBtcVolatilityHistory).toHaveBeenCalledWith(
    expect.objectContaining({ resolution: '14400' }),
  ));
});

test('opens strategy drawer with live setup and payoff chart', async () => {
  fetchBtcVolatilityHistory.mockResolvedValue({
    data: {
      candles: [
        { timestamp: '2026-01-01T00:00:00.000Z', open: 50, close: 52, low: 49, high: 53 },
      ],
      timestamps: { generatedAt: '2026-01-01T00:00:00.000Z' },
    },
  });
  fetchBtcOptionStrategySetup.mockResolvedValue({
    data: {
      strategyId: 'iron-condor',
      priceBasis: 'mark',
      underlyingPrice: 64000,
      generatedAt: '2026-06-08T12:00:00.000Z',
      legs: [
        { id: 'long-put-wing', type: 'option', side: 'buy', optionType: 'put', strike: 52000, quantity: 1, entryPrice: 0.002, entryIv: 66, instrumentName: 'BTC-26JUN26-52000-P', expirationDate: '2026-06-26' },
        { id: 'short-put', type: 'option', side: 'sell', optionType: 'put', strike: 60000, quantity: 1, entryPrice: 0.012, entryIv: 64, instrumentName: 'BTC-26JUN26-60000-P', expirationDate: '2026-06-26' },
        { id: 'short-call', type: 'option', side: 'sell', optionType: 'call', strike: 68000, quantity: 1, entryPrice: 0.014, entryIv: 63, instrumentName: 'BTC-26JUN26-68000-C', expirationDate: '2026-06-26' },
        { id: 'long-call-wing', type: 'option', side: 'buy', optionType: 'call', strike: 76000, quantity: 1, entryPrice: 0.003, entryIv: 67, instrumentName: 'BTC-26JUN26-76000-C', expirationDate: '2026-06-26' },
      ],
      controls: {
        expirations: ['2026-06-26'],
        priceBasisOptions: ['mark', 'mid', 'bid', 'ask'],
      },
    },
  });
  calculateBtcOptionPayoff.mockResolvedValue({
    data: {
      scenarioLabels: ['expiry', 'currentEstimate', 'ivDown', 'ivUp', 'tPlus3'],
      points: [
        { spot: 52000, expiryPnlBtc: -0.12, currentEstimateBtc: -0.04, ivDownBtc: -0.02, ivUpBtc: -0.06, tPlus3Btc: -0.03 },
        { spot: 64000, expiryPnlBtc: 0.021, currentEstimateBtc: 0.012, ivDownBtc: 0.018, ivUpBtc: 0.005, tPlus3Btc: 0.014 },
        { spot: 76000, expiryPnlBtc: -0.09, currentEstimateBtc: -0.03, ivDownBtc: -0.01, ivUpBtc: -0.05, tPlus3Btc: -0.02 },
      ],
      metrics: {
        netPremiumBtc: 0.021,
        maxProfitBtc: 0.021,
        maxLossBtc: -0.12,
        breakevens: [58500, 69500],
        greeks: { delta: 0.01, gamma: -0.0002, theta: 42, vega: -21 },
        generatedAt: '2026-06-08T12:00:00.000Z',
      },
    },
  });

  render(<OptionsPage />);

  fireEvent.click(screen.getAllByRole('button', { name: /查看详情/ })[0]);

  expect(await screen.findByText('实时搭建设置')).toBeInTheDocument();
  expect(screen.getByText('BTC-26JUN26-60000-P')).toBeInTheDocument();
  expect(await screen.findByText('最大收益')).toBeInTheDocument();
  expect((await screen.findAllByText('0.021 BTC')).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('盈亏图')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('数量倍率'), {
    target: { value: '2' },
  });

  await waitFor(() => expect(calculateBtcOptionPayoff).toHaveBeenCalledTimes(2));
});
