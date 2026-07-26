import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PasswordChangePrompt from '../PasswordChangePrompt';

jest.mock('react-redux', () => ({
  useSelector: selector => selector({
    auth: {
      isAuthenticated: true,
      user: { id: 1, username: 'admin', passwordChangeRecommended: true },
    },
  }),
}));

jest.mock('../ChangePassword', () => ({ visible }) => (
  <div>{visible ? 'password prompt open' : 'password prompt closed'}</div>
));

test('opens the password dialog for an account using an initial simple password', async () => {
  render(<PasswordChangePrompt />);

  await waitFor(() => {
    expect(screen.getByText('password prompt open')).toBeInTheDocument();
  });
});
