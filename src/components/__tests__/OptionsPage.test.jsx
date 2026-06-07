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
