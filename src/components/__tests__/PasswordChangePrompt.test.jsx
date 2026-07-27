import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PasswordChangePrompt from '../PasswordChangePrompt';

let mockAuthState;

jest.mock('react-redux', () => ({
  useSelector: selector => selector({
    auth: mockAuthState,
  }),
}));

jest.mock('../ChangePassword', () => ({ visible }) => (
  <div>{visible ? 'password prompt open' : 'password prompt closed'}</div>
));

beforeEach(() => {
  mockAuthState = {
    isAuthenticated: true,
    user: { id: 1, username: 'admin', passwordChangeRecommended: true },
  };
});

test('opens the password dialog for an account using an initial simple password', async () => {
  render(<PasswordChangePrompt />);

  await waitFor(() => {
    expect(screen.getByText('password prompt open')).toBeInTheDocument();
  });
});

test('skips the password dialog for a demo account using its shared password', () => {
  mockAuthState = {
    isAuthenticated: true,
    user: {
      id: 4,
      username: 'test',
      passwordChangeRecommended: true,
      demoAccount: true,
    },
  };

  render(<PasswordChangePrompt />);

  expect(screen.queryByText('password prompt open')).not.toBeInTheDocument();
});
