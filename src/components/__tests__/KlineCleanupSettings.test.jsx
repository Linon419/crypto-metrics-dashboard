import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import KlineCleanupSettings from '../KlineCleanupSettings';
import {
  deleteKlinesByCleanupFilters,
  previewKlineCleanup,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  deleteKlinesByCleanupFilters: jest.fn(),
  previewKlineCleanup: jest.fn(),
}));

describe('KlineCleanupSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewKlineCleanup.mockResolvedValue({
      success: true,
      count: 6395,
      filters: {
        coinSymbol: 'GOLD',
        market: 'yahoo_finance',
        tradingSymbol: 'GLD',
        interval: null,
        startDate: null,
        endDate: null,
      },
    });
    deleteKlinesByCleanupFilters.mockResolvedValue({
      success: true,
      deleted: 6395,
    });
  });

  test('confirms and deletes klines matched by the current filters', async () => {
    render(<KlineCleanupSettings />);

    fireEvent.click(screen.getByRole('button', { name: /预览命中数量/ }));

    expect(await screen.findByText('6,395')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /删除命中K线/ }));

    expect(await screen.findByText('确认删除K线')).toBeInTheDocument();
    expect(screen.getByText('将删除当前过滤条件命中的 6395 根K线。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(deleteKlinesByCleanupFilters).toHaveBeenCalledWith({
        coinSymbol: 'GOLD',
        market: 'yahoo_finance',
        tradingSymbol: 'GLD',
        interval: '',
        startDate: '',
        endDate: '',
      });
    });
  });
});
