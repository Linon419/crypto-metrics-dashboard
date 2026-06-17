import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CoinManagement from '../CoinManagement';
import {
  createAdminCoin,
  deleteAdminCoin,
  fetchAdminCoins,
  updateAdminCoin,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  createAdminCoin: jest.fn(),
  deleteAdminCoin: jest.fn(),
  fetchAdminCoins: jest.fn(),
  updateAdminCoin: jest.fn(),
}));

describe('CoinManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchAdminCoins.mockResolvedValue({
      coins: [
        {
          id: 1,
          symbol: 'BTC',
          name: 'Bitcoin',
          current_price: 65000,
          logo_url: 'https://example.com/btc.png',
          latestMetricDate: '2026-06-06',
          globalLatestMetricDate: '2026-06-06',
          isLatestMetricMissing: false,
          updatedAt: '2026-06-17T00:00:00.000Z',
        },
        {
          id: 2,
          symbol: 'EOS',
          name: 'EOS Network',
          current_price: null,
          logo_url: '',
          latestMetricDate: '2025-06-01',
          globalLatestMetricDate: '2026-06-06',
          isLatestMetricMissing: true,
          updatedAt: '2026-06-17T00:00:00.000Z',
        },
      ],
    });
    createAdminCoin.mockResolvedValue({ coin: { id: 2, symbol: 'TEST', name: 'Test Coin' } });
    updateAdminCoin.mockResolvedValue({ coin: { id: 1, symbol: 'BTC', name: 'Bitcoin' } });
  });

  test('loads coin rows', async () => {
    render(<CoinManagement />);

    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('65,000')).toBeInTheDocument();
    expect(screen.getByText('最新')).toBeInTheDocument();
    expect(screen.getByText('缺最新')).toBeInTheDocument();
  });

  test('filters coins missing latest metric date', async () => {
    render(<CoinManagement />);

    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('EOS')).toBeInTheDocument();

    fireEvent.click(screen.getByText('最新日期缺失'));

    expect(screen.queryByText('BTC')).not.toBeInTheDocument();
    expect(screen.getByText('EOS')).toBeInTheDocument();
  });

  test('opens create modal', async () => {
    render(<CoinManagement />);

    await screen.findByText('BTC');
    fireEvent.click(screen.getByRole('button', { name: '新增币种' }));

    expect(screen.getByRole('dialog', { name: '新增币种' })).toBeInTheDocument();
    expect(screen.getByLabelText('Symbol')).toBeInTheDocument();
  });

  test('shows force delete confirmation when dependencies exist', async () => {
    const error = new Error('需要二次确认');
    error.response = {
      status: 409,
      data: {
        requiresConfirmation: true,
        coin: { id: 1, symbol: 'BTC', name: 'Bitcoin' },
        dependencies: {
          dailyMetrics: 2,
          otcAndExplosionMetrics: 2,
          coinKlines: 3,
          coinKlineMappings: 1,
          userFavorites: 1,
          btcPricePoints: 4,
          total: 11,
        },
      },
    };
    deleteAdminCoin
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ deleted: true });

    render(<CoinManagement />);

    await screen.findByText('BTC');
    fireEvent.click(screen.getByRole('button', { name: '删除 BTC' }));

    expect(await screen.findByText('确认删除 BTC')).toBeInTheDocument();
    expect(screen.getByText('场外/爆破指标: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认删除全部关联数据' }));

    await waitFor(() => {
      expect(deleteAdminCoin).toHaveBeenLastCalledWith(1, { force: true });
    });
  });
});
