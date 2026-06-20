import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Plotly from 'plotly.js-basic-dist-min';
import { buildPayoffPlotlyConfig } from '../../utils/optionsPayoffPlotlyConfig';
import OptionsPayoffChart from '../OptionsPayoffChart';

const { OPTIONS_STRATEGY_CATALOG } = require('../../../scripts/optionsStrategyCatalog');
const { buildStrategySetup } = require('../../../server/utils/optionsStrategyBlueprints');
const { buildPayoffModel } = require('../../../server/utils/optionsPayoff');

const NOW = Date.UTC(2026, 5, 8, 12);
const SPOT = 64000;

jest.mock('plotly.js-basic-dist-min', () => ({
  react: jest.fn(),
  purge: jest.fn(),
  Plots: {
    resize: jest.fn(),
  },
}));

let resizeObservers = [];

beforeEach(() => {
  jest.useFakeTimers();
  Plotly.react.mockReset();
  Plotly.purge.mockReset();
  Plotly.Plots.resize.mockReset();
  Plotly.react.mockImplementation(node => {
    node._fullLayout = {};
    return Promise.resolve();
  });
  Plotly.purge.mockImplementation(node => {
    delete node._fullLayout;
  });
  resizeObservers = [];
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  window.cancelAnimationFrame = jest.fn();
  const MockResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observe = jest.fn();
      this.disconnect = jest.fn();
      resizeObservers.push(this);
    }
  };
  global.ResizeObserver = MockResizeObserver;
  window.ResizeObserver = MockResizeObserver;
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  delete global.ResizeObserver;
  delete window.ResizeObserver;
  delete window.cancelAnimationFrame;
});

async function flushPlotlyRender() {
  await act(async () => {
    await Promise.resolve();
  });
}

test('uses Plotly layout for payoff chart axes', async () => {
  render(<OptionsPayoffChart payoff={{
    metrics: { payoffHorizonLabel: '到期盈亏', breakevens: [62000], strikes: [63000] },
    points: [
      {
        spot: 61000,
        expiryPnlUsd: 533,
        currentEstimateUsd: 420,
        ivDownUsd: 380,
        ivUpUsd: 640,
        tPlus3Usd: 500,
      },
      {
        spot: 63000,
        expiryPnlUsd: -467,
        currentEstimateUsd: -310,
        ivDownUsd: -220,
        ivUpUsd: -520,
        tPlus3Usd: -420,
      },
    ],
  }} />);

  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  await flushPlotlyRender();
  const [node, data, layout, config] = Plotly.react.mock.calls[0];

  expect(screen.getByLabelText('期权策略盈亏图')).toBe(node);
  expect(data.map(trace => trace.name)).toEqual(['盈利区', '亏损区', '到期盈亏', '当前估算', 'IV 回落', 'IV 上升', 'T+3']);
  expect(data[0].fill).toBe('tozeroy');
  expect(data[0].showlegend).toBe(false);
  expect(data[2].line.shape).toBe('linear');
  expect(data[2].line.width).toBe(3);
  expect(data[4].visible).toBe('legendonly');
  expect(layout.height).toBe(320);
  expect(layout.margin.l).toBeGreaterThanOrEqual(70);
  expect(layout.hovermode).toBe('x unified');
  expect(layout.shapes).toHaveLength(2);
  expect(layout.shapes.map(shape => shape.x0)).toEqual([63000, 62000]);
  expect(layout.xaxis.tickformat).toBe('$~s');
  expect(layout.yaxis.tickformat).toBe('$~s');
  expect(layout.yaxis.zeroline).toBe(true);
  expect(config.responsive).toBe(true);
  expect(config.scrollZoom).toBe(true);
});

test('resizes after render and container resize', async () => {
  render(<OptionsPayoffChart payoff={{
    metrics: { payoffHorizonLabel: '到期盈亏' },
    points: [
      { spot: 61000, expiryPnlUsd: 533, currentEstimateUsd: 420 },
      { spot: 63000, expiryPnlUsd: -467, currentEstimateUsd: -310 },
    ],
  }} />);

  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  await flushPlotlyRender();
  expect(resizeObservers).toHaveLength(1);
  expect(resizeObservers[0].observe).toHaveBeenCalled();
  expect(Plotly.Plots.resize).toHaveBeenCalled();

  const resizeCount = Plotly.Plots.resize.mock.calls.length;
  act(() => {
    resizeObservers[0].callback();
    jest.runOnlyPendingTimers();
  });

  expect(Plotly.Plots.resize.mock.calls.length).toBeGreaterThan(resizeCount);
});

test('skips automatic resize until Plotly has a full layout', async () => {
  Plotly.react.mockImplementationOnce(() => Promise.resolve());

  render(<OptionsPayoffChart payoff={{
    metrics: { payoffHorizonLabel: '到期盈亏' },
    points: [
      { spot: 61000, expiryPnlUsd: 533, currentEstimateUsd: 420 },
      { spot: 63000, expiryPnlUsd: -467, currentEstimateUsd: -310 },
    ],
  }} />);

  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  await flushPlotlyRender();
  act(() => {
    resizeObservers[0].callback();
    jest.runOnlyPendingTimers();
  });

  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
});

function option({ expirationDate, strike, optionType }) {
  return {
    instrumentName: `BTC-${expirationDate.replace(/-/g, '')}-${strike}-${optionType === 'call' ? 'C' : 'P'}`,
    expirationDate,
    expirationTimestamp: expirationDate === '2026-06-19'
      ? Date.UTC(2026, 5, 19, 8)
      : Date.UTC(2026, 6, 31, 8),
    strike,
    optionType,
    state: 'open',
    isActive: true,
    markPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.01),
    midPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.009),
    bidPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.008),
    askPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.012),
    markIv: 65,
    underlyingPrice: SPOT,
    interestRate: 0,
    openInterest: 10,
  };
}

function buildMockChain() {
  const strikes = [48000, 52000, 56000, 60000, 64000, 68000, 72000, 76000, 80000, 84000];
  return {
    currency: 'BTC',
    underlyingPrice: SPOT,
    updatedAt: new Date(NOW).toISOString(),
    options: ['2026-06-19', '2026-07-31'].flatMap(expirationDate => (
      strikes.flatMap(strike => [
        option({ expirationDate, strike, optionType: 'call' }),
        option({ expirationDate, strike, optionType: 'put' }),
      ])
    )),
    expirations: ['2026-06-19', '2026-07-31'],
  };
}

function expectFinitePlotlyData(plotlyConfig) {
  expect(plotlyConfig.data.length).toBeGreaterThanOrEqual(2);
  plotlyConfig.data.forEach(trace => {
    expect(trace.x.length).toBeGreaterThan(40);
    expect(trace.y.length).toBe(trace.x.length);
    trace.x.forEach(value => expect(Number.isFinite(value)).toBe(true));
    trace.y.forEach(value => expect(Number.isFinite(value)).toBe(true));
  });

  const spots = plotlyConfig.data[0].x;
  expect(Math.max(...spots) - Math.min(...spots)).toBeGreaterThan(10000);
  expect(plotlyConfig.layout.xaxis.fixedrange).toBe(false);
  expect(plotlyConfig.layout.yaxis.fixedrange).toBe(false);
  expect(plotlyConfig.layout.margin.l).toBeGreaterThanOrEqual(70);
  expect(plotlyConfig.config.responsive).toBe(true);
}

test('builds finite Plotly data for every strategy payoff chart', () => {
  const chain = buildMockChain();
  OPTIONS_STRATEGY_CATALOG.forEach(strategy => {
    const setup = buildStrategySetup({
      strategyId: strategy.id,
      chain,
      now: NOW,
    });
    const payoff = buildPayoffModel({
      legs: setup.legs,
      underlyingPrice: setup.underlyingPrice,
      now: NOW,
      pointCount: 81,
    });
    expectFinitePlotlyData(buildPayoffPlotlyConfig(payoff));
  });
});
