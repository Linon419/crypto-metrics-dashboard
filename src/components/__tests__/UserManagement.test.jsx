import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserManagement from '../UserManagement';
import {
  getAllUsers,
  getSystemSettings,
  getUserAuditLogs,
} from '../../services/api';

jest.mock('react-redux', () => ({
  useSelector: selector => selector({
    auth: { user: { id: 1, username: 'owner', role: 'admin' } },
  }),
}));

jest.mock('../../services/api', () => ({
  getAllUsers: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  banUser: jest.fn(),
  unbanUser: jest.fn(),
  getSystemSettings: jest.fn(),
  updateSystemSettings: jest.fn(),
  getUserAuditLogs: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getAllUsers.mockResolvedValue({
    users: [{
      id: 1,
      username: 'owner',
      email: 'owner@example.com',
      role: 'admin',
      status: 'active',
      lastLogin: '2026-07-26T08:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  });
  getSystemSettings.mockResolvedValue({ settings: { registrationEnabled: false } });
  getUserAuditLogs.mockResolvedValue({
    auditLogs: [{
      id: 4,
      actorUsername: 'owner',
      targetUsername: 'owner',
      action: 'auth.login.success',
      createdAt: '2026-07-26T08:00:00.000Z',
    }],
  });
});

test('protects the current final administrator and displays audit history', async () => {
  render(<UserManagement />);

  expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '封禁 owner' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '删除 owner' })).toBeDisabled();
  expect(await screen.findByText('登录成功')).toBeInTheDocument();
  expect(getUserAuditLogs).toHaveBeenCalledWith({ limit: 50 });
});
