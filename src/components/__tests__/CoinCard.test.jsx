import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CoinCard from '../CoinCard';

jest.mock('../../utils/coinLogos', () => ({
  getCoinLogoFallbackUrl: symbol => `/fallback/${symbol}.png`,
  getCoinLogoUrl: symbol => `/logo/${symbol}.png`,
}));

const coin = {
  symbol: 'BTC',
  entryExitType: 'entry',
  entryExitDay: 15,
  explosionIndex: 74,
  explosionIndexChangePercent: -48.6,
  otcIndex: 1040,
  otcIndexChangePercent: -3.7,
  schellingPoint: 0,
};

test('renders the aligned card content structure and metrics', () => {
  const { container } = render(<CoinCard coin={coin} />);

  expect(screen.getByText('BTC')).toBeInTheDocument();
  expect(screen.getByText('进15')).toBeInTheDocument();
  expect(container.querySelector('.coin-card__content')).toBeInTheDocument();
  expect(container.querySelector('.coin-card__details')).toBeInTheDocument();
  expect(container.querySelector('.coin-card__metrics')).toBeInTheDocument();
});

test('keeps the favorite action separate from the card selection action', () => {
  const onCardClick = jest.fn();
  const onToggleFavorite = jest.fn();
  render(
    <CoinCard
      coin={coin}
      isFavorite={false}
      onCardClick={onCardClick}
      onToggleFavorite={onToggleFavorite}
    />
  );

  fireEvent.click(screen.getByRole('button'));

  expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  expect(onCardClick).not.toHaveBeenCalled();
});

test('hides the schelling point when the value is missing', () => {
  const { rerender } = render(<CoinCard coin={{ ...coin, schellingPoint: null }} />);
  expect(screen.queryByText('谢林:')).not.toBeInTheDocument();

  rerender(<CoinCard coin={{ ...coin, schellingPoint: 98500 }} />);
  expect(screen.getByText('谢林:')).toBeInTheDocument();
  expect(screen.getByText('98,500')).toBeInTheDocument();
});

test('shows the warning icon only when explosion just dropped below 200', () => {
  const { container, rerender } = render(
    <CoinCard coin={{ ...coin, explosionIndex: 74, previousDayData: { explosion_index: 144 } }} />
  );
  expect(container.querySelector('.coin-card__warning')).not.toBeInTheDocument();

  rerender(<CoinCard coin={{ ...coin, explosionIndex: 180, previousDayData: { explosion_index: 230 } }} />);
  expect(container.querySelector('.coin-card__warning')).toBeInTheDocument();
});
