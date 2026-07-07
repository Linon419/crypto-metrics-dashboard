import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OptionsStrategyDrawer from '../OptionsStrategyDrawer';
import {
  calculateBtcOptionPayoff,
  fetchBtcOptionStrategySetup,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  calculateBtcOptionPayoff: jest.fn(),
  fetchBtcOptionStrategySetup: jest.fn(),
}));

jest.mock('../OptionsLiveSetupPanel', () => function MockOptionsLiveSetupPanel({
  expirationDate,
  onExpirationChange,
  setup,
}) {
  return (
    <div>
      <div data-testid="panel-expiration">
        {expirationDate || setup?.controls?.selectedExpiration || 'none'}
      </div>
      <button type="button" onClick={() => onExpirationChange('2026-06-20')}>
        select-near-expiry
      </button>
    </div>
  );
});

jest.mock('../OptionsLegTable', () => function MockOptionsLegTable({ legs }) {
  return <div data-testid="leg-table">{legs.length}</div>;
});

jest.mock('../OptionsPayoffChart', () => function MockOptionsPayoffChart() {
  return <div data-testid="payoff-chart" />;
});

jest.mock('../OptionsScenarioMetrics', () => function MockOptionsScenarioMetrics() {
  return <div data-testid="scenario-metrics" />;
});

const firstStrategy = {
  id: 'ratio-spread',
  nameZh: '比例价差',
  nameEn: 'ratio spread',
  operationSteps: [],
  risks: [],
};

const secondStrategy = {
  id: 'gamma-scalping',
  nameZh: 'Gamma Scalping',
  nameEn: 'gamma scalping',
  operationSteps: [],
  risks: [],
};

function buildSetup(strategyId) {
  return {
    strategyId,
    priceBasis: 'mark',
    underlyingPrice: 64000,
    generatedAt: '2026-06-20T02:00:00.000Z',
    legs: [
      {
        id: `${strategyId}-call`,
        type: 'option',
        side: 'buy',
        optionType: 'call',
        strike: 64000,
        quantity: 1,
        entryPrice: 0.01,
        entryIv: 30,
        instrumentName: 'BTC-3JUL26-64000-C',
        expirationDate: '2026-07-03',
        expirationTimestamp: Date.UTC(2026, 6, 3, 8),
      },
    ],
    controls: {
      expirations: ['2026-06-20', '2026-07-03'],
      priceBasisOptions: ['mark'],
      selectedExpiration: '2026-07-03',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchBtcOptionStrategySetup.mockImplementation(strategyId => Promise.resolve({
    data: buildSetup(strategyId),
  }));
  calculateBtcOptionPayoff.mockResolvedValue({
    data: {
      points: [],
      metrics: {},
      scenarioLabels: [],
    },
  });
});

test('does not reuse a manually selected near expiry when opening a different strategy', async () => {
  const { rerender } = render(
    <OptionsStrategyDrawer strategy={firstStrategy} open onClose={() => {}} />,
  );

  await waitFor(() => expect(fetchBtcOptionStrategySetup).toHaveBeenCalledWith(
    'ratio-spread',
    expect.objectContaining({ expirationDate: null }),
  ));

  fireEvent.click(screen.getByRole('button', { name: 'select-near-expiry' }));

  await waitFor(() => expect(fetchBtcOptionStrategySetup).toHaveBeenCalledWith(
    'ratio-spread',
    expect.objectContaining({ expirationDate: '2026-06-20' }),
  ));

  rerender(
    <OptionsStrategyDrawer strategy={secondStrategy} open onClose={() => {}} />,
  );

  await waitFor(() => expect(fetchBtcOptionStrategySetup).toHaveBeenCalledWith(
    'gamma-scalping',
    expect.objectContaining({ expirationDate: null }),
  ));

  const gammaCalls = fetchBtcOptionStrategySetup.mock.calls.filter(([strategyId]) => (
    strategyId === 'gamma-scalping'
  ));
  expect(gammaCalls[0][1].expirationDate).toBeNull();
});
