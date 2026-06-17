import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BtcVolatilityPanel from '../BtcVolatilityPanel';
import { fetchBtcVolatility } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchBtcVolatility: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('defaults to daily RV/IV and can switch to annualized values', async () => {
  fetchBtcVolatility.mockResolvedValue({
    data: {
      dailyRv: 0.021,
      dailyIv: 0.0195969916617776,
      dvolAnnualizedPercent: 37.44,
      atr: 2280,
      comparison: {
        label: '接近',
        bias: 'balanced',
        spread: -0.0014030083382224,
        ratio: 0.93,
      },
    },
  });

  render(<BtcVolatilityPanel />);

  expect(await screen.findByText((_, element) => element?.textContent === 'IV 1.96%')).toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.textContent === '年化IV 37.44%')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('radio', { name: '年化' }));

  expect(screen.getByText((_, element) => element?.textContent === 'IV 37.44%')).toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.textContent === '日化IV 1.96%')).toBeInTheDocument();
});
