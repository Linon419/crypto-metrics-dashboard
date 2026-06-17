import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import OtcIndexTable from '../OtcIndexTable';

// Mock data for testing
const mockCoins = Array.from({ length: 25 }, (_, index) => ({
  symbol: `COIN${index + 1}`,
  otcIndex: (1000 + index * 10).toString(),
  explosionIndex: (300 + index * 5).toString(),
  schellingPoint: (50 + index).toString(),
  entryExitType: index % 3 === 0 ? 'entry' : index % 3 === 1 ? 'exit' : 'neutral',
  entryExitDay: index % 7 + 1,
  entryExitQuality: index % 2 === 0 ? '高质量进场' : '低质量进场',
  otcIndexChangePercent: ((Math.random() - 0.5) * 10).toFixed(2),
  explosionIndexChangePercent: ((Math.random() - 0.5) * 20).toFixed(2),
  previousDayData: {
    otc_index: (990 + index * 10).toString(),
    explosion_index: (290 + index * 5).toString()
  }
}));

describe('OtcIndexTable', () => {
  test('renders table with pagination controls', () => {
    render(<OtcIndexTable coins={mockCoins} />);
    
    // Check if table is rendered
    expect(screen.getByText('场外指数表')).toBeInTheDocument();
    
    // Check if pagination is present (should show when data > pageSize)
    expect(screen.getByText(/第.*条，共.*条/)).toBeInTheDocument();
  });

  test('shows page size selector', () => {
    render(<OtcIndexTable coins={mockCoins} />);
    
    expect(document.querySelector('.ant-select-selector')).toBeInTheDocument();
  });

  test('displays correct number of rows per page', () => {
    render(<OtcIndexTable coins={mockCoins} />);
    
    // Should show 10 rows by default (plus header)
    const tableRows = screen.getAllByRole('row');
    // Header row + 10 data rows = 11 total
    expect(tableRows).toHaveLength(11);
  });

  test('handles empty data gracefully', () => {
    render(<OtcIndexTable coins={[]} />);
    
    // Should still render the table structure
    expect(screen.getByText('场外指数表')).toBeInTheDocument();
    
    expect(document.querySelector('.ant-table-empty')).toBeInTheDocument();
  });

  test('shows loading state', () => {
    render(<OtcIndexTable coins={mockCoins} loading={true} />);
    
    expect(document.querySelector('.ant-spin-spinning')).toBeInTheDocument();
  });

  test('calls onCoinSelect when symbol is clicked', () => {
    const onCoinSelect = jest.fn();
    render(
      <OtcIndexTable
        coins={mockCoins.slice(0, 3)}
        onCoinSelect={onCoinSelect}
        selectedCoin="COIN2"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'COIN2' }));

    expect(onCoinSelect).toHaveBeenCalledWith('COIN2');
    expect(screen.getByRole('button', { name: 'COIN2' })).toHaveClass('is-active');
  });

  test('renders asterisk momentum indicator', () => {
    render(
      <OtcIndexTable
        coins={[
          {
            symbol: 'SNDK',
            otcIndex: 1529,
            explosionIndex: 249,
            entryExitType: 'entry',
            entryExitDay: 34,
            momentumIndicators: ['*']
          }
        ]}
      />
    );

    expect(screen.getByText('*')).toBeInTheDocument();
  });
});
