import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChangePassword from '../ChangePassword';
import { changePassword } from '../../services/api';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
let mockAuthUser = { id: 7, username: 'member' };

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: selector => selector({ auth: { user: mockAuthUser } }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('../../services/api', () => ({
  changePassword: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUser = { id: 7, username: 'member' };
  changePassword.mockResolvedValue({ reauthenticationRequired: true });
});

test('shows a clear warning when the account uses an initial simple password', () => {
  mockAuthUser = { id: 7, username: 'admin', passwordChangeRecommended: true };

  render(<ChangePassword visible onClose={jest.fn()} />);

  expect(screen.getByText('请更换初始密码')).toBeInTheDocument();
  expect(screen.getAllByText(/至少15个字符/).length).toBeGreaterThan(0);
});

test('offers no way out when the password change is mandatory', () => {
  mockAuthUser = { id: 7, username: 'admin', passwordChangeRecommended: true };

  render(<ChangePassword visible mandatory onClose={jest.fn()} />);

  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '修改密码' })).toBeInTheDocument();
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
