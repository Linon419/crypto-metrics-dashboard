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
  expect(screen.getAllByText(/至少6个字符/).length).toBeGreaterThan(0);
});

test('cannot be dismissed when mandatory, but still offers a sign-out escape', () => {
  mockAuthUser = { id: 7, username: 'admin', passwordChangeRecommended: true };

  render(<ChangePassword visible mandatory onClose={jest.fn()} />);

  // 仍然不允许"取消"掉过强制改密
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '修改密码' })).toBeInTheDocument();

  // 但必须留一条出口：忘记当前密码的用户否则只能手工清 localStorage
  const signOut = screen.getByRole('button', { name: '退出登录' });
  expect(signOut).toBeInTheDocument();

  fireEvent.click(signOut);

  expect(mockDispatch).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
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
