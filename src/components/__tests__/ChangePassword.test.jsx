import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChangePassword from '../ChangePassword';
import { changePassword } from '../../services/api';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: selector => selector({ auth: { user: { id: 7, username: 'member' } } }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('../../services/api', () => ({
  changePassword: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  changePassword.mockResolvedValue({ reauthenticationRequired: true });
});

test('changes the authenticated user password and requires a new login', async () => {
  render(<ChangePassword visible onClose={jest.fn()} />);

  fireEvent.change(screen.getByPlaceholderText('当前密码'), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.change(screen.getByPlaceholderText('新密码'), {
    target: { value: 'a newly secured passphrase' },
  });
  fireEvent.change(screen.getByPlaceholderText('确认新密码'), {
    target: { value: 'a newly secured passphrase' },
  });
  fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

  await waitFor(() => expect(changePassword).toHaveBeenCalledWith({
    currentPassword: 'correct horse battery staple',
    newPassword: 'a newly secured passphrase',
  }));
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/logout' }));
  expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
});
