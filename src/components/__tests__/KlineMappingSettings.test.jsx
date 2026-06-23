import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import KlineMappingSettings, {
  getTradingSymbolForMarket,
  normalizeBinanceTradingSymbol,
} from '../KlineMappingSettings';
import {
  fetchKlineMappings,
  seedDefaultKlineMappings,
  updateKlineMapping,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchKlineMappings: jest.fn(),
  seedDefaultKlineMappings: jest.fn(),
  updateKlineMapping: jest.fn(),
}));

describe('KlineMappingSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchKlineMappings.mockResolvedValue({
      mappings: [
        {
          coinId: 1,
          coinSymbol: 'CN_AI_ETF',
          coinName: '国内人工智能 ETF',
          market: 'yahoo_finance',
          tradingSymbol: '159819.SZ',
          enabled: true,
          notes: '默认映射',
          updatedAt: '2026-06-17T00:00:00.000Z',
          isDefault: false,
        },
      ],
    });
    updateKlineMapping.mockResolvedValue({
      mapping: {
        coinId: 1,
        coinSymbol: 'CN_AI_ETF',
        coinName: '国内人工智能 ETF',
        market: 'yahoo_finance',
        tradingSymbol: '159819.SZ',
        enabled: true,
        notes: '默认映射',
      },
    });
    seedDefaultKlineMappings.mockResolvedValue({ created: 0, rows: [] });
  });

  test('loads and saves kline mapping rows', async () => {
    render(<KlineMappingSettings />);

    expect(await screen.findByText('CN_AI_ETF')).toBeInTheDocument();
    expect(screen.getByDisplayValue('159819.SZ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存 CN_AI_ETF' }));

    await waitFor(() => {
      expect(updateKlineMapping).toHaveBeenCalledWith(1, {
        market: 'yahoo_finance',
        trading_symbol: '159819.SZ',
        enabled: true,
        notes: '默认映射',
      });
    });
  });

  test('can seed default mappings and reload list', async () => {
    render(<KlineMappingSettings />);

    await screen.findByText('CN_AI_ETF');
    fireEvent.click(screen.getByRole('button', { name: '补齐默认映射' }));

    await waitFor(() => {
      expect(seedDefaultKlineMappings).toHaveBeenCalledTimes(1);
      expect(fetchKlineMappings).toHaveBeenCalledTimes(2);
    });
  });

  test('shows a visible save all action', async () => {
    render(<KlineMappingSettings />);

    await screen.findByText('CN_AI_ETF');
    fireEvent.click(screen.getByRole('button', { name: '保存全部K线映射' }));

    await waitFor(() => {
      expect(updateKlineMapping).toHaveBeenCalledWith(1, {
        market: 'yahoo_finance',
        trading_symbol: '159819.SZ',
        enabled: true,
        notes: '默认映射',
      });
    });
  });

  test('normalizes Binance mapping symbols with USDT suffix', () => {
    expect(normalizeBinanceTradingSymbol('btc')).toBe('BTCUSDT');
    expect(normalizeBinanceTradingSymbol('ETHUSDT')).toBe('ETHUSDT');
    expect(getTradingSymbolForMarket({
      coinSymbol: 'BTC',
      market: 'yahoo_finance',
      tradingSymbol: '^BTC',
    }, 'binance_usdm_perpetual')).toBe('BTCUSDT');
  });

  test('keeps China futures mapping symbols unchanged', () => {
    expect(getTradingSymbolForMarket({
      coinSymbol: 'CN_HOG',
      market: 'yahoo_finance',
      tradingSymbol: 'LH0',
    }, 'china_futures_sina')).toBe('LH0');
  });

  test('shows China futures source label', async () => {
    fetchKlineMappings.mockResolvedValueOnce({
      mappings: [
        {
          coinId: 2,
          coinSymbol: 'CN_HOG',
          coinName: '国内生猪',
          market: 'china_futures_sina',
          tradingSymbol: 'LH0',
          enabled: true,
          notes: '默认映射',
          isDefault: true,
        },
      ],
    });

    render(<KlineMappingSettings />);

    expect(await screen.findByText('CN_HOG')).toBeInTheDocument();
    expect(screen.getAllByText('新浪国内期货').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('LH0')).toBeInTheDocument();
  });
});
