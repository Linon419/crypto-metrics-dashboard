import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotificationCenter from '../NotificationCenter';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  fetchNotifications.mockResolvedValue({
    notifications: [
      {
        id: 7,
        title: '高质量进场期初期',
        content: 'BTC · Bitcoin\n场外：1080\n质量：高质量进场',
        category: 'quality',
        priority: 'high',
        coinSymbol: 'BTC',
        readAt: null,
        createdAt: '2026-07-26T08:30:00.000Z',
      },
    ],
    unreadCount: 1,
  });
  markNotificationRead.mockResolvedValue({ success: true });
  markAllNotificationsRead.mockResolvedValue({ success: true, updatedCount: 1 });
});

test('shows Telegram notification content and supports read actions', async () => {
  render(<NotificationCenter />);

  const trigger = await screen.findByRole('button', { name: '打开通知中心，1 条未读' });
  fireEvent.click(trigger);

  expect(await screen.findByText('高质量进场期初期')).toBeInTheDocument();
  expect(screen.getByText(/场外：1080/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '标记 高质量进场期初期 为已读' }));
  await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(7));

  fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
  await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
});
