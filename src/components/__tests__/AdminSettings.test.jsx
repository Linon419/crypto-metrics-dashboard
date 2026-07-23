import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminSettings from '../AdminSettings';

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('tab=users'), jest.fn()],
}), { virtual: true });

jest.mock('../AIModelSettings', () => () => <div>AI model panel</div>);
jest.mock('../CoinManagement', () => () => <div>Coin panel</div>);
jest.mock('../KlineCleanupSettings', () => () => <div>Kline cleanup panel</div>);
jest.mock('../KlineMappingSettings', () => () => <div>Kline mapping panel</div>);
jest.mock('../PromptSettings', () => () => <div>Prompt panel</div>);
jest.mock('../UserManagement', () => () => <div>User management panel</div>);

test('shows user management inside Admin settings', () => {
  render(<AdminSettings />);

  expect(screen.getByText('用户管理')).toBeInTheDocument();
  expect(screen.getByText('User management panel')).toBeInTheDocument();
});
